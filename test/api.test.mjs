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
async function compte(email) {
  const r = await call("POST", "/api/inscription", { email, motdepasse: "motdepasse123", cgv: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return cookieOf(r);
}

test("inscription, connexion, refus sans session", async () => {
  assert.equal((await call("GET", "/api/moi")).status, 401);
  assert.equal((await call("POST", "/api/inscription", { email: "a@b.fr", motdepasse: "court", cgv: true })).status, 400);
  assert.equal((await call("POST", "/api/inscription", { email: "a@b.fr", motdepasse: "motdepasse123" })).status, 400);   // CGV
  const c = await compte("Alice@Exemple.fr");
  const moi = await call("GET", "/api/moi", null, c);
  assert.equal(moi.json.email, "alice@exemple.fr");
  assert.equal(moi.json.formule.id, "gratuit");
  assert.equal((await call("POST", "/api/inscription", { email: "alice@exemple.fr", motdepasse: "motdepasse123", cgv: true })).status, 409);
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
  assert.equal(v.json.objet.titre, "Zelda");
  const moi = await call("GET", "/api/moi", null, c);
  assert.equal(moi.json.bilan.vendus, 1); assert.equal(moi.json.bilan.encaisse, 40);
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
  const c = await compte("ia@exemple.fr");
  const r = await call("POST", "/api/ia/identifier", { photo: PHOTO }, c);
  assert.equal(r.json.objet.plateforme, "Nintendo 64");
  const k = await call("POST", "/api/ia/cote", { objet: r.json.objet }, c);
  assert.equal(k.json.cote.conseille, 49);
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
  const c = await compte("legende@exemple.fr");
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
