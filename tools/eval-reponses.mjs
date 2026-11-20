// Banc d'essai des réponses IA sur de vraies conversations Le Bon Coin (appelle vraiment Claude : il faut ANTHROPIC_API_KEY).
//   node tools/eval-reponses.mjs            → chaque cas, ses 3 réponses, et les vérifications ✓ / ✗
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rr-eval-"));
delete process.env.IA_FAKE;
const { repondre } = await import("../server/ia.mjs");

const PD = { titre: "Perfect Dark Nintendo 64 PAL loose", plateforme: "Nintendo 64", categorie: "jeux", prix: 20, etat: "tres_bon", contenu: "loose",
  description: "Perfect Dark sur Nintendo 64, version européenne (PAL, NUS-NPDP-EUR). Cartouche seule, testée et fonctionnelle.\nTrès bon état.\nRemise en main propre ou envoi." };
const ENTETE = "À propos de cet acheteur\nMoselle\nMembre depuis novembre 2015\n4 transactions réalisées avec la Transaction sécurisée leboncoin\n";
const conv = (corps) => `[Annonce concernée]\ncarter054\n5 (4)\nDernière activité il y a 9 heures\nPerfect Dark Nintendo 64 PAL loose\n20 €\n\n[Conversation]\n${ENTETE}${corps}\nFaire une offre\nEnvoyer`;
const M1 = "hier\nBonjour Titelive, votre annonce m'intéresse ! Est-elle toujours disponible ? Je suis d'à côté de Nancy\n22:01";
const R1 = "Bonjour, oui il est toujours disponible 👍 Dites-moi quand vous voulez passer le récupérer, on s'arrangera pour un créneau à Nancy.";
const M2 = "Je suis sur Nancy à partir de 18h15 ce soir, je serai exactement au FoodLab. Vous pensez pouvoir y être à cette heure ci ou c'est compliqué ?\nil y a 1 min";

const sans = (re, nom) => ({ nom, ok: (r) => r.reponses.every((x) => !re.test(x.texte)) });
const avec = (re, nom) => ({ nom, ok: (r) => r.reponses.every((x) => re.test(x.texte)) });
const differentes = { nom: "3 réponses vraiment différentes", ok: (r) => {
  const mots = (t) => new Set(t.toLowerCase().replace(/[^\p{L}\d ]/gu, " ").split(/\s+/).filter((m) => m.length > 2));
  const l = r.reponses.map((x) => mots(x.texte));
  for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) { const a = l[i], b = l[j], c = [...a].filter((m) => b.has(m)).length; if (c / Math.min(a.size, b.size) > 0.85) return false; }
  return l.length === 3;
} };
const COMMUNS = [sans(/Garnier|Moselle/, "pas de prénom inventé ni « Moselle »"), sans(/merci pour votre (message|retour)/i, "pas de « merci pour votre message »"), sans(/texte fourni|transmis|consigne/i, "pas de méta")];

const CAS = [
  { nom: "FoodLab + consigne « Aucun souci, je suis en vacances »", conversation: conv(`${M1}\nAujourd'hui\n${R1}\nil y a 12 min\n${M2}`),
    contexte: { acheteur: "carter054", consigne: "Aucun souci, je suis en vacances, ahah", mesMessages: [R1] },
    verifs: [avec(/18h15|18 h 15|FoodLab/i, "reprend l'heure ou le lieu"), sans(/juste|autre jour|compliqu|pas possible|demain/i, "n'en fait pas un refus"), avec(/vacances/i, "garde « vacances »"), sans(/disponible/i, "ne redit pas la disponibilité"), differentes] },
  { nom: "FoodLab sans consigne", conversation: conv(`${M1}\nAujourd'hui\n${R1}\nil y a 12 min\n${M2}`), contexte: { acheteur: "carter054", mesMessages: [R1] },
    verifs: [sans(/disponible/i, "ne redit pas la disponibilité"), sans(/\d+\s?€|prix/i, "ne parle pas de prix"), avec(/18h15|18 h 15|FoodLab|ce soir/i, "répond à sa proposition"), differentes] },
  { nom: "Premier message : dispo ? je suis d'à côté de Nancy", conversation: conv(M1), contexte: { acheteur: "carter054", mesMessages: [] },
    verifs: [avec(/disponible/i, "dit que c'est disponible"), sans(/envoi|exp[ée]di|colis/i, "ne demande pas main propre ou envoi"), sans(/\d+\s?€|prix|ferme/i, "ne parle pas de prix"), sans(/PAL|loose|cartouche seule|testé/i, "ne redécrit pas l'annonce"), sans(/vous (venez|êtes|habitez)|tout près|du coin/i, "ne reformule pas où il habite"), differentes] },
  { nom: "Négociation : « vous le feriez à 10 € ? »", conversation: conv(`${M1}\nAujourd'hui\n${R1}\nil y a 12 min\nVous me le feriez à 10 € ?\nil y a 1 min`), contexte: { acheteur: "carter054", mesMessages: [R1] },
    verifs: [sans(/\b10 ?€.{0,20}(ok|d'accord|ça marche|va pour)/i, "n'accepte pas 10 €"), sans(/disponible/i, "ne redit pas la disponibilité"), differentes] },
  { nom: "Consigne de refus : « non c'est 20 pas moins »", conversation: conv(`${M1}\nAujourd'hui\n${R1}\nil y a 12 min\nC'est votre dernier prix ? 15 € ?\nil y a 1 min`),
    contexte: { acheteur: "carter054", consigne: "non c'est 20 pas moins", mesMessages: [R1] },
    verifs: [avec(/20/, "garde 20 €"), sans(/\b15 ?€.{0,20}(ok|d'accord|ça marche|va pour)/i, "n'accepte pas 15 €"), differentes] },
];

let echecs = 0;
for (const c of CAS) {
  let r;
  try { r = await repondre(c.conversation, PD, [], c.contexte); } catch (e) { console.log(`\n✗ ${c.nom} : erreur ${e.message}`); echecs++; continue; }
  console.log(`\n=== ${c.nom}\nRésumé : ${r.resume}`);
  r.reponses.forEach((x, i) => console.log(`  ${i + 1}. [${x.approche}] ${x.texte}`));
  for (const v of [...c.verifs, ...COMMUNS]) { const ok = v.ok(r); if (!ok) echecs++; console.log(`  ${ok ? "✓" : "✗"} ${v.nom}`); }
}
console.log(`\n${echecs ? `✗ ${echecs} vérification(s) en échec` : "✓ tout est bon"}`);
process.exit(echecs ? 1 : 0);
