// Tests de l'API (sans réseau : IA simulée, base temporaire).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rr-"));
process.env.IA_FAKE = "1";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
process.env.STRIPE_PRICE_VENDEUR_MOIS = "price_v_m";
process.env.STRIPE_PRICE_COLLECTIONNEUR_AN = "price_c_a";
const { handleApi, HttpError } = await import("../server/api.mjs");
const { db } = await import("../server/db.mjs");
const { verify } = await import("../server/stripe.mjs");
const { IaError } = await import("../server/ia.mjs");

const PHOTO = "data:image/jpeg;base64," + Buffer.from("fausse image").toString("base64");
let ipN = 0;
async function call(method, p, body, cookie, extra = {}) {
  try {
    const r = await handleApi({ method, path: p, headers: { host: "retrorevente.fr", cookie: cookie || "", ...extra }, ip: "10.0.0." + (++ipN % 250), body: Buffer.from(body ? (typeof body === "string" ? body : JSON.stringify(body)) : "") });
    return r;
  } catch (e) { if (e instanceof IaError) return { status: 422, json: { error: e.message } };
    if (e instanceof HttpError) return { status: e.status, json: { error: e.message, ...(e.extra || {}) } }; throw e; }
}
const cookieOf = (r) => /rr_session=([^;]+)/.exec(r.headers["Set-Cookie"])[0];
async function compte(email, payant = false) {
  const r = await call("POST", "/api/inscription", { email, motdepasse: "motdepasse123", cgv: true, adresse: "54000 Nancy" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // Adresse confirmée (lien e-mail) ; « payant » : formule Collectionneur active, l'IA sans limite d'essai.
  db.prepare("UPDATE users SET email_ok = 1" + (payant ? ", plan = 'collectionneur', plan_status = 'active'" : "") + " WHERE email = ?").run(email.toLowerCase());
  return cookieOf(r);
}

test("inscription, connexion, refus sans session", async () => {
  assert.equal((await call("GET", "/api/moi")).status, 401);
  assert.equal((await call("POST", "/api/inscription", { email: "a@b.fr", motdepasse: "court", cgv: true, adresse: "54000 Nancy" })).status, 400);
  assert.equal((await call("POST", "/api/inscription", { email: "a@b.fr", motdepasse: "motdepasse123" })).status, 400);   // CGV
  const c = await compte("Alice@Exemple.fr");
  const moi = await call("GET", "/api/moi", null, c);
  assert.equal(moi.json.email, "alice@exemple.fr");
  assert.equal(moi.json.formule.id, "gratuit");
  assert.equal((await call("POST", "/api/inscription", { email: "alice@exemple.fr", motdepasse: "motdepasse123", cgv: true, adresse: "54000 Nancy" })).status, 409);
  assert.equal((await call("POST", "/api/connexion", { email: "alice@exemple.fr", motdepasse: "mauvais!!" })).status, 401);
  assert.equal((await call("POST", "/api/connexion", { email: "ALICE@exemple.fr", motdepasse: "motdepasse123" })).status, 200);
});

test("origine étrangère refusée", async () => {
  const c = await compte("csrf@exemple.fr");
  const r = await call("POST", "/api/objets", { objet: { titre: "X" } }, c, { origin: "https://pirate.example" });
  assert.equal(r.status, 403);
});

test("fiches : création, photo, modification, isolation entre comptes, suppression", async () => {
  const c = await compte("bob@exemple.fr"), d = await compte("carole@exemple.fr");
  const r = await call("POST", "/api/objets", { objet: { titre: "Zelda", plateforme: "Nintendo 64", prixDemande: "45,5" }, photo: PHOTO }, c);
  assert.equal(r.status, 200);
  const o = r.json.objet;
  assert.equal(o.prixDemande, 45.5); assert.equal(o.photo, true); assert.equal(o.statut, "en_vente");
  assert.equal((await call("GET", "/api/photo/" + o.id, null, c)).status, 200);
  assert.equal((await call("GET", "/api/photo/" + o.id, null, d)).status, 404);
  assert.equal((await call("PUT", "/api/objets/" + o.id, { objet: { statut: "vendu", prixVente: 40 } }, d)).status, 404);
  const v = await call("PUT", "/api/objets/" + o.id, { objet: { statut: "vendu", prixVente: 40 } }, c);
  assert.equal(v.json.objet.statut, "vendu"); assert.ok(v.json.objet.dateVente);
  assert.equal(v.json.objet.titre, "Zelda"); assert.equal(v.json.objet.photo, true);   // changer seulement le statut garde le reste
  const r2 = await call("PUT", "/api/objets/" + o.id, { objet: { statut: "en_vente" } }, c);
  assert.equal(r2.json.objet.statut, "en_vente"); assert.equal(r2.json.objet.dateVente, "");
  const r3 = await call("PUT", "/api/objets/" + o.id, { objet: { statut: "vendu", prixVente: 40, dateVente: v.json.objet.dateVente } }, c);
  assert.equal(r3.json.objet.dateVente, v.json.objet.dateVente);
  const moi = await call("GET", "/api/moi", null, c);
  assert.equal(moi.json.bilan.vendus, 1); assert.equal(moi.json.bilan.encaisse, 40);
  assert.equal(moi.json.bilan.annee.ventes, 1); assert.equal(moi.json.bilan.annee.montant, 40);
  // remis en main propre : toujours vendu, mais hors des seuils de déclaration des plateformes
  await call("PUT", "/api/objets/" + o.id, { objet: { remise: "main_propre" } }, c);
  const moi2 = await call("GET", "/api/moi", null, c);
  assert.equal(moi2.json.bilan.vendus, 1); assert.equal(moi2.json.bilan.annee.ventes, 0); assert.equal(moi2.json.bilan.annee.montant, 0);
  assert.equal((await call("DELETE", "/api/objets/" + o.id, null, c)).status, 200);
  assert.equal((await call("GET", "/api/objets", null, c)).json.objets.length, 0);
});

test("quota gratuit : 5 jeux par mois, puis 402", async () => {
  const c = await compte("quota@exemple.fr");
  for (let i = 0; i < 5; i++) assert.equal((await call("POST", "/api/objets", { objet: { titre: "Jeu " + i } }, c)).status, 200);
  const r = await call("POST", "/api/objets", { objet: { titre: "Jeu 6" } }, c);
  assert.equal(r.status, 402); assert.equal(r.json.quota, true);
  assert.equal((await call("POST", "/api/ia/identifier", { photo: PHOTO }, c)).status, 402);
  const moi = await call("GET", "/api/moi", null, c);
  assert.deepEqual([moi.json.quota.utilise, moi.json.quota.reste], [5, 0]);
});

test("IA simulée : identifier et cote comptent pour le temps gagné", async () => {
  const c = await compte("ia@exemple.fr", true);
  const r = await call("POST", "/api/ia/identifier", { photo: PHOTO }, c);
  assert.equal(r.json.objet.plateforme, "Nintendo 64");
  const k = await call("POST", "/api/ia/cote", { objet: r.json.objet }, c);
  assert.equal(k.json.cote.conseille, 53);   // vente probable 48 € (médiane pondérée) + 10 %, sous l'annonce concurrente à 60 €
  assert.ok(k.json.cote.conseille < 60 && k.json.cote.rapide < k.json.cote.probable);
  assert.equal((await call("POST", "/api/ia/identifier", { photo: "pas une image" }, c)).status !== 200, true);
  const moi = await call("GET", "/api/moi", null, c);
  assert.equal(moi.json.usage.identifier, 1); assert.equal(moi.json.usage.cote, 1);
});

test("export réservé à Collectionneur", async () => {
  const c = await compte("exp@exemple.fr");
  assert.equal((await call("GET", "/api/export.csv", null, c)).status, 402);
});

function signe(payload, secret = "whsec_test", t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=` + crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
}
test("signature des webhooks Stripe", () => {
  const p = '{"a":1}';
  assert.equal(verify(p, signe(p)), true);
  assert.equal(verify(p, signe(p, "autre")), false);
  assert.equal(verify(p + " ", signe(p)), false);
  assert.equal(verify(p, signe(p, "whsec_test", Math.floor(Date.now() / 1000) - 1000)), false);
});

test("webhooks : abonnement Collectionneur, pass, résiliation, doublon", async () => {
  const c = await compte("paye@exemple.fr");
  const uid = db.prepare("SELECT id FROM users WHERE email = ?").get("paye@exemple.fr").id;
  const envoyer = async (ev) => { const raw = JSON.stringify(ev); return call("POST", "/api/stripe/webhook", raw, "", { "stripe-signature": signe(raw) }); };
  const sub = (status) => ({ id: "sub_1", customer: "cus_1", status, metadata: { user_id: String(uid) }, items: { data: [{ price: { id: "price_c_a" }, current_period_end: Math.floor(Date.now() / 1000) + 3e7 }] } });
  assert.equal((await envoyer({ id: "evt_1", type: "customer.subscription.created", data: { object: sub("active") } })).status, 200);
  let moi = await call("GET", "/api/moi", null, c);
  assert.equal(moi.json.formule.id, "collectionneur"); assert.equal(moi.json.formule.periode, "an"); assert.equal(moi.json.quota.max, null);
  assert.equal((await call("GET", "/api/export.csv", null, c)).status, 200);
  assert.equal((await envoyer({ id: "evt_1", type: "customer.subscription.created", data: { object: sub("active") } })).json.r, "doublon");
  await envoyer({ id: "evt_2", type: "customer.subscription.deleted", data: { object: sub("canceled") } });
  moi = await call("GET", "/api/moi", null, c);
  assert.equal(moi.json.formule.id, "gratuit");
  await envoyer({ id: "evt_3", type: "checkout.session.completed", data: { object: { mode: "payment", payment_status: "paid", customer: "cus_1", client_reference_id: String(uid), metadata: { user_id: String(uid), offre: "pass" } } } });
  moi = await call("GET", "/api/moi", null, c);
  assert.equal(moi.json.formule.id, "pass");
  assert.equal((await call("POST", "/api/stripe/webhook", "{}", "", { "stripe-signature": "t=1,v1=00" })).status, 400);
});

test("mot de passe oublié puis réinitialisation", async () => {
  await compte("oubli@exemple.fr");
  const { makeReset } = await import("../server/auth.mjs");
  const uid = db.prepare("SELECT id FROM users WHERE email = ?").get("oubli@exemple.fr").id;
  const t = makeReset(uid);
  assert.equal((await call("POST", "/api/reinitialiser", { jeton: t, motdepasse: "nouveaumdp1" })).status, 200);
  assert.equal((await call("POST", "/api/reinitialiser", { jeton: t, motdepasse: "nouveaumdp2" })).status, 400);   // lien à usage unique
  assert.equal((await call("POST", "/api/connexion", { email: "oubli@exemple.fr", motdepasse: "nouveaumdp1" })).status, 200);
});

test("suppression du compte", async () => {
  const c = await compte("bye@exemple.fr");
  await call("POST", "/api/objets", { objet: { titre: "Jeu" }, photo: PHOTO }, c);
  assert.equal((await call("POST", "/api/compte/supprimer", { motdepasse: "faux" }, c)).status, 400);
  assert.equal((await call("POST", "/api/compte/supprimer", { motdepasse: "motdepasse123" }, c)).status, 200);
  assert.equal((await call("GET", "/api/moi", null, c)).status, 401);
});

test("preuves et obligations légales : CG acceptées, résiliation programmée, rappel annuel", async () => {
  const c = await compte("legal@exemple.fr");
  const { CGV_VERSION } = await import("../server/plans.mjs");
  const { rappelsAnnuels } = await import("../server/stripe.mjs");
  let u = db.prepare("SELECT * FROM users WHERE email = ?").get("legal@exemple.fr");
  assert.equal(u.cgv_version, CGV_VERSION); assert.ok(u.cgv_at);
  const envoyer = async (ev) => { const raw = JSON.stringify(ev); return call("POST", "/api/stripe/webhook", raw, "", { "stripe-signature": signe(raw) }); };
  const fin = Math.floor(Date.now() / 1000) + 45 * 86400;
  const sub = (extra) => ({ id: "sub_l", customer: "cus_l", status: "active", metadata: { user_id: String(u.id) }, items: { data: [{ price: { id: "price_c_a" }, current_period_end: fin }] }, ...extra });
  await envoyer({ id: "evt_l1", type: "customer.subscription.created", data: { object: sub({}) } });
  assert.equal(await rappelsAnnuels(), 1);                       // échéance dans 45 jours : rappel envoyé
  assert.equal(await rappelsAnnuels(), 0);                       // une seule fois par échéance
  await envoyer({ id: "evt_l2", type: "customer.subscription.updated", data: { object: sub({ cancel_at_period_end: true }) } });
  const moi = await call("GET", "/api/moi", null, c);
  assert.equal(moi.json.formule.id, "collectionneur");           // garde sa formule jusqu'à la fin
  assert.equal(moi.json.formule.resiliation, new Date(fin * 1000).toISOString());
  await envoyer({ id: "evt_l3", type: "customer.subscription.updated", data: { object: sub({ cancel_at_period_end: false }) } });
  assert.equal((await call("GET", "/api/moi", null, c)).json.formule.resiliation, "");
});

test("résilier votre contrat, puis renoncer au contrat (rétractation)", async () => {
  const c = await compte("retract@exemple.fr");
  const uid = db.prepare("SELECT id FROM users WHERE email = ?").get("retract@exemple.fr").id;
  const envoyer = async (ev) => { const raw = JSON.stringify(ev); return call("POST", "/api/stripe/webhook", raw, "", { "stripe-signature": signe(raw) }); };
  assert.equal((await call("POST", "/api/resilier", { nom: "Camille Test", confirmer: true }, c)).status, 400);   // rien à résilier
  assert.equal((await call("POST", "/api/retractation", { nom: "Camille Test", confirmer: true }, c)).status, 400);
  const sub = { id: "sub_r", customer: "cus_r", status: "active", metadata: { user_id: String(uid) }, items: { data: [{ price: { id: "price_v_m" }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } };
  await envoyer({ id: "evt_r1", type: "checkout.session.completed", data: { object: { mode: "subscription", customer: "cus_r", amount_total: 499, client_reference_id: String(uid), metadata: { user_id: String(uid), offre: "vendeur" } } } });
  await envoyer({ id: "evt_r2", type: "customer.subscription.created", data: { object: sub } });
  let moi = (await call("GET", "/api/moi", null, c)).json;
  assert.equal(moi.formule.id, "vendeur"); assert.ok(moi.formule.retractable); assert.match(moi.formule.contrat, /Vendeur/);
  assert.equal((await call("POST", "/api/resilier", { nom: "", confirmer: true }, c)).status, 400);           // nom obligatoire
  assert.equal((await call("POST", "/api/resilier", { nom: "Camille Test" }, c)).status, 400);                // confirmation obligatoire
  assert.equal((await call("POST", "/api/resilier", { nom: "Camille Test", email: "camille@exemple.fr", confirmer: true }, c)).status, 200);
  moi = (await call("GET", "/api/moi", null, c)).json;
  assert.equal(moi.formule.id, "vendeur"); assert.ok(moi.formule.resiliation);
  const r = await call("POST", "/api/retractation", { nom: "Camille Test", confirmer: true }, c);
  assert.equal(r.status, 200); assert.equal(r.json.rembourse, "4,99");
  moi = (await call("GET", "/api/moi", null, c)).json;
  assert.equal(moi.formule.id, "gratuit"); assert.equal(moi.formule.retractable, "");
  const traces = db.prepare("SELECT type FROM demandes WHERE user_id = ? ORDER BY id").all(uid).map((x) => x.type);
  assert.deepEqual(traces, ["resiliation", "retractation"]);
});

test("profil : pseudo, avatar, changement d'e-mail", async () => {
  const c = await compte("profil@exemple.fr");
  let r = await call("POST", "/api/compte/profil", { pseudo: "Titelive" }, c);
  assert.equal(r.status, 200); assert.equal(r.json.pseudo, "Titelive"); assert.equal(r.json.nom, "Titelive");
  assert.equal((await call("POST", "/api/compte/profil", { pseudo: "<script>" }, c)).status, 400);
  assert.equal((await call("POST", "/api/compte/profil", { avatar: "javascript:alert(1)" }, c)).status, 400);
  r = await call("POST", "/api/compte/profil", { avatar: PHOTO }, c);
  assert.equal(r.status, 200); assert.equal(r.json.avatar, PHOTO);
  assert.equal((await call("POST", "/api/compte/email", { email: "nouveau@exemple.fr", motdepasse: "faux" }, c)).status, 400);
  await compte("pris@exemple.fr");
  assert.equal((await call("POST", "/api/compte/email", { email: "pris@exemple.fr", motdepasse: "motdepasse123" }, c)).status, 409);
  r = await call("POST", "/api/compte/email", { email: "nouveau@exemple.fr", motdepasse: "motdepasse123" }, c);
  assert.equal(r.status, 200); assert.equal(r.json.applique, true);   // pas d'envoi d'e-mails configuré en test : appliqué directement
  assert.equal((await call("GET", "/api/moi", null, c)).json.email, "nouveau@exemple.fr");
  const cx = await call("POST", "/api/connexion", { email: "nouveau@exemple.fr", motdepasse: "motdepasse123" });
  assert.equal(cx.status, 200);
  assert.match(String(cx.headers["Set-Cookie"]), /rr_co=1/);
});

test("extension navigateur : clé, annonces en vente, photo, isolation, révocation", async () => {
  const c = await compte("ext@exemple.fr"), d = await compte("ext2@exemple.fr");
  assert.equal((await call("POST", "/api/extension/cle")).status, 401);                                   // il faut une session
  const k = (await call("POST", "/api/extension/cle", null, c)).json.cle;
  assert.match(k, /^rre_/);
  const bearer = (cle) => ({ authorization: "Bearer " + cle });
  const o = (await call("POST", "/api/objets", { objet: { titre: "Zelda", plateforme: "Nintendo 64", etat: "bon", contenu: "complet", prixDemande: "44,6" }, photo: PHOTO }, c)).json.objet;
  await call("POST", "/api/objets", { objet: { titre: "Vendu déjà", statut: "vendu" } }, c);
  const autre = (await call("POST", "/api/objets", { objet: { titre: "Pas à moi" }, photo: PHOTO }, d)).json.objet;

  assert.equal((await call("GET", "/api/extension/annonces")).status, 401);
  assert.equal((await call("GET", "/api/extension/annonces", null, "", bearer("rre_" + "x".repeat(43)))).status, 401);
  assert.equal((await call("GET", "/api/extension/annonces", null, c)).status, 401);                      // le cookie ne suffit pas
  const r = await call("GET", "/api/extension/annonces", null, "", bearer(k));
  assert.equal(r.status, 200); assert.equal(r.headers["Access-Control-Allow-Origin"], "*");
  assert.equal(r.json.annonces.length, 1);
  const a = r.json.annonces[0];
  assert.equal(a.titre, "Zelda Nintendo 64"); assert.equal(a.prix, 45); assert.equal(a.etat, "bon"); assert.equal(a.photo, true);
  assert.match(a.description, /Bon état\.\nComplet : boîte et notice\./);

  assert.equal((await call("GET", "/api/extension/photo/" + o.id, null, "", bearer(k))).status, 200);
  assert.equal((await call("GET", "/api/extension/photo/" + autre.id, null, "", bearer(k))).status, 404);   // photo d'un autre compte
  // Toutes les photos de la galerie, dans l'ordre
  const g = (await call("POST", "/api/objets/" + o.id + "/photos", { photo: PHOTO }, c)).json.objet;
  const ids = (await call("GET", "/api/extension/annonces", null, "", bearer(k))).json.annonces[0].photos;
  assert.deepEqual(ids, g.photos.map((x) => x.id)); assert.equal(ids.length, 2);
  assert.equal((await call("GET", "/api/extension/photo/" + o.id + "/" + ids[1], null, "", bearer(k))).status, 200);
  assert.equal((await call("GET", "/api/extension/photo/" + o.id + "/abcdef12", null, "", bearer(k))).status, 404);
  assert.equal((await call("OPTIONS", "/api/extension/annonces", null, "", { origin: "chrome-extension://abc" })).status, 204);
  assert.equal((await call("POST", "/api/extension/rempli", null, "", { ...bearer(k), origin: "chrome-extension://abc" })).status, 200);
  assert.equal((await call("GET", "/api/moi", null, c)).json.usage.lbc, 1);
  assert.equal((await call("GET", "/api/moi", null, c)).json.extension, 1);

  assert.equal((await call("DELETE", "/api/extension/cle", null, c)).json.supprimees, 1);
  assert.equal((await call("GET", "/api/extension/annonces", null, "", bearer(k))).status, 401);
});

test("galerie : ajout, légende, ordre, suppression, plafond de 12", async () => {
  const c = await compte("galerie@exemple.fr"), d = await compte("intrus@exemple.fr");
  const o = (await call("POST", "/api/objets", { objet: { titre: "Conker", plateforme: "Nintendo 64" }, photo: PHOTO }, c)).json.objet;
  assert.deepEqual(o.photos.map((x) => x.id), ["p0"]);
  const a = await call("POST", "/api/objets/" + o.id + "/photos", { photo: PHOTO, legende: "Dos de la cartouche" }, c);
  assert.equal(a.status, 200);
  const p1 = a.json.objet.photos[1];
  assert.equal(p1.legende, "Dos de la cartouche");
  assert.equal((await call("POST", "/api/objets/" + o.id + "/photos", { photo: PHOTO }, d)).status, 404);
  assert.equal((await call("GET", "/api/photo/" + o.id + "/" + p1.id, null, c)).status, 200);
  assert.equal((await call("GET", "/api/photo/" + o.id + "/" + p1.id, null, d)).status, 404);
  const l = await call("PUT", "/api/objets/" + o.id + "/photos/" + p1.id, { legende: "Étiquette arrière" }, c);
  assert.equal(l.json.objet.photos[1].legende, "Étiquette arrière");
  const r = await call("PUT", "/api/objets/" + o.id, { objet: { photos: [{ id: p1.id, legende: "Étiquette arrière" }, { id: "p0", legende: "Face" }, { id: "inconnu" }] } }, c);
  assert.deepEqual(r.json.objet.photos.map((x) => x.id), [p1.id, "p0"]);
  assert.equal((await call("GET", "/api/photo/" + o.id, null, c)).status, 200);
  assert.equal((await call("DELETE", "/api/objets/" + o.id + "/photos/p0", null, c)).json.objet.photos.length, 1);
  for (let i = 0; i < 11; i++) assert.equal((await call("POST", "/api/objets/" + o.id + "/photos", { photo: PHOTO }, c)).status, 200);
  assert.equal((await call("POST", "/api/objets/" + o.id + "/photos", { photo: PHOTO }, c)).status, 400);
  assert.equal((await call("DELETE", "/api/objets/" + o.id, null, c)).status, 200);
});

test("légendes IA simulées : une par photo", async () => {
  const c = await compte("legende@exemple.fr", true);
  const r = await call("POST", "/api/ia/legender", { photos: [PHOTO, PHOTO, PHOTO], objet: { titre: "Zelda" } }, c);
  assert.equal(r.status, 200);
  assert.equal(r.json.legendes.length, 3);
  assert.ok(r.json.legendes.every((x) => typeof x === "string" && x.length > 0));
});

test("mode test des formules : réservé aux adresses ADMIN_EMAILS", async () => {
  process.env.ADMIN_EMAILS = "chef@exemple.fr, autre@exemple.fr";
  try {
    const n = await compte("pasadmin@exemple.fr"), a = await compte("Chef@Exemple.fr");
    assert.equal((await call("POST", "/api/admin/formule", { formule: "pass" }, n)).status, 404);
    const mn = (await call("GET", "/api/moi", null, n)).json;
    assert.equal(mn.admin, undefined); assert.equal(mn.formuleTest, undefined);
    assert.equal((await call("GET", "/api/moi", null, a)).json.formule.id, "collectionneur");   // propriétaire : formule la plus complète d'office
    assert.equal((await call("GET", "/api/moi", null, n)).json.formule.id, "gratuit");
    assert.equal((await call("POST", "/api/admin/formule", { formule: "nimporte" }, a)).status, 400);
    const r = await call("POST", "/api/admin/formule", { formule: "collectionneur" }, a);
    assert.equal(r.status, 200);
    assert.equal(r.json.moi.admin, true); assert.equal(r.json.moi.formuleTest, "collectionneur");
    assert.equal((await call("GET", "/api/export.csv", null, a)).status, 200);
    process.env.ADMIN_EMAILS = "";
    assert.notEqual((await call("GET", "/api/export.csv", null, a)).status, 200);
    assert.equal((await call("POST", "/api/admin/formule", { formule: "" }, a)).status, 404);
  } finally { process.env.ADMIN_EMAILS = ""; }
});

test("origine et fonctionnement : d'origine testé par défaut, précision gardée", async () => {
  const c = await compte("origine@exemple.fr");
  const a = (await call("POST", "/api/objets", { objet: { titre: "Conker" } }, c)).json.objet;
  assert.equal(a.origine, "origine");
  const b = (await call("POST", "/api/objets", { objet: { titre: "Zelda", origine: "modifie", modif: "pile changée" } }, c)).json.objet;
  assert.equal(b.origine, "modifie"); assert.equal(b.modif, "pile changée");
  assert.equal((await call("POST", "/api/objets", { objet: { titre: "X", origine: "bidon" } }, c)).json.objet.origine, "origine");
});

test("légendes et annonces : jamais d'« apparemment », on affirme ou on se tait", async () => {
  const { affirme } = await import("../server/ia.mjs");
  assert.equal(affirme("Connecteur doré : contacts apparemment propres, pas de défaut visible"), "Connecteur doré : pas de défaut");
  assert.equal(affirme("Extrémité : aucune cassure apparente"), "Extrémité : aucune cassure");
  assert.equal(affirme("L'étiquette semble propre"), "");
  assert.equal(affirme("Super Mario 64 sur Nintendo 64.\nBon état, coins probablement frottés.\nRemise en main propre ou envoi."), "Super Mario 64 sur Nintendo 64.\nBon état.\nRemise en main propre ou envoi.");
  assert.equal(affirme("Tranche gauche : plastique lisse, sans rayure ni choc visible"), "Tranche gauche : plastique lisse, sans rayure ni choc");
  assert.equal(affirme("Cartouche visiblement d'origine, probablement testée"), "Cartouche d'origine");
});

test("menu du site : l'indice de connexion est rattrapé pour les anciennes sessions", async () => {
  const { indiceConnexion } = await import("../server/auth.mjs");
  const c = await compte("indice@exemple.fr");
  assert.match(indiceConnexion({ headers: { cookie: c } }), /^rr_co=1;/);
  assert.equal(indiceConnexion({ headers: { cookie: c + "; rr_co=1" } }), "");
  assert.match(indiceConnexion({ headers: { cookie: "rr_co=1" } }), /^rr_co=; .*Max-Age=0/);
  assert.equal(indiceConnexion({ headers: { cookie: "" } }), "");
});

test("légendes déjà enregistrées : les formules de doute disparaissent à la lecture", async () => {
  const c = await compte("vieilles-legendes@exemple.fr");
  const o = (await call("POST", "/api/objets", { objet: { titre: "Conker" }, photo: PHOTO }, c)).json.objet;
  const r = await call("PUT", "/api/objets/" + o.id + "/photos/p0", { legende: "Connecteur doré : contacts apparemment propres, pas de défaut visible" }, c);
  assert.equal(r.json.objet.photos[0].legende, "Connecteur doré : pas de défaut");
});

test("extension : réponse IA aux acheteurs", async () => {
  const c = await compte("rep@exemple.fr", true);
  const k = (await call("POST", "/api/extension/cle", null, c)).json.cle;
  const o = (await call("POST", "/api/objets", { objet: { titre: "Conker", plateforme: "Nintendo 64", prixDemande: 200 } }, c)).json.objet;
  const h = { authorization: "Bearer " + k };
  assert.equal((await call("POST", "/api/extension/reponse", { conversation: "" }, "", h)).status, 422);
  const r = await call("POST", "/api/extension/reponse", { conversation: "Kevin : je vous prends Conker et Kirby pour 60 € les deux", annonce: o.id }, "", h);
  assert.equal(r.status, 200); assert.equal(r.json.reponses.length, 3); assert.ok(r.json.reponses[0].texte);
  assert.equal((await call("GET", "/api/moi", null, c)).json.usage.reponse, 1);
});

test("extension : lien de l'annonce publiée", async () => {
  const c = await compte("lien@exemple.fr"), d = await compte("lien2@exemple.fr");
  const k = (await call("POST", "/api/extension/cle", null, c)).json.cle, h = { authorization: "Bearer " + k };
  const o = (await call("POST", "/api/objets", { objet: { titre: "Kirby 64" } }, c)).json.objet;
  const autre = (await call("POST", "/api/objets", { objet: { titre: "Pas à moi" } }, d)).json.objet;
  assert.equal((await call("POST", "/api/extension/lien", { annonce: o.id, url: "https://pirate.example/ad/x/123456" }, "", h)).status, 400);
  assert.equal((await call("POST", "/api/extension/lien", { annonce: autre.id, url: "https://www.leboncoin.fr/ad/jeux_video/2934567890" }, "", h)).status, 404);
  const r = await call("POST", "/api/extension/lien", { annonce: o.id, url: "https://www.leboncoin.fr/ad/jeux_video/2934567890?ref=x" }, "", h);
  assert.equal(r.status, 200); assert.equal(r.json.url, "https://www.leboncoin.fr/ad/jeux_video/2934567890");
  const a = (await call("GET", "/api/extension/annonces", null, "", h)).json.annonces.find((x) => x.id === o.id);
  assert.equal(a.publiee, true);
  // une annonce ne se rattache qu'à un seul jeu
  const o2 = (await call("POST", "/api/objets", { objet: { titre: "Kirby 64 bis" } }, c)).json.objet;
  assert.equal((await call("POST", "/api/extension/lien", { annonce: o2.id, url: "https://www.leboncoin.fr/ad/jeux_video/2934567890" }, "", h)).status, 409);
  assert.equal((await call("POST", "/api/extension/lien", { annonce: o.id, url: "https://www.leboncoin.fr/ad/jeux_video/2934567890" }, "", h)).status, 200);
  // prix modifié sur Le Bon Coin : repris dans RetroRevente
  const p = await call("POST", "/api/extension/lien", { annonce: o.id, url: "https://www.leboncoin.fr/ad/jeux_video/2934567890", prix: 35 }, "", h);
  assert.equal(p.json.prixChange, true); assert.equal(p.json.prix, 35);
  const a2 = (await call("GET", "/api/extension/annonces", null, "", h)).json.annonces.find((x) => x.id === o.id);
  assert.equal(a2.prix, 35); assert.equal(a2.url, "https://www.leboncoin.fr/ad/jeux_video/2934567890");
  assert.equal((await call("POST", "/api/extension/lien", { annonce: o.id, url: "https://www.leboncoin.fr/ad/jeux_video/2934567890", prix: 35 }, "", h)).json.prixChange, false);
});

test("eBay : lien de l'annonce, depuis la fiche et depuis l'extension", async () => {
  const { lienEbay } = await import("../server/api.mjs");
  assert.equal(lienEbay("https://www.ebay.fr/itm/Kirby-64-N64-PAL/204512345678?hash=item2f9&var=1"), "https://www.ebay.fr/itm/204512345678");
  assert.equal(lienEbay("ebay.fr/itm/204512345678"), "https://www.ebay.fr/itm/204512345678");
  assert.equal(lienEbay("https://m.ebay.com/itm/204512345678"), "https://www.ebay.com/itm/204512345678");
  assert.equal(lienEbay("https://www.ebay.fr/itm/?item=204512345678"), "https://www.ebay.fr/itm/204512345678");
  assert.equal(lienEbay("https://www.ebay.fr.pirate.example/itm/204512345678"), "");
  assert.equal(lienEbay("https://www.ebay.fr/usr/vendeur"), "");
  const c = await compte("ebay@exemple.fr");
  assert.equal((await call("POST", "/api/objets", { objet: { titre: "Kirby 64", annonceEbay: "https://www.ebay.fr/sch/kirby" } }, c)).status, 400);
  const o = (await call("POST", "/api/objets", { objet: { titre: "Kirby 64", prixDemande: 40, annonceEbay: "https://www.ebay.fr/itm/Kirby/204512345678?x=1" } }, c)).json.objet;
  assert.equal(o.annonceEbay, "https://www.ebay.fr/itm/204512345678");
  const k = (await call("POST", "/api/extension/cle", null, c)).json.cle, h = { authorization: "Bearer " + k };
  const o2 = (await call("POST", "/api/objets", { objet: { titre: "Conker", prixDemande: 150 } }, c)).json.objet;
  assert.equal((await call("POST", "/api/extension/lien", { site: "ebay", annonce: o2.id, url: "https://www.leboncoin.fr/ad/jeux_video/2934567890" }, "", h)).status, 400);
  assert.equal((await call("POST", "/api/extension/lien", { site: "ebay", annonce: o2.id, url: "https://www.ebay.fr/itm/204512345678" }, "", h)).status, 409);
  const r = await call("POST", "/api/extension/lien", { site: "ebay", annonce: o2.id, url: "https://www.ebay.fr/itm/Conker/205599887766", prix: 145 }, "", h);
  assert.equal(r.status, 200); assert.equal(r.json.url, "https://www.ebay.fr/itm/205599887766"); assert.equal(r.json.prix, 145);
  const a = (await call("GET", "/api/extension/annonces", null, "", h)).json.annonces.find((x) => x.id === o2.id);
  assert.equal(a.urlEbay, "https://www.ebay.fr/itm/205599887766"); assert.equal(a.url, ""); assert.equal(a.publiee, false);
  // les deux liens cohabitent : Le Bon Coin ne remplace pas eBay
  await call("POST", "/api/extension/lien", { annonce: o2.id, url: "https://www.leboncoin.fr/ad/jeux_video/2934567891" }, "", h);
  const a2 = (await call("GET", "/api/extension/annonces", null, "", h)).json.annonces.find((x) => x.id === o2.id);
  assert.equal(a2.urlEbay, "https://www.ebay.fr/itm/205599887766"); assert.equal(a2.url, "https://www.leboncoin.fr/ad/jeux_video/2934567891");
});

test("eBay : l'extension reçoit l'annonce au format eBay", async () => {
  const { titreEbay } = await import("../server/api.mjs");
  assert.equal(titreEbay("Kirby 64 The Crystal Shards Nintendo 64 PAL complet en boîte avec notice CIB très bon état"), "Kirby 64 The Crystal Shards Nintendo 64 PAL complet en boîte avec notice CIB");
  const c = await compte("ebay-format@exemple.fr");
  const o = (await call("POST", "/api/objets", { objet: { titre: "Kirby 64", plateforme: "Nintendo 64", region: "PAL", etat: "tres_bon", contenu: "complet", prixDemande: 85 } }, c)).json.objet;
  const k = (await call("POST", "/api/extension/cle", null, c)).json.cle, h = { authorization: "Bearer " + k };
  const e = (await call("GET", "/api/extension/annonces", null, "", h)).json.annonces.find((x) => x.id === o.id).ebay;
  assert.equal(e.titre, "Kirby 64 Nintendo 64"); assert.equal(e.etat, "Très bon état"); assert.equal(e.prix, 85); assert.equal(e.plancher, 75);
  assert.deepEqual(e.caracteristiques.map((x) => x.nom), ["Nom du jeu", "Plateforme", "Région", "Contenu"]);
  assert.match(e.description, /Envoi soigné et rapide, avec suivi\./); assert.doesNotMatch(e.description, /main propre/);
});

test("eBay : réponse IA dans la messagerie eBay", async () => {
  const c = await compte("ebay-rep@exemple.fr", true);
  const k = (await call("POST", "/api/extension/cle", null, c)).json.cle, h = { authorization: "Bearer " + k };
  const o = (await call("POST", "/api/objets", { objet: { titre: "Conker", plateforme: "Nintendo 64", prixDemande: 200 } }, c)).json.objet;
  const r = await call("POST", "/api/extension/reponse", { site: "ebay", conversation: "kevin_64 : Offre de 120,00 EUR. Bonjour, possible à ce prix ?", annonce: o.id, offre: 120 }, "", h);
  assert.equal(r.status, 200); assert.equal(r.json.reponses.length, 3); assert.equal(r.json.offre.offre, 120);
});

test("contenu d'un lot : chaque jeu retrouvé parmi les annonces", async () => {
  const { contenuLot } = await import("../server/ia.mjs");
  const autres = [
    { nom: "Conker's Bad Fur Day", titre: "Conker's Bad Fur Day Nintendo 64", prix: 190, etat: "tres_bon", contenu: "seul" },
    { nom: "Astérix and the Great Rescue", titre: "Astérix and the Great Rescue Mega Drive", prix: 15, contenu: "boite" },
    { nom: "Super Mario 64", titre: "Super Mario 64 Nintendo 64", prix: 49 },
  ];
  const r = contenuLot(["Conker's Bad Fur Day Nintendo 64 PAL EUR loose", "Astérix and the Great Rescue – Sega Mega Drive PAL – Boîte + cartouche", "Zelda Majora's Mask"], autres);
  assert.equal(r.length, 3);
  assert.equal(r[0].annonce.prix, 190);
  assert.equal(r[1].annonce.prix, 15);
  assert.equal(r[2].annonce, null);
  assert.deepEqual(contenuLot(null, autres), []);
});

test("identification : si le premier modèle ne reconnaît pas, un modèle plus fort avec recherche web prend le relais", async () => {
  const { identifier } = await import("../server/ia.mjs");
  const vrai = globalThis.fetch, appels = [];
  process.env.IA_FAKE = "0"; process.env.ANTHROPIC_API_KEY = "test";
  globalThis.fetch = async (url, o) => {
    const b = JSON.parse(o.body); appels.push(b);
    const rep = appels.length === 1 ? { trouve: false } : { trouve: true, titre: "Grand Theft Auto VI", categorie: "jeux", plateforme: "PlayStation 5", region: "PAL EUR", contenu: "boite", description: "GTA VI sur PlayStation 5." };
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(rep) }] }), { status: 200 });
  };
  try {
    const o = await identifier(PHOTO.replace("data:image/jpeg", "data:image/jpeg"));
    assert.equal(o.titre, "Grand Theft Auto VI"); assert.equal(o.plateforme, "PlayStation 5");
    assert.equal(appels.length, 2);
    assert.ok(appels[1].tools && appels[1].tools[0].type.startsWith("web_search"));
    assert.notEqual(appels[1].model, appels[0].model);
  } finally { globalThis.fetch = vrai; process.env.IA_FAKE = "1"; delete process.env.ANTHROPIC_API_KEY; }
});

test("JSON du modèle : lu même avec des retours à la ligne bruts ou une virgule en trop", async () => {
  const { lireJson } = await import("../server/ia.mjs");
  assert.deepEqual(lireJson('Voici :\n```json\n{"a": "l1\nl2", "b": [1,],}\n```'), { a: "l1\nl2", b: [1] });
  assert.equal(lireJson("pas de json"), null);
});

test("discussion avec l'IA : réponse, changements filtrés, message requis", async () => {
  const c = await compte("dial" + Date.now() + "@t.fr", true);
  let r = await call("POST", "/api/ia/dialoguer", { messages: [{ role: "vendeur", texte: "baisse à 25 €" }], fiche: { titre: "GTA VI", prixDemande: "40" } }, c);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.changements.prixDemande, 25);
  assert.match(r.json.reponse, /25/);
  r = await call("POST", "/api/ia/dialoguer", { messages: [{ role: "ia", texte: "Bonjour" }] }, c);
  assert.equal(r.status, 422);
  r = await call("POST", "/api/ia/dialoguer", { messages: [{ role: "vendeur", texte: "salut" }] });
  assert.equal(r.status, 401);
  const { changementsSurs } = await import("../server/ia.mjs");
  assert.deepEqual(changementsSurs({ contenu: "boite_vide", etat: "nul", statut: "vendu", prixDemande: "19,5", particularites: "Poster inclus", texteAnnonce: "Boîte apparemment propre." }),
    { contenu: "boite_vide", particularites: "Poster inclus", prixDemande: 19.5, texteAnnonce: "" });
});

test("cartes Pokémon : reconnaissance, fiche, cote, annonce pour l'extension", async () => {
  const c = await compte("carte" + Date.now() + "@t.fr", true);
  process.env.IA_FAKE_OBJET = "carte";
  try {
    const r = await call("POST", "/api/ia/identifier", { photo: PHOTO }, c);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const o = r.json.objet;
    assert.equal(o.categorie, "cartes"); assert.equal(o.numero, "4/102"); assert.equal(o.etatCarte, "near_mint");
    assert.equal(o.etat, "tres_bon"); assert.equal(o.contenu, "");
    const cote = await call("POST", "/api/ia/cote", { objet: { ...o } }, c);
    assert.equal(cote.status, 200, JSON.stringify(cote.json));
    assert.ok(cote.json.cote.conseille > 0);
    // fiche : champs de carte gardés, contenu ignoré, état LBC déduit de l'état collectionneur
    const f = await call("POST", "/api/objets", { objet: { titre: "Dracaufeu", categorie: "cartes", plateforme: "Set de base", region: "Français", numero: "4/102", rarete: "Holo rare", gradation: "", etatCarte: "excellent", contenu: "complet", prixDemande: 250 } }, c);
    assert.equal(f.status, 200, JSON.stringify(f.json));
    const it = f.json.objet;
    assert.equal(it.numero, "4/102"); assert.equal(it.etatCarte, "excellent"); assert.equal(it.etat, "tres_bon"); assert.equal(it.contenu, "");
    const { annonceLbc } = await import("../server/api.mjs");
    const a = annonceLbc(it);
    assert.equal(a.categorie, "cartes"); assert.equal(a.numero, "4/102");
    assert.match(a.description, /Carte Pokémon Dracaufeu 4\/102, extension Set de base, en français\./);
    assert.match(a.description, /sleeve et toploader/);
    // un jeu ne reçoit pas les champs de carte
    const j = await call("POST", "/api/objets", { objet: { titre: "Kirby 64", categorie: "jeux", numero: "4/102" } }, c);
    assert.equal(j.json.objet.numero, undefined);
  } finally { delete process.env.IA_FAKE_OBJET; }
});

test("films : reconnaissance, fiche, cote, infos, annonce et réponses pour l'extension", async () => {
  const c = await compte("film" + Date.now() + "@t.fr", true);
  process.env.IA_FAKE_OBJET = "film";
  try {
    const r = await call("POST", "/api/ia/identifier", { photo: PHOTO }, c);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const o = r.json.objet;
    assert.equal(o.categorie, "films"); assert.equal(o.plateforme, "Blu-Ray 4K UHD + Blu-Ray"); assert.equal(o.edition, "Steelbook");
    assert.equal(o.annee, "2024"); assert.equal(o.realisateur, "Denis Villeneuve"); assert.equal(o.contenu, ""); assert.equal(o.jauni, undefined);
    // cote : un 4K steelbook vaut plus qu'un DVD, et un DVD courant est signalé « à mettre en lot »
    const cote = await call("POST", "/api/ia/cote", { objet: { ...o } }, c);
    assert.equal(cote.status, 200, JSON.stringify(cote.json));
    const dvd = await call("POST", "/api/ia/cote", { objet: { titre: "Gladiator", categorie: "films", plateforme: "DVD" } }, c);
    assert.ok(cote.json.cote.conseille > dvd.json.cote.conseille);
    assert.equal(cote.json.cote.lot, false); assert.equal(dvd.json.cote.lot, true);
    // fiche : format normalisé, champs de film gardés, contenu ignoré
    const f = await call("POST", "/api/objets", { objet: { titre: "Dune : Deuxième partie", categorie: "films", plateforme: "4k ultra hd", region: "VF incluse", annee: "2024", realisateur: "Denis Villeneuve", edition: "Steelbook, Édition limitée", contenu: "complet", etat: "tres_bon", prixDemande: 35 } }, c);
    assert.equal(f.status, 200, JSON.stringify(f.json));
    const it = f.json.objet;
    assert.equal(it.plateforme, "Blu-Ray 4K UHD"); assert.equal(it.annee, "2024"); assert.equal(it.edition, "Steelbook, Édition limitée"); assert.equal(it.contenu, "");
    const mauvais = await call("POST", "/api/objets", { objet: { titre: "Film", categorie: "films", annee: "deux mille" } }, c);
    assert.equal(mauvais.json.objet.annee, "");
    const { annonceLbc } = await import("../server/api.mjs");
    const a = annonceLbc(it);
    assert.equal(a.categorie, "films"); assert.equal(a.titre, "Dune : Deuxième partie 4K UHD Steelbook"); assert.equal(a.edition, "Steelbook, Édition limitée");
    assert.match(a.description, /^Film Dune : Deuxième partie \(2024\) de Denis Villeneuve, en Blu-Ray 4K UHD, Steelbook, édition limitée\.\nVF incluse\.\nTrès bon état\./);
    // fiche du film (exemple hors ligne) et export CSV avec les colonnes de film
    const inf = await call("POST", "/api/film-infos", { titre: "Dune : Deuxième partie", annee: "2024" }, c);
    assert.equal(inf.status, 200); assert.equal(inf.json.infos.realisateur, "Denis Villeneuve"); assert.ok(inf.json.infos.jaquette);
    const csv = await call("GET", "/api/export.csv", null, c);
    assert.match(String(csv.body || ""), /;annee;realisateur;/);
    // légendes : pas de jaunissement pour un film
    process.env.IA_FAKE_JAUNI = "net";
    const lg = await call("POST", "/api/ia/legender", { photos: [PHOTO], objet: { titre: "Dune", categorie: "films" } }, c);
    assert.deepEqual(lg.json.jaunis, ["non"]);
    delete process.env.IA_FAKE_JAUNI;
    // discussion : l'année et le réalisateur passent, une année fantaisiste non
    const { changementsSurs } = await import("../server/ia.mjs");
    assert.deepEqual(changementsSurs({ annee: "1999", realisateur: "Lana Wachowski", edition: "Steelbook" }), { edition: "Steelbook", annee: "1999", realisateur: "Lana Wachowski" });
    assert.deepEqual(changementsSurs({ annee: "vers 1999" }), {});
  } finally { delete process.env.IA_FAKE_OBJET; delete process.env.IA_FAKE_JAUNI; }
});

test("cartes Pokémon : TCGdex retrouve la bonne carte et sa cote Cardmarket", async () => {
  const { carteTcgdex, numLocal } = await import("../server/cartes.mjs");
  assert.equal(numLocal("004/102"), "4"); assert.equal(numLocal("TG05/TG30"), "TG05");
  const vrai = globalThis.fetch, vus = [];
  const cartes = {
    "base1-4": { id: "base1-4", localId: "4", name: "Dracaufeu", rarity: "Rare Holo", set: { name: "Set de Base", cardCount: { official: 102 } }, variants: { holo: true, firstEdition: true }, pricing: { cardmarket: { updated: "2026-11-17T00:00:00Z", unit: "EUR", avg: 410, low: 250, trend: 432.5, avg30: 420 } } },
    "base4-4": { id: "base4-4", localId: "4", name: "Dracaufeu", rarity: "Rare Holo", set: { name: "Base Set 2", cardCount: { official: 130 } }, variants: { holo: true }, pricing: { cardmarket: { trend: 150, avg30: 140 } } },
  };
  globalThis.fetch = async (url) => {
    vus.push(String(url));
    const u = new URL(url);
    if (u.pathname.endsWith("/cards")) return new Response(JSON.stringify([{ id: "base1-4", localId: "4", name: "Dracaufeu" }, { id: "base4-4", localId: "4", name: "Dracaufeu" }, { id: "xy12-11", localId: "11", name: "Dracaufeu" }]));
    const id = decodeURIComponent(u.pathname.split("/").pop());
    return cartes[id] ? new Response(JSON.stringify(cartes[id])) : new Response("", { status: 404 });
  };
  try {
    const r = await carteTcgdex({ titre: "Dracaufeu", numero: "4/102", plateforme: "Set de base", region: "Français" }, { base: "https://tcg.test/v2" });
    assert.equal(r.id, "base1-4"); assert.equal(r.numero, "4/102"); assert.equal(r.cote.tendance, 432.5); assert.equal(r.cote.variante, "normale");
    assert.ok(vus[0].includes("/fr/cards?name=Dracaufeu"));
    // ambigu et rien ne colle : on ne devine pas
    assert.equal(await carteTcgdex({ titre: "Dracaufeu", numero: "4", plateforme: "Inconnue" }, { base: "https://tcg.test/v2" }), null);
    // reverse : cote « holo » de Cardmarket
    cartes["base1-4"].pricing.cardmarket["trend-holo"] = 600;
    assert.equal((await carteTcgdex({ titre: "Dracaufeu", numero: "4/102", rarete: "Reverse" }, { base: "https://tcg.test/v2" })).cote.tendance, 600);
    // TCGdex en panne : null, sans erreur
    globalThis.fetch = async () => { throw new Error("réseau"); };
    assert.equal(await carteTcgdex({ titre: "Dracaufeu", numero: "4/102" }, { base: "https://tcg.test/v2" }), null);
  } finally { globalThis.fetch = vrai; }
  const { rondCarte } = await import("../server/ia.mjs");
  assert.equal(rondCarte(3.4), 3); assert.equal(rondCarte(0.2), 1); assert.equal(rondCarte(47), 45); assert.equal(rondCarte(476), 480);
});

test("cartes Pokémon : photo d'un classeur, cartes de valeur à part, le reste en lot", async () => {
  const c = await compte("classeur" + Date.now() + "@t.fr", true);
  const r = await call("POST", "/api/ia/inventaire", { photo: PHOTO }, c);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.cartes.length, 4);
  assert.deepEqual(r.json.cartes.filter((x) => x.seule).map((x) => x.titre), ["Dracaufeu", "Ronflex"]);
  assert.equal(r.json.cartes[0].etat, "tres_bon");
  const lot = r.json.lot;
  assert.equal(lot.n, 2); assert.equal(lot.titre, "Lot de 2 cartes Pokémon FR");
  assert.equal(lot.prix, 5);   // 2 € de cote : prix plancher d'un lot
  assert.match(lot.description, /Cartes : Pikachu 58\/102, Salamèche 46\/102\./);
  const l2 = await call("POST", "/api/lot-cartes", { cartes: [...r.json.cartes, { titre: "Mew", rarete: "Reverse", region: "Anglais", cote: 40 }] }, c);
  assert.match(l2.json.lot.titre, /^Lot de 5 cartes Pokémon dont 2 holo et 1 reverse$/);
  assert.equal(l2.json.lot.prix, 140);   // (120 + 1,2 + 0,8 + 14 + 40) × 0,8 = 140,8
  assert.equal((await call("POST", "/api/lot-cartes", { cartes: [] }, c)).json.lot, null);
});

test("IA en formule Découverte : un seul essai, e-mail confirmé, pas de comptes en série", async () => {
  const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
  // adresse jetable refusée à l'inscription
  assert.equal((await call("POST", "/api/inscription", { email: "x@yopmail.com", motdepasse: "motdepasse123", cgv: true, adresse: "54000 Nancy" })).status, 400);
  // adresse pas encore confirmée : refus explicite
  const r0 = await call("POST", "/api/inscription", { email: "jean.dupont+a@gmail.com", motdepasse: "motdepasse123", cgv: true, adresse: "54000 Nancy" });
  const c = cookieOf(r0);
  let r = await call("POST", "/api/ia/identifier", { photo: PHOTO }, c);
  assert.equal(r.status, 403); assert.equal(r.json.verif, true);
  assert.equal((await call("GET", "/api/moi", null, c)).json.ia, "verif");
  // confirmation par le lien
  db.prepare("UPDATE users SET verif_token = ? WHERE email = ?").run(sha("jeton-de-test-0123456789abc"), "jean.dupont+a@gmail.com");
  assert.equal((await call("POST", "/api/verifier", { jeton: "jeton-de-test-0123456789abc" })).status, 200);
  assert.equal((await call("POST", "/api/verifier", { jeton: "jeton-de-test-0123456789abc" })).status, 400);
  assert.equal((await call("GET", "/api/moi", null, c)).json.ia, "dispo");
  // l'essai : un jeu reconnu, une cote, puis c'est fini
  const app = { "x-rr-app": "appareil0123456789ab" };
  assert.equal((await call("POST", "/api/ia/identifier", { photo: PHOTO }, c, app)).status, 200);
  assert.equal((await call("POST", "/api/ia/cote", { objet: { titre: "Super Mario 64" } }, c, app)).status, 200);
  r = await call("POST", "/api/ia/identifier", { photo: PHOTO }, c, app);
  assert.equal(r.status, 402); assert.equal(r.json.ia, true);
  assert.equal((await call("POST", "/api/ia/cote", { objet: { titre: "Zelda" } }, c, app)).status, 402);
  assert.equal((await call("GET", "/api/moi", null, c)).json.ia, "utilise");
  // nouveau compte avec une variante Gmail de la même adresse : pas de nouvel essai
  const c2 = await compte("JeanDupont@googlemail.com");
  assert.equal((await call("POST", "/api/ia/identifier", { photo: PHOTO }, c2)).status, 402);
  // nouveau compte, autre adresse, même appareil : pas de nouvel essai
  const c3 = await compte("autre.personne@exemple.fr");
  assert.equal((await call("POST", "/api/ia/identifier", { photo: PHOTO }, c3, app)).status, 402);
  // formule payante : l'IA sans essai
  const c4 = await compte("payant-ia@exemple.fr", true);
  for (let i = 0; i < 3; i++) assert.equal((await call("POST", "/api/ia/cote", { objet: { titre: "Jeu " + i } }, c4, app)).status, 200);
  assert.equal((await call("GET", "/api/moi", null, c4)).json.ia, null);
});

test("un au revoir ne reparle pas du budget", async () => {
  const { sansSujet } = await import("../server/ia.mjs");
  assert.equal(sansSujet("Je comprends tout à fait votre budget, Garnier. Merci pour l'échange et bonne soirée à vous 😊"), "Merci pour l'échange et bonne soirée à vous 😊");
  assert.doesNotMatch(sansSujet("Merci Garnier, je comprends pour le budget 🙂"), /budget|comprends/);
  assert.equal(sansSujet("Merci à vous, bonne soirée 🙂"), "Merci à vous, bonne soirée 🙂");
});

test("suite de son propre message : ni merci ni bonjour en ouverture", async () => {
  const { sansPolitesse } = await import("../server/ia.mjs");
  assert.equal(sansPolitesse("Merci Sofian ! Petite précision : il y a aussi le poster 🙂"), "Petite précision : il y a aussi le poster 🙂");
  assert.equal(sansPolitesse("Bonjour Sofian, merci pour votre message ! Je précise que le jeu est complet."), "Je précise que le jeu est complet.");
  assert.equal(sansPolitesse("Bonjour il y a aussi le poster dans la boîte."), "Il y a aussi le poster dans la boîte.");
  assert.equal(sansPolitesse("Petite précision : poster recto verso."), "Petite précision : poster recto verso.");
});

test("analyse d'une offre officielle : trop basse face au prix affiché", async () => {
  const { analyseOffre } = await import("../server/ia.mjs");
  const a = analyseOffre(190, 140);
  assert.equal(a.ecart, 26); assert.equal(a.plancher, 170); assert.equal(a.contre, 180); assert.equal(a.basse, true);
  const b = analyseOffre(190, 175);
  assert.equal(b.basse, false); assert.equal(b.acceptable, true);
  assert.equal(analyseOffre(null, 140), null);
  // Offre presque insultante (−39 %) : un tout petit geste seulement, jamais vers le plancher.
  const c = analyseOffre(330, 200);
  assert.equal(c.insultante, true); assert.equal(c.contre, 320); assert.equal(c.plancher, 320);
});

test("pseudo avec des chiffres : gardé tel quel, jamais coupé", async () => {
  const { sansPrenomInvente } = await import("../server/ia.mjs");
  assert.equal(sansPrenomInvente("Bonjour Jram76100, merci pour l'offre !", "Jram76100"), "Bonjour Jram76100, merci pour l'offre !");
  assert.equal(sansPrenomInvente("Bonjour Kevin54, merci !", ""), "Bonjour, merci !");
});

test("fiche d'un jeu : infos (simulées) et ma note enregistrée", async () => {
  const c = await compte("note@exemple.fr");
  const r = await call("POST", "/api/jeu-infos", { titre: "Super Mario 64", plateforme: "Nintendo 64" }, c);
  assert.equal(r.status, 200);
  assert.ok(r.json.infos.jaquette && r.json.infos.captures.length && r.json.infos.description);
  assert.equal((await call("POST", "/api/jeu-infos", { titre: "Introuvable" }, c)).json.infos, null);
  const o = (await call("POST", "/api/objets", { objet: { titre: "Super Mario 64", note: "4", jeuRef: "1074" } }, c)).json.objet;
  assert.equal(o.note, 4); assert.equal(o.jeuRef, "1074");
  const o2 = (await call("PUT", "/api/objets/" + o.id, { objet: { ...o, note: 9, jeuRef: "pas un nombre" } }, c)).json.objet;
  assert.equal(o2.note, 5); assert.equal(o2.jeuRef, "");
});

test("le lieu de l'acheteur (« Moselle ») n'est jamais pris pour son prénom", async () => {
  const { lieuxAcheteur, sansLieu } = await import("../server/ia.mjs");
  const lieux = lieuxAcheteur("À propos de cet acheteur\nMoselle\nMembre depuis novembre 2015\nhier\nBonjour, je suis d'à côté de Nancy");
  assert.deepEqual(lieux, ["Moselle"]);
  assert.equal(sansLieu("Bonjour Moselle, oui le jeu est encore là !", lieux), "Bonjour, oui le jeu est encore là !");
  assert.equal(sansLieu("Merci Moselle ! À bientôt", lieux), "Merci ! À bientôt");
});

test("pas de « prix ferme » quand l'acheteur ne parle pas de prix", async () => {
  const { parlePrix } = await import("../server/ia.mjs");
  assert.equal(parlePrix("[Annonce concernée]\nPerfect Dark\n20 €\n\n[Conversation]\nBonjour, est-elle toujours disponible ? Je suis d'à côté de Nancy\n22:01\nFaire une offre\nEnvoyer"), false);
  assert.equal(parlePrix("[Conversation]\nBonjour, vous le feriez à 15 € ?"), true);
  assert.equal(parlePrix("[Conversation]\nC'est votre dernier prix ?"), true);
});

test("on ne reformule pas où habite l'acheteur", async () => {
  const { sansOuIlHabite } = await import("../server/ia.mjs");
  assert.equal(sansOuIlHabite("Bonjour, oui toujours disponible 🙂 Si vous venez de Nancy, on peut se retrouver dans le centre. Quel jour ?"), "Bonjour, oui toujours disponible 🙂 On peut se retrouver dans le centre. Quel jour ?");
  assert.equal(sansOuIlHabite("Bonjour, toujours dispo ! Vous êtes du côté de Nancy ? On peut se voir dans le centre de Nancy 🙂"), "Bonjour, toujours dispo ! On peut se voir dans le centre de Nancy 🙂");
  const ok = "Bonjour, oui toujours disponible 🙂 Si vous êtes près, on peut se retrouver dans le centre de Nancy.";
  assert.equal(sansOuIlHabite(ok), ok);
});

test("disponibilité dite clairement : « le jeu est toujours disponible »", async () => {
  const { dispoClaire } = await import("../server/ia.mjs");
  assert.equal(dispoClaire("Bonjour, oui il est bien là 🙂"), "Bonjour, oui le jeu est toujours disponible 🙂");
  assert.equal(dispoClaire("Bonjour, elle est encore là !", "la console"), "Bonjour, la console est toujours disponible !");
});

test("pas de prénom inventé, pas de disponibilité répétée", async () => {
  const { sansPrenomInvente, sansDispoRepetee } = await import("../server/ia.mjs");
  assert.equal(sansPrenomInvente("Merci Garnier ! Le jeu part ce soir 🙂", "carter054"), "Merci ! Le jeu part ce soir 🙂");
  assert.equal(sansPrenomInvente("Bonjour Julien, oui 🙂", "Julien"), "Bonjour Julien, oui 🙂");
  assert.equal(sansDispoRepetee("Le jeu est toujours disponible 😊 À 18h15 au FoodLab, ça me va !"), "À 18h15 au FoodLab, ça me va !");
});

test("profil de vendeur : inscription, Mon compte, extension, prix plancher", async () => {
  const r = await call("POST", "/api/inscription", { email: "profil@exemple.fr", motdepasse: "motdepasse123", cgv: true, adresse: "54000 Nancy", vendeur: { rythme: "patient", remise: "main_propre", echanges: "non", prix: "ferme", ton: "diplomate", note: "Pas d'envoi\nle dimanche", pirate: "x" } });
  assert.equal(r.status, 200);
  const c = cookieOf(r);
  db.prepare("UPDATE users SET email_ok = 1, plan = 'collectionneur', plan_status = 'active' WHERE email = ?").run("profil@exemple.fr");
  const moi = (await call("GET", "/api/moi", null, c)).json;
  assert.deepEqual(moi.vendeur, { rythme: "patient", remise: "main_propre", echanges: "non", prix: "ferme", ton: "diplomate", note: "Pas d'envoi le dimanche" });
  // Valeur inconnue ignorée, profil modifiable ensuite.
  const m = (await call("POST", "/api/compte/profil", { vendeur: { rythme: "rapide", prix: "n'importe quoi", ton: "humour" } }, c)).json;
  assert.deepEqual(m.vendeur, { rythme: "rapide", ton: "humour" });
  assert.deepEqual((await call("POST", "/api/compte/profil", { vendeur: {} }, c)).json.vendeur, {});
  await call("POST", "/api/compte/profil", { vendeur: { prix: "ferme", ton: "diplomate" } }, c);
  // L'extension reçoit le profil et l'IA ne propose plus de contre-offre.
  const k = (await call("POST", "/api/extension/cle", null, c)).json.cle, h = { authorization: "Bearer " + k };
  assert.deepEqual((await call("GET", "/api/extension/annonces", null, "", h)).json.profil.vendeur, { prix: "ferme", ton: "diplomate" });
  const o = (await call("POST", "/api/objets", { objet: { titre: "Conker", plateforme: "Nintendo 64", statut: "en_vente", prixDemande: 190 } }, c)).json.objet;
  const rep = (await call("POST", "/api/extension/reponse", { conversation: "Voici l'offre de mm : 140 €.", annonce: o.id, offre: 140 }, "", h)).json;
  assert.equal(rep.offre.ferme, true); assert.equal(rep.offre.contre, 190);
  assert.ok(rep.reponses.length && rep.reponses.every((x) => x.approche !== "contre_offre"));

  const { partPlancher, consignesProfil } = await import("../server/profil.mjs");
  assert.equal(partPlancher({}), 0.85); assert.equal(partPlancher({ rythme: "patient" }), 0.9); assert.equal(partPlancher({ rythme: "rapide", prix: "souple" }), 0.75);
  assert.equal(consignesProfil({}), "");
  assert.match(consignesProfil({ ton: "diplomate", echanges: "oui" }), /très diplomate et affable[\s\S]*ouvert aux échanges/);
  const { analyseOffre } = await import("../server/ia.mjs");
  assert.equal(analyseOffre(190, 170, 0.9).basse, true); assert.equal(analyseOffre(190, 170).basse, false);
});

test("photos : JPEG incomplet refusé, écriture sans fichier temporaire laissé", async () => {
  const { jpegCoupe } = await import("../server/api.mjs");
  const entier = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  assert.equal(jpegCoupe(entier), false);
  assert.equal(jpegCoupe(Buffer.concat([entier, Buffer.alloc(12)])), false);   // remplissage après la fin : accepté
  assert.equal(jpegCoupe(entier.subarray(0, 6)), true);
  assert.equal(jpegCoupe(Buffer.from("fausse image")), false);   // pas un JPEG : pas notre affaire
  const c = await compte("photos-jpeg@test.fr");
  const b64 = (b) => "data:image/jpeg;base64," + b.toString("base64");
  const r = await call("POST", "/api/objets", { objet: { titre: "Donkey Kong 64" }, photo: b64(entier) }, c);
  assert.equal(r.status, 200);
  const id = r.json.objet.id;
  assert.equal((await call("POST", `/api/objets/${id}/photos`, { photo: b64(entier.subarray(0, 6)) }, c)).status, 400);
  const lu = await call("GET", `/api/photo/${id}`, null, c);
  assert.deepEqual(Buffer.from(lu.body), entier);
  const dossier = path.join(process.env.DATA_DIR, "photos");
  const tous = fs.readdirSync(dossier, { recursive: true }).map(String);
  assert.deepEqual(tous.filter((f) => f.endsWith(".tmp")), []);
});

test("caractéristiques eBay : valeurs sûres tirées de la fiche (lot compris)", async () => {
  const { specifiquesSurs } = await import("../server/ia.mjs");
  const champs = [{ nom: "Plateforme", multiple: true }, { nom: "Nom du jeu vidéo", multiple: true }, { nom: "Éditeur" }, { nom: "Code de région" }, { nom: "Quantité unitaire" }];
  const seul = specifiquesSurs({ nom: "Kirby 64", plateforme: "Nintendo 64", region: "PAL" }, champs);
  assert.deepEqual(seul, { Plateforme: "Nintendo 64", "Nom du jeu vidéo": "Kirby 64", "Code de région": "PAL" });
  const lot = specifiquesSurs({ nom: "Lot de 2 jeux", plateforme: "Nintendo 64", contient: ["a", "b"], jeux: ["Zelda", "Conker"] }, champs);
  assert.deepEqual(lot, { Plateforme: "Nintendo 64", "Nom du jeu vidéo": "Lot de 2 jeux", "Quantité unitaire": "2" });   // jamais un jeu précis pour un lot
  const { specifiquesEbay } = await import("../server/ia.mjs");
  assert.deepEqual(await specifiquesEbay({ plateforme: "Nintendo 64", contient: ["a", "b"] }, [{ nom: "Plateforme" }, { nom: "Éditeur", suggestions: ["Nintendo"] }, { nom: "Nom du jeu vidéo", obligatoire: true }]), { Plateforme: "Nintendo 64", "Nom du jeu vidéo": "Lot de 2 articles" });
  assert.deepEqual(specifiquesSurs({ contient: ["a", "b", "c"], jeux: ["Zelda", "Conker"], nbArticles: 3 }, [{ nom: "Nom du jeu vidéo" }, { nom: "Quantité unitaire" }]), { "Nom du jeu vidéo": "Lot de 2 jeux", "Quantité unitaire": "3" });   // l'accessoire ne compte pas dans les jeux
});

test("couleur du site : au choix pour un Collectionneur, imposée pour les autres formules", async () => {
  const g = await compte("teinte-gratuit@exemple.fr"), c = await compte("teinte-collec@exemple.fr", true);
  assert.equal((await call("GET", "/api/moi", null, g)).json.teinte, "");
  assert.equal((await call("POST", "/api/compte/profil", { teinte: "lilas" }, g)).status, 403);
  assert.equal((await call("GET", "/api/moi", null, c)).json.teinte, "");                       // or par défaut
  assert.equal((await call("POST", "/api/compte/profil", { teinte: "rouge" }, c)).status, 400);
  assert.equal((await call("POST", "/api/compte/profil", { teinte: "menthe" }, c)).json.teinte, "menthe");
  assert.equal((await call("GET", "/api/moi", null, c)).json.teinte, "menthe");                 // gardé sur le compte
  assert.equal((await call("POST", "/api/compte/profil", { teinte: "or" }, c)).json.teinte, "");
  await call("POST", "/api/compte/profil", { teinte: "lilas" }, c);
  // L'abonnement se termine : la couleur de la formule reprend le dessus (le choix reste gardé pour un retour).
  db.prepare("UPDATE users SET plan_status = 'canceled' WHERE email = ?").run("teinte-collec@exemple.fr");
  assert.equal((await call("GET", "/api/moi", null, c)).json.teinte, "");
  db.prepare("UPDATE users SET plan_status = 'active' WHERE email = ?").run("teinte-collec@exemple.fr");
  assert.equal((await call("GET", "/api/moi", null, c)).json.teinte, "lilas");
});

test("description eBay : l'envoi d'un lot se lit bien", async () => {
  const { annonceEbay } = await import("../server/api.mjs");
  const e = annonceEbay({ titre: "Lot", etat: "bon" }, { titre: "Lot", description: "Lot :\n- A\nRemise en main propre ou envoi soigné, en un seul colis.", prix: 100 });
  assert.match(e.description, /Envoi soigné et rapide, avec suivi, en un seul colis\.$/);
  assert.doesNotMatch(e.description, /suivi\. soigné/);
});

test("rareté des jeux : établie automatiquement (IA, cote, arrière-plan), suit le jeu, transmise à l'extension", async () => {
  const c = await compte("rarete@exemple.fr", true);
  const { annonceLbc, rareteFinie } = await import("../server/api.mjs");
  // reconnaissance photo et recherche des prix donnent la rareté, que l'appli renvoie avec la fiche
  const id = await call("POST", "/api/ia/identifier", { photo: PHOTO }, c);
  assert.equal(id.json.objet.rareteJeu, "commun");
  assert.equal((await call("POST", "/api/ia/cote", { objet: id.json.objet }, c)).json.cote.rarete, "peu_commun");
  // fiche saisie à la main : estimée en arrière-plan, sans toucher à la date de modification
  const a = (await call("POST", "/api/objets", { objet: { titre: "Conker's Bad Fur Day", plateforme: "Nintendo 64" } }, c)).json.objet;
  assert.equal(a.rareteJeu, "");
  await rareteFinie();
  let l = (await call("GET", "/api/objets", null, c)).json.objets;
  const a2 = l.find((x) => x.id === a.id);
  assert.equal(a2.rareteJeu, "rare"); assert.equal(a2.modifie, a.modifie);
  assert.equal(annonceLbc(a2).rareteJeu, "rare");
  // autre jeu sur la même fiche : la rareté est estimée à nouveau
  const b = (await call("PUT", "/api/objets/" + a.id, { objet: { titre: "Little Samson", plateforme: "NES" } }, c)).json.objet;
  assert.equal(b.rareteJeu, "");
  await rareteFinie();
  l = (await call("GET", "/api/objets", null, c)).json.objets;
  assert.equal(l.find((x) => x.id === a.id).rareteJeu, "tres_rare");
  // même jeu, autre détail (prix) : la rareté reste
  assert.equal((await call("PUT", "/api/objets/" + a.id, { objet: { prixDemande: 900 } }, c)).json.objet.rareteJeu, "tres_rare");
  assert.equal((await call("POST", "/api/objets", { objet: { titre: "X", rareteJeu: "légendaire" } }, c)).json.objet.rareteJeu, "");
  // une carte Pokémon garde sa rareté imprimée, sans la rareté des jeux
  const k = (await call("POST", "/api/objets", { objet: { titre: "Dracaufeu", categorie: "cartes", rarete: "Holo rare", rareteJeu: "tres_rare" } }, c)).json.objet;
  assert.equal(k.rarete, "Holo rare"); assert.equal(k.rareteJeu, undefined);
  await rareteFinie();
});

test("adresse du vendeur : obligatoire à l'inscription, modifiable dans Mon compte, transmise à l'extension", async () => {
  const sans = await call("POST", "/api/inscription", { email: "sansadr@exemple.fr", motdepasse: "motdepasse123", cgv: true });
  assert.equal(sans.status, 400); assert.match(sans.json.error, /code postal/);
  assert.equal((await call("POST", "/api/inscription", { email: "sansadr@exemple.fr", motdepasse: "motdepasse123", cgv: true, adresse: "Nancy" })).status, 400);
  const c = await compte("adresse@exemple.fr");
  assert.equal((await call("GET", "/api/moi", null, c)).json.adresse, "54000 Nancy");
  const m = await call("POST", "/api/compte/profil", { adresse: "  12 rue Stanislas   54000 Nancy " }, c);
  assert.equal(m.status, 200); assert.equal(m.json.adresse, "12 rue Stanislas 54000 Nancy");
  assert.equal((await call("POST", "/api/compte/profil", { adresse: "" }, c)).status, 400);
});

test("vues et favoris : relevé de l'app (cookie) et de l'extension (clé), gardés à l'enregistrement de la fiche", async () => {
  const c = await compte("stats@retro.fr");
  const lbc = "https://www.leboncoin.fr/ad/jeux_video/2874512345", eb = "https://www.ebay.fr/itm/123456789012";
  const a = (await call("POST", "/api/objets", { objet: { titre: "Super Mario 64", prixDemande: 45, annonce: lbc, annonceEbay: eb } }, c)).json.objet;
  const b = (await call("POST", "/api/objets", { objet: { titre: "Zelda", prixDemande: 39 } }, c)).json.objet;
  let r = await call("POST", "/api/stats", { site: "lbc", annonces: [{ id: "2874512345", vues: 128, favoris: 7 }, { id: "9999999", vues: 3 }] }, c);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.maj, 1);
  const cle = (await call("POST", "/api/extension/cle", {}, c)).json.cle;
  r = await call("POST", "/api/extension/stats", { site: "ebay", annonces: [{ id: "123456789012", vues: 40, favoris: 2 }] }, "", { authorization: "Bearer " + cle });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  let o = (await call("GET", "/api/objets", null, c)).json.objets.find((x) => x.id === a.id);
  assert.equal(o.stats.lbc.vues, 128); assert.equal(o.stats.lbc.favoris, 7); assert.equal(o.stats.ebay.vues, 40);
  assert.equal((await call("GET", "/api/objets", null, c)).json.objets.find((x) => x.id === b.id).stats, undefined);
  // la fiche réécrite (même lien) garde ses stats ; le lien eBay retiré emporte les siennes
  o = (await call("PUT", "/api/objets/" + a.id, { objet: { ...o, prixDemande: 49, annonceEbay: "" } }, c)).json.objet;
  assert.equal(o.stats.lbc.vues, 128); assert.equal(o.stats.ebay, undefined);
  assert.equal((await call("POST", "/api/stats", { site: "autre", annonces: [] }, c)).status, 400);
});
