// Comptes : e-mail + mot de passe (scrypt), session dans un cookie HttpOnly, mot de passe oublié par e-mail.
import crypto from "node:crypto";
import { db, now } from "./db.mjs";

const COOKIE = "rr_session", DUREE = 60 * 864e5;   // 60 jours
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

export function hashPass(p) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + "$" + crypto.scryptSync(p, salt, 64, { N: 16384 }).toString("hex");
}
export function checkPass(p, stored) {
  const [salt, h] = String(stored).split("$");
  if (!salt || !h) return false;
  const got = crypto.scryptSync(p, salt, 64, { N: 16384 });
  return crypto.timingSafeEqual(got, Buffer.from(h, "hex"));
}
export const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e);

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions(token, user_id, expires) VALUES (?, ?, ?)").run(sha(token), userId, new Date(Date.now() + DUREE).toISOString());
  return token;
}
export function sessionCookie(token, secure = true) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? DUREE / 1000 : 0}${secure ? "; Secure" : ""}`;
}
const tokenOf = (req) => { const m = new RegExp("(?:^|;\\s*)" + COOKIE + "=([A-Za-z0-9_-]+)").exec(req.headers.cookie || ""); return m ? m[1] : ""; };
export function currentUser(req) {
  const t = tokenOf(req); if (!t) return null;
  return db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?").get(sha(t), now()) || null;
}
export function endSession(req) { const t = tokenOf(req); if (t) db.prepare("DELETE FROM sessions WHERE token = ?").run(sha(t)); }
export const endAllSessions = (userId) => db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);

/* Extension navigateur : clé « Bearer » propre à chaque navigateur, qui ne donne accès qu'à la lecture des annonces.
   On garde les 5 plus récentes par compte ; changer de mot de passe ou se déconnecter partout ne les touche pas,
   « Déconnecter l'extension » (Mon compte) les supprime toutes. */
export function createExtKey(userId) {
  const t = "rre_" + crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO ext_keys(token, user_id, created) VALUES (?, ?, ?)").run(sha(t), userId, now());
  db.prepare("DELETE FROM ext_keys WHERE user_id = ? AND token NOT IN (SELECT token FROM ext_keys WHERE user_id = ? ORDER BY created DESC LIMIT 5)").run(userId, userId);
  return t;
}
export function extUser(req) {
  const m = /^Bearer (rre_[A-Za-z0-9_-]{20,80})$/.exec(String(req.headers.authorization || ""));
  if (!m) return null;
  const h = sha(m[1]);
  const u = db.prepare("SELECT u.* FROM ext_keys k JOIN users u ON u.id = k.user_id WHERE k.token = ?").get(h);
  if (u) db.prepare("UPDATE ext_keys SET used = ? WHERE token = ?").run(now(), h);
  return u || null;
}
export const endExtKeys = (userId) => db.prepare("DELETE FROM ext_keys WHERE user_id = ?").run(userId).changes;
export const countExtKeys = (userId) => db.prepare("SELECT COUNT(*) AS n FROM ext_keys WHERE user_id = ?").get(userId).n;

/** Lien de nouveau mot de passe (valable 1 heure). Renvoie le jeton en clair, à mettre dans l'e-mail. */
export function makeReset(userId) {
  const t = crypto.randomBytes(24).toString("base64url");
  db.prepare("UPDATE users SET reset_token = ?, reset_until = ? WHERE id = ?").run(sha(t), new Date(Date.now() + 3600e3).toISOString(), userId);
  return t;
}
export function useReset(token) {
  if (!token) return null;
  const u = db.prepare("SELECT * FROM users WHERE reset_token = ? AND reset_until > ?").get(sha(token), now());
  if (u) db.prepare("UPDATE users SET reset_token = '', reset_until = '' WHERE id = ?").run(u.id);
  return u || null;
}

/** Envoi d'e-mail par Resend (RESEND_API_KEY, MAIL_FROM). Sans clé, l'e-mail est seulement écrit dans le journal. */
export async function sendMail(to, subject, text, html) {
  if (!process.env.RESEND_API_KEY) { console.log(`[e-mail non envoyé, RESEND_API_KEY absent] à ${to} : ${subject}\n${text}`); return false; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.MAIL_FROM || "RetroRevente <bonjour@retrorevente.fr>", to: [to], subject, text, ...(html ? { html } : {}) }),
  });
  if (!r.ok) { console.error("e-mail", r.status, await r.text().catch(() => "")); return false; }
  return true;
}
