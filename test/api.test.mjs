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
