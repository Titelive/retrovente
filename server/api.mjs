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
import { infosJeu } from "./jeux.mjs";
import { infosFilm, formatFilm, formatCourt, editionTexte } from "./films.mjs";
import * as stripe from "./stripe.mjs";
import { coteLot, repartir, resumeLot, annonceLotSimple, suggestionsLocales, rondLot, MIN_LOT, MAX_LOT } from "./lots.mjs";

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
  const categorie = parmi(v.categorie, ia.CATEGORIES, "jeux"), carte = categorie === "cartes", film = categorie === "films";
  if (!titre) fail(400, carte ? "Indique le nom de la carte." : film ? "Indique le titre du film." : "Indique le nom du jeu.");
  const statut = parmi(v.statut, STATUTS, "en_vente");
  const auj = new Date().toISOString().slice(0, 10);
  const etatCarte = carte ? parmi(v.etatCarte, ia.ETATS_CARTE, "") : "";
  return {
    titre,
    categorie,
    // Cartes Pokémon : plateforme = extension, region = langue ; l'état Le Bon Coin suit l'état collectionneur s'il manque.
    ...(carte ? { numero: txt(v.numero, 20), rarete: txt(v.rarete, 40), edition: txt(v.edition, 40), gradation: txt(v.gradation, 30), etatCarte } : {}),
    // Films : plateforme = format (Blu-Ray 4K UHD, Blu-Ray, DVD…), region = langues et zone, edition = steelbook, collector…
    ...(film ? { annee: /^(18|19|20)\d{2}$/.test(String(v.annee || "").trim()) ? String(v.annee).trim() : "", realisateur: txt(v.realisateur, 80), edition: txt(v.edition, 80) } : {}),
    plateforme: film ? formatFilm(txt(v.plateforme, 60)) : txt(v.plateforme, 60), region: txt(v.region, 30),
    etat: parmi(v.etat, ia.ETATS, "") || (carte ? ETAT_LBC_DE_CARTE[etatCarte] || "" : ""), contenu: carte || film ? "" : parmi(v.contenu, ia.CONTENUS, ""),
    prixAchat: prix(v.prixAchat), prixDemande: prix(v.prixDemande), prixVente: prix(v.prixVente), frais: prix(v.frais),
    statut,
    dateMiseEnVente: jour(v.dateMiseEnVente) || (avant && avant.dateMiseEnVente) || auj,
    dateVente: ["vendu", "envoye"].includes(statut) ? (jour(v.dateVente) || (avant && avant.dateVente) || auj) : "",
    remise: parmi(v.remise, REMISES, ""),
    titreAnnonce: txt(v.titreAnnonce, 100), texteAnnonce: txt(v.texteAnnonce, 4000),
    annonce: lien(v.annonce), notes: txt(v.notes, 1000),
    origine: parmi(v.origine, ORIGINES, "origine"), modif: txt(v.modif, 160), particularites: txt(v.particularites, 300),
    cote: ia.coteDe(v.cote),
    // Fiche du jeu : ma note (0 à 5 étoiles, 0 = pas notée) et le jeu IGDB choisi à la main quand la recherche s'est trompée.
    note: Math.max(0, Math.min(5, Math.round(Number(v.note) || 0))),
    jeuRef: /^\d{1,9}$/.test(String(v.jeuRef || "")) ? String(v.jeuRef) : "",
    ia: !!(v.ia || (avant && avant.ia)),
    photo: !!(avant && photosDe(avant).length),
    photos: ordrePhotos(v.photos, avant),
    // Lots : la composition ne change que par /api/lots (jamais par la fiche), on la reprend telle quelle.
    ...(avant && Array.isArray(avant.articles) ? { articles: avant.articles, theme: avant.theme || null, ...(avant.alerte ? { alerte: avant.alerte } : {}), ...(avant.mosaiqueAFaire ? { mosaiqueAFaire: true } : {}) } : {}),
    ...(avant && avant.lot ? { lot: avant.lot } : {}),
    ...(avant && avant.exLot ? { exLot: avant.exLot } : {}),
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
  for (const x of liste) { const id = x && String(x.id); if (par.has(id) && !vus.has(id)) { vus.add(id); out.push({ ...par.get(id), legende: txt(x.legende, 200) }); } }
  for (const x of ex) if (!vus.has(x.id)) out.push(x);
  return out;
}
const fichierPhoto = (uid, id, pid) => photoPath(uid, pid === "p0" ? id : id + "-" + pid);
const itemOut = (r) => { const d = JSON.parse(r.data); const photos = photosDe(d).map((x) => ({ ...x, legende: ia.affirme(x.legende) })); return { id: r.id, ...d, photos, photo: photos.length > 0, cree: r.created, modifie: r.updated }; };
const listItems = (uid) => db.prepare("SELECT * FROM items WHERE user_id = ? ORDER BY created DESC").all(uid).map(itemOut);
const getItem = (uid, id) => { const r = db.prepare("SELECT * FROM items WHERE user_id = ? AND id = ?").get(uid, String(id)); return r ? itemOut(r) : null; };

/* ===== Lots ===== */
const ID = /^[a-f0-9]{16}$/;
const VENDU = (st) => st === "vendu" || st === "envoye";
const ecrire = (uid, it) => { const { id, cree: _c, modifie: _m, ...data } = it; db.prepare("UPDATE items SET data = ?, updated = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(data), now(), id, uid); };
const estLot = (it) => Array.isArray(it && it.articles);
const lotDe = (uid, it) => { const l = it && it.lot ? getItem(uid, it.lot) : null; return estLot(l) ? l : null; };
/** Articles qu'on peut mettre dans un lot : à soi, pas vendus, pas un lot, pas déjà dans un autre lot. */
function articlesPourLot(uid, ids, lotId = "") {
  const l = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((x) => ID.test(x));
  if (l.length < MIN_LOT) fail(400, "Choisis au moins 2 articles pour faire un lot.");
  if (l.length > MAX_LOT) fail(400, `${MAX_LOT} articles au plus dans un lot.`);
  return l.map((id) => {
    const it = getItem(uid, id);
    if (!it) fail(404, "Un des articles est introuvable.");
    if (estLot(it)) fail(400, "Un lot ne peut pas contenir un autre lot.");
    if (VENDU(it.statut)) fail(400, `« ${it.titre} » est déjà vendu.`);
    const autre = lotDe(uid, it);
    if (autre && autre.id !== lotId) fail(409, `« ${it.titre} » est déjà dans le lot « ${autre.titre} ».`);
    return it;
  });
}
/** Lot vendu : ses articles passent en vendu, le prix et les frais se partagent au prorata de leur valeur.
    Lot remis en vente après une vente : ses articles redeviennent à vendre. Le reste du temps, chaque article garde
    son propre statut : il reste en vente à l'unité tant que le lot n'est pas vendu. */
function suivreLot(uid, lot, avant) {
  const vendu = VENDU(lot.statut), etaitVendu = !!(avant && VENDU(avant.statut));
  if (vendu === etaitVendu && !(vendu && avant && (avant.prixVente !== lot.prixVente || avant.frais !== lot.frais || avant.dateVente !== lot.dateVente))) return;
  const membres = lot.articles.map((id) => getItem(uid, id)).filter(Boolean);
  const px = vendu ? repartir(lot.prixVente ?? lot.prixDemande, membres) : [], fr = vendu && lot.frais != null ? repartir(lot.frais, membres) : [];
  membres.forEach((m, i) => {
    if (vendu) { m.statut = lot.statut; m.dateVente = lot.dateVente; m.prixVente = px[i]; m.frais = fr.length ? fr[i] : null; m.remise = lot.remise; }
    else { m.statut = "en_vente"; m.dateVente = ""; m.prixVente = null; m.frais = null; m.remise = ""; }
    ecrire(uid, m);
  });
}
/* Un article du lot vendu à l'unité quitte le lot : prix du lot recalculé, sa photo retirée, mosaïque à refaire.
   S'il revient en vente (« Annuler »), il y retourne. Le titre et l'annonce écrits par l'appli suivent ; ceux que
   la personne a réécrits restent, et le lot le signale. */
const champsLot = (l) => ({ titre: l.titre, titreAnnonce: l.titreAnnonce, texteAnnonce: l.texteAnnonce, prixDemande: l.prixDemande, theme: l.theme || null });
function recomposer(uid, lot, ids, theme, ratio) {
  const anciens = lot.articles.map((id) => getItem(uid, id)).filter(Boolean), nouveaux = ids.map((id) => getItem(uid, id)).filter(Boolean);
  const auto = annonceLotSimple(anciens, lot.prixDemande, lot.theme);
  const c0 = coteLot(anciens, lot.theme), c1 = coteLot(nouveaux, theme);
  let prixDemande = lot.prixDemande == null ? c1.conseille : c0.conseille && c1.conseille ? Math.max(1, rondLot(lot.prixDemande * c1.conseille / c0.conseille)) : lot.prixDemande;
  // le lot était moins cher que ses articles à l'unité : il le reste après l'arrondi
  if (c1.somme && prixDemande >= c1.somme && lot.prixDemande != null && c0.somme && lot.prixDemande < c0.somme) prixDemande = c1.conseille;
  const neuf = annonceLotSimple(nouveaux, prixDemande, theme);
  const titreAuto = lot.titre === auto.titre, annonceAuto = lot.texteAnnonce === auto.description || !lot.texteAnnonce;
  return {
    ...lot, articles: nouveaux.map((m) => m.id), theme, prixDemande, mosaiqueAFaire: true,
    ...(titreAuto ? { titre: neuf.titre } : {}),
    ...(annonceAuto ? { texteAnnonce: neuf.description, titreAnnonce: lot.titreAnnonce === auto.titre || !lot.titreAnnonce ? neuf.titre : lot.titreAnnonce } : {}),
    _annonceAJour: annonceAuto, _ratio: ratio,
  };
}
function photoMembre(uid, lot, m) {
  const ph = photosDe(m)[0], f = ph && fichierPhoto(uid, m.id, ph.id);
  if (!f || !fs.existsSync(f)) return null;
  const pid = crypto.randomBytes(4).toString("hex");
  fs.mkdirSync(path.dirname(fichierPhoto(uid, lot.id, pid)), { recursive: true });
  fs.copyFileSync(f, fichierPhoto(uid, lot.id, pid));
  return { id: pid, legende: txt(m.titre, 200), de: m.id };
}
function sortirDuLot(uid, lot, m) {
  const reste = lot.articles.filter((id) => id !== m.id);
  delete m.lot; m.exLot = lot.id; ecrire(uid, m);
  if (reste.length < MIN_LOT) { defaireLot(uid, lot); return { id: lot.id, titre: lot.titre, action: "defait" }; }
  const avant = champsLot(lot);
  const theme = lot.theme ? { ...lot.theme, complet: false } : null;
  const n = recomposer(uid, lot, reste, theme);
  // sa photo s'en va aussi (les lots d'avant ne notaient pas d'où venait chaque photo : on la reconnaît à sa légende)
  const ph = photosDe(lot), part = ph.filter((x) => x.de === m.id || (!x.de && x.id !== (ph[0] && ph[0].id) && x.legende === m.titre)).slice(0, 1);
  for (const x of part) fs.rmSync(fichierPhoto(uid, lot.id, x.id), { force: true });
  const photos = ph.filter((x) => !part.includes(x));
  const a = lot.alerte || {};
  const vendus = [...(a.vendus || []).filter((x) => x.id !== m.id), { id: m.id, titre: m.titre, photo: part.length > 0 }];
  const { _annonceAJour, _ratio, ...l } = n;
  ecrire(uid, { ...l, photos, photo: photos.length > 0, alerte: { vendus, annonce: !!a.annonce || !_annonceAJour, avant: a.avant || avant, ancienPrix: a.ancienPrix ?? lot.prixDemande, apres: champsLot(l) } });
  return { id: lot.id, titre: l.titre, action: "retire", prix: l.prixDemande, ancienPrix: lot.prixDemande, annonce: _annonceAJour };
}
function revenirDansLot(uid, lot, m) {
  if (!estLot(lot) || VENDU(lot.statut) || lot.articles.includes(m.id) || lot.articles.length >= MAX_LOT) { delete m.exLot; ecrire(uid, m); return null; }
  m.lot = lot.id; delete m.exLot; ecrire(uid, m);
  const a = lot.alerte || {}, vendus = (a.vendus || []).filter((x) => x.id !== m.id), dernier = !vendus.length && a.avant;
  const n = recomposer(uid, lot, [...lot.articles, m.id], lot.theme);
  const { _annonceAJour, _ratio, ...l } = n;
  // retour à l'identique (le « Annuler » juste après la vente) : chaque champ que la personne n'a pas touché entre-temps reprend sa valeur d'avant
  if (dernier && a.apres) for (const k of Object.keys(a.avant)) if (JSON.stringify(lot[k] ?? null) === JSON.stringify(a.apres[k] ?? null)) l[k] = a.avant[k];
  const ph = photosDe(lot), np = (a.vendus || []).some((x) => x.id === m.id && x.photo) && ph.length < MAX_PHOTOS ? photoMembre(uid, lot, m) : null;
  const photos = np ? [...ph, np] : ph;
  if (vendus.length) l.alerte = { ...a, vendus, apres: champsLot(l) }; else delete l.alerte;
  ecrire(uid, { ...l, photos, photo: photos.length > 0 });
  return { id: lot.id, titre: l.titre, action: "remis", prix: l.prixDemande };
}
/** Défaire un lot : ses articles redeviennent indépendants (un lot vendu laisse ses articles vendus, avec leur part du prix). */
function defaireLot(uid, lot) {
  for (const id of lot.articles) { const m = getItem(uid, id); if (m && m.lot === lot.id) { delete m.lot; ecrire(uid, m); } }
  db.prepare("DELETE FROM items WHERE id = ? AND user_id = ?").run(lot.id, uid);
  for (const x of photosDe(lot)) fs.rmSync(fichierPhoto(uid, lot.id, x.id), { force: true });
}
const themeDe = (t) => (t && typeof t === "object" && txt(t.nom, 60) ? { nom: txt(t.nom, 60), type: txt(t.type, 20), complet: t.complet === true } : null);

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
  if (q.reste === 0) fail(402, `Tu as utilisé tes ${q.max} articles de ce mois avec la formule ${rights(u).nom}.`, { quota: true });
}
/* IA : réservée aux formules payantes. En Découverte, un seul essai, pour un seul jeu (voir essai.mjs). */
const MSG_ESSAI_FINI = "Tu as profité de ton article offert avec l'IA. Elle t'attend dans toutes les formules payantes, sur tous tes jeux.";
function iaAllowed(u, kind, req) {
  if (!allow("ia:" + u.id, 40, 600) || !allow("iaip:" + req.ip, 90, 600)) fail(429, "Trop de demandes à l'IA d'un coup, attends quelques minutes.");
  const r = rights(u), us = usageOf(u.id);
  if (r.id === "gratuit") {
    if (!u.email_ok) fail(403, "Ton premier article avec l'IA est offert : confirme ton adresse e-mail grâce au lien qu'on t'a envoyé, et c'est parti.", { verif: true });
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
    email: u.email, cree: u.created, pseudo: u.pseudo || "", nom: u.pseudo || u.email.split("@")[0], avatar: u.avatar || "", lbc: u.lbc || "", emailEnAttente: u.email_until > now() ? u.email_new : "",
    formule: { id: r.id, nom: r.nom, fiscal: r.fiscal, export: r.export, abonnement: u.plan !== "gratuit" ? u.plan : "", statut: u.plan_status, periode: u.plan_period, fin: u.plan_end, pass: u.pass_until, resiliation: u.plan_cancel, retractable: retractableJusqua(u), contrat: u.plan !== "gratuit" || u.achat_at ? contratDe(u) : "" },
    quota: quota(u), usage: usageTotal(u.id), mois: month(), ia: iaEtat(u), emailOk: !!u.email_ok,
    bilan: bilan(u.id), paiement: stripe.stripeReady(), client: !!u.stripe_customer, extension: countExtKeys(u.id),
  };
}

function csv(items) {
  const cols = ["titre", "categorie", "plateforme", "region", "numero", "rarete", "gradation", "edition", "annee", "realisateur", "etat", "contenu", "statut", "prixAchat", "prixDemande", "prixVente", "frais", "dateMiseEnVente", "dateVente", "remise", "lot", "annonce", "notes"];
  const q = (v) => { const s = v == null ? "" : String(v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return "﻿" + [cols.join(";"), ...items.map((v) => cols.map((c) => q(typeof v[c] === "number" ? String(v[c]).replace(".", ",") : v[c])).join(";"))].join("\r\n");
}

/* ===== Extension navigateur (remplissage du dépôt Le Bon Coin) ===== */
// Le Bon Coin n'a pas d'API publique : l'extension lit ici les annonces prêtes et remplit le formulaire de dépôt
// dans l'onglet de la personne, qui vérifie chaque étape et publie elle-même.
const ETAT_DESC = { neuf: "Neuf.", tres_bon: "Très bon état.", bon: "Bon état.", correct: "État correct.", pieces: "Pour pièces." };
const CONTENU_DESC = { seul: "Cartouche ou disque seul.", boite: "En boîte, sans notice.", complet: "Complet : boîte et notice.", boite_vide: "Boîte seule, sans le jeu." };
export function annonceLbc(v) {
  const film = v.categorie === "films";
  const nom = film ? [v.titre, formatCourt(v.plateforme), v.edition && v.edition.split(/\s*,\s*/)[0]].filter(Boolean).join(" ") : [v.titre, v.plateforme].filter(Boolean).join(" ");
  const description = v.texteAnnonce || (film
    ? [`Film ${v.titre}${v.annee ? ` (${v.annee})` : ""}${v.realisateur ? " de " + v.realisateur : ""}${v.plateforme ? ", en " + v.plateforme : ""}${v.edition ? ", " + editionTexte(v.edition) : ""}.`, v.region ? v.region.replace(/^./, (c) => c.toUpperCase()) + "." : "", ETAT_DESC[v.etat], "Remise en main propre ou envoi."]
    : v.categorie === "cartes"
    ? [`Carte Pokémon ${[v.titre, v.numero].filter(Boolean).join(" ")}${v.plateforme ? ", extension " + v.plateforme : ""}${v.region ? ", en " + v.region.toLowerCase() : ""}.`, v.gradation ? `Carte gradée ${v.gradation}.` : ETAT_DESC[v.etat], "Envoi soigné sous sleeve et toploader, dans une enveloppe rigide.", "Remise en main propre ou envoi."]
    : [[v.titre, v.plateforme].filter(Boolean).join(", ") + ".", ETAT_DESC[v.etat], CONTENU_DESC[v.contenu], "Remise en main propre ou envoi."]).filter(Boolean).join("\n");
  return {
    id: v.id, nom: v.titre, titre: (v.titreAnnonce || nom).slice(0, 100), description,
    prix: v.prixDemande != null ? Math.round(v.prixDemande) : null,
    categorie: v.categorie, plateforme: v.plateforme, etat: v.etat, contenu: v.contenu,
    ...(v.categorie === "cartes" ? { numero: v.numero || "", region: v.region || "", rarete: v.rarete || "", gradation: v.gradation || "", etatCarte: v.etatCarte || "" } : {}),
    ...(film ? { edition: v.edition || "", annee: v.annee || "", realisateur: v.realisateur || "", region: v.region || "" } : {}),
    photo: !!v.photo, photos: photosDe(v).map((x) => x.id), publiee: !!v.annonce, url: v.annonce || "", modifie: v.modifie,
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
      const r = rights(eu);
      return { status: 200, json: { email: eu.email, profil: { nom: eu.pseudo || eu.email.split("@")[0], avatar: eu.avatar || "", formule: r.id, formuleNom: r.nom }, annonces: l }, headers: CORS };
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
      // Une annonce = un seul jeu : on ne rattache pas un lien déjà pris par un autre jeu.
      if (listItems(eu.id).some((v) => v.id !== it.id && v.annonce === url)) return { status: 409, json: { error: "Cette annonce est déjà liée à un autre jeu." }, headers: CORS };
      // Prix lu sur « Mes annonces » de Le Bon Coin : le prix demandé suit celui de l'annonce en ligne.
      const px = Number(b.prix), nouveauPrix = Number.isFinite(px) && px >= 1 && px <= 100000 ? Math.round(px) : null;
      const prixChange = nouveauPrix != null && (it.prixDemande == null || Math.round(it.prixDemande) !== nouveauPrix);
      if (it.annonce !== url || prixChange) {
        const r = db.prepare("SELECT data FROM items WHERE id = ? AND user_id = ?").get(it.id, eu.id), d = JSON.parse(r.data);
        d.annonce = url;
        if (prixChange) d.prixDemande = nouveauPrix;
        db.prepare("UPDATE items SET data = ?, updated = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(d), now(), it.id, eu.id);
      }
      return { status: 200, json: { ok: true, url, prix: nouveauPrix != null ? nouveauPrix : (it.prixDemande != null ? Math.round(it.prixDemande) : null), prixChange }, headers: CORS };
    }
    // Réponse aux acheteurs proposée par l'IA (messagerie Le Bon Coin).
    if (p === "/api/extension/reponse" && method === "POST") {
      if (!allow("rep:" + eu.id, 30, 600)) return { status: 429, json: { error: "Tu as atteint la limite de réponses IA pour le moment. Les réponses types restent disponibles." }, headers: CORS };
      try { iaAllowed(eu, "reponse", req); } catch (e) { if (e instanceof HttpError) return { status: e.status, json: { error: e.message, ...(e.extra || {}) }, headers: CORS }; throw e; }
      const b = body(), it = /^[a-f0-9]{16}$/.test(String(b.annonce || "")) ? getItem(eu.id, b.annonce) : null;
      const tous = listItems(eu.id).filter((v) => v.statut === "en_vente" || v.statut === "reserve").map(annonceLbc);
      const out = await ia.repondre(b.conversation, it ? annonceLbc(it) : {}, tous, { lot: b.lot, offre: b.offre, acheteur: b.acheteur, consigne: b.consigne, precedentes: b.precedentes, mesMessages: b.mesMessages, suite: !!b.suite });
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
// Page vendeur Le Bon Coin : seulement une adresse https sur leboncoin.fr, sans identifiants ni port.
function lienLbc(v) {
  let t = txt(v, 300);
  if (!t) return "";
  if (!/^https?:\/\//i.test(t)) t = "https://" + t;
  let u; try { u = new URL(t); } catch { fail(400, "Lien Le Bon Coin invalide : colle l'adresse de ta page, par exemple https://www.leboncoin.fr/profile/…"); }
  if (!/(^|\.)leboncoin\.fr$/i.test(u.hostname) || u.username || u.password || u.port) fail(400, "Le lien doit être une adresse leboncoin.fr (ta page vendeur).");
  u.protocol = "https:"; u.hash = "";
  return u.toString().slice(0, 300);
}
  if (p === "/api/inscription" && method === "POST") {
    if (!allow("ins:" + ip, 10, 3600) || !allow("insj:" + ip, 20, 86400)) fail(429, "Trop d'inscriptions depuis cette connexion, réessaie plus tard.");
    const b = body(), email = txt(b.email, 254).toLowerCase(), mdp = String(b.motdepasse || "");
    if (!validEmail(email)) fail(400, "Adresse e-mail invalide.");
    if (jetable(email)) fail(400, "Les adresses e-mail jetables ne sont pas acceptées : utilise ta vraie adresse.");
    if (mdp.length < 8) fail(400, "Choisis un mot de passe d'au moins 8 caractères.");
    if (!b.cgv) fail(400, "Accepte les conditions générales pour créer ton compte.");
    const lbc = lienLbc(b.lbc);
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) fail(409, "Un compte existe déjà avec cette adresse. Connecte-toi.");
    const r = db.prepare("INSERT INTO users(email, pass, created, cgv_at, cgv_version) VALUES (?, ?, ?, ?, ?)").run(email, hashPass(mdp), now(), now(), CGV_VERSION);
    const uid = Number(r.lastInsertRowid), t = createSession(uid);
    if (lbc) db.prepare("UPDATE users SET lbc = ? WHERE id = ?").run(lbc, uid);
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
    if (b.lbc !== undefined) maj.lbc = lienLbc(b.lbc);
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
    iaAllowed(u, "nettoyer", req); const b = body(); const jpg = await retoucher(b.photo, b.rotation, rights(u).id === "gratuit"); bump(u.id, "nettoyer"); return ok({ ok: true, photo: jpg });
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
    const avant = getItem(u.id, mo[1]); if (!avant) fail(404, "Article introuvable.");
    if (method === "PUT") {
      const b = body(), it = nettoyer({ ...avant, ...(b.objet || {}) }, avant);
      const sonLot = estLot(avant) ? null : lotDe(u.id, avant);
      // Article d'un lot vendu : il est parti avec le lot, son statut suit celui du lot.
      if (sonLot && VENDU(sonLot.statut)) { it.statut = avant.statut; it.dateVente = avant.dateVente; }
      if (estLot(avant) && b.fermerAlerte) delete it.alerte;
      if (typeof b.photo === "string") {
        const prem = it.photos[0];
        if (b.photo === "") { if (prem) { savePhoto(u.id, avant.id, "", prem.id); it.photos = it.photos.slice(1); } }
        else if (prem) savePhoto(u.id, avant.id, b.photo, prem.id);
        else { savePhoto(u.id, avant.id, b.photo, "p0"); it.photos = [{ id: "p0", legende: "" }]; }
      }
      it.photo = it.photos.length > 0;
      db.prepare("UPDATE items SET data = ?, updated = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(it), now(), avant.id, u.id);
      let lot = null;
      if (estLot(it)) suivreLot(u.id, { ...it, id: avant.id }, avant);
      // Vendu à l'unité alors que son lot est encore en vente : il quitte le lot. Remis en vente : il y revient.
      else if (sonLot && !VENDU(sonLot.statut) && VENDU(it.statut) && !VENDU(avant.statut)) lot = tx(() => sortirDuLot(u.id, sonLot, getItem(u.id, avant.id)));
      else if (!sonLot && avant.exLot && VENDU(avant.statut) && !VENDU(it.statut)) lot = tx(() => revenirDansLot(u.id, getItem(u.id, avant.exLot), getItem(u.id, avant.id)));
      return ok({ ok: true, objet: getItem(u.id, avant.id), ...(lot ? { lot } : {}) });
    }
    if (method === "DELETE") {
      if (estLot(avant)) { defaireLot(u.id, avant); return ok({ ok: true }); }
      const l = lotDe(u.id, avant);
      if (l) fail(409, `Cet article est dans le lot « ${l.titre} » : retire-le du lot (ou défais le lot) avant de le supprimer.`);
      db.prepare("DELETE FROM items WHERE id = ? AND user_id = ?").run(avant.id, u.id);
      for (const x of photosDe(avant)) fs.rmSync(fichierPhoto(u.id, avant.id, x.id), { force: true });
      return ok({ ok: true });
    }
  }
  // Galerie : ajouter, remplacer (retouche) ou retirer une photo
  const mg = /^\/api\/objets\/([a-f0-9]{16})\/photos(?:\/(p0|[a-f0-9]{8}))?$/.exec(p);
  if (mg) {
    const avant = getItem(u.id, mg[1]); if (!avant) fail(404, "Article introuvable.");
    const liste = photosDe(avant), b = method === "DELETE" ? {} : body();
    let photos = liste;
    if (method === "POST" && !mg[2]) {
      if (liste.length >= MAX_PHOTOS) fail(400, "12 photos au plus par article.");
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
    // la mosaïque d'un lot vient d'être refaite : elle est à jour
    if (estLot(avant) && b.photo && /articles du lot/.test(String(b.legende || ""))) delete data.mosaiqueAFaire;
    db.prepare("UPDATE items SET data = ?, updated = ? WHERE id = ? AND user_id = ?").run(JSON.stringify({ ...data, photos, photo: photos.length > 0 }), now(), avant.id, u.id);
    return ok({ ok: true, objet: getItem(u.id, avant.id) });
  }
  /* --- lots --- */
  if (p === "/api/lots/cote" && method === "POST") {
    const b = body(), ids = (Array.isArray(b.articles) ? b.articles : []).map(String).filter((x) => ID.test(x)).slice(0, MAX_LOT);
    return ok({ ok: true, cote: coteLot(ids.map((id) => getItem(u.id, id)).filter(Boolean), themeDe(b.theme)) });
  }
  if (p === "/api/lots/suggestions" && method === "POST") {
    const b = body(), tous = listItems(u.id);
    const pris = new Set(tous.filter(estLot).flatMap((l) => l.articles));
    const libres = tous.filter((o) => !estLot(o) && !VENDU(o.statut) && o.statut !== "retire" && !pris.has(o.id));
    let l, parIa = false;
    if (b.ia && libres.length >= MIN_LOT) { iaAllowed(u, "dialogue", req); l = await ia.suggererLots(libres); bump(u.id, "dialogue"); parIa = true; }
    else l = suggestionsLocales(libres, 8);
    const par = new Map(libres.map((o) => [o.id, o]));
    return ok({ ok: true, ia: parIa, suggestions: l.map((x) => ({ ...x, cote: coteLot(x.articles.map((id) => par.get(id)).filter(Boolean), { nom: x.theme, type: x.type, complet: x.complet }) })) });
  }
  if (p === "/api/lots" && method === "POST") {
    const b = body(), theme = themeDe(b.theme);
    const id = crypto.randomBytes(8).toString("hex");
    const lot = tx(() => {
      const membres = articlesPourLot(u.id, b.articles), r = resumeLot(membres), c = coteLot(membres, theme);
      const a = annonceLotSimple(membres, c.conseille, theme);
      const it = { ...nettoyer({ titre: a.titre, categorie: r.categorie, plateforme: r.plateforme, etat: r.etat, prixDemande: c.conseille, titreAnnonce: a.titre, texteAnnonce: a.description, statut: "en_vente" }, null), contenu: "", articles: membres.map((m) => m.id), theme };
      db.prepare("INSERT INTO items(id, user_id, data, created, updated) VALUES (?, ?, ?, ?, ?)").run(id, u.id, JSON.stringify(it), now(), now());
      for (const m of membres) { m.lot = id; delete m.exLot; ecrire(u.id, m); }
      return it;
    });
    // Photos du lot : la mosaïque composée par l'appli en premier, puis la première photo de chaque article.
    const photos = [];
    if (typeof b.photo === "string" && b.photo) { try { if (savePhoto(u.id, id, b.photo, "p0")) photos.push({ id: "p0", legende: txt(`Les ${lot.articles.length} articles du lot réunis`, 200) }); } catch (e) { if (!(e instanceof HttpError)) throw e; } }
    for (const mid of lot.articles) {
      if (photos.length >= MAX_PHOTOS) break;
      const m = getItem(u.id, mid), ph = m && photosDe(m)[0], f = ph && fichierPhoto(u.id, m.id, ph.id);
      if (!f || !fs.existsSync(f)) continue;
      const pid = photos.length ? crypto.randomBytes(4).toString("hex") : "p0";
      fs.mkdirSync(path.dirname(fichierPhoto(u.id, id, pid)), { recursive: true });
      fs.copyFileSync(f, fichierPhoto(u.id, id, pid));
      photos.push({ id: pid, legende: txt(m.titre, 200), de: m.id });
    }
    if (photos.length) ecrire(u.id, { ...getItem(u.id, id), photos, photo: true });
    return ok({ ok: true, objet: getItem(u.id, id) });
  }
  const ml = /^\/api\/lots\/([a-f0-9]{16})(\/annonce)?$/.exec(p);
  if (ml) {
    const lot = getItem(u.id, ml[1]); if (!estLot(lot)) fail(404, "Lot introuvable.");
    if (ml[2] && method === "POST") {
      iaAllowed(u, "dialogue", req);
      const membres = lot.articles.map((id) => getItem(u.id, id)).filter(Boolean);
      const a = await ia.annonceLot(membres, { theme: lot.theme, prixDemande: body().prixDemande ?? lot.prixDemande });
      bump(u.id, "dialogue");
      return ok({ ok: true, ...a });
    }
    if (ml[2]) fail(405, "Méthode non prise en charge.");
    if (method === "DELETE") { defaireLot(u.id, lot); return ok({ ok: true }); }
    if (method === "PUT") {
      if (VENDU(lot.statut)) fail(409, "Ce lot est vendu : sa composition ne change plus.");
      const membres = tx(() => {
        const l = articlesPourLot(u.id, body().articles, lot.id), garde = new Set(l.map((m) => m.id));
        for (const id of lot.articles) if (!garde.has(id)) { const m = getItem(u.id, id); if (m && m.lot === lot.id) { delete m.lot; ecrire(u.id, m); } }
        for (const m of l) if (m.lot !== lot.id) { m.lot = lot.id; delete m.exLot; ecrire(u.id, m); }
        const it = { ...lot, articles: l.map((m) => m.id), mosaiqueAFaire: true };
        ecrire(u.id, it);
        return l;
      });
      return ok({ ok: true, objet: getItem(u.id, lot.id), cote: coteLot(membres, lot.theme) });
    }
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
  if (p === "/api/ia/legender" && method === "POST") { iaAllowed(u, "legender", req); const b = body(); const tr = [];
    // Avec « flux », l'avancement (photo N/M, jaunissement) est envoyé au fil de l'eau, puis le résultat.
    if (b.flux) return { status: 200, headers: {}, flux: async (envoi) => {
      try { const l = await ia.legender(b.photos, b.objet || {}, tr, (x) => envoi({ progres: x })); bump(u.id, "legender"); envoi({ fin: true, ok: true, ...l, ...(isAdmin(u) ? { trace: tr } : {}) }); }
      catch (e) { console.error("legender", e && e.message); envoi({ fin: true, error: e instanceof ia.IaError ? e.message : "Le service d'IA est momentanément indisponible, réessaie.", statut: e instanceof ia.IaError ? 422 : 500, ...(isAdmin(u) ? { trace: tr } : {}) }); }
    } };
    let l; try { l = await ia.legender(b.photos, b.objet || {}, tr); } catch (e) { if (isAdmin(u)) e.trace = tr; throw e; } bump(u.id, "legender"); return ok({ ok: true, ...l, ...(isAdmin(u) ? { trace: tr } : {}) }); }
  if (p === "/api/ia/inventaire" && method === "POST") { iaAllowed(u, "identifier", req); const o = await ia.inventaire(body().photo); bump(u.id, "identifier"); return ok({ ok: true, ...o }); }
  // Jaquette, captures, descriptif et notes d'un jeu (IGDB et Wikipédia, gardés en cache).
  if (p === "/api/jeu-infos" && method === "POST") {
    if (!allow("infos:" + u.id, 200, 3600)) fail(429, "Trop de recherches d'infos, réessaie dans un moment.");
    const b = body();
    try { return ok({ ok: true, infos: await infosJeu({ titre: b.titre, plateforme: b.plateforme, ref: b.ref }, ia.traduire) }); }
    catch (e) { console.error("infos jeu", e.message); fail(503, "Les infos du jeu sont momentanément indisponibles."); }
  }
  // Affiche, images, synopsis, réalisateur, casting et notes d'un film (TMDB, Wikidata ou Wikipédia, gardés en cache).
  if (p === "/api/film-infos" && method === "POST") {
    if (!allow("infos:" + u.id, 200, 3600)) fail(429, "Trop de recherches d'infos, réessaie dans un moment.");
    const b = body();
    try { return ok({ ok: true, infos: await infosFilm({ titre: b.titre, annee: b.annee, ref: b.ref }) }); }
    catch (e) { console.error("infos film", e.message); fail(503, "Les infos du film sont momentanément indisponibles."); }
  }
  if (p === "/api/lot-cartes" && method === "POST") return ok({ ok: true, lot: ia.lotCartes(body().cartes) });
  if (p === "/api/ia/cote" && method === "POST") { iaAllowed(u, "cote", req); const c = await ia.estimerCote(body().objet || {}); bump(u.id, "cote"); return ok({ ok: true, cote: c }); }
  if (p === "/api/ia/dialoguer" && method === "POST") {
    iaAllowed(u, "dialogue", req);
    const b = body(); const out = await ia.dialoguer(b.messages, b.fiche || {}); bump(u.id, "dialogue"); return ok({ ok: true, ...out });
  }
  if (p === "/api/ia/endroit" && method === "POST") { iaAllowed(u, "cadrer", req); const tr = []; const s = await ia.endroit(body().photo, tr); bump(u.id, "cadrer"); return ok({ ok: true, ...s, ...(isAdmin(u) ? { trace: tr } : {}) }); }
  if (p === "/api/ia/cadrer" && method === "POST") { iaAllowed(u, "cadrer", req); const c = await ia.cadrer(body().photo); bump(u.id, "cadrer"); return ok({ ok: true, cadre: c }); }
  if (p === "/api/compter" && method === "POST") { const q = body().quoi; if (q === "lbc") bump(u.id, "lbc"); return ok({ ok: true }); }

  /* --- export --- */
  if (p === "/api/export.csv" && method === "GET") {
    if (!rights(u).export) fail(402, "L'export est inclus dans la formule Collectionneur.");
    const tous = listItems(u.id), noms = new Map(tous.filter(estLot).map((l) => [l.id, l.titre]));
    // les lots n'ont pas de ligne à eux : leurs articles portent chacun sa part du prix, et le nom du lot
    return { status: 200, body: Buffer.from(csv(tous.filter((o) => !estLot(o)).map((o) => ({ ...o, lot: noms.get(o.lot) || "" })))), headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="retrorevente-${new Date().toISOString().slice(0, 10)}.csv"` } };
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
