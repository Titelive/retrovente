// API de l'appli (/api/…). Réponses JSON ; session par cookie (voir auth.mjs).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, now, month, bump, usageOf, usageTotal, allow, photoPath, tx } from "./db.mjs";
import { retoucher } from "./photo.mjs";
import { hashPass, checkPass, validEmail, createSession, sessionCookie, currentUser, endSession, endAllSessions, makeReset, useReset, sendMail, createExtKey, extUser, endExtKeys, countExtKeys } from "./auth.mjs";
import { rights, isAdmin, PLANS, SEUIL_VENTES, SEUIL_MONTANT, CGV_VERSION } from "./plans.mjs";
import * as ia from "./ia.mjs";
import { ESSAI, ouvrirEssai, essaiOuvert, jetable } from "./essai.mjs";
import { ETAT_LBC_DE_CARTE } from "./cartes.mjs";
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
  const categorie = parmi(v.categorie, ia.CATEGORIES, "jeux"), carte = categorie === "cartes";
  if (!titre) fail(400, carte ? "Indique le nom de la carte." : "Indique le nom du jeu.");
  const statut = parmi(v.statut, STATUTS, "en_vente");
  const auj = new Date().toISOString().slice(0, 10);
  const etatCarte = carte ? parmi(v.etatCarte, ia.ETATS_CARTE, "") : "";
  return {
    titre,
    categorie,
    // Cartes Pokémon : plateforme = extension, region = langue ; l'état Le Bon Coin suit l'état collectionneur s'il manque.
    ...(carte ? { numero: txt(v.numero, 20), rarete: txt(v.rarete, 40), edition: txt(v.edition, 40), gradation: txt(v.gradation, 30), etatCarte } : {}),
    plateforme: txt(v.plateforme, 60), region: txt(v.region, 30),
    etat: parmi(v.etat, ia.ETATS, "") || (carte ? ETAT_LBC_DE_CARTE[etatCarte] || "" : ""), contenu: carte ? "" : parmi(v.contenu, ia.CONTENUS, ""),
    prixAchat: prix(v.prixAchat), prixDemande: prix(v.prixDemande), prixVente: prix(v.prixVente), frais: prix(v.frais),
    statut,
    dateMiseEnVente: jour(v.dateMiseEnVente) || (avant && avant.dateMiseEnVente) || auj,
    dateVente: ["vendu", "envoye"].includes(statut) ? (jour(v.dateVente) || (avant && avant.dateVente) || auj) : "",
    remise: parmi(v.remise, REMISES, ""),
    titreAnnonce: txt(v.titreAnnonce, 100), texteAnnonce: txt(v.texteAnnonce, 4000),
    annonce: lien(v.annonce), notes: txt(v.notes, 1000),
    origine: parmi(v.origine, ORIGINES, "origine"), modif: txt(v.modif, 160), particularites: txt(v.particularites, 300),
    cote: ia.coteDe(v.cote),
    ia: !!(v.ia || (avant && avant.ia)),
    photo: !!(avant && photosDe(avant).length),
    photos: ordrePhotos(v.photos, avant),
  };
}
/* Galerie : item.photos = [{ id, legende }] dans l'ordre d'affichage. « p0 » est la photo historique (fichier <objet>.jpg). */
export const MAX_PHOTOS = 12;
const ORIGINES = ["origine", "non_teste", "modifie", "repro", "hs"];
const photosDe = (it) => (Array.isArray(it.photos) ? it.photos : it.photo ? [{ id: "p0", legende: "" }] : []);
function ordrePhotos(liste, avant) {
  const ex = avant ? photosDe(avant) : [];
  if (!Array.isArray(liste)) return ex;
  const par = new Map(ex.map((x) => [x.id, x])), vus = new Set(), out = [];
  for (const x of liste) { const id = x && String(x.id); if (par.has(id) && !vus.has(id)) { vus.add(id); out.push({ id, legende: txt(x.legende, 200) }); } }
  for (const x of ex) if (!vus.has(x.id)) out.push(x);
  return out;
}
const fichierPhoto = (uid, id, pid) => photoPath(uid, pid === "p0" ? id : id + "-" + pid);
const itemOut = (r) => { const d = JSON.parse(r.data); const photos = photosDe(d).map((x) => ({ ...x, legende: ia.affirme(x.legende) })); return { id: r.id, ...d, photos, photo: photos.length > 0, cree: r.created, modifie: r.updated }; };
const listItems = (uid) => db.prepare("SELECT * FROM items WHERE user_id = ? ORDER BY created DESC").all(uid).map(itemOut);
const getItem = (uid, id) => { const r = db.prepare("SELECT * FROM items WHERE user_id = ? AND id = ?").get(uid, String(id)); return r ? itemOut(r) : null; };

function savePhoto(uid, id, data, pid = "p0") {
  const f = fichierPhoto(uid, id, pid);
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
/* IA : réservée aux formules payantes. En Découverte, un seul essai, pour un seul jeu (voir essai.mjs). */
const MSG_ESSAI_FINI = "Ton essai gratuit de l'IA est terminé : il couvrait un jeu.";
function iaAllowed(u, kind, req) {
  if (!allow("ia:" + u.id, 40, 600) || !allow("iaip:" + req.ip, 90, 600)) fail(429, "Trop de demandes à l'IA d'un coup, attends quelques minutes.");
  const r = rights(u), us = usageOf(u.id);
  if (r.id === "gratuit") {
    if (!u.email_ok) fail(403, "Confirme d'abord ton adresse e-mail pour essayer l'IA : ouvre le lien qu'on t'a envoyé.", { verif: true });
    const refus = ouvrirEssai(u, req);
    if (refus) fail(402, refus, { ia: true });
    const tot = usageTotal(u.id);
    if ((tot[kind] || 0) >= (ESSAI[kind] ?? 0)) fail(402, MSG_ESSAI_FINI, { ia: true });
    if (kind === "identifier") needQuota(u);
    return;
  }
  if (kind === "dialogue") { if ((us.dialogue || 0) >= (r.quota === Infinity ? FAIR_USE * 2 : r.quota * 20 + 30)) fail(429, "Tu as atteint la limite de messages à l'IA pour ce mois."); return; }
  if (kind === "reponse") { if ((us.reponse || 0) >= (r.quota === Infinity ? FAIR_USE : r.quota * 6 + 20)) fail(429, "Tu as atteint la limite de réponses IA pour le moment. Les réponses types restent disponibles."); return; }
  const calls = (us.identifier || 0) + (us.cote || 0) + (us.cadrer || 0);
  const cap = r.quota === Infinity ? FAIR_USE : r.quota * 4 + 6;
  if (calls >= cap) fail(429, "Tu as atteint la limite d'utilisation de l'IA pour ce mois.");
  needQuota(u);
}
/** Où en est l'essai gratuit (pour l'affichage) : null en formule payante. */
function iaEtat(u) {
  if (rights(u).id !== "gratuit") return null;
  if (!u.email_ok) return "verif";
  const tot = usageTotal(u.id);
  if (!essaiOuvert(u.id)) return "dispo";
  return (tot.identifier || 0) >= ESSAI.identifier ? "utilise" : "en_cours";
}

async function envoyerVerif(uid, email) {
  const t = crypto.randomBytes(24).toString("base64url");
  db.prepare("UPDATE users SET verif_token = ? WHERE id = ?").run(crypto.createHash("sha256").update(t).digest("hex"), uid);
  return sendMail(email, "Confirme ton adresse RetroRevente", `Bonjour,\n\nBienvenue sur RetroRevente ! Pour confirmer ton adresse (et profiter de ton essai gratuit de l'IA), ouvre ce lien :\n${SITE()}/app/?verifier=${t}\n\nSi tu n'as pas créé de compte, ignore ce message.\n\nRetroRevente`);
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
    ...(isAdmin(u) ? { admin: true, formuleTest: u.test_plan || "" } : {}),
    email: u.email, cree: u.created, pseudo: u.pseudo || "", nom: u.pseudo || u.email.split("@")[0], avatar: u.avatar || "", emailEnAttente: u.email_until > now() ? u.email_new : "",
    formule: { id: r.id, nom: r.nom, fiscal: r.fiscal, export: r.export, abonnement: u.plan !== "gratuit" ? u.plan : "", statut: u.plan_status, periode: u.plan_period, fin: u.plan_end, pass: u.pass_until, resiliation: u.plan_cancel, retractable: retractableJusqua(u), contrat: u.plan !== "gratuit" || u.achat_at ? contratDe(u) : "" },
    quota: quota(u), usage: usageTotal(u.id), mois: month(), ia: iaEtat(u), emailOk: !!u.email_ok,
    bilan: bilan(u.id), paiement: stripe.stripeReady(), client: !!u.stripe_customer, extension: countExtKeys(u.id),
  };
}

function csv(items) {
  const cols = ["titre", "categorie", "plateforme", "region", "numero", "rarete", "gradation", "etat", "contenu", "statut", "prixAchat", "prixDemande", "prixVente", "frais", "dateMiseEnVente", "dateVente", "remise", "annonce", "notes"];
  const q = (v) => { const s = v == null ? "" : String(v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return "﻿" + [cols.join(";"), ...items.map((v) => cols.map((c) => q(typeof v[c] === "number" ? String(v[c]).replace(".", ",") : v[c])).join(";"))].join("\r\n");
}

/* ===== Extension navigateur (remplissage du dépôt Le Bon Coin) ===== */
// Le Bon Coin n'a pas d'API publique : l'extension lit ici les annonces prêtes et remplit le formulaire de dépôt
// dans l'onglet de la personne, qui vérifie chaque étape et publie elle-même.
const ETAT_DESC = { neuf: "Neuf.", tres_bon: "Très bon état.", bon: "Bon état.", correct: "État correct.", pieces: "Pour pièces." };
const CONTENU_DESC = { seul: "Cartouche ou disque seul.", boite: "En boîte, sans notice.", complet: "Complet : boîte et notice.", boite_vide: "Boîte seule, sans le jeu." };
export function annonceLbc(v) {
  const nom = [v.titre, v.plateforme].filter(Boolean).join(" ");
  const description = v.texteAnnonce || (v.categorie === "cartes"
    ? [`Carte Pokémon ${[v.titre, v.numero].filter(Boolean).join(" ")}${v.plateforme ? ", extension " + v.plateforme : ""}${v.region ? ", en " + v.region.toLowerCase() : ""}.`, v.gradation ? `Carte gradée ${v.gradation}.` : ETAT_DESC[v.etat], "Envoi soigné sous sleeve et toploader, dans une enveloppe rigide.", "Remise en main propre ou envoi."]
    : [[v.titre, v.plateforme].filter(Boolean).join(", ") + ".", ETAT_DESC[v.etat], CONTENU_DESC[v.contenu], "Remise en main propre ou envoi."]).filter(Boolean).join("\n");
  return {
    id: v.id, nom: v.titre, titre: (v.titreAnnonce || nom).slice(0, 100), description,
    prix: v.prixDemande != null ? Math.round(v.prixDemande) : null,
    categorie: v.categorie, plateforme: v.plateforme, etat: v.etat, contenu: v.contenu,
    ...(v.categorie === "cartes" ? { numero: v.numero || "", region: v.region || "", rarete: v.rarete || "", gradation: v.gradation || "", etatCarte: v.etatCarte || "" } : {}),
    photo: !!v.photo, photos: photosDe(v).map((x) => x.id), publiee: !!v.annonce, modifie: v.modifie,
  };
}
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "86400" };

/* ===== Résiliation et rétractation en ligne ===== */
const dateFr = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
const heureFr = (iso) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }) + " (heure de Paris)";
const OFFRE_NOMS = { vendeur: "Vendeur", collectionneur: "Collectionneur", pass: "Pass Grand ménage" };
function contratDe(u) {
  const [o, per] = String(u.achat_ref || (u.plan + ":" + u.plan_period)).split(":");
  return `RetroRevente ${OFFRE_NOMS[o] || o}${per === "an" ? ", abonnement annuel" : per === "mois" ? ", abonnement mensuel" : ""} — client n° ${u.id}`;
}
// Délai de 14 jours (art. L221-18 et L221-19) ; on accepte jusqu'à 16 jours pleins pour couvrir un délai qui finit un week-end.
function retractableJusqua(u, at = Date.now()) {
  if (!u.achat_at || u.retract_at) return "";
  const lim = Date.parse(u.achat_at) + 16 * 864e5;
  const actif = u.achat_ref.startsWith("pass") ? Date.parse(u.pass_until || 0) > at : ["active", "trialing", "past_due"].includes(u.plan_status);
  return actif && at < lim ? new Date(lim).toISOString() : "";
}
function demande(b, u) {
  const nom = txt(b.nom, 120), email = txt(b.email, 254).toLowerCase() || u.email;
  if (nom.length < 2) fail(400, "Indique ton nom et ton prénom.");
  if (!validEmail(email)) fail(400, "Adresse e-mail invalide.");
  if (b.confirmer !== true) fail(400, "Confirme ta demande.");
  return { nom, email };
}
const trace = (type, u, email, contenu) => db.prepare("INSERT INTO demandes(type, user_id, email, contenu, at) VALUES (?, ?, ?, ?, ?)").run(type, u.id, email, JSON.stringify(contenu), now());
const envoyer = (dest, sujet, texte) => Promise.all([...new Set(dest)].map((to) => sendMail(to, sujet, texte + "\n\nRetroRevente · bonjour@retrorevente.fr · https://retrorevente.fr/cgv/").catch((e) => console.error("e-mail", e.message))));

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

  // Extension navigateur : clé Bearer (pas de cookie), lecture seule, ouverte à toutes les origines.
  if (p.startsWith("/api/extension/") && p !== "/api/extension/cle") {
    if (method === "OPTIONS") return { status: 204, body: Buffer.alloc(0), headers: CORS };
    if (!allow("ext:" + ip, 600, 3600)) fail(429, "Trop de requêtes, réessaie dans un moment.");
    const eu = extUser(req);
    if (!eu) return { status: 401, json: { error: "Extension déconnectée : reconnecte-la depuis Mon compte sur retrorevente.fr." }, headers: CORS };
    if (p === "/api/extension/annonces" && method === "GET") {
      const l = listItems(eu.id).filter((v) => v.statut === "en_vente").map(annonceLbc);
      return { status: 200, json: { email: eu.email, annonces: l }, headers: CORS };
    }
    const mx = /^\/api\/extension\/photo\/([a-f0-9]{16})(?:\/(p0|[a-f0-9]{8}))?$/.exec(p);
    if (mx && method === "GET") {
      const it = getItem(eu.id, mx[1]), ph = it ? photosDe(it) : [], x = mx[2] ? ph.find((y) => y.id === mx[2]) : ph[0];
      const f = it && x ? fichierPhoto(eu.id, it.id, x.id) : "";
      if (!it || !f || !fs.existsSync(f)) return { status: 404, json: { error: "Pas de photo." }, headers: CORS };
      return { status: 200, body: fs.readFileSync(f), headers: { ...CORS, "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=600" } };
    }
    if (p === "/api/extension/rempli" && method === "POST") { bump(eu.id, "lbc"); return { status: 200, json: { ok: true }, headers: CORS }; }
    // Lien de l'annonce publiée, repéré par l'extension sur Le Bon Coin : seul champ que la clé peut écrire.
    if (p === "/api/extension/lien" && method === "POST") {
      const b = body(), it = /^[a-f0-9]{16}$/.test(String(b.annonce || "")) ? getItem(eu.id, b.annonce) : null;
      if (!it) return { status: 404, json: { error: "Jeu introuvable." }, headers: CORS };
      let url = ""; try { const x = new URL(String(b.url || "")); if (x.protocol === "https:" && x.hostname === "www.leboncoin.fr" && /^\/ad\/[a-z_]+\/\d{6,}$/.test(x.pathname.replace(/\/$/, ""))) url = "https://www.leboncoin.fr" + x.pathname.replace(/\/$/, ""); } catch (e) {}
      if (!url) return { status: 400, json: { error: "Lien d'annonce Le Bon Coin invalide." }, headers: CORS };
      if (it.annonce !== url) {
        const r = db.prepare("SELECT data FROM items WHERE id = ? AND user_id = ?").get(it.id, eu.id), d = JSON.parse(r.data);
        d.annonce = url;
        db.prepare("UPDATE items SET data = ?, updated = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(d), now(), it.id, eu.id);
      }
      return { status: 200, json: { ok: true, url }, headers: CORS };
    }
    // Réponse aux acheteurs proposée par l'IA (messagerie Le Bon Coin).
    if (p === "/api/extension/reponse" && method === "POST") {
      if (!allow("rep:" + eu.id, 30, 600)) return { status: 429, json: { error: "Tu as atteint la limite de réponses IA pour le moment. Les réponses types restent disponibles." }, headers: CORS };
      try { iaAllowed(eu, "reponse", req); } catch (e) { if (e instanceof HttpError) return { status: e.status, json: { error: e.message, ...(e.extra || {}) }, headers: CORS }; throw e; }
      const b = body(), it = /^[a-f0-9]{16}$/.test(String(b.annonce || "")) ? getItem(eu.id, b.annonce) : null;
      const tous = listItems(eu.id).filter((v) => v.statut === "en_vente" || v.statut === "reserve").map(annonceLbc);
      const out = await ia.repondre(b.conversation, it ? annonceLbc(it) : {}, tous, { lot: b.lot, offre: b.offre, acheteur: b.acheteur });
      bump(eu.id, "reponse");
      return { status: 200, json: { ok: true, ...out }, headers: CORS };
    }
    return { status: 404, json: { error: "Adresse inconnue." }, headers: CORS };
  }

  // Protection CSRF : les requêtes qui modifient doivent venir de notre site (en plus du cookie SameSite=Lax).
  if (method !== "GET" && method !== "HEAD") {
    const origin = req.headers.origin || "";
    if (origin && new URL(origin).host !== req.headers.host) fail(403, "Origine refusée.");
  }

  /* --- comptes --- */
  if (p === "/api/inscription" && method === "POST") {
    if (!allow("ins:" + ip, 10, 3600) || !allow("insj:" + ip, 20, 86400)) fail(429, "Trop d'inscriptions depuis cette connexion, réessaie plus tard.");
    const b = body(), email = txt(b.email, 254).toLowerCase(), mdp = String(b.motdepasse || "");
    if (!validEmail(email)) fail(400, "Adresse e-mail invalide.");
    if (jetable(email)) fail(400, "Les adresses e-mail jetables ne sont pas acceptées : utilise ta vraie adresse.");
    if (mdp.length < 8) fail(400, "Choisis un mot de passe d'au moins 8 caractères.");
    if (!b.cgv) fail(400, "Accepte les conditions générales pour créer ton compte.");
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) fail(409, "Un compte existe déjà avec cette adresse. Connecte-toi.");
    const r = db.prepare("INSERT INTO users(email, pass, created, cgv_at, cgv_version) VALUES (?, ?, ?, ?, ?)").run(email, hashPass(mdp), now(), now(), CGV_VERSION);
    const uid = Number(r.lastInsertRowid), t = createSession(uid);
    envoyerVerif(uid, email).catch(() => {});
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
  if (p === "/api/verifier" && method === "POST") {
    const j = String(body().jeton || ""); if (!/^[A-Za-z0-9_-]{20,64}$/.test(j)) fail(400, "Lien invalide.");
    const h = crypto.createHash("sha256").update(j).digest("hex"), v = db.prepare("SELECT id FROM users WHERE verif_token = ?").get(h);
    if (!v) fail(400, "Ce lien a déjà servi ou n'est plus valable.");
    db.prepare("UPDATE users SET email_ok = 1, verif_token = '' WHERE id = ?").run(v.id);
    return ok({ ok: true });
  }
  if (p === "/api/reinitialiser" && method === "POST") {
    const b = body(), mdp = String(b.motdepasse || "");
    if (mdp.length < 8) fail(400, "Choisis un mot de passe d'au moins 8 caractères.");
    const u = useReset(txt(b.jeton, 100)); if (!u) fail(400, "Ce lien a expiré. Refais une demande.");
    db.prepare("UPDATE users SET pass = ?, email_ok = 1 WHERE id = ?").run(hashPass(mdp), u.id);   // le lien reçu prouve l'adresse
    endAllSessions(u.id);
    return ok({ ok: true }, 200, { "Set-Cookie": sessionCookie(createSession(u.id), secure()) });
  }

  const u = currentUser(req);
  if (!u) fail(401, "Connecte-toi pour continuer.");

  if (p === "/api/moi" && method === "GET") return ok(me(u));
  // Clé de l'extension : créée depuis l'appli (session), transmise à l'extension par la page, révocable.
  if (p === "/api/extension/cle" && method === "POST") {
    if (!allow("extcle:" + u.id, 20, 3600)) fail(429, "Trop de demandes, réessaie plus tard.");
    return ok({ ok: true, cle: createExtKey(u.id) });
  }
  if (p === "/api/extension/cle" && method === "DELETE") return ok({ ok: true, supprimees: endExtKeys(u.id) });
  if (p === "/api/compte/motdepasse" && method === "POST") {
    const b = body();
    if (!checkPass(String(b.ancien || ""), u.pass)) fail(400, "Mot de passe actuel incorrect.");
    if (String(b.nouveau || "").length < 8) fail(400, "Choisis un mot de passe d'au moins 8 caractères.");
    db.prepare("UPDATE users SET pass = ? WHERE id = ?").run(hashPass(String(b.nouveau)), u.id);
    return ok({ ok: true });
  }
  if (p === "/api/compte/profil" && method === "POST") {
    const b = body(), maj = {};
    if (b.pseudo !== undefined) {
      const ps = txt(b.pseudo, 40).replace(/\s+/g, " ");
      if (ps && !/^[\p{L}\p{N} ._'-]{2,40}$/u.test(ps)) fail(400, "Pseudo : 2 à 40 caractères, lettres, chiffres, espaces, points, tirets.");
      maj.pseudo = ps;
    }
    if (b.avatar !== undefined) {
      const a = String(b.avatar || "");
      if (a && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a) || a.length > 120000)) fail(400, "Image de profil invalide ou trop lourde.");
      maj.avatar = a;
    }
    for (const [k, v] of Object.entries(maj)) db.prepare(`UPDATE users SET ${k} = ? WHERE id = ?`).run(v, u.id);
    return ok(me(db.prepare("SELECT * FROM users WHERE id = ?").get(u.id)));
  }
  if (p === "/api/verifier/renvoyer" && method === "POST") {
    if (u.email_ok) return ok({ ok: true, deja: true });
    if (!allow("verif:" + u.id, 3, 3600)) fail(429, "Lien déjà renvoyé plusieurs fois : regarde aussi dans les courriers indésirables.");
    if (!(await envoyerVerif(u.id, u.email))) fail(503, "L'envoi d'e-mails est momentanément indisponible, réessaie plus tard.");
    return ok({ ok: true });
  }
  if (p === "/api/compte/email" && method === "POST") {
    const b = body(), email = txt(b.email, 254).toLowerCase();
    if (!checkPass(String(b.motdepasse || ""), u.pass)) fail(400, "Mot de passe incorrect.");
    if (!validEmail(email)) fail(400, "Adresse e-mail invalide.");
    if (email === u.email.toLowerCase()) fail(400, "C'est déjà ton adresse.");
    if (jetable(email)) fail(400, "Les adresses e-mail jetables ne sont pas acceptées.");
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) fail(409, "Un compte utilise déjà cette adresse.");
    if (!allow("mail:" + u.id, 5, 3600)) fail(429, "Trop de demandes, réessaie plus tard.");
    const t = crypto.randomBytes(24).toString("base64url"), h = crypto.createHash("sha256").update(t).digest("hex");
    db.prepare("UPDATE users SET email_new = ?, email_token = ?, email_until = ? WHERE id = ?").run(email, h, new Date(Date.now() + 24 * 3600e3).toISOString(), u.id);
    const envoye = await sendMail(email, "Confirme ta nouvelle adresse RetroRevente", `Bonjour,\n\nPour utiliser cette adresse sur RetroRevente, ouvre ce lien (valable 24 heures) :\n${SITE()}/app/?email=${t}\n\nSi tu n'as rien demandé, ignore ce message.\n\nRetroRevente`);
    if (!envoye) {
      // Pas d'envoi d'e-mails configuré : on applique directement (le mot de passe a été vérifié).
      db.prepare("UPDATE users SET email = ?, email_new = '', email_token = '', email_until = '' WHERE id = ?").run(email, u.id);
      return ok({ ok: true, applique: true, moi: me(db.prepare("SELECT * FROM users WHERE id = ?").get(u.id)) });
    }
    sendMail(u.email, "Changement d'adresse demandé", `Bonjour,\n\nUn changement d'adresse vers ${email} a été demandé sur ton compte RetroRevente. Si ce n'est pas toi, change ton mot de passe.\n\nRetroRevente`).catch(() => {});
    return ok({ ok: true, applique: false });
  }
  if (p === "/api/compte/email/confirmer" && method === "POST") {
    const h = crypto.createHash("sha256").update(txt(body().jeton, 100)).digest("hex");
    if (!u.email_token || u.email_token !== h || u.email_until < now()) fail(400, "Ce lien a expiré. Refais la demande depuis ton compte.");
    if (db.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").get(u.email_new, u.id)) fail(409, "Un compte utilise déjà cette adresse.");
    db.prepare("UPDATE users SET email = email_new, email_new = '', email_token = '', email_until = '', email_ok = 1 WHERE id = ?").run(u.id);
    return ok(me(db.prepare("SELECT * FROM users WHERE id = ?").get(u.id)));
  }
  if (p === "/api/ia/nettoyer" && method === "POST") {
    iaAllowed(u, "nettoyer", req); const b = body(); const jpg = await retoucher(b.photo, b.rotation); bump(u.id, "nettoyer"); return ok({ ok: true, photo: jpg });
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
      try { item.photo = savePhoto(u.id, id, b.photo); item.photos = item.photo ? [{ id: "p0", legende: txt(b.legende, 200) }] : []; db.prepare("UPDATE items SET data = ? WHERE id = ?").run(JSON.stringify(item), id); }
      catch (e) { if (!(e instanceof HttpError)) throw e; }
    }
    return ok({ ok: true, objet: getItem(u.id, id) });
  }
  const mo = /^\/api\/objets\/([a-f0-9]{16})$/.exec(p);
  if (mo) {
    const avant = getItem(u.id, mo[1]); if (!avant) fail(404, "Jeu introuvable.");
    if (method === "PUT") {
      const b = body(), it = nettoyer({ ...avant, ...(b.objet || {}) }, avant);
      if (typeof b.photo === "string") {
        const prem = it.photos[0];
        if (b.photo === "") { if (prem) { savePhoto(u.id, avant.id, "", prem.id); it.photos = it.photos.slice(1); } }
        else if (prem) savePhoto(u.id, avant.id, b.photo, prem.id);
        else { savePhoto(u.id, avant.id, b.photo, "p0"); it.photos = [{ id: "p0", legende: "" }]; }
      }
      it.photo = it.photos.length > 0;
      db.prepare("UPDATE items SET data = ?, updated = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(it), now(), avant.id, u.id);
      return ok({ ok: true, objet: getItem(u.id, avant.id) });
    }
    if (method === "DELETE") {
      db.prepare("DELETE FROM items WHERE id = ? AND user_id = ?").run(avant.id, u.id);
      for (const x of photosDe(avant)) fs.rmSync(fichierPhoto(u.id, avant.id, x.id), { force: true });
      return ok({ ok: true });
    }
  }
  // Galerie : ajouter, remplacer (retouche) ou retirer une photo
  const mg = /^\/api\/objets\/([a-f0-9]{16})\/photos(?:\/(p0|[a-f0-9]{8}))?$/.exec(p);
  if (mg) {
    const avant = getItem(u.id, mg[1]); if (!avant) fail(404, "Jeu introuvable.");
    const liste = photosDe(avant), b = method === "DELETE" ? {} : body();
    let photos = liste;
    if (method === "POST" && !mg[2]) {
      if (liste.length >= MAX_PHOTOS) fail(400, "12 photos au plus par jeu.");
      const pid = liste.some((x) => x.id === "p0") || liste.length ? crypto.randomBytes(4).toString("hex") : "p0";
      if (!savePhoto(u.id, avant.id, String(b.photo || ""), pid)) fail(400, "Photo manquante.");
      photos = [...liste, { id: pid, legende: txt(b.legende, 200) }];
    } else if (method === "PUT" && mg[2]) {
      if (!liste.some((x) => x.id === mg[2])) fail(404, "Photo introuvable.");
      if (typeof b.photo === "string" && b.photo) savePhoto(u.id, avant.id, b.photo, mg[2]);
      if (typeof b.legende === "string") photos = liste.map((x) => (x.id === mg[2] ? { ...x, legende: txt(b.legende, 200) } : x));
    } else if (method === "DELETE" && mg[2]) {
      fs.rmSync(fichierPhoto(u.id, avant.id, mg[2]), { force: true });
      photos = liste.filter((x) => x.id !== mg[2]);
    } else fail(405, "Méthode non prise en charge.");
    const { id: _i, cree: _c, modifie: _m, ...data } = avant;
    db.prepare("UPDATE items SET data = ?, updated = ? WHERE id = ? AND user_id = ?").run(JSON.stringify({ ...data, photos, photo: photos.length > 0 }), now(), avant.id, u.id);
    return ok({ ok: true, objet: getItem(u.id, avant.id) });
  }
  const mp = /^\/api\/photo\/([a-f0-9]{16})(?:\/(p0|[a-f0-9]{8}))?$/.exec(p);
  if (mp && method === "GET") {
    const it = getItem(u.id, mp[1]); if (!it) fail(404, "Pas de photo.");
    const ph = photosDe(it), pid = mp[2] || (ph[0] && ph[0].id);
    if (!pid || !ph.some((x) => x.id === pid)) fail(404, "Pas de photo.");
    const f = fichierPhoto(u.id, it.id, pid);
    if (!fs.existsSync(f)) fail(404, "Pas de photo.");
    return { status: 200, body: fs.readFileSync(f), headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=600" } };
  }

  /* --- Mode test des formules : uniquement les comptes listés dans ADMIN_EMAILS (vérifié ici, côté serveur) --- */
  if (p === "/api/admin/formule" && method === "POST") {
    if (!isAdmin(u)) fail(404, "Adresse inconnue.");
    const f = String(body().formule || "");
    if (f && !PLANS[f]) fail(400, "Formule inconnue.");
    db.prepare("UPDATE users SET test_plan = ? WHERE id = ?").run(f, u.id);
    return ok({ ok: true, moi: me(db.prepare("SELECT * FROM users WHERE id = ?").get(u.id)) });
  }

  /* --- IA --- */
  if (p === "/api/ia/identifier" && method === "POST") { iaAllowed(u, "identifier", req); const o = await ia.identifier(body().photo); bump(u.id, "identifier"); return ok({ ok: true, objet: o }); }
  if (p === "/api/ia/legender" && method === "POST") { iaAllowed(u, "legender", req); const b = body(); const l = await ia.legender(b.photos, b.objet || {}); bump(u.id, "legender"); return ok({ ok: true, legendes: l }); }
  if (p === "/api/ia/inventaire" && method === "POST") { iaAllowed(u, "identifier", req); const o = await ia.inventaire(body().photo); bump(u.id, "identifier"); return ok({ ok: true, ...o }); }
  if (p === "/api/lot-cartes" && method === "POST") return ok({ ok: true, lot: ia.lotCartes(body().cartes) });
  if (p === "/api/ia/cote" && method === "POST") { iaAllowed(u, "cote", req); const c = await ia.estimerCote(body().objet || {}); bump(u.id, "cote"); return ok({ ok: true, cote: c }); }
  if (p === "/api/ia/dialoguer" && method === "POST") {
    iaAllowed(u, "dialogue", req);
    const b = body(); const out = await ia.dialoguer(b.messages, b.fiche || {}); bump(u.id, "dialogue"); return ok({ ok: true, ...out });
  }
  if (p === "/api/ia/cadrer" && method === "POST") { iaAllowed(u, "cadrer", req); const c = await ia.cadrer(body().photo); bump(u.id, "cadrer"); return ok({ ok: true, cadre: c }); }
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
  // « Résilier votre contrat » (art. L215-1-1 et D215-1 à D215-3 du Code de la consommation).
  if (p === "/api/resilier" && method === "POST") {
    if (!u.stripe_sub || !["active", "trialing", "past_due"].includes(u.plan_status) || u.plan_cancel) fail(400, "Tu n'as pas d'abonnement en cours à résilier.");
    const d = demande(body(), u);
    await stripe.resilier(u);
    const contenu = { ...d, contrat: contratDe(u), fin: u.plan_end };
    trace("resiliation", u, d.email, contenu);
    const quand = heureFr(now()), fin = u.plan_end ? dateFr(u.plan_end) : "";
    await envoyer([d.email, u.email], "Confirmation de ta résiliation", `Bonjour ${d.nom},

Nous avons bien reçu la notification de résiliation de ton contrat le ${quand}.

Contrat : ${contenu.contrat}
Nom : ${d.nom}
Adresse e-mail de confirmation : ${d.email}

Ton abonnement prend fin le ${fin}. Jusqu'à cette date, tu gardes tous les avantages de ta formule ; aucun autre paiement ne sera prélevé. Ensuite, ton compte passe en formule Découverte (gratuite) : tes fiches restent disponibles.`);
    return ok({ ok: true, fin: u.plan_end });
  }
  // « Renoncer au contrat ici » (art. L221-21 et D221-5 du Code de la consommation, depuis le 19 juin 2026).
  if (p === "/api/retractation" && method === "POST") {
    const lim = retractableJusqua(u);
    if (!lim) fail(400, "Le délai de rétractation de 14 jours est terminé pour ton dernier achat.");
    const d = demande(body(), u);
    const contenu = { ...d, contrat: contratDe(u), achat: u.achat_at, montant: u.achat_montant / 100 };
    await stripe.arreter(u);
    const at = now();
    trace("retractation", u, d.email, contenu);
    const jours = Math.max(0, Math.floor((Date.parse(at) - Date.parse(u.achat_at)) / 864e5));   // jours entiers écoulés, arrondi en faveur du client
    const duree = u.achat_ref.endsWith(":an") ? 365 : 30;
    const du = Math.min(u.achat_montant, Math.round(u.achat_montant * jours / duree));
    const rembourse = ((u.achat_montant - du) / 100).toFixed(2).replace(".", ",");
    await envoyer([d.email, u.email], "Accusé de réception de ta rétractation", `Bonjour ${d.nom},

Nous avons bien reçu ta rétractation le ${heureFr(at)}.

Contenu de ta déclaration :
- Nom : ${d.nom}
- Contrat : ${contenu.contrat}, conclu le ${heureFr(u.achat_at)}
- Adresse e-mail pour l'accusé de réception : ${d.email}
- Décision : rétractation du contrat

Ta formule est arrêtée et ton compte repasse en formule Découverte (gratuite). Tes fiches restent disponibles.
${jours ? `Comme tu avais demandé que le service commence tout de suite, le montant correspondant au service déjà fourni (${jours} jour${jours > 1 ? "s" : ""} sur ${duree}) est retenu. ` : ""}Nous te remboursons ${rembourse} € sur le moyen de paiement utilisé, au plus tard dans les 14 jours.`);
    await envoyer([process.env.CONTACT_EMAIL || "bonjour@retrorevente.fr"], `[RetroRevente] Rétractation à rembourser : ${rembourse} €`,
      `Rétractation reçue le ${heureFr(at)}.\nCompte : ${u.email} (n° ${u.id}), client Stripe ${u.stripe_customer || "-"}\nContrat : ${contenu.contrat}, payé ${(u.achat_montant / 100).toFixed(2)} € le ${heureFr(u.achat_at)}\nJours utilisés : ${jours} sur ${duree}\n\nÀ FAIRE sous 14 jours : rembourser ${rembourse} € depuis Stripe (Paiements > ce paiement > Rembourser).`);
    return ok({ ok: true, rembourse });
  }

  fail(404, "Adresse inconnue.");
}
