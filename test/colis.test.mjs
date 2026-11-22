// Suivi des colis envoyés : transporteur, numéro, lien, état La Poste (fetch simulé), lots.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rr-colis-"));
process.env.IA_FAKE = "1";
const { handleApi, HttpError } = await import("../server/api.mjs");
const { db } = await import("../server/db.mjs");
const C = await import("../server/colis.mjs");

let ipN = 0;
async function call(method, p, body, cookie) {
  try { return await handleApi({ method, path: p, headers: { host: "retrorevente.fr", cookie: cookie || "" }, ip: "10.2.0." + (++ipN % 250), body: Buffer.from(body ? JSON.stringify(body) : "") }); }
  catch (e) { if (e instanceof HttpError) return { status: e.status, json: { error: e.message } }; throw e; }
}
async function compte(email) {
  const r = await call("POST", "/api/inscription", { email, motdepasse: "motdepasse123", cgv: true });
  db.prepare("UPDATE users SET email_ok = 1, plan = 'collectionneur', plan_status = 'active' WHERE email = ?").run(email);
  return /rr_session=([^;]+)/.exec(r.headers["Set-Cookie"])[0];
}
const ajout = async (c, objet) => (await call("POST", "/api/objets", { objet }, c)).json.objet;
const maj = async (c, id, objet) => (await call("PUT", "/api/objets/" + id, { objet }, c)).json.objet;

test("numéro nettoyé, transporteur deviné, lien de suivi", () => {
  assert.equal(C.numeroSuivi(" 6a 123-456 789 01 "), "6A12345678901");
  assert.equal(C.devinerTransporteur("6A12345678901"), "colissimo");
  assert.equal(C.devinerTransporteur("CB123456789FR"), "colissimo");
  assert.equal(C.devinerTransporteur("12345678"), "mondial_relay");
  assert.equal(C.devinerTransporteur("1Z999AA10123456784"), "ups");
  assert.equal(C.devinerTransporteur("ABC"), "");
  assert.equal(C.lienSuivi("colissimo", "6A12345678901"), "https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901");
  assert.equal(C.lienSuivi("autre", "123"), "");
  assert.equal(C.lienSuivi("colissimo", ""), "");
});

test("la fiche garde le colis d'une vente envoyée, pas d'une remise en main propre", async () => {
  const c = await compte("colis@exemple.fr");
  const o = await ajout(c, { titre: "Banjo-Kazooie", plateforme: "Nintendo 64", prixDemande: 40 });
  let n = await maj(c, o.id, { statut: "envoye", remise: "envoi", suivi: "6a 123 456 789 01" });
  assert.equal(n.suivi, "6A12345678901");
  assert.equal(n.transporteur, "colissimo");                     // deviné d'après le numéro
  n = await maj(c, o.id, { transporteur: "mondial_relay", suivi: "12345678", livreLe: "2026-11-20" });
  assert.equal(n.transporteur, "mondial_relay"); assert.equal(n.livreLe, "2026-11-20");
  n = await maj(c, o.id, { remise: "main_propre" });
  assert.equal(n.suivi, ""); assert.equal(n.transporteur, ""); assert.equal(n.livreLe, "");
  n = await maj(c, o.id, { remise: "envoi", suivi: "12345678", statut: "en_vente" });
  assert.equal(n.suivi, "");                                      // remis en vente : plus de colis
});

test("état La Poste relu, livré coché tout seul, et suivi du lot sur ses articles", async () => {
  const c = await compte("poste@exemple.fr");
  const vieux = globalThis.fetch;
  let appels = 0;
  process.env.LAPOSTE_API_KEY = "cle-test";
  globalThis.fetch = async (url, opts) => {
    appels++;
    assert.match(String(url), /api\.laposte\.fr\/suivi\/v2\/idships\/6A12345678901/);
    assert.equal(opts.headers["X-Okapi-Key"], "cle-test");
    return new Response(JSON.stringify({ shipment: { isFinal: appels > 1, event: appels > 1
      ? [{ code: "DI1", label: "Votre colis est livré.", date: "2026-11-22T10:00:00+01:00" }, { code: "PC1", label: "Pris en charge", date: "2026-11-20T09:00:00+01:00" }]
      : [{ code: "PC1", label: "Votre colis est pris en charge par La Poste.", date: "2026-11-20T09:00:00+01:00" }] } }), { status: 200 });
  };
  try {
    const a = await ajout(c, { titre: "Mario 64", plateforme: "Nintendo 64", prixDemande: 30 });
    const b = await ajout(c, { titre: "Zelda", plateforme: "Nintendo 64", prixDemande: 30 });
    const lot = (await call("POST", "/api/lots", { articles: [a.id, b.id] }, c)).json.objet;
    await maj(c, lot.id, { statut: "envoye", remise: "envoi", prixVente: 50, transporteur: "colissimo", suivi: "6A12345678901" });
    // les articles du lot portent le suivi du lot
    assert.equal((await call("GET", "/api/objets", null, c)).json.objets.find((x) => x.id === a.id).suivi, "6A12345678901");
    let r = await call("POST", "/api/suivis", {}, c);
    assert.equal(r.status, 200); assert.equal(r.json.auto, true);
    assert.equal(r.json.objets.length, 1); assert.equal(r.json.objets[0].id, lot.id);      // les articles du lot ne sont pas relus à part
    assert.match(r.json.objets[0].suiviEtat.libelle, /pris en charge/); assert.equal(r.json.objets[0].livreLe, "");
    // relu il y a moins d'une heure : pas de nouvel appel, sauf si on force ce colis
    r = await call("POST", "/api/suivis", {}, c); assert.equal(r.json.objets.length, 0); assert.equal(appels, 1);
    r = await call("POST", "/api/suivis", { ids: [lot.id], force: true }, c);
    assert.equal(r.json.objets[0].livreLe, "2026-11-22"); assert.equal(r.json.objets[0].suiviEtat.livre, true);
    const art = (await call("GET", "/api/objets", null, c)).json.objets.find((x) => x.id === b.id);
    assert.equal(art.livreLe, "2026-11-22"); assert.equal(art.suiviEtat.livre, true);
    // livré : plus jamais relu
    r = await call("POST", "/api/suivis", { ids: [lot.id], force: true }, c); assert.equal(r.json.objets.length, 0); assert.equal(appels, 2);
  } finally { globalThis.fetch = vieux; delete process.env.LAPOSTE_API_KEY; }
});

test("sans clé La Poste : rien n'est relu", async () => {
  const c = await compte("sanscle@exemple.fr");
  const o = await ajout(c, { titre: "F-Zero X", prixDemande: 20 });
  await maj(c, o.id, { statut: "envoye", remise: "envoi", suivi: "6A12345678901" });
  const r = await call("POST", "/api/suivis", {}, c);
  assert.equal(r.json.auto, false); assert.equal(r.json.objets.length, 0);
});
