// Films : formats, et infos de la fiche (TMDB, Wikidata et Wikipédia simulés par un petit serveur local).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rr-films-"));
process.env.TMDB_API_KEY = "0123456789abcdef0123456789abcdef";

const FILMS = [
  { id: 438631, title: "Dune : Première partie", original_title: "Dune: Part One", release_date: "2021-09-15", poster_path: "/p1.jpg", popularity: 80 },
  { id: 693134, title: "Dune : Deuxième partie", original_title: "Dune: Part Two", release_date: "2024-02-27", poster_path: "/p2.jpg", popularity: 120 },
  { id: 841, title: "Dune", original_title: "Dune", release_date: "1984-12-14", poster_path: "/p3.jpg", popularity: 30 },
];
const DETAIL = {
  id: 693134, title: "Dune : Deuxième partie", original_title: "Dune: Part Two", release_date: "2024-02-27", runtime: 166,
  overview: "Paul Atréides s'unit à Chani et aux Fremen pour mener la révolte.", poster_path: "/p2.jpg", backdrop_path: "/b0.jpg",
  genres: [{ name: "Science-Fiction" }, { name: "Aventure" }], vote_average: 8.2, vote_count: 6900,
  credits: { crew: [{ job: "Producer", name: "Mary Parent" }, { job: "Director", name: "Denis Villeneuve" }], cast: [{ name: "Timothée Chalamet" }, { name: "Zendaya" }, { name: "Rebecca Ferguson" }, { name: "Javier Bardem" }, { name: "Josh Brolin" }] },
  images: { backdrops: [{ file_path: "/b1.jpg", vote_average: 5 }, { file_path: "/b2.jpg", vote_average: 6 }] },
  external_ids: { imdb_id: "tt15239678", wikidata_id: "Q107218659" },
};
const WD = { Q107218659: { claims: { P444: [
  { mainsnak: { datavalue: { value: "92%" } }, qualifiers: { P447: [{ datavalue: { value: { id: "Q105584" } } }] } },
  { mainsnak: { datavalue: { value: "79/100" } }, qualifiers: { P447: [{ datavalue: { value: { id: "Q150248" } } }], P7887: [{ datavalue: { value: { amount: "+67" } } }] } },
] } },
  Q1: { claims: { P577: [{ mainsnak: { datavalue: { value: { time: "+1990-02-07T00:00:00Z" } } } }], P57: [{ mainsnak: { datavalue: { value: { id: "Q2" } } } }], P136: [{ mainsnak: { datavalue: { value: { id: "Q3" } } } }], P2047: [{ mainsnak: { datavalue: { value: { amount: "+117" } } } }] } } };
let appels = 0, tmdbVu = "";
const srv = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/search/movie") { appels++; tmdbVu = u.search; return res.end(JSON.stringify({ results: /zzz/i.test(u.searchParams.get("query")) ? [{ id: 9, title: "Autre chose", release_date: "2001-01-01" }] : FILMS })); }
  if (u.pathname === "/movie/693134") { appels++; return res.end(JSON.stringify(DETAIL)); }
  if (u.pathname === "/w/api.php" && u.searchParams.get("action") === "wbgetentities") {
    const ids = u.searchParams.get("ids").split("|");
    if (u.searchParams.get("props") === "labels") return res.end(JSON.stringify({ entities: Object.fromEntries(ids.map((id) => [id, { labels: { fr: { value: { Q2: "Akira Kurosawa", Q3: "film dramatique" }[id] || id } } }])) }));
    return res.end(JSON.stringify({ entities: Object.fromEntries(ids.map((id) => [id, WD[id] || {}])) }));
  }
  if (u.pathname === "/w/api.php" && u.searchParams.get("generator") === "search") return res.end(JSON.stringify({ query: { pages: [
    { index: 2, title: "Rêves (film)", fullurl: "https://fr.wikipedia.org/wiki/R%C3%AAves_(film)", extract: "Rêves est un film japonais réalisé par Akira Kurosawa, sorti en 1990[1].", pageprops: { wikibase_item: "Q1" } },
    { index: 1, title: "Rêves (album)", extract: "Album de musique." }] } }));
  res.statusCode = 404; res.end("{}");
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
process.env.TMDB_URL = process.env.WIKI_URL = process.env.WIKIDATA_URL = `http://127.0.0.1:${srv.address().port}`;
const { infosFilm, scoreFilm, formatFilm, notePresse } = await import("../server/films.mjs");
test.after(() => srv.close());

test("formats lus comme on les écrit", () => {
  assert.equal(formatFilm("4K Ultra HD + Blu-ray"), "Blu-Ray 4K UHD + Blu-Ray");
  assert.equal(formatFilm("blu-ray 4k"), "Blu-Ray 4K UHD");
  assert.equal(formatFilm("UHD"), "Blu-Ray 4K UHD");
  assert.equal(formatFilm("bluray"), "Blu-Ray");
  assert.equal(formatFilm("Blu-ray 3D"), "Blu-Ray 3D");
  assert.equal(formatFilm("dvd"), "DVD");
  assert.equal(formatFilm("cassette VHS"), "VHS");
  assert.equal(formatFilm(""), "");
});

test("le bon film d'après le titre et l'année, avec affiche, images, synopsis, casting et notes", async () => {
  const i = await infosFilm({ titre: "Dune : Deuxième partie (4K steelbook)", annee: "2024" });
  assert.equal(i.ref, 693134);
  assert.equal(i.annee, 2024);
  assert.equal(i.duree, 166);
  assert.equal(i.realisateur, "Denis Villeneuve");
  assert.deepEqual(i.acteurs, ["Timothée Chalamet", "Zendaya", "Rebecca Ferguson", "Javier Bardem"]);
  assert.equal(i.titreOriginal, "Dune: Part Two");
  assert.match(i.jaquette.petite, /\/w342\/p2\.jpg$/);
  assert.match(i.captures[0].grande, /\/w1280\/b2\.jpg$/);   // la mieux notée d'abord
  assert.deepEqual(i.notes, { presse: { valeur: 79, nb: 67, source: "Metacritic" }, joueurs: { valeur: 82, nb: 6900 } });
  assert.match(i.description, /^Paul Atréides/);
  assert.equal(i.source, "TMDB");
  assert.ok(i.autres.some((a) => a.ref === 438631));
  assert.match(tmdbVu, /language=fr-FR/); assert.match(tmdbVu, /api_key=0123/);
  // gardé en cache : pas de nouvel appel à TMDB
  const n = appels; await infosFilm({ titre: "dune deuxième partie", annee: 2024 }); assert.equal(appels, n);
});

test("l'année départage les films du même nom, et rien de sûr : on propose une liste", async () => {
  assert.ok(scoreFilm(FILMS[2], "Dune", 1984) > scoreFilm(FILMS[0], "Dune", 1984));
  const i = await infosFilm({ titre: "Zzz le film" });
  assert.equal(i.introuvable, true);
  assert.equal(i.autres[0].ref, 9);
});

test("note de la presse : seulement Metacritic sur 100", () => {
  assert.equal(notePresse({ claims: { P444: [WD.Q107218659.claims.P444[0]] } }), null);
  assert.equal(notePresse(null), null);
});

test("sans clé TMDB : synopsis Wikipédia et infos Wikidata", async () => {
  delete process.env.TMDB_API_KEY;
  const i = await infosFilm({ titre: "Rêves", annee: 1990 });
  assert.equal(i.nom, "Rêves");
  assert.equal(i.annee, 1990);
  assert.equal(i.duree, 117);
  assert.equal(i.realisateur, "Akira Kurosawa");
  assert.deepEqual(i.genres, ["Dramatique"]);
  assert.equal(i.description, "Rêves est un film japonais réalisé par Akira Kurosawa, sorti en 1990.");
  assert.equal(i.descriptionSource.licence, "CC BY-SA 4.0");
  assert.equal(i.jaquette, null);
});
