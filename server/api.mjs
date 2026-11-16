// API de l'appli (/api/…). Réponses JSON ; session par cookie (voir auth.mjs).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, now, month, bump, usageOf, usageTotal, allow, photoPath, tx } from "./db.mjs";
import { hashPass, checkPass, validEmail, createSession, sessionCookie, currentUser, endSession, endAllSessions, makeReset, useReset, sendMail } from "./auth.mjs";
import { rights, SEUIL_VENTES, SEUIL_MONTANT } from "./plans.mjs";
import * as ia from "./ia.mjs";
import * as stripe from "./stripe.mjs";

const { txt, prix, jour, parmi, lien } = ia;
const STATUTS = ["en_vente", "reserve", "vendu", "envoye", "retire"];
const REMISES = ["main_propre", "envoi", ""];
const FAIR_USE = 600;   // appels IA par mois, plafond de bon usage des formules illimitées

const SITE = () => (process.env.SITE_URL || "https://retrorevente.fr").replace(/\/$/, "");
const secure = () => process.env.COOKIE_INSECURE !== "1";

export class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const fail = (status, msg, extra) => { throw new HttpError(status, msg, extra); };

/* ===== Fiches ===== */
function nettoyer(v, avant) {
  const titre = txt(v.titre, 160);
  if (!titre) fail(400, "Indique le nom du jeu.");
  const statut = parmi(v.statut, STATUTS, "en_vente");
  const auj = new Date().toISOString().slice(0, 10);
  return {
    titre,
    categorie: parmi(v.categorie, ia.CATEGORIES, "jeux"),
    plateforme: txt(v.plateforme, 60), region: txt(v.region, 30),
    etat: parmi(v.etat, ia.ETATS, ""), contenu: parmi(v.contenu, ia.CONTENUS, ""),
    prixAchat: prix(v.prixAchat), prixDemande: prix(v.prixDemande), prixVente: prix(v.prixVente), frais: prix(v.frais),
    statut,
    dateMiseEnVente: jour(v.dateMiseEnVente) || (avant && avant.dateMiseEnVente) || auj,
    dateVente: ["vendu", "envoye"].includes(statut) ? (jour(v.dateVente) || (avant && avant.dateVente) || auj) : "",
    remise: parmi(v.remise, REMISES, ""),
    titreAnnonce: txt(v.titreAnnonce, 100), texteAnnonce: txt(v.texteAnnonce, 4000),
    annonce: lien(v.annonce), notes: txt(v.notes, 1000),
    cote: ia.coteDe(v.cote),
    ia: !!(v.ia || (avant && avant.ia)),
    photo: !!(avant && avant.photo),
  };
}
const itemOut = (r) => ({ id: r.id, ...JSON.parse(r.data), cree: r.created, modifie: r.updated });
const listItems = (uid) => db.prepare("SELECT * FROM items WHERE user_id = ? ORDER BY created DESC").all(uid).map(itemOut);
const getItem = (uid, id) => { const r = db.prepare("SELECT * FROM items WHERE user_id = ? AND id = ?").get(uid, String(id)); return r ? itemOut(r) : null; };

function savePhoto(uid, id, data) {
  const f = photoPath(uid, id);
  if (data === "") { fs.rmSync(f, { force: true }); return false; }
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(data));
  if (!m || data.length > ia.MAX_PHOTO) fail(400, "Photo trop lourde ou illisible.");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.from(m[1], "base64"));
  return true;
}

/* ===== Quotas ===== */
function quota(u) {
  const r = rights(u), used = usageOf(u.id).ajout || 0;
  return { max: r.quota === Infinity ? null : r.quota, utilise: used, reste: r.quota === Infinity ? null : Math.max(0, r.quota - used) };
}
function needQuota(u) {
  const q = quota(u);
  if (q.reste === 0) fail(402, `Tu as utilisé tes ${q.max} jeux de ce mois avec la formule ${rights(u).nom}.`, { quota: true });
}
function iaAllowed(u) {
  const r = rights(u), us = usageOf(u.id);
  const calls = (us.identifier || 0) + (us.cote || 0) + (us.cadrer || 0);
  const cap = r.quota === Infinity ? FAIR_USE : r.quota * 4 + 6;
  if (calls >= cap) fail(429, "Tu as atteint la limite d'utilisation de l'IA pour ce mois.");
  needQuota(u);
}

/* ===== Bilan (vendus cette année, seuil fiscal) ===== */
function bilan(uid) {
  const items = listItems(uid), an = String(new Date().getFullYear());
  const vendus = items.filter((v) => ["vendu", "envoye"].includes(v.statut));
  const annee = vendus.filter((v) => (v.dateVente || "").startsWith(an));
  const somme = (l) => Math.round(l.reduce((a, v) => a + (v.prixVente || 0), 0) * 100) / 100;
  return {
    objets: items.length, enVente: items.filter((v) => v.statut === "en_vente" || v.statut === "reserve").length,
    vendus: vendus.length, encaisse: somme(vendus), net: Math.round(vendus.reduce((a, v) => a + (v.prixVente || 0) - (v.frais || 0), 0) * 100) / 100,
    annee: { an: +an, ventes: annee.length, montant: somme(annee), seuilVentes: SEUIL_VENTES, seuilMontant: SEUIL_MONTANT },
  };
}

function me(u) {
  const r = rights(u);
  return {
    email: u.email, cree: u.created,
    formule: { id: r.id, nom: r.nom, fiscal: r.fiscal, export: r.export, abonnement: u.plan !== "gratuit" ? u.plan : "", statut: u.plan_status, periode: u.plan_period, fin: u.plan_end, pass: u.pass_until },
    quota: quota(u), usage: usageTotal(u.id), mois: month(),
    bilan: bilan(u.id), paiement: stripe.stripeReady(), client: !!u.stripe_customer,
  };
}

function csv(items) {
  const cols = ["titre", "plateforme", "region", "etat", "contenu", "statut", "prixAchat", "prixDemande", "prixVente", "frais", "dateMiseEnVente", "dateVente", "remise", "annonce", "notes"];
  const q = (v) => { const s = v == null ? "" : String(v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return "﻿" + [cols.join(";"), ...items.map((v) => cols.map((c) => q(typeof v[c] === "number" ? String(v[c]).replace(".", ",") : v[c])).join(";"))].join("\r\n");
}

/* ===== Routeur ===== */
// req : { method, path, headers, ip, body (Buffer) } → { status, json?, body?, headers? }
export async function handleApi(req) {
  const { method, ip } = req, p = req.path;
  const ok = (json, status = 200, headers = {}) => ({ status, json, headers });
  const body = () => { if (!req.body || !req.body.length) return {}; try { return JSON.parse(req.body.toString("utf8")); } catch (e) { fail(400, "Requête illisible."); } };

  // Webhook Stripe : signé, sans cookie.
  if (p === "/api/stripe/webhook" && method === "POST") {
    const raw = req.body.toString("utf8");
    if (!stripe.verify(raw, req.headers["stripe-signature"])) return ok({ error: "Signature invalide." }, 400);
    return ok({ ok: true, r: await stripe.handleEvent(JSON.parse(raw)) });
  }

  // Protection CSRF : les requêtes qui modifient doivent venir de notre site (en plus du cookie SameSite=Lax).
  if (method !== "GET" && method !== "HEAD") {
    const origin = req.headers.origin || "";
    if (origin && new URL(origin).host !== req.headers.host) fail(403, "Origine refusée.");
  }

  /* --- comptes --- */
  if (p === "/api/inscription" && method === "POST") {
    if (!allow("ins:" + ip, 10, 3600)) fail(429, "Trop d'inscriptions depuis cette connexion, réessaie plus tard.");
    const b = body(), email = txt(b.email, 254).toLowerCase(), mdp = String(b.motdepasse || "");
    if (!validEmail(email)) fail(400, "Adresse e-mail invalide.");
    if (mdp.length < 8) fail(400, "Choisis un mot de passe d'au moins 8 caractères.");
    if (!b.cgv) fail(400, "Accepte les conditions générales pour créer ton compte.");
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) fail(409, "Un compte existe déjà avec cette adresse. Connecte-toi.");
    const r = db.prepare("INSERT INTO users(email, pass, created) VALUES (?, ?, ?)").run(email, hashPass(mdp), now());
    const t = createSession(Number(r.lastInsertRowid));
    return ok({ ok: true }, 200, { "Set-Cookie": sessionCookie(t, secure()) });
  }
  if (p === "/api/connexion" && method === "POST") {
    const b = body(), email = txt(b.email, 254).toLowerCase();
    if (!allow("cx:" + ip, 20, 900) || !allow("cxm:" + email, 8, 900)) fail(429, "Trop d'essais. Attends un quart d'heure ou utilise « Mot de passe oublié ».");
    const u = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!u || !checkPass(String(b.motdepasse || ""), u.pass)) fail(401, "E-mail ou mot de passe incorrect.");
    return ok({ ok: true }, 200, { "Set-Cookie": sessionCookie(createSession(u.id), secure()) });
  }
  if (p === "/api/deconnexion" && method === "POST") { endSession(req); return ok({ ok: true }, 200, { "Set-Cookie": sessionCookie("", secure()) }); }
  if (p === "/api/oubli" && method === "POST") {
    const email = txt(body().email, 254).toLowerCase();
    if (!allow("oubli:" + ip, 5, 3600)) fail(429, "Trop de demandes, réessaie plus tard.");
    const u = validEmail(email) && db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (u) await sendMail(u.email, "Ton nouveau mot de passe RetroRevente", `Bonjour,\n\nPour choisir un nouveau mot de passe, ouvre ce lien (valable une heure) :\n${SITE()}/app/?reinitialiser=${makeReset(u.id)}\n\nSi tu n'as rien demandé, ignore ce message.\n\nRetroRevente`);
    return ok({ ok: true });
  }
  if (p === "/api/reinitialiser" && method === "POST") {
    const b = body(), mdp = String(b.motdepasse || "");
    if (mdp.length < 8) fail(400, "Choisis un mot de passe d'au moins 8 caractères.");
    const u = useReset(txt(b.jeton, 100)); if (!u) fail(400, "Ce lien a expiré. Refais une demande.");
    db.prepare("UPDATE users SET pass = ? WHERE id = ?").run(hashPass(mdp), u.id);
    endAllSessions(u.id);
    return ok({ ok: true }, 200, { "Set-Cookie": sessionCookie(createSession(u.id), secure()) });
  }

  const u = currentUser(req);
  if (!u) fail(401, "Connecte-toi pour continuer.");

  if (p === "/api/moi" && method === "GET") return ok(me(u));
  if (p === "/api/compte/motdepasse" && method === "POST") {
    const b = body();
    if (!checkPass(String(b.ancien || ""), u.pass)) fail(400, "Mot de passe actuel incorrect.");
    if (String(b.nouveau || "").length < 8) fail(400, "Choisis un mot de passe d'au moins 8 caractères.");
    db.prepare("UPDATE users SET pass = ? WHERE id = ?").run(hashPass(String(b.nouveau)), u.id);
    return ok({ ok: true });
  }
  if (p === "/api/compte/supprimer" && method === "POST") {
    if (!checkPass(String(body().motdepasse || ""), u.pass)) fail(400, "Mot de passe incorrect.");
    if (u.stripe_sub && ["active", "trialing", "past_due"].includes(u.plan_status)) fail(400, "Résilie d'abord ton abonnement depuis « Gérer mon abonnement ».");
    db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    fs.rmSync(path.dirname(photoPath(u.id, "x")), { recursive: true, force: true });
    return ok({ ok: true }, 200, { "Set-Cookie": sessionCookie("", secure()) });
  }

  /* --- fiches --- */
  if (p === "/api/objets" && method === "GET") return ok({ objets: listItems(u.id) });
  if (p === "/api/objets" && method === "POST") {
    const b = body();
    const id = crypto.randomBytes(8).toString("hex");
    const item = tx(() => {
      needQuota(u);
      const it = nettoyer(b.objet || {}, null);
      db.prepare("INSERT INTO items(id, user_id, data, created, updated) VALUES (?, ?, ?, ?, ?)").run(id, u.id, JSON.stringify(it), now(), now());
      bump(u.id, "ajout");
      return it;
    });
    if (typeof b.photo === "string" && b.photo) {
      try { item.photo = savePhoto(u.id, id, b.photo); db.prepare("UPDATE items SET data = ? WHERE id = ?").run(JSON.stringify(item), id); }
      catch (e) { if (!(e instanceof HttpError)) throw e; }
    }
    return ok({ ok: true, objet: getItem(u.id, id) });
  }
  const mo = /^\/api\/objets\/([a-f0-9]{16})$/.exec(p);
  if (mo) {
    const avant = getItem(u.id, mo[1]); if (!avant) fail(404, "Jeu introuvable.");
    if (method === "PUT") {
      const b = body(), it = nettoyer({ ...avant, ...(b.objet || {}) }, avant);
      if (typeof b.photo === "string") it.photo = savePhoto(u.id, avant.id, b.photo);
      db.prepare("UPDATE items SET data = ?, updated = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(it), now(), avant.id, u.id);
      return ok({ ok: true, objet: getItem(u.id, avant.id) });
    }
    if (method === "DELETE") {
      db.prepare("DELETE FROM items WHERE id = ? AND user_id = ?").run(avant.id, u.id);
      fs.rmSync(photoPath(u.id, avant.id), { force: true });
      return ok({ ok: true });
    }
  }
  const mp = /^\/api\/photo\/([a-f0-9]{16})$/.exec(p);
  if (mp && method === "GET") {
    const f = photoPath(u.id, mp[1]);
    if (!fs.existsSync(f)) fail(404, "Pas de photo.");
    return { status: 200, body: fs.readFileSync(f), headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=600" } };
  }

  /* --- IA --- */
  if (p === "/api/ia/identifier" && method === "POST") { iaAllowed(u); const o = await ia.identifier(body().photo); bump(u.id, "identifier"); return ok({ ok: true, objet: o }); }
  if (p === "/api/ia/cote" && method === "POST") { iaAllowed(u); const c = await ia.estimerCote(body().objet || {}); bump(u.id, "cote"); return ok({ ok: true, cote: c }); }
  if (p === "/api/ia/cadrer" && method === "POST") { iaAllowed(u); const c = await ia.cadrer(body().photo); bump(u.id, "cadrer"); return ok({ ok: true, cadre: c }); }
  if (p === "/api/compter" && method === "POST") { const q = body().quoi; if (q === "lbc") bump(u.id, "lbc"); return ok({ ok: true }); }

  /* --- export --- */
  if (p === "/api/export.csv" && method === "GET") {
    if (!rights(u).export) fail(402, "L'export est inclus dans la formule Collectionneur.");
    return { status: 200, body: Buffer.from(csv(listItems(u.id))), headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="retrorevente-${new Date().toISOString().slice(0, 10)}.csv"` } };
  }

  /* --- paiement --- */
  if (p === "/api/paiement" && method === "POST") {
    if (!stripe.stripeReady()) fail(503, "Le paiement arrive très bientôt.");
    const b = body(), offre = parmi(b.offre, ["vendeur", "collectionneur", "pass"], ""), periode = b.periode === "an" ? "an" : "mois";
    if (!offre) fail(400, "Offre inconnue.");
    if (offre !== "pass" && u.stripe_sub && ["active", "trialing", "past_due"].includes(u.plan_status)) return ok({ url: await stripe.portal(u) });
    return ok({ url: await stripe.checkout(u, offre, periode) });
  }
  if (p === "/api/portail" && method === "POST") return ok({ url: await stripe.portal(u) });

  fail(404, "Adresse inconnue.");
}
