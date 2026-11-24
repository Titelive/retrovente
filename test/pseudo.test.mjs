// Pseudos Le Bon Coin à point, à chiffres ou à tiret bas, et offre déjà refusée (sans réseau).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rr-p-"));
process.env.IA_FAKE = "1";
const { sansPrenomInvente, offreRefusee, repondre } = await import("../server/ia.mjs");

// personnaliser() de l'extension, extraite telle quelle de lbc.js.
const src = fs.readFileSync(new URL("../extension/lbc.js", import.meta.url), "utf8");
const corps = /function personnaliser\(t, nom\) \{[\s\S]*?\n  \}\n/.exec(src)[0];
const personnaliser = vm.runInNewContext(`(${corps.replace("function personnaliser", "function")})`);

const PSEUDOS = ["Mick.8", "Jean_75", "Lulu.retro.64", "Max-33", "Kev2000", "Mick"];

test("le pseudo de l'acheteur reste entier, même avec un point ou des chiffres", () => {
  for (const p of PSEUDOS) {
    for (const t of [`Bonjour ${p}, merci pour l'offre 🙂`, `Merci ${p}, bonne journée ! 🙂`, `Merci pour l'échange ${p}, bonne soirée 🙂`]) {
      assert.equal(sansPrenomInvente(t, p), t, `${p} : ${t}`);
    }
  }
  // Le cas de la capture : plus jamais « Bonjour.8 » ni « Merci.8 ».
  assert.doesNotMatch(sansPrenomInvente("Bonjour Mick.8, merci pour l'offre", "Mick.8"), /Bonjour\.8|Bonjour,? \.8/);
  assert.doesNotMatch(sansPrenomInvente("Merci Mick.8, bonne journée !", "Mick.8"), /Merci\.8/);
});

test("un prénom inventé est retiré en entier, sans laisser de bout", () => {
  assert.equal(sansPrenomInvente("Bonjour Garnier, merci !", "Mick.8"), "Bonjour, merci !");
  assert.equal(sansPrenomInvente("Merci Paul.8, bonne journée", "Mick.8"), "Merci, bonne journée");
  assert.equal(sansPrenomInvente("Bonjour Kev2000 !", ""), "Bonjour !");
  // Un point de fin de phrase n'est pas collé au nom.
  assert.equal(sansPrenomInvente("Merci Mick.", "Mick.8"), "Merci Mick.");
});

test("l'extension ne remet pas le pseudo une seconde fois", () => {
  for (const p of PSEUDOS) {
    assert.equal(personnaliser(`Bonjour ${p}, merci pour l'offre`, p), `Bonjour ${p}, merci pour l'offre`);
    assert.equal(personnaliser("Bonjour, merci pour l'offre", p), `Bonjour ${p}, merci pour l'offre`);
  }
  assert.equal(personnaliser("Bonjour merci", "Mick.8"), "Bonjour Mick.8, merci");
});

const CONV = "[Annonce concernée]\nMick.8\nEn ligne\n5 (46)\nLot 11 jeux N64 avec raretés\n590 €\n\n[Conversation]\nÀ propos de cet acheteur\nSarthe\nMembre depuis janvier 2019\nAujourd'hui\nOffre reçue\nVoici l'offre de Mick.8 : 360 €.\nVous avez 48 heures pour accepter.\nil y a 2 min - Message automatique leboncoin\nAchat immédiat\nOffre refusée\nVous avez refusé l'offre de 360 €.\nEnvoyez-en une nouvelle pour trouver un accord !\nil y a 1 min - Message automatique leboncoin\nBonjour Mick.8, merci pour l'offre, mais 360 € pour ce lot, je ne peux pas.\nil y a 1 min\nOk 👍\nil y a 1 min";

test("offre refusée : le bandeau « Offre très basse » ne revient plus", async () => {
  assert.equal(offreRefusee(CONV), true);
  assert.equal(offreRefusee(CONV.replace(/Offre refusée\nVous avez refusé l'offre de 360 €\.\n/, "")), false);
  // Une nouvelle offre après le refus est de nouveau en cours.
  assert.equal(offreRefusee(CONV + "\nVoici l'offre de Mick.8 : 450 €."), false);
  const r = await repondre(CONV, { titre: "Lot 11 jeux N64", prix: 590, categorie: "jeux" }, [], { acheteur: "Mick.8", offre: 360 });
  assert.equal(r.offre, undefined);
  const avant = await repondre(CONV.split("Achat immédiat")[0], { titre: "Lot 11 jeux N64", prix: 590, categorie: "jeux" }, [], { acheteur: "Mick.8", offre: 360 });
  assert.equal(avant.offre.offre, 360);
});
