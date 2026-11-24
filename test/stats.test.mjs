// Vues et favoris des annonces : lecture des liens, historique, conservation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { idAnnonce, lignesStats, majStats, garderStats, evolution } from "../server/stats.mjs";

test("identifiant de l'annonce dans son lien", () => {
  assert.equal(idAnnonce("lbc", "https://www.leboncoin.fr/ad/jeux_video/2874512345"), "2874512345");
  assert.equal(idAnnonce("lbc", "https://www.leboncoin.fr/ad/consoles/2874512345?x=1"), "2874512345");
  assert.equal(idAnnonce("lbc", "https://www.leboncoin.fr/recherche?q=12345678"), "");
  assert.equal(idAnnonce("ebay", "https://www.ebay.fr/itm/123456789012"), "123456789012");
  assert.equal(idAnnonce("ebay", "https://www.ebay.fr/itm/super-mario-64/123456789012?hash=x"), "123456789012");
});

test("lignes reçues nettoyées", () => {
  const l = lignesStats([{ id: "2874512345", vues: "12", favoris: 3 }, { id: "12", vues: 1 }, { id: "2874512346" }, { id: "2874512347", vues: -1, favoris: 2 }, null]);
  assert.deepEqual(l, [{ id: "2874512345", vues: 12, favoris: 3 }, { id: "2874512347", vues: null, favoris: 2 }]);
});

test("historique : une valeur par jour, évolution sur 7 jours", () => {
  const u = "https://www.leboncoin.fr/ad/jeux_video/2874512345";
  let e = majStats(null, u, { vues: 10, favoris: 1 }, new Date("2026-11-10T10:00:00Z"));
  e = majStats(e, u, { vues: 20, favoris: 2 }, new Date("2026-11-18T10:00:00Z"));
  e = majStats(e, u, { vues: 25, favoris: null }, new Date("2026-11-18T18:00:00Z"));
  assert.equal(e.hist.length, 2);
  assert.equal(e.favoris, 2);   // valeur absente : la précédente est gardée
  e = majStats(e, u, { vues: 40, favoris: 5 }, new Date("2026-11-24T10:00:00Z"));
  assert.deepEqual(evolution(e, 7, new Date("2026-11-24T12:00:00Z")), { vues: 15, favoris: 3, depuis: "2026-11-18" });
  // lien changé : on repart de zéro
  const n = majStats(e, u + "9", { vues: 1, favoris: 0 }, new Date("2026-11-24T11:00:00Z"));
  assert.equal(n.hist.length, 1);
});

test("stats gardées seulement pour le lien en place", () => {
  const s = { lbc: { url: "https://www.leboncoin.fr/ad/jeux_video/1234567", vues: 3 }, ebay: { url: "https://www.ebay.fr/itm/123456789012", vues: 4 } };
  assert.deepEqual(garderStats(s, "https://www.leboncoin.fr/ad/jeux_video/1234567", ""), { lbc: s.lbc });
  assert.equal(garderStats(s, "", ""), null);
});
