// Lots : cote et prix, idées par thème, création, vente répartie, défaire (IA simulée, base temporaire).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rr-lots-"));
process.env.IA_FAKE = "1";
const { handleApi, HttpError } = await import("../server/api.mjs");
const { db } = await import("../server/db.mjs");
const L = await import("../server/lots.mjs");

const PHOTO = "data:image/jpeg;base64," + Buffer.from("fausse image").toString("base64");
let ipN = 0;
async function call(method, p, body, cookie) {
  try { return await handleApi({ method, path: p, headers: { host: "retrorevente.fr", cookie: cookie || "" }, ip: "10.1.0." + (++ipN % 250), body: Buffer.from(body ? JSON.stringify(body) : "") }); }
  catch (e) { if (e instanceof HttpError) return { status: e.status, json: { error: e.message } }; throw e; }
}
async function compte(email) {
  const r = await call("POST", "/api/inscription", { email, motdepasse: "motdepasse123", cgv: true });
  db.prepare("UPDATE users SET email_ok = 1, plan = 'collectionneur', plan_status = 'active' WHERE email = ?").run(email);
  return /rr_session=([^;]+)/.exec(r.headers["Set-Cookie"])[0];
}
const ajout = async (c, objet, photo) => (await call("POST", "/api/objets", { objet, ...(photo ? { photo } : {}) }, c)).json.objet;

test("prix d'un lot : remise selon la taille, thème, série complète, petits prix", () => {
  const a = (p) => ({ prixDemande: p });
  assert.equal(L.coteLot([a(20), a(30)]).conseille, 45);                 // 2 articles : −10 %
  assert.equal(L.coteLot([a(20), a(30), a(50)]).conseille, 85);          // 3 articles : −15 %
  assert.equal(L.coteLot([a(20), a(30)], { nom: "Rareware" }).conseille, 50);              // thème : −5 % seulement
  assert.equal(L.coteLot([a(25), a(35)], { nom: "Banjo", complet: true }).conseille, 65);  // série complète : +10 %
  const petits = L.coteLot([a(2), a(3), a(2), a(4)]);
  assert.equal(petits.petits, 4); assert.ok(petits.raisons.some((r) => /moins de 5 €/.test(r)));
  assert.equal(petits.conseille, 9);
  // la cote d'un article passe avant son prix affiché
  assert.equal(L.valeurArticle({ prixDemande: 10, cote: { conseille: 14 } }), 14);
  // le prix de vente se partage au centime près
  const parts = L.repartir(50, [a(10), a(30), a(10)]);
  assert.deepEqual(parts, [10, 30, 10]);
  assert.equal(L.repartir(10, [a(1), a(1), a(1)]).reduce((x, y) => x + y, 0), 10);
});

test("idées de lots par thème : studio, lignée, licence, série, petits prix", () => {
  const o = (id, titre, prixDemande = 20, extra = {}) => ({ id, titre, plateforme: "Nintendo 64", prixDemande, ...extra });
  const s = L.suggestionsLocales([o("a", "Banjo-Kazooie"), o("b", "Banjo-Tooie"), o("c", "GoldenEye 007"), o("d", "Perfect Dark"),
    o("e", "The Legend of Zelda: Ocarina of Time"), o("f", "Zelda Majora's Mask"), o("g", "Star Wars Episode I Racer"), o("h", "Star Wars Rogue Squadron"),
    o("i", "Inception", 2, { categorie: "films", plateforme: "DVD" }), o("j", "Matrix", 3, { categorie: "films", plateforme: "DVD" })], 10);
  const par = Object.fromEntries(s.map((x) => [x.theme, x.articles.sort().join("")]));
  assert.equal(par.Rareware, "abcd");
  assert.equal(par["GoldenEye et Perfect Dark"], "cd");
  assert.equal(par["Star Wars"], "gh");
  assert.equal(par.Banjo, "ab");
  assert.equal(par.Zelda, "ef");
  assert.equal(par["Les films à petit prix"], "ij");
  assert.equal(L.titreLot([o("a", "Banjo-Kazooie"), o("b", "Banjo-Tooie")], { nom: "Banjo", type: "série", complet: true }), "Lot Banjo (série complète) : 2 jeux Nintendo 64");
});

test("lot : création, photos, vente répartie, défaire", async () => {
  const c = await compte("lots@exemple.fr");
  const b1 = await ajout(c, { titre: "Banjo-Kazooie", plateforme: "Nintendo 64", prixDemande: 25, contenu: "complet", etat: "tres_bon" }, PHOTO);
  const b2 = await ajout(c, { titre: "Banjo-Tooie", plateforme: "Nintendo 64", prixDemande: 35, contenu: "seul", etat: "bon" }, PHOTO);
  const z = await ajout(c, { titre: "Zelda", plateforme: "Nintendo 64", prixDemande: 30 });

  // idées : l'IA (simulée) sait que les deux Banjo forment la série complète, et le prix en tient compte
  const s = await call("POST", "/api/lots/suggestions", { ia: true }, c);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const banjo = s.json.suggestions.find((x) => /banjo/i.test(x.theme));
  assert.ok(banjo && banjo.complet);
  assert.equal(banjo.cote.conseille, 65);

  assert.equal((await call("POST", "/api/lots", { articles: [b1.id] }, c)).status, 400);   // un seul article
  const r = await call("POST", "/api/lots", { articles: [b1.id, b2.id], theme: { nom: "Banjo", type: "série", complet: true }, photo: PHOTO }, c);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const lot = r.json.objet;
  assert.deepEqual(lot.articles, [b1.id, b2.id]);
  assert.equal(lot.prixDemande, 65);
  assert.equal(lot.etat, "bon");                       // l'état le moins bon du lot
  assert.match(lot.titre, /^Lot Banjo \(série complète\)/);
  assert.match(lot.texteAnnonce, /- Banjo-Kazooie, complet en boîte, très bon état/);
  assert.equal(lot.photos.length, 3);                  // mosaïque + une photo par article
  assert.equal((await call("GET", "/api/photo/" + lot.id + "/" + lot.photos[1].id, null, c)).status, 200);

  // un article ne va pas dans deux lots, ni un lot dans un lot
  assert.equal((await call("POST", "/api/lots", { articles: [b1.id, z.id] }, c)).status, 409);
  assert.equal((await call("POST", "/api/lots", { articles: [lot.id, z.id] }, c)).status, 400);
  // un article du lot ne se supprime pas seul
  assert.equal((await call("DELETE", "/api/objets/" + b1.id, null, c)).status, 409);

  // annonce rédigée par l'IA (simulée)
  const an = await call("POST", "/api/lots/" + lot.id + "/annonce", {}, c);
  assert.equal(an.status, 200); assert.match(an.json.description, /Banjo-Tooie/);

  // ajouter Zelda, puis le retirer
  let m = await call("PUT", "/api/lots/" + lot.id, { articles: [b1.id, b2.id, z.id] }, c);
  assert.equal(m.status, 200); assert.equal(m.json.objet.articles.length, 3);
  m = await call("PUT", "/api/lots/" + lot.id, { articles: [b1.id, b2.id] }, c);
  const objs = (await call("GET", "/api/objets", null, c)).json.objets, de = (id) => objs.find((o) => o.id === id);
  assert.equal(de(z.id).lot, undefined);
  assert.equal(de(b1.id).lot, lot.id);

  // chaque article du lot garde son propre statut tant que le lot n'est pas vendu (réservé, retiré…)
  const ret = await call("PUT", "/api/objets/" + b1.id, { objet: { statut: "reserve" } }, c);
  assert.equal(ret.json.objet.statut, "reserve"); assert.equal(ret.json.objet.lot, lot.id); assert.equal(ret.json.lot, undefined);
  // vendre le lot : chaque article passe en vendu, avec sa part du prix et des frais
  const v = await call("PUT", "/api/objets/" + lot.id, { objet: { statut: "vendu", prixVente: 60, frais: 6 } }, c);
  assert.equal(v.status, 200);
  const apres = (await call("GET", "/api/objets", null, c)).json.objets, a = (id) => apres.find((o) => o.id === id);
  assert.equal(a(b1.id).statut, "vendu"); assert.equal(a(b2.id).statut, "vendu");
  assert.equal(a(b1.id).prixVente, 25); assert.equal(a(b2.id).prixVente, 35);
  assert.equal(a(b1.id).frais + a(b2.id).frais, 6);
  assert.equal(a(b1.id).dateVente, a(lot.id).dateVente);
  // un lot vendu ne change plus de composition
  assert.equal((await call("PUT", "/api/lots/" + lot.id, { articles: [b1.id, b2.id, z.id] }, c)).status, 409);
  // remis en vente : les articles aussi, sans prix de vente
  await call("PUT", "/api/objets/" + lot.id, { objet: { statut: "en_vente" } }, c);
  const re = (await call("GET", "/api/objets", null, c)).json.objets;
  assert.equal(re.find((o) => o.id === b2.id).statut, "en_vente");
  assert.equal(re.find((o) => o.id === b2.id).prixVente, null);

  // défaire : le lot disparaît, ses articles restent, libres
  assert.equal((await call("DELETE", "/api/lots/" + lot.id, null, c)).status, 200);
  const fin = (await call("GET", "/api/objets", null, c)).json.objets;
  assert.equal(fin.length, 3);
  assert.ok(fin.every((o) => !o.lot));
  assert.equal((await call("DELETE", "/api/objets/" + b1.id, null, c)).status, 200);
});

test("lots : isolation entre comptes", async () => {
  const c = await compte("lotsa@exemple.fr"), d = await compte("lotsb@exemple.fr");
  const x = await ajout(c, { titre: "A", prixDemande: 5 }), y = await ajout(c, { titre: "B", prixDemande: 5 });
  assert.equal((await call("POST", "/api/lots", { articles: [x.id, y.id] }, d)).status, 404);
  const lot = (await call("POST", "/api/lots", { articles: [x.id, y.id] }, c)).json.objet;
  assert.equal((await call("DELETE", "/api/lots/" + lot.id, null, d)).status, 404);
});

test("lot : un article vendu à l'unité quitte le lot, et y revient si on annule", async () => {
  const c = await compte("unite@exemple.fr");
  const o = (titre, prixDemande) => ajout(c, { titre, plateforme: "Nintendo 64", prixDemande }, PHOTO);
  const ge = await o("GoldenEye 007", 20), pd = await o("Perfect Dark", 30), bk = await o("Banjo-Kazooie", 25);
  const lot = (await call("POST", "/api/lots", { articles: [ge.id, pd.id, bk.id], theme: { nom: "Rareware", type: "studio" }, photo: PHOTO }, c)).json.objet;
  assert.equal(lot.photos.length, 4);
  // créer le lot ne retire pas ses articles de la vente à l'unité
  let tous = (await call("GET", "/api/objets", null, c)).json.objets;
  assert.ok([ge, pd, bk].every((x) => tous.find((y) => y.id === x.id).statut === "en_vente"));

  // Perfect Dark part seul : il quitte le lot, le prix du lot baisse, sa photo s'en va, la mosaïque est à refaire
  const v = await call("PUT", "/api/objets/" + pd.id, { objet: { statut: "vendu", prixVente: 30 } }, c);
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.objet.statut, "vendu"); assert.equal(v.json.objet.lot, undefined);
  assert.equal(v.json.lot.action, "retire");
  tous = (await call("GET", "/api/objets", null, c)).json.objets;
  let l = tous.find((x) => x.id === lot.id);
  assert.deepEqual(l.articles, [ge.id, bk.id]);
  assert.equal(l.prixDemande, L.coteLot([ge, bk], { nom: "Rareware", type: "studio" }).conseille);
  assert.ok(l.prixDemande < lot.prixDemande);
  assert.equal(l.photos.length, 3); assert.ok(!l.photos.some((x) => x.de === pd.id));
  assert.ok(l.mosaiqueAFaire);
  assert.doesNotMatch(l.texteAnnonce, /Perfect Dark/);            // l'annonce écrite par l'appli suit
  assert.deepEqual(l.alerte.vendus.map((x) => x.titre), ["Perfect Dark"]);
  assert.equal(l.alerte.annonce, false);
  // les autres restent en vente, à l'unité et dans le lot
  assert.equal(tous.find((x) => x.id === ge.id).statut, "en_vente");

  // « Annuler » : remis en vente, il revient dans le lot, au prix d'avant
  const an = await call("PUT", "/api/objets/" + pd.id, { objet: { statut: "en_vente", prixVente: null } }, c);
  assert.equal(an.json.lot.action, "remis"); assert.equal(an.json.objet.lot, lot.id);
  l = (await call("GET", "/api/objets", null, c)).json.objets.find((x) => x.id === lot.id);
  assert.equal(l.articles.length, 3); assert.equal(l.prixDemande, lot.prixDemande); assert.equal(l.texteAnnonce, lot.texteAnnonce);
  assert.equal(l.photos.length, 4); assert.equal(l.alerte, undefined);

  // annonce réécrite à la main : elle ne change pas toute seule, le lot le signale
  await call("PUT", "/api/objets/" + lot.id, { objet: { texteAnnonce: "Mon annonce à moi : GoldenEye, Perfect Dark, Banjo." } }, c);
  await call("PUT", "/api/objets/" + pd.id, { objet: { statut: "vendu" } }, c);
  l = (await call("GET", "/api/objets", null, c)).json.objets.find((x) => x.id === lot.id);
  assert.equal(l.alerte.annonce, true); assert.match(l.texteAnnonce, /Mon annonce/);
  // la mosaïque refaite et l'alerte lue
  await call("PUT", "/api/objets/" + lot.id + "/photos/" + l.photos[0].id, { photo: PHOTO, legende: "Les 2 articles du lot réunis" }, c);
  const f = await call("PUT", "/api/objets/" + lot.id, { objet: {}, fermerAlerte: true }, c);
  assert.equal(f.json.objet.alerte, undefined); assert.equal(f.json.objet.mosaiqueAFaire, undefined);

  // vendu lui aussi : il ne reste qu'un article, le lot se défait
  const d = await call("PUT", "/api/objets/" + bk.id, { objet: { statut: "vendu" } }, c);
  assert.equal(d.json.lot.action, "defait");
  tous = (await call("GET", "/api/objets", null, c)).json.objets;
  assert.ok(!tous.some((x) => x.id === lot.id));
  assert.equal(tous.find((x) => x.id === ge.id).lot, undefined);
  assert.equal(tous.find((x) => x.id === ge.id).statut, "en_vente");
});
