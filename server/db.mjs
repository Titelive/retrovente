// Base de données SQLite (module node:sqlite intégré à Node 22, aucune dépendance à installer).
// Fichier : DATA_DIR/retrorevente.db. Les photos sont à part, dans DATA_DIR/photos/<utilisateur>/<objet>.jpg.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, "retrorevente.db"));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass            TEXT NOT NULL,                 -- scrypt : sel$hash
  created         TEXT NOT NULL,
  plan            TEXT NOT NULL DEFAULT 'gratuit', -- gratuit | vendeur | collectionneur (abonnement Stripe actif)
  plan_status     TEXT NOT NULL DEFAULT '',      -- statut Stripe de l'abonnement (active, past_due, canceled…)
  plan_period     TEXT NOT NULL DEFAULT '',      -- mois | an
  plan_end        TEXT NOT NULL DEFAULT '',      -- fin de la période payée (ISO)
  pass_until      TEXT NOT NULL DEFAULT '',      -- fin du Pass Grand ménage (ISO), illimité jusque-là
  stripe_customer TEXT NOT NULL DEFAULT '',
  stripe_sub      TEXT NOT NULL DEFAULT '',
  reset_token     TEXT NOT NULL DEFAULT '',      -- empreinte du lien de nouveau mot de passe
  reset_until     TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
  token    TEXT PRIMARY KEY,                     -- empreinte SHA-256 du jeton du cookie
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id       TEXT PRIMARY KEY,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data     TEXT NOT NULL,                        -- fiche de l'objet (JSON)
  created  TEXT NOT NULL,
  updated  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_user ON items(user_id, created);
-- Compteurs d'utilisation par mois (AAAA-MM) : jeux ajoutés (quota), outils utilisés (temps gagné).
CREATE TABLE IF NOT EXISTS usage (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month    TEXT NOT NULL,
  kind     TEXT NOT NULL,
  n        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month, kind)
);
-- Événements Stripe déjà traités (Stripe peut renvoyer le même plusieurs fois).
CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, at TEXT NOT NULL);
-- Limiteur d'essais (connexion, inscription, IA) : clé → nombre d'essais dans la fenêtre.
CREATE TABLE IF NOT EXISTS hits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL);
`);

export const now = () => new Date().toISOString();
export const month = (d = new Date()) => d.toISOString().slice(0, 7);

export function tx(fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

export function bump(userId, kind, by = 1) {
  db.prepare(`INSERT INTO usage(user_id, month, kind, n) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, month, kind) DO UPDATE SET n = n + excluded.n`).run(userId, month(), kind, by);
}
export function usageOf(userId, m = month()) {
  const out = {};
  for (const r of db.prepare("SELECT kind, n FROM usage WHERE user_id = ? AND month = ?").all(userId, m)) out[r.kind] = r.n;
  return out;
}
export function usageTotal(userId) {
  const out = {};
  for (const r of db.prepare("SELECT kind, SUM(n) AS n FROM usage WHERE user_id = ? GROUP BY kind").all(userId)) out[r.kind] = r.n;
  return out;
}

/** Limiteur simple : au plus `max` essais par `windowS` secondes pour une clé. Renvoie true si autorisé. */
export function allow(key, max, windowS) {
  const t = Date.now();
  const r = db.prepare("SELECT n, until FROM hits WHERE key = ?").get(key);
  if (!r || r.until < t) { db.prepare("INSERT OR REPLACE INTO hits(key, n, until) VALUES (?, 1, ?)").run(key, t + windowS * 1000); return true; }
  if (r.n >= max) return false;
  db.prepare("UPDATE hits SET n = n + 1 WHERE key = ?").run(key);
  return true;
}
setInterval(() => { try { db.prepare("DELETE FROM hits WHERE until < ?").run(Date.now()); db.prepare("DELETE FROM sessions WHERE expires < ?").run(now()); } catch (e) {} }, 3600_000).unref();

export const photoPath = (userId, itemId) => path.join(DATA_DIR, "photos", String(userId), String(itemId).replace(/[^a-z0-9-]/gi, "") + ".jpg");
