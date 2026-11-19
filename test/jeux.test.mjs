// Infos des jeux (jaquette, captures, descriptif, notes) : IGDB et Wikipédia simulés par un petit serveur local.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rr-jeux-"));
process.env.TWITCH_CLIENT_ID = "test";
process.env.TWITCH_CLIENT_SECRET = "test";

const JEUX = [
  { id: 2327, name: "Super Mario 64 DS", platforms: [{ name: "Nintendo DS", abbreviation: "NDS" }], cover: { image_id: "ds" }, first_release_date: 1101340800 },
  { id: 1074, name: "Super Mario 64", summary: "Mario explores Peach's castle.", url: "https://www.igdb.com/games/super-mario-64", first_release_date: 835488000,
    platforms: [{ name: "Nintendo 64", abbreviation: "N64" }], cover: { image_id: "co1" }, screenshots: [{ image_id: "sc1" }, { image_id: "sc2" }],
    genres: [{ name: "Platform" }], involved_companies: [{ developer: true, company: { name: "Nintendo EAD" } }, { developer: false, company: { name: "Nintendo" } }],
    aggregated_rating: 94.4, aggregated_rating_count: 18, rating: 88.6, rating_count: 1460 },
];
let appels = 0, wiki = true;
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/games")) { appels++; const m = /where id = (\d+)/.exec(b); return res.end(JSON.stringify(m ? JEUX.filter((j) => j.id === Number(m[1])) : /search "Zzz/.test(b) ? [{ id: 9, name: "Autre chose" }] : JEUX)); }
    if (req.url.startsWith("/w/api.php")) return res.end(JSON.stringify(wiki ? { query: { pages: [
      { index: 2, title: "Super Mario 64", fullurl: "https://fr.wikipedia.org/wiki/Super_Mario_64", extract: "Super Mario 64 est un jeu vidéo de plates-formes sorti en 1996[1]. Il a marqué son époque." },
      { index: 1, title: "Super Mario 64 (bande originale)", extract: "Album de musique." }] } } : { query: { pages: [] } }));
    res.statusCode = 404; res.end("{}");
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
process.env.IGDB_URL = process.env.WIKI_URL = `http://127.0.0.1:${srv.address().port}`;
const { infosJeu, score, couper } = await import("../server/jeux.mjs");
test.after(() => srv.close());

test("le bon jeu sur la bonne console, avec jaquette, captures, notes et texte Wikipédia", async () => {
  const i = await infosJeu({ titre: "Super Mario 64 (PAL)", plateforme: "Nintendo 64" });
  assert.equal(i.ref, 1074);
  assert.equal(i.annee, 1996);
  assert.equal(i.studio, "Nintendo EAD");
  assert.match(i.jaquette.petite, /t_cover_big\/co1\.jpg$/);
  assert.equal(i.captures.length, 2);
  assert.deepEqual(i.notes, { presse: { valeur: 94, nb: 18 }, joueurs: { valeur: 89, nb: 1460 } });
  assert.equal(i.description, "Super Mario 64 est un jeu vidéo de plates-formes sorti en 1996. Il a marqué son époque.");
  assert.equal(i.descriptionSource.licence, "CC BY-SA 4.0");
  assert.ok(i.autres.some((a) => a.ref === 2327));
  // gardé en cache : pas de nouvel appel à IGDB
  const n = appels; await infosJeu({ titre: "super mario 64", plateforme: "N64" }); assert.equal(appels, n);
});

test("la console départage, et un jeu choisi à la main est respecté", async () => {
  assert.ok(score(JEUX[0], "Super Mario 64 DS", "Nintendo DS") > score(JEUX[1], "Super Mario 64 DS", "Nintendo DS"));
  const i = await infosJeu({ titre: "Mario", ref: 2327 });
  assert.equal(i.ref, 2327);
});

test("sans article Wikipédia, le résumé IGDB est traduit ; rien de sûr : on propose une liste", async () => {
  wiki = false;
  const i = await infosJeu({ titre: "Super Mario 64", plateforme: "Wii" }, async (t) => "Mario explore le château de Peach.");
  assert.equal(i.description, "Mario explore le château de Peach.");
  assert.equal(i.descriptionSource.nom, "IGDB (traduit)");
  const r = await infosJeu({ titre: "Zzz jeu inconnu", plateforme: "" });
  assert.equal(r.introuvable, true);
  assert.equal(r.autres[0].nom, "Autre chose");
});

test("descriptif coupé en fin de phrase", () => {
  assert.equal(couper("Une phrase. Deux phrases un peu plus longues.", 22), "Une phrase.");
});
