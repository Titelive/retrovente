import { test } from "node:test";
import assert from "node:assert/strict";
import { calculerCote, medianePonderee, poidsContenu } from "../server/prix.mjs";

// Le cas qui a fait naître ce calcul : Jet Force Gemini N64, cartouche seule en très bon état.
const JFG = [
  { site: "eBay.fr", titre: "Jet Force Gemini N64 EUR", prix: 19.9, date: "2026-11-19", url: "https://www.ebay.fr/itm/1", type: "vente", etat: "tres_bon", contenu: "seul" },
  { site: "eBay.fr", titre: "Rareware Jet Force Gemini", prix: 12.78, date: "2026-10-26", url: "https://www.ebay.fr/itm/2", type: "vente", etat: "bon", contenu: "boite" },
  { site: "Leboncoin", titre: "Jet force gemini n64 (vendue)", prix: 10, date: "2026-11-19", url: "https://www.leboncoin.fr/ad/1", type: "vente", etat: "tres_bon", contenu: "seul" },
  { site: "Leboncoin", titre: "Jet force gemini n64 (en ligne)", prix: 19, date: "2026-11-19", url: "https://www.leboncoin.fr/ad/2", type: "annonce", etat: "bon", contenu: "seul" },
  { site: "PriceCharting", titre: "Jet Force Gemini PAL (loose)", prix: 6.53, date: "2026-11-19", url: "https://www.pricecharting.com/x", type: "cote", contenu: "seul" },
];
const AUJ = new Date("2026-11-19");

test("cote : prix conseillé et vendre vite dans la fourchette, annonce en ligne à part", () => {
  const c = calculerCote(JFG, { etat: "tres_bon", contenu: "seul" }, AUJ);
  assert.deepEqual([c.bas, c.haut, c.probable, c.conseille, c.rapide], [6.53, 19.9, 10, 11, 9]);
  assert.ok(c.bas <= c.rapide && c.rapide < c.conseille && c.conseille <= c.haut);
  const ann = c.releves.find((r) => r.type === "annonce");
  assert.equal(ann.compte, false);
  // le texte Méthode reprend les chiffres affichés
  for (const x of ["6,53 €", "19,90 €", "10 €", "11 €", "9 €", "n'est pas comptée"]) assert.ok(c.methode.replace(/\u00a0/g, " ").includes(x), x);
});

test("cote : un relevé trop différent de l'objet est écarté et le texte le dit", () => {
  const c = calculerCote(JFG, { etat: "bon", contenu: "boite" }, AUJ);
  assert.equal(c.releves.find((r) => r.type === "cote").compte, false);
  assert.deepEqual([c.bas, c.haut, c.probable], [10, 19.9, 12.78]);
  assert.match(c.methode, /1 prix est écarté/);
});

test("cote : sans vente conclue, on part des annonces moins 15 %", () => {
  const c = calculerCote([JFG[3]], { etat: "bon", contenu: "seul" }, AUJ);
  assert.equal(c.probable, 16.15);
  assert.ok(c.conseille <= c.haut);
  assert.match(c.methode, /aucune vente conclue/);
});

test("cote : médiane pondérée et poids du contenu", () => {
  assert.equal(medianePonderee([{ prix: 10, poids: 1 }, { prix: 20, poids: 1 }]), 15);
  assert.equal(medianePonderee([{ prix: 10, poids: 1 }, { prix: 20, poids: 3 }]), 20);
  assert.equal(poidsContenu("seul", "complet"), poidsContenu("complet", "seul"));
  assert.equal(calculerCote([], {}), null);
});
