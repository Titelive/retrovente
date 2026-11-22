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

// GoldenEye 007 : une vente eBay à 25 €, une cote à 24 €, des annonces en ligne à 25 et 30 €.
test("cote : marge de négociation sous le prix médian des annonces concurrentes (GoldenEye 007)", () => {
  const R = [
    { site: "eBay France", titre: "GoldenEye 007 cartouche", prix: 25, date: "2026-03-29", url: "https://www.ebay.fr/itm/g1", type: "vente", etat: "bon", contenu: "seul" },
    { site: "Le Bon Coin", titre: "GoldenEye 007 bon état", prix: 25, date: "2026-11-19", url: "https://www.leboncoin.fr/ad/g1", type: "annonce", etat: "bon", contenu: "seul" },
    { site: "Le Bon Coin", titre: "GoldenEye 007 PAL", prix: 30, date: "2026-11-19", url: "https://www.leboncoin.fr/ad/g2", type: "annonce", contenu: "seul" },
    { site: "Le Bon Coin", titre: "GoldenEye 007 sans boîte", prix: 30, date: "2026-11-19", url: "https://www.leboncoin.fr/ad/g3", type: "annonce", etat: "tres_bon", contenu: "seul" },
    { site: "PriceCharting", titre: "GoldenEye 007 PAL loose", prix: 24, date: "2026-11-19", url: "https://www.pricecharting.com/g", type: "cote", contenu: "seul" },
  ];
  const c = calculerCote(R, { etat: "bon", contenu: "seul" }, AUJ);
  assert.deepEqual([c.bas, c.haut, c.probable, c.conseille, c.rapide], [24, 25, 25, 28, 24]);
  assert.equal(c.releves.filter((r) => r.compte).length, 2);
  assert.match(c.methode, /annonces encore en ligne .* ne sont pas comptées/);
});

test("cote : un résumé trop long est coupé à la fin d'une phrase ou d'un mot", async () => {
  const { coupe: phrase } = await import("../server/ia.mjs");
  const long = "Le prix dépend de la boîte. " + "Et aussi de l'étiquette et du fait que la cartouche soit d'origine ".repeat(10);
  assert.equal(phrase(long, 50), "Le prix dépend de la boîte.");
  const sansPoint = "mot ".repeat(50);
  assert.ok(phrase(sansPoint, 41).endsWith("mot…"));
});

// Majora's Mask : une cote à 75 €, des annonces de 50 à 85 €. Le conseillé ne doit pas monter au plafond des annonces.
test("cote : avec une seule cote, le conseillé reste près d'elle et sous les annonces concurrentes (Majora's Mask)", () => {
  const R = [
    { site: "PrixRetro", titre: "Argus Majora's Mask", prix: 75, date: "2026-11-20", url: "https://prixretro.test/1", type: "cote", contenu: "seul" },
    { site: "Le Bon Coin", titre: "Cartouche dorée", prix: 75, url: "https://lbc.test/1", type: "annonce", contenu: "seul" },
    { site: "Le Bon Coin", titre: "Cartouche seule", prix: 80, url: "https://lbc.test/2", type: "annonce", contenu: "seul" },
    { site: "Le Bon Coin", titre: "Nintendo 64", prix: 50, url: "https://lbc.test/3", type: "annonce" },
    { site: "Le Bon Coin", titre: "TBE, sauvegardes", prix: 85, url: "https://lbc.test/4", type: "annonce", etat: "tres_bon", contenu: "seul" },
  ];
  const c = calculerCote(R, { etat: "tres_bon", contenu: "seul" }, new Date("2026-11-20"));
  assert.deepEqual([c.probable, c.conseille, c.rapide], [75, 80, 64]);
  assert.match(c.methode.replace(/\u00a0/g, " "), /prix médian des annonces concurrentes \(80 €\)/);
});
