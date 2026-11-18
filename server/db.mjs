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
-- Résiliations et rétractations reçues en ligne (preuve : contenu, date et heure). Gardées 5 ans, même après suppression du compte.
CREATE TABLE IF NOT EXISTS demandes (id INTEGER PRIMARY KEY, type TEXT NOT NULL, user_id INTEGER, email TEXT NOT NULL, contenu TEXT NOT NULL, at TEXT NOT NULL);
-- Clés de l'extension navigateur (remplissage du dépôt Le Bon Coin) : lecture seule des annonces.
CREATE TABLE IF NOT EXISTS ext_keys (
  token    TEXT PRIMARY KEY,                     -- empreinte SHA-256 de la clé
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created  TEXT NOT NULL,
  used     TEXT NOT NULL DEFAULT ''
);
`);

// Colonnes ajoutées après la mise en ligne (une base existante les reçoit au démarrage).
const COLS = {
  cgv_at: "TEXT NOT NULL DEFAULT ''",        // date d'acceptation des conditions générales (preuve)
  cgv_version: "TEXT NOT NULL DEFAULT ''",   // version acceptée (date de mise à jour des CG)
  plan_cancel: "TEXT NOT NULL DEFAULT ''",   // résiliation demandée : date de fin de l'abonnement (ISO)
  rappel: "TEXT NOT NULL DEFAULT ''",        // échéance annuelle déjà rappelée par e-mail (loi Chatel)
  achat_at: "TEXT NOT NULL DEFAULT ''",      // date du dernier achat (point de départ du délai de rétractation)
  achat_ref: "TEXT NOT NULL DEFAULT ''",     // offre:periode achetée
  achat_montant: "INTEGER NOT NULL DEFAULT 0", // montant payé, en centimes
  retract_at: "TEXT NOT NULL DEFAULT ''",    // rétractation reçue pour cet achat
  pseudo: "TEXT NOT NULL DEFAULT ''",        // nom affiché dans le menu
  avatar: "TEXT NOT NULL DEFAULT ''",        // photo de profil (data URL JPEG 256 px)
  email_new: "TEXT NOT NULL DEFAULT ''",     // nouvelle adresse en attente de confirmation
  email_token: "TEXT NOT NULL DEFAULT ''",   // empreinte du lien de confirmation
  email_until: "TEXT NOT NULL DEFAULT ''",
  test_plan: "TEXT NOT NULL DEFAULT ''",     // formule de test, prise en compte seulement pour les comptes de ADMIN_EMAILS
  email_ok: "INTEGER NOT NULL DEFAULT 0",    // adresse confirmée (lien reçu par e-mail) : requis pour l'essai gratuit de l'IA
  verif_token: "TEXT NOT NULL DEFAULT ''",   // empreinte du lien de confirmation d'adresse
};
const have = new Set(db.prepare("PRAGMA table_info(users)").all().map((c) => c.name));
for (const [c, def] of Object.entries(COLS)) if (!have.has(c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${def}`);
// Comptes créés avant la confirmation d'adresse : considérés comme confirmés.
if (!have.has("email_ok") && have.size) db.exec("UPDATE users SET email_ok = 1");

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
setInterval(() => { try { db.prepare("DELETE FROM hits WHERE until < ?").run(Date.now()); db.prepare("DELETE FROM demandes WHERE at < ?").run(new Date(Date.now() - 5 * 365.25 * 864e5).toISOString()); db.prepare("DELETE FROM sessions WHERE expires < ?").run(now()); } catch (e) {} }, 3600_000).unref();

export const photoPath = (userId, itemId) => path.join(DATA_DIR, "photos", String(userId), String(itemId).replace(/[^a-z0-9-]/gi, "") + ".jpg");
