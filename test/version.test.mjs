// Questions de langue, de version régionale et de compatibilité posées par un acheteur (sans réseau).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rr-v-"));
process.env.IA_FAKE = "1";
const { questionVersion, versionConnue, faitVersion, consigneVersion, reponsesVersion, resumeVersion, titreConversation } = await import("../server/ia.mjs");

// Le cas réel : Zelda Majora's Mask PAL, l'acheteur demande « Est-il en français », l'IA a répondu « jamais sorti en français ».
const MAJORA = { titre: "The Legend of Zelda Majora's Mask Nintendo 64", plateforme: "Nintendo 64", categorie: "jeux", prix: 85, etat: "tres_bon", contenu: "loose",
  description: "The Legend of Zelda : majora's Mask sur Nintendo 64, version européenne (PAL, NUS-NZSP-EUR). Cartouche seule, testée et fonctionnelle." };
const CONV = "[Annonce concernée]\nMathsangor\nThe Legend of Zelda Majora's Mask ...\n85 €\n\n[Conversation]\nÀ propos de cet acheteur\nMembre depuis août 2021\nAujourd'hui\nBonjour Titelive, votre annonce m'intéresse ! Est-elle toujours disponible ?\nil y a 7 min\nBonjour, oui le jeu est toujours disponible 🙂\nil y a 3 min\nEst-il en français\nil y a 2 min\nFaire une offre\nEnvoyer";
const FAUSSES = [
  { approche: "info", titre: "Réponse directe", texte: "C'est une version européenne PAL, donc le texte est en anglais 🙂 Sur N64, Majora's Mask n'est jamais sorti en français, c'est la même pour tout le monde." },
  { approche: "info", titre: "Avec précision", texte: "Non, il est en anglais : la version PAL de Majora's Mask n'a pas de texte en français sur N64 🙂 Par contre elle fonctionne parfaitement sur une console européenne." },
  { approche: "info", titre: "Court et sympa", texte: "Non, il est en anglais, c'est la seule langue de cette version PAL 🙂 Si vous avez une question, je vous réponds volontiers !" },
];

test("repère une question de langue ou de compatibilité dans la fin de la conversation", () => {
  assert.equal(questionVersion(CONV), "langue");
  assert.equal(questionVersion("[Conversation]\nil est en VF ?"), "langue");
  assert.equal(questionVersion("[Conversation]\nÇa marche sur une console japonaise ?"), "compatibilite");
  assert.equal(questionVersion("[Conversation]\nEst-il compatible avec ma N64 NTSC ?"), "compatibilite");
  // Le titre de l'annonce (« PAL ») n'est pas une question ; une question de disponibilité non plus.
  assert.equal(questionVersion("[Annonce concernée]\nPerfect Dark Nintendo 64 PAL loose\n20 €\n\n[Conversation]\nToujours disponible ?"), "");
  assert.equal(titreConversation(CONV), "The Legend of Zelda Majora's Mask ...");
});

test("Majora's Mask PAL : le français est connu, l'IA reçoit le fait et ne peut plus le nier", async () => {
  const v = versionConnue(MAJORA);
  assert.ok(v && v.langues.includes("français"));
  assert.equal(versionConnue({ ...MAJORA, description: "Version NTSC USA" }), null);   // pas la même version
  const f = await faitVersion(MAJORA, CONV);
  assert.equal(f.sujet, "langue"); assert.ok(f.fait.langues.includes("français"));
  assert.match(consigneVersion(f), /FAIT VÉRIFIÉ.*français/);
  // Les trois réponses fausses de la capture sont écartées et remplacées par une réponse juste.
  const l = reponsesVersion(FAUSSES, f, "le jeu");
  assert.equal(l.length, 1);
  assert.match(l[0].texte, /^Oui, le jeu est bien en français/);
  assert.doesNotMatch(l[0].texte, /anglais uniquement|jamais/);
  // Une bonne réponse du modèle est gardée telle quelle.
  const ok = [{ approche: "info", titre: "Direct", texte: "Oui, la version européenne est en français 🙂 Vous choisissez la langue dans le menu." }];
  assert.deepEqual(reponsesVersion([...FAUSSES, ...ok], f), ok);
  assert.equal(resumeVersion(f).verifie, true);
});

test("Majora's Mask sans fiche : le titre de la conversation suffit à reconnaître la version si la description manque", async () => {
  // Sans « PAL » nulle part, on ne suppose rien : pas de fait, et l'IA ne doit rien affirmer.
  const f = await faitVersion({}, CONV);
  assert.equal(f.fait, null);
  assert.match(consigneVersion(f), /N'AFFIRME RIEN/);
  const l = reponsesVersion(FAUSSES, f, "le jeu");
  assert.equal(l.length, 1); assert.match(l[0].texte, /Je vérifie la langue/);
  assert.equal(resumeVersion(f).verifie, false);
});

test("sans source sûre, une réponse prudente est gardée et une affirmation est écartée", async () => {
  const f = await faitVersion({ titre: "Banjo-Tooie Nintendo 64", plateforme: "Nintendo 64", description: "Version PAL" }, "[Conversation]\nIl est en français ?");
  assert.equal(f.fait, null);   // pas de réseau dans les tests
  const prudente = { approche: "info", titre: "Je vérifie", texte: "Je regarde l'écran de choix de langue ce soir et je vous redis 🙂" };
  assert.deepEqual(reponsesVersion([FAUSSES[0], prudente], f), [prudente]);
});

test("la langue écrite dans la fiche fait foi", async () => {
  const f = await faitVersion({ titre: "Dune 4K", categorie: "films", region: "VF incluse, zone B" }, "[Conversation]\nil y a la VF ?");
  assert.ok(f.fait); assert.equal(f.fait.origine, "fiche");
  const j = await faitVersion({ titre: "Banjo-Tooie", description: "Langues : anglais, français, allemand, espagnol" }, "[Conversation]\nen français ?");
  assert.deepEqual(j.fait.langues, ["anglais", "français", "allemand", "espagnol"]);
});

/* ===== Suite de la même conversation : le vendeur a répondu, puis l'acheteur sans avis ===== */
const { vendeurEnDernier, acheteurSansAvis, refusSansAvis, repondre } = await import("../server/ia.mjs");
const CONV2 = CONV.replace("Est-il en français\nil y a 2 min\n", "Est-il en français\nil y a 5 min\nIl s'agit de la version européenne, donc le français est bien présent. 🙂\nil y a 2 min\n✓\n");
const MIENS = ["Bonjour, oui le jeu est toujours disponible 🙂", "Il s'agit de la version européenne, donc le français est bien présent. 🙂"];

test("le vendeur a écrit le dernier message : reconnu même sans l'indication de l'extension", () => {
  assert.equal(vendeurEnDernier(CONV2, MIENS), true);
  assert.equal(vendeurEnDernier(CONV, MIENS), false);   // « Est-il en français » : l'acheteur attend une réponse
  assert.equal(vendeurEnDernier(CONV2, []), false);
});

test("acheteur sans avis : repéré d'après l'encadré, avec un refus poli tout prêt", async () => {
  assert.equal(acheteurSansAvis(CONV), true);   // Mathsangor : « Membre depuis août 2021 », aucune note
  assert.equal(acheteurSansAvis("[Annonce concernée]\ncarter054\n5 (4)\nPerfect Dark\n20 €\n\n[Conversation]\nÀ propos de cet acheteur\nMoselle\nMembre depuis novembre 2015\nDispo ?"), false);
  assert.equal(acheteurSansAvis("Kevin : je vous prends Conker"), false);   // sans encadré : on ne sait pas
  assert.match(refusSansAvis("le jeu")[0].texte, /^Après réflexion, je préfère réserver ce jeu à un acheteur ayant déjà des avis sur Le Bon Coin\. Rien de personnel/);
  const r = await repondre(CONV, MAJORA, [], { acheteur: "Mathsangor", mesMessages: MIENS.slice(0, 1) });
  assert.equal(r.acheteur.sansAvis, true); assert.equal(r.reponses.length, 3);
  assert.ok(r.reponses.every((x) => x.approche === "couper_court" && /avis/.test(x.texte)));
  // Règle désactivée dans le panneau : réponses normales, l'alerte reste.
  const n = await repondre(CONV, MAJORA, [], { acheteur: "Mathsangor", refuserSansAvis: false });
  assert.equal(n.acheteur.sansAvis, true); assert.ok(n.reponses.some((x) => !/avis/.test(x.texte)));
});
