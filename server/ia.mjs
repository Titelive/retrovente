// IA : reconnaître un jeu sur une photo (fiche + annonce + cadre pour le recadrage) et estimer sa cote.
// Repris de la section Ventes du backoffice titelive. Clé ANTHROPIC_API_KEY ; modèle CLAUDE_MODEL facultatif.
// IA_FAKE=1 : réponses fictives, pour les tests et le développement sans clé.
import { calculerCote, TYPES as TYPES_RELEVE } from "./prix.mjs";
import { ETATS_CARTE, LIB_ETAT_CARTE, ETAT_LBC_DE_CARTE, carteTcgdex, lienCardmarket } from "./cartes.mjs";
export { ETATS_CARTE };
export const CATEGORIES = ["jeux", "consoles", "accessoires", "cartes", "autres"];
export const ETATS = ["neuf", "tres_bon", "bon", "correct", "pieces", ""];
export const CONTENUS = ["seul", "boite", "complet", "boite_vide", ""];
export const MAX_PHOTO = 2_100_000;   // data URL ; photos en haute définition (2000 à 2400 px) pour la retouche et la galerie

export const txt = (v, n) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, n);
export const prix = (v) => { if (v == null || String(v).trim() === "") return null; const n = Number(String(v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) && n >= 0 && n < 1e6 ? Math.round(n * 100) / 100 : null; };
export const jour = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
export const parmi = (v, liste, def) => (liste.includes(v) ? v : def);
export const lien = (v) => { const s = txt(v, 500); try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch (e) { return ""; } };

export class IaError extends Error {}
// adresse sans fragment ni barre finale, pour comparer un lien cité aux pages réellement trouvées par la recherche
export const norme = (u) => { try { const x = new URL(u); x.hash = ""; return (x.host.replace(/^www\./, "") + x.pathname.replace(/\/$/, "") + x.search).toLowerCase(); } catch (e) { return ""; } };

export function coteDe(c) {
  if (!c || typeof c !== "object") return null;
  const o = { bas: prix(c.bas), haut: prix(c.haut), conseille: prix(c.conseille), rapide: prix(c.rapide), resume: txt(c.resume, 400), date: jour(c.date) || new Date().toISOString().slice(0, 10),
    sources: (Array.isArray(c.sources) ? c.sources : []).map(lien).filter(Boolean).slice(0, 4),
    methode: txt(c.methode, 900),
    releves: (Array.isArray(c.releves) ? c.releves : []).map((r) => {
      if (!r || typeof r !== "object") return null;
      const x = { site: txt(r.site, 40), titre: txt(r.titre, 140), prix: prix(r.prix), date: jour(r.date), url: lien(r.url) };
      // nature du relevé (vente conclue, annonce en ligne, cote), état et contenu, et ce qu'il pèse dans le calcul
      if (TYPES_RELEVE.includes(r.type)) x.type = r.type;
      if (ETATS.includes(r.etat) && r.etat) x.etat = r.etat;
      if (CONTENUS.includes(r.contenu) && r.contenu) x.contenu = r.contenu;
      if (r.poids != null && isFinite(+r.poids)) x.poids = Math.max(0, Math.min(1, Math.round(+r.poids * 100) / 100));
      if (typeof r.compte === "boolean") x.compte = r.compte;
      return x;
    }).filter((r) => r && r.url && r.prix != null).slice(0, 8) };
  const pb = prix(c.probable); if (pb != null) o.probable = pb;
  return o.conseille != null || o.bas != null ? o : null;
}

// Les modèles récents réfléchissent avant de répondre, et cette réflexion compte dans max_tokens :
// un petit budget (200, 300, 800) peut être entièrement consommé et la réponse arriver vide.
// On garde donc un plancher confortable, et on relance une fois avec plus de marge si c'est arrivé.
const PLANCHER = 4000;
async function claude(content, opts = {}) {
  const d = await claude1(content, opts);
  if (!(d && d._vide)) return d;
  const e = await claude1(content, { ...opts, max: Math.max(opts.max || 1500, PLANCHER) * 2, timeout: Math.max(opts.timeout || 30000, 45000) });
  return e && e._vide ? (opts.brut ? { _texte: "" } : null) : e;
}
async function claude1(content, { web = 0, max = 1500, timeout = 30000, model = "", brut = false, outil = null, trace = null, effort = "" } = {}) {
  max = Math.max(max, PLANCHER);
  const t0 = Date.now(), modele = model || process.env.CLAUDE_MODEL || "claude-haiku-5-5";
  const note = (x) => { if (trace) trace.push({ modele, ms: Date.now() - t0, ...x }); };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new IaError("Le service d'IA n'est pas configuré.");
  let r;
  try { r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(timeout),
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: modele, max_tokens: max,
      // Effort réduit pour les petites tâches (sens, légendes, cadrage) : moins de réflexion, réponse plus rapide.
      ...(effort && /claude-(haiku|sonnet|opus|fable)-5/.test(modele) ? { output_config: { effort } } : {}),
      ...(web ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: web }] } : {}),
      // Sortie structurée : le modèle remplit un outil au schéma imposé (pas de JSON à relire dans du texte).
      ...(outil ? { tools: [{ name: outil.name, description: outil.description, input_schema: outil.schema }], tool_choice: { type: "tool", name: outil.name } } : {}),
      messages: [{ role: "user", content }],
    }),
  }); } catch (e) { note({ erreur: e.name === "TimeoutError" ? "délai dépassé (" + timeout / 1000 + " s)" : String(e.message || e).slice(0, 120) }); throw e; }
  if (!r.ok) { const corps = (await r.text().catch(() => "")).slice(0, 300); console.error("IA", r.status, corps); note({ statut: r.status, erreur: corps.slice(0, 200) }); const e = new IaError("Le service d'IA est momentanément indisponible, réessaie dans un instant."); e.statut = r.status; throw e; }
  const d = await r.json();
  const t = (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const vus = new Set();
  for (const b of d.content || []) if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const x of b.content) if (x && x.url) vus.add(norme(x.url));
  for (const b of d.content || []) for (const c of b.citations || []) if (c && c.url) vus.add(norme(c.url));
  if (d.stop_reason === "max_tokens") console.error("IA : réponse coupée (max_tokens)", max);
  if (outil) {
    const u = (d.content || []).find((b) => b.type === "tool_use" && b.name === outil.name);
    if (u && u.input && typeof u.input === "object") return u.input;
    console.error("IA : outil non rempli", d.stop_reason, t.slice(0, 300));
  }
  const o = lireJson(t);
  note({ statut: 200, fin: d.stop_reason, texte: t.slice(0, 240), json: !!o, blocs: (d.content || []).map((b) => b.type).join(","), jetons: d.usage && d.usage.output_tokens, max });
  if (!t.trim() && d.stop_reason === "max_tokens" && !outil) return { _vide: true };
  if (!o) { console.error("IA : JSON illisible", t.slice(0, 400)); if (brut) return { _texte: t }; }
  if (o && web) Object.defineProperty(o, "_vus", { value: vus });
  return o;
}
// Lit l'objet JSON d'une réponse du modèle, même entouré de texte ou de ```json, avec des retours à la ligne bruts
// dans les chaînes ou une virgule en trop.
export function lireJson(t) {
  const m = /\{[\s\S]*\}/.exec(String(t || "").replace(/```(?:json)?/g, ""));
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch {}
  let r = "", dans = false, ech = false;
  for (const c of m[0]) {
    if (dans) {
      if (ech) { ech = false; r += c; continue; }
      if (c === "\\") { ech = true; r += c; continue; }
      if (c === '"') dans = false;
      r += c === "\n" ? "\\n" : c === "\r" ? "" : c === "\t" ? " " : c;
    } else { if (c === '"') dans = true; r += c; }
  }
  try { return JSON.parse(r.replace(/,\s*([}\]])/g, "$1")); } catch { return null; }
}

export function checkPhoto(photo) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(photo || ""));
  if (!m || photo.length > MAX_PHOTO) throw new IaError("Photo trop lourde ou illisible.");
  return m;
}
const image = (photo) => { const m = checkPhoto(photo); return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } }; };

const CADRE_CONSIGNE = `"cadre" (rectangle qui entoure tout l'objet à vendre, boîte et accessoires compris, sans marge : objet {"x","y","w","h"} en fractions de la largeur et de la hauteur de l'image, entre 0 et 1, origine en haut à gauche)`;
export function cadreDe(c) {
  if (!c || typeof c !== "object") return null;
  const n = (v) => { const x = Number(v); return isFinite(x) ? Math.max(0, Math.min(1, x)) : NaN; };
  const o = { x: n(c.x), y: n(c.y), w: n(c.w), h: n(c.h) };
  if ([o.x, o.y, o.w, o.h].some(isNaN) || o.w < 0.08 || o.h < 0.08 || o.x + o.w > 1.02 || o.y + o.h > 1.02) return null;
  if (o.w > 0.95 && o.h > 0.95) return null;
  return o;
}

const FAKE = () => process.env.IA_FAKE === "1";

const CARTE_FAKE = { trouve: true, titre: "Dracaufeu", categorie: "cartes", plateforme: "Set de base", region: "Français", numero: "4/102", rarete: "Holo rare", edition: "", gradation: "", etatCarte: "near_mint", remarques: "", particularites: ["Carte mise en sleeve dès l'ouverture du booster"], annonce: "Dracaufeu 4/102 Set de base Holo FR", description: "Carte Pokémon Dracaufeu 4/102, extension Set de base, holo rare, en français.\nCarte authentique en état Near Mint : bords nets, surface holo sans rayure.\nEnvoi soigné sous sleeve et toploader, dans une enveloppe rigide.\nRemise en main propre ou envoi.", cadre: { x: 0.25, y: 0.1, w: 0.5, h: 0.8 } };
export async function identifier(photo) {
  if (FAKE() && process.env.IA_FAKE_OBJET === "carte") { checkPhoto(photo); const o = CARTE_FAKE; return { ...champsCarte(o), titre: o.titre, categorie: o.categorie, plateforme: o.plateforme, region: o.region, etat: ETAT_LBC_DE_CARTE[o.etatCarte], contenu: "", remarques: "", particularites: o.particularites, annonce: o.annonce, description: o.description, cadre: o.cadre, rotation: 0 }; }
  if (FAKE()) { checkPhoto(photo); return { titre: "Super Mario 64", categorie: "jeux", plateforme: "Nintendo 64", region: "PAL EUR", etat: "bon", contenu: "complet", remarques: "Boîte légèrement frottée sur les coins.", particularites: ["Notice incluse", "Poster inclus"], annonce: "Super Mario 64 Nintendo 64 complet boîte notice PAL", description: "Super Mario 64 sur Nintendo 64, version française (PAL, NUS-NSMP-FRA).\nComplet en boîte (CIB) : boîte, notice et cartouche d'origine, testée et fonctionnelle.\nBon état général, coins de la boîte légèrement frottés.\nRemise en main propre ou envoi.", cadre: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 } }; }
  const consigne = `Cette photo montre un objet qu'un particulier va vendre d'occasion sur Le Bon Coin (le plus souvent un jeu vidéo, une console, un accessoire ou une carte Pokémon). Identifie-le aussi précisément que possible à partir de ce qui est visible (étiquette, logo, boîte, références comme « NUS-NKXP-EUR »). Lis le texte de la jaquette : si le titre est lisible, considère l'objet comme reconnu même si tu ne connais pas ce jeu (il peut être sorti récemment).
Réponds uniquement par un objet JSON avec les clés :
"trouve" (true si tu as reconnu l'objet, sinon false),
"titre" (nom exact et officiel, version française ou européenne si c'est elle, ex. « Kirby 64: The Crystal Shards »),
"categorie" (« jeux », « consoles », « accessoires », « cartes » pour une carte Pokémon, ou « autres »),
"plateforme" (console ou support, nom courant en français, ex. « Nintendo 64 », « PlayStation 2 » ; "" si sans objet),
"region" (ex. « PAL EUR », « NTSC-J » ; "" si inconnue),
"etat" (d'après la photo : « neuf », « tres_bon », « bon », « correct » ou « pieces » ; "" si impossible à dire ; jamais « neuf » ni « tres_bon » si le plastique est nettement jauni),
"jauni" (couleur du plastique de la cartouche, de la console ou de la manette : un gris ou un blanc d'origine qui tire sur le jaune, le beige ou l'orangé a jauni avec le temps (UV) ; compare avec la couleur normale de ce modèle et avec les parties à l'abri : « non », « leger » ou « net » ; « non » si la lumière de la photo (chaude, jaune) suffit à l'expliquer ou si c'est impossible à dire),
"contenu" (« seul » si jeu en loose, c'est-à-dire cartouche ou disque sans boîte, « boite » si boîte sans notice visible, « complet » si boîte et notice, « boite_vide » si c'est une boîte sans le jeu (édition à code, disque absent) ; "" si sans objet),
"particularites" (liste de 0 à 5 points propres à CE jeu ou à cette édition qu'un acheteur voudrait savoir, sous forme d'options courtes à cocher par le vendeur, ex. pour un jeu vendu avec un code : « Code de téléchargement déjà utilisé », « Code non utilisé » ; pour une édition avec bonus : « Poster inclus », « Carte de la ville incluse », « Steelbook inclus », « Jaquette réversible » ; [] si rien de particulier),
"remarques" (une phrase courte sur ce qui compte pour un acheteur : étiquette abîmée, rayures, plastique jauni, éléments manquants… ; "" sinon),
${CADRE_CONSIGNE},
"rotation" (rotation en degrés, dans le sens des aiguilles d'une montre, à appliquer à la photo pour que l'étiquette ou le texte de l'objet soit à l'endroit : 0, 90, 180 ou 270),
"annonce" (titre d'annonce Le Bon Coin précis, 70 caractères au plus : nom du jeu, plateforme, région, puis « loose » si cartouche ou disque seul, « en boîte » ou « complet CIB » ; ex. « Kirby 64 Nintendo 64 PAL loose »),
"description" (texte de l'annonce en français, exactement dans ce style, 4 lignes courtes, honnête, sans prix ni émoji, sans inventer ce qui ne se voit pas :
« Conker's Bad Fur Day sur Nintendo 64, version européenne (PAL, NUS-NFUP-EUR).
Jeu en loose : cartouche seule, d'origine, testée et fonctionnelle, sans boîte ni notice.
Étiquette propre et bien lisible, cartouche en bon état.
Remise en main propre ou envoi. »
Ligne 1 : nom, console, version et référence si elle est lisible sur la photo. Ligne 2 : ce qui est fourni (« Jeu en loose : cartouche seule » ou « disque seul », « En boîte : … sans notice », « Complet en boîte (CIB) : boîte, notice et cartouche ») avec toujours « d'origine, testé(e) et fonctionnel(le) » accordé avec cartouche, disque ou console. Ligne 3 : l'état visible et un défaut s'il y en a (dont « plastique légèrement jauni » ou « plastique nettement jauni » si c'est le cas). Ligne 4 : « Remise en main propre ou envoi. » ${CERTAIN})
${consigneCarte()}`;
  let o = await claude([image(photo), { type: "text", text: consigne }], { max: 1500 });
  // Pas reconnu du premier coup (jeu récent, photo difficile) : on passe la main à un modèle plus fort, qui peut chercher sur le web.
  if (!o || !o.trouve) {
    o = await claude([image(photo), { type: "text", text: consigne + `

Un premier essai n'a pas reconnu l'objet. Regarde attentivement la photo (titre, logos, console, classification d'âge, références) ; si besoin, fais une recherche web pour confirmer le titre exact et la plateforme, surtout pour un jeu récent. Termine ta réponse par l'objet JSON demandé.` }], { max: 2500, timeout: 60000, web: 3, model: process.env.CLAUDE_MODEL_FORT || "claude-sonnet-5-5" })
      // recherche web indisponible sur le compte : même modèle fort, sans le web
      .catch(() => claude([image(photo), { type: "text", text: consigne }], { max: 1500, timeout: 45000, model: process.env.CLAUDE_MODEL_FORT || "claude-sonnet-5-5" }))
      .catch((e) => { console.error("IA secours", e.message); return null; });
  }
  if (!o || !o.trouve) throw new IaError("Je n'ai pas reconnu le jeu. Essaie une photo plus nette où l'on voit bien l'étiquette ou la boîte.");
  const carte = o.categorie === "cartes" ? champsCarte(o) : {};
  return {
    ...carte,
    titre: txt(o.titre, 160), categorie: parmi(o.categorie, CATEGORIES, "autres"), plateforme: txt(o.plateforme, 60), region: txt(o.region, 30),
    etat: parmi(o.etat, ETATS, ""), contenu: parmi(o.contenu, CONTENUS, ""), remarques: affirme(txt(o.remarques, 300)), particularites: (Array.isArray(o.particularites) ? o.particularites : []).map((x) => txt(x, 80)).filter(Boolean).slice(0, 5), annonce: txt(o.annonce, 100), description: affirme(txt(o.description, 1500)), cadre: cadreDe(o.cadre), rotation: [0, 90, 180, 270].includes(Number(o.rotation)) ? Number(o.rotation) : 0,
    ...(o.categorie === "cartes" ? { contenu: "", etat: parmi(o.etat, ETATS, "") || ETAT_LBC_DE_CARTE[carte.etatCarte] || "" } : {}),
    ...(o.categorie === "cartes" ? {} : jaunissement(o)),
  };
}
// Plastique jauni (cartouche, console, manette) : dit honnêtement dans les remarques et les particularités, et l'état ne peut pas être « comme neuf ».
function jaunissement(o) {
  const j = parmi(o.jauni, ["non", "leger", "net"], "non");
  if (j === "non") return { jauni: "non" };
  const mot = j === "net" ? "Plastique nettement jauni" : "Plastique légèrement jauni";
  let etat = parmi(o.etat, ETATS, "");
  if (j === "net" && (etat === "neuf" || etat === "tres_bon")) etat = "bon";
  if (j === "leger" && etat === "neuf") etat = "tres_bon";
  const rem = affirme(txt(o.remarques, 300));
  const part = (Array.isArray(o.particularites) ? o.particularites : []).map((x) => txt(x, 80)).filter(Boolean);
  return {
    jauni: j, etat,
    remarques: /jaun/i.test(rem) ? rem : [rem, mot.toLowerCase().replace(/^./, (c) => c.toUpperCase()) + " (vieillissement normal du plastique)."].filter(Boolean).join(" "),
    particularites: (part.some((x) => /jaun/i.test(x)) ? part : [...part, mot]).slice(0, 5),
  };
}

/* ===== Cartes Pokémon ===== */
const consigneCarte = () => `
Si c'est une carte Pokémon (règles qui remplacent celles des jeux pour "titre", "plateforme", "region", "contenu", "annonce" et "description") :
"categorie" vaut « cartes » ; "titre" est le nom imprimé sur la carte, dans sa langue s'il s'agit du français, sinon son nom français officiel (ex. « Dracaufeu », « Pikachu V », « Mew ex », « Lugia VSTAR ») ; "plateforme" est le nom français de l'extension (ex. « Set de base », « Jungle », « Évolutions Prismatiques », « Flammes Obsidiennes », « 151 »), déduit du symbole, du numéro et du style de la carte ; "region" est la langue de la carte (« Français », « Anglais », « Japonais », « Allemand »…) ; "contenu" vaut "".
Ajoute les clés :
"numero" (numéro imprimé en bas de la carte, ex. « 4/102 », « 199/165 », « TG05/TG30 », « SWSH020 » ; "" si illisible),
"rarete" (une parmi « Commune », « Peu commune », « Rare », « Holo rare », « Reverse », « Double rare », « Ultra rare », « Full art », « Illustration rare », « Illustration spéciale rare », « Hyper rare », « Secrète », « Promo » ; la carte est « Reverse » si tout le fond brille sauf l'illustration),
"edition" (« 1re édition » si le tampon Édition 1 est présent, « Shadowless » pour un Set de base anglais sans ombre portée, sinon ""),
"gradation" (si la carte est dans un boîtier gradé : société et note lues sur l'étiquette, ex. « PSA 9 », « PCA 9.5 », « CGC 10 », « Collect Aura 9 » ; sinon ""),
"etatCarte" (pour une carte non gradée : « mint » (parfaite), « near_mint » (quasi parfaite, au plus un minuscule point blanc), « excellent » (légère usure des bords), « good » (usure nette, petits plis absents), « light_played », « played » (pli, rayures marquées) ou « poor » ; "" si impossible à dire ou si la carte est gradée),
"etat" (déduit de etatCarte : mint → « neuf », near_mint ou excellent → « tres_bon », good → « bon », light_played ou played → « correct », poor → « pieces » ; carte gradée 9 ou plus → « neuf », sinon « tres_bon »),
"particularites" (options utiles à un acheteur, ex. « Carte mise en sleeve dès l'ouverture du booster », « Petit point blanc au dos », « Centrage décalé » ; [] sinon),
"annonce" (titre Le Bon Coin, 70 caractères au plus : nom, numéro, extension, rareté marquante, langue en abrégé FR, EN ou JP, puis « 1re édition » ou la note de gradation s'il y en a une ; ex. « Dracaufeu 4/102 Set de base Holo FR », « Pikachu Illustration rare 173/165 151 FR PSA 10 »),
"description" (exactement ce style, 4 lignes courtes, sans prix ni émoji :
« Carte Pokémon Dracaufeu 4/102, extension Set de base, holo rare, en français.
Carte authentique en état Near Mint : bords nets, surface holo sans rayure.
Envoi soigné sous sleeve et toploader, dans une enveloppe rigide.
Remise en main propre ou envoi. »
Ligne 1 : nom, numéro, extension, rareté, langue, édition. Ligne 2 : « Carte authentique » et l'état (ou « gradée PSA 9, boîtier intact »), avec ce que la photo montre des bords, des coins et de la surface. Ligne 3 : l'envoi protégé. Ligne 4 : « Remise en main propre ou envoi. » ${CERTAIN})`;

function champsCarte(o) {
  const etatCarte = parmi(o.etatCarte, ETATS_CARTE, "");
  return { numero: txt(o.numero, 20), rarete: txt(o.rarete, 40), edition: txt(o.edition, 40), gradation: txt(o.gradation, 30), etatCarte };
}

export async function cadrer(photo) {
  if (FAKE()) { checkPhoto(photo); return { x: 0.15, y: 0.1, w: 0.7, h: 0.8 }; }
  const o = await claude([image(photo), { type: "text", text: `Repère sur cette photo l'objet qu'un particulier veut vendre (jeu vidéo, console, accessoire…). Réponds uniquement par un objet JSON avec la clé ${CADRE_CONSIGNE}.` }], { max: 200, effort: "low" });
  return cadreDe(o && o.cadre);
}

/* Sens de la photo : où pointe le haut des lettres de l'étiquette ? (plus fiable que de demander un angle)
   haut → 0, gauche → 90 (quart de tour horaire), bas → 180, droite → 270. « incertain » : on ne tourne pas. */
const SENS = { haut: 0, gauche: 90, bas: 180, droite: 270 };
export async function endroit(photo, trace = null) {
  if (FAKE()) { checkPhoto(photo); const s = process.env.IA_FAKE_SENS || "haut"; return { sens: s, rotation: SENS[s] ?? 0, sur: s !== "incertain" }; }
  const o = await claude([image(photo), { type: "text", text: `Regarde le texte principal imprimé sur l'objet (titre de l'étiquette, logo, texte de la boîte ou de la carte). Le haut des lettres pointe vers quel bord de la photo ?
- « haut » : le texte se lit normalement, à l'endroit ;
- « gauche » : le texte se lit de bas en haut (la photo est couchée sur la gauche) ;
- « droite » : le texte se lit de haut en bas ;
- « bas » : le texte est à l'envers, tête en bas ;
- « incertain » : pas de texte lisible, ou tu hésites.
Réponds uniquement par un objet JSON : {"sens": "haut"}` }], { max: 300, timeout: 40000, brut: true, trace, effort: "low" });
  const s = String((o && o.sens) || (/"sens"\s*:\s*"(\w+)"/.exec((o && o._texte) || "") || [])[1] || "").toLowerCase();
  return s in SENS ? { sens: s, rotation: SENS[s], sur: true } : { sens: "incertain", rotation: 0, sur: false };
}

const LIB_ETAT = { neuf: "neuf", tres_bon: "très bon état", bon: "bon état", correct: "état correct", pieces: "pour pièces" };
const LIB_CONTENU = { seul: "jeu en loose (cartouche ou disque seul)", boite: "en boîte, sans notice", complet: "complet en boîte, CIB (boîte et notice)", boite_vide: "boîte seule, sans le jeu (code déjà utilisé ou disque absent)" };
export async function estimerCote(v) {
  if (v && v.categorie === "cartes") return estimerCoteCarte(v);
  const titre = txt(v.titre, 160);
  if (!titre) throw new IaError("Indique d'abord le nom du jeu.");
  const cible = { etat: parmi(v.etat, ETATS, ""), contenu: parmi(v.contenu, CONTENUS, "") };
  if (FAKE()) return coteCalculee({ resume: "Le prix dépend surtout de la boîte et de la notice, et de l'état de l'étiquette.", sources: ["https://www.ebay.fr/", "https://www.pricecharting.com/"],
    releves: [{ site: "eBay", titre: "Exemple de vente conclue", prix: 45, date: "2026-11-02", url: "https://www.ebay.fr/itm/1", type: "vente", etat: cible.etat || "tres_bon", contenu: cible.contenu || "complet" },
      { site: "eBay", titre: "Autre vente conclue", prix: 52, date: "2026-10-20", url: "https://www.ebay.fr/itm/2", type: "vente", etat: cible.etat || "tres_bon", contenu: cible.contenu || "complet" },
      { site: "Le Bon Coin", titre: "Annonce en ligne", prix: 60, date: "2026-11-10", url: "https://www.leboncoin.fr/ad/1", type: "annonce", etat: cible.etat || "tres_bon", contenu: cible.contenu || "complet" },
      { site: "PriceCharting", titre: "Cote moyenne", prix: 48, date: "2026-11-10", url: "https://www.pricecharting.com/", type: "cote", contenu: cible.contenu || "complet" }] }, cible);
  const quoi = [titre, txt(v.plateforme, 60), txt(v.region, 30), LIB_CONTENU[v.contenu], LIB_ETAT[v.etat]].filter(Boolean).join(", ");
  const o = await claude(`Relève les prix d'occasion en France, aujourd'hui, de cet objet vendu par un particulier : ${quoi}.
Cherche sur le web les prix réellement pratiqués : ventes conclues sur eBay France (objets vendus), annonces Le Bon Coin, et sites de cote comme PriceCharting ou Retroplace. Note pour chaque prix l'état et ce qui est fourni (loose, en boîte, complet), qui changent beaucoup le prix des jeux rétro. Ne calcule pas de prix conseillé : le calcul est fait ensuite à partir de tes relevés.
Réponds uniquement par un objet JSON avec les clés :
"releves" (3 à 8 prix précis réellement lus pendant ta recherche, de préférence des ventes conclues proches de l'objet : objets avec
  "site" (eBay, PriceCharting, Le Bon Coin…), "titre" (intitulé de la vente ou de la page),
  "prix" (en euros, converti si besoin, frais de port exclus),
  "type" ("vente" pour une vente conclue ou une annonce marquée vendue, "annonce" pour une annonce encore en ligne, "cote" pour une cote moyenne comme PriceCharting),
  "etat" (l'un de "neuf", "tres_bon", "bon", "correct", "pieces", ou "" si la page ne le dit pas),
  "contenu" (l'un de "seul" pour cartouche ou disque seul, "boite" pour en boîte sans notice, "complet" pour boîte et notice, "boite_vide", ou "" si la page ne le dit pas ; pour PriceCharting, « loose » = "seul", « CIB » = "complet"),
  "date" (AAAA-MM-JJ de la vente ou du relevé) et "url" (adresse exacte de la page où tu l'as lu, telle que donnée par la recherche ; n'invente jamais d'adresse)),
"resume" (une phrase en français, sans chiffres : ce qui fait varier le prix de ce jeu (boîte, notice, édition, état…)),
"sources" (2 à 4 adresses web consultées les plus utiles),
"bas" et "haut" (fourchette des prix de vente constatés, en euros, utilisée seulement si aucun relevé n'est exploitable).`, { web: 5, max: 3500, timeout: 70000 });
  // on ne garde que les liens qui sont vraiment sortis de la recherche web
  const c = coteCalculee(o, cible, o && o._vus);
  if (!c) throw new IaError("Pas assez de prix trouvés pour estimer la cote. Précise le nom ou la console.");
  return c;
}

/* Les relevés de l'IA passent par calculerCote (server/prix.mjs) : fourchette, prix probable, prix conseillé,
   prix pour vendre vite et texte « Méthode » sont tous tirés des mêmes nombres. */
export function coteCalculee(o, cible, vus) {
  if (!o || typeof o !== "object") return null;
  const c0 = coteDe({ ...o, conseille: o.conseille ?? o.bas ?? (o.releves && o.releves.length ? 0 : null) });
  if (!c0) return null;
  if (vus && vus.size) { c0.releves = c0.releves.filter((r) => vus.has(norme(r.url))); c0.sources = c0.sources.filter((u) => vus.has(norme(u))); }
  const k = calculerCote(c0.releves, cible);
  if (k) return coteDe({ ...c0, bas: k.bas, haut: k.haut, probable: k.probable, conseille: k.conseille, rapide: k.rapide, methode: k.methode, releves: k.releves });
  // aucun relevé vérifiable : on garde la fourchette de l'IA, en rendant les prix cohérents entre eux
  const bas = prix(o.bas), haut = prix(o.haut);
  if (bas == null || haut == null) return null;
  const lo = Math.min(bas, haut), hi = Math.max(bas, haut), probable = Math.round((lo + hi) / 2);
  return coteDe({ ...c0, bas: lo, haut: hi, probable, conseille: Math.min(Math.floor(hi), Math.round(probable * 1.1)), rapide: Math.round(Math.max(lo, probable * 0.85)) < Math.min(Math.floor(hi), Math.round(probable * 1.1)) ? Math.round(Math.max(lo, probable * 0.85)) : null,
    methode: `Aucun prix vérifiable n'a pu être relu : fourchette estimée par l'IA, de ${lo} à ${hi} €, milieu ${probable} €. À vérifier avant de publier.`, releves: [] });
}

/* Cote d'une carte Pokémon : la cote Cardmarket (TCGdex) sert d'ancre, puis le modèle relève les ventes conclues
   eBay et les annonces Le Bon Coin pour la même carte, la même langue et le même état (ou la même note de gradation). */
export async function estimerCoteCarte(v) {
  const titre = txt(v.titre, 160);
  if (!titre) throw new IaError("Indique d'abord le nom de la carte.");
  const c0 = { titre, plateforme: txt(v.plateforme, 60), region: txt(v.region, 30), numero: txt(v.numero, 20), rarete: txt(v.rarete, 40), edition: txt(v.edition, 40), gradation: txt(v.gradation, 30), etatCarte: parmi(v.etatCarte, ETATS_CARTE, "") };
  const ref = FAKE() && !process.env.TCGDEX_URL ? null : await carteTcgdex(c0).catch(() => null);
  const cm = ref && ref.cote;
  const releveCm = cm ? { site: "Cardmarket", titre: `Cote ${ref.nom} ${ref.numero} ${ref.extension}${cm.variante === "reverse" ? " (reverse)" : ""}, tendance du marché`, prix: cm.tendance ?? cm.moyenne30, date: cm.maj || new Date().toISOString().slice(0, 10), url: lienCardmarket(ref.nom, ref.extension) } : null;
  const quoi = [`carte Pokémon ${titre}`, c0.numero, c0.plateforme && `extension ${c0.plateforme}`, c0.rarete, c0.region && `en ${c0.region.toLowerCase()}`, c0.edition, c0.gradation ? `gradée ${c0.gradation}` : LIB_ETAT_CARTE[c0.etatCarte] && `état ${LIB_ETAT_CARTE[c0.etatCarte]}`].filter(Boolean).join(", ");
  if (FAKE()) {
    const base = releveCm ? releveCm.prix : 120;
    const c = coteDe({ bas: Math.round(base * 0.85), haut: Math.round(base * 1.2), conseille: rondCarte(base * 1.1), rapide: rondCarte(base * 0.95), resume: `Cote Cardmarket autour de ${Math.round(base)} € ; ventes eBay conclues proches.`, methode: "Cote Cardmarket en Near Mint, recoupée avec les ventes conclues eBay, puis prix affiché un peu au-dessus pour la négociation.", releves: [{ site: "eBay", titre: "Exemple de vente conclue", prix: base, date: "2026-11-02", url: "https://www.ebay.fr/" }], sources: ["https://www.ebay.fr/"] });
    if (releveCm) c.releves.unshift(releveCm);
    return { ...c, carte: ref ? { id: ref.id, extension: ref.extension, numero: ref.numero, rarete: ref.rarete, image: ref.image } : null, lot: (c.conseille ?? 99) < PRIX_MINI_SEULE };
  }
  const ancre = cm ? `Cote Cardmarket du jour (base TCGdex, toutes langues confondues, carte non gradée) : tendance ${cm.tendance ?? "?"} €, moyenne sur 30 jours ${cm.moyenne30 ?? "?"} €, plus bas ${cm.bas ?? "?"} € (version ${cm.variante}). Sers-t'en comme point de départ, puis ajuste pour la langue, l'édition, l'état ou la gradation.` : "";
  const o = await claude(`Estime la cote en France, aujourd'hui, de cette carte vendue par un particulier : ${quoi}.
${ancre}
Cherche sur le web les prix réellement pratiqués pour CETTE carte (même numéro, même extension, même langue${c0.gradation ? ", même société et même note de gradation" : ", non gradée, dans le même état"}) : ventes conclues sur eBay France (objets vendus), Cardmarket, annonces Le Bon Coin. Une carte française se vend en général un peu moins cher que l'anglaise et plus cher que l'allemande ; une 1re édition et une carte gradée PSA 9 ou 10 valent nettement plus.
Réponds uniquement par un objet JSON avec les clés :
"bas" et "haut" (fourchette des prix de vente constatés, en euros),
"conseille" (prix à afficher sur Le Bon Coin, un peu au-dessus du prix de vente probable pour laisser de la marge à la négociation),
"rapide" (prix pour vendre en quelques jours),
"resume" (une ou deux phrases en français : sur quoi tu t'appuies et ce qui fait varier le prix),
"methode" (une phrase en français : comment tu as calculé le prix conseillé à partir des relevés),
"releves" (3 à 6 prix précis réellement lus pendant ta recherche : objets avec "site", "titre", "prix" (en euros), "date" (AAAA-MM-JJ) et "url" (adresse exacte de la page lue ; n'invente jamais d'adresse)),
"sources" (2 à 4 adresses web consultées les plus utiles).`, { web: 5, max: 3500, timeout: 70000 }).catch((e) => { if (cm) return null; throw e; });
  let c = coteDe(o);
  if (c && o && o._vus && o._vus.size) { c.releves = c.releves.filter((r) => o._vus.has(norme(r.url))); c.sources = c.sources.filter((u) => o._vus.has(norme(u))); }
  // Recherche web vide ou indisponible : la cote Cardmarket seule suffit pour une carte non gradée.
  if (!c && cm && !c0.gradation) { const b = releveCm.prix; c = coteDe({ bas: cm.bas ?? b * 0.85, haut: Math.max(b, cm.moyenne30 ?? b) * 1.15, conseille: b * 1.1, rapide: b * 0.95, resume: `Cote Cardmarket du jour : ${b} € (tendance du marché, carte non gradée).`, methode: "Tendance Cardmarket, plus 10 % de marge pour la négociation." }); }
  if (!c) throw new IaError("Pas assez de prix trouvés pour estimer la cote. Précise le numéro de la carte ou son extension.");
  if (releveCm) c.releves = [releveCm, ...c.releves].slice(0, 6);
  c.conseille = rondCarte(c.conseille); c.rapide = rondCarte(c.rapide);
  return { ...c, carte: ref ? { id: ref.id, extension: ref.extension, numero: ref.numero, rarete: ref.rarete, image: ref.image } : null, lot: (c.conseille ?? 99) < PRIX_MINI_SEULE };
}
/* Plusieurs cartes sur une photo (classeur, pile étalée) : le modèle liste chaque carte et son emplacement,
   TCGdex donne la cote Cardmarket de chacune (sans recherche web : rapide et gratuit), et on sépare
   les cartes qui valent le coup d'être vendues seules de celles qui partiront en lot. */
const INVENTAIRE_FAKE = [
  { titre: "Dracaufeu", numero: "4/102", plateforme: "Set de base", region: "Français", rarete: "Holo rare", etatCarte: "excellent", cadre: { x: 0.02, y: 0.02, w: 0.3, h: 0.3 }, _cote: 120 },
  { titre: "Pikachu", numero: "58/102", plateforme: "Set de base", region: "Français", rarete: "Commune", etatCarte: "near_mint", cadre: { x: 0.35, y: 0.02, w: 0.3, h: 0.3 }, _cote: 1.2 },
  { titre: "Salamèche", numero: "46/102", plateforme: "Set de base", region: "Français", rarete: "Commune", etatCarte: "near_mint", cadre: { x: 0.68, y: 0.02, w: 0.3, h: 0.3 }, _cote: 0.8 },
  { titre: "Ronflex", numero: "11/64", plateforme: "Jungle", region: "Français", rarete: "Holo rare", etatCarte: "good", cadre: { x: 0.02, y: 0.35, w: 0.3, h: 0.3 }, _cote: 14 },
];
export async function inventaire(photo) {
  checkPhoto(photo);
  let l;
  if (FAKE()) l = INVENTAIRE_FAKE.map((x) => ({ ...x }));
  else {
    const o = await claude([image(photo), { type: "text", text: `Cette photo montre plusieurs cartes Pokémon (page de classeur, cartes étalées) qu'un particulier veut revendre. Liste CHAQUE carte dont la face est visible, de gauche à droite puis de haut en bas, 60 au plus.
Pour chaque carte : "titre" (nom français officiel), "numero" (numéro imprimé, ex. « 58/102 » ; "" si illisible), "plateforme" (extension en français, "" si incertaine), "region" (langue : « Français », « Anglais », « Japonais »…), "rarete" (« Commune », « Peu commune », « Rare », « Holo rare », « Reverse », « Ultra rare », « Full art », « Illustration rare », « Illustration spéciale rare », « Secrète », « Promo »), "edition" (« 1re édition » ou ""), "etatCarte" (« mint », « near_mint », « excellent », « good », « light_played », « played », « poor » ou ""), "cadre" (rectangle de la carte : {"x","y","w","h"} en fractions de la largeur et de la hauteur de l'image, origine en haut à gauche).
N'invente pas une carte dont tu ne vois que le dos. Réponds uniquement par un objet JSON : {"cartes": [ … ]}` }], { max: 8000, timeout: 90000, model: process.env.CLAUDE_MODEL_FORT || "claude-sonnet-5-5" });
    l = (o && Array.isArray(o.cartes) ? o.cartes : []).slice(0, 60);
  }
  l = l.map((c) => ({ titre: txt(c.titre, 160), numero: txt(c.numero, 20), plateforme: txt(c.plateforme, 60), region: txt(c.region, 30), rarete: txt(c.rarete, 40), edition: txt(c.edition, 40), etatCarte: parmi(c.etatCarte, ETATS_CARTE, ""), cadre: cadreLibre(c.cadre), _cote: c._cote })).filter((c) => c.titre);
  if (!l.length) throw new IaError("Je ne vois pas de carte sur cette photo. Essaie une photo bien éclairée, prise de face, sans reflet.");
  // Cotes en parallèle, 6 à la fois (TCGdex est gratuit, inutile de le surcharger).
  const out = [];
  for (let i = 0; i < l.length; i += 6) {
    out.push(...(await Promise.all(l.slice(i, i + 6).map(async (c) => {
      const ref = FAKE() ? null : await carteTcgdex(c).catch(() => null);
      const cote = FAKE() ? c._cote : ref && ref.cote ? ref.cote.tendance ?? ref.cote.moyenne30 : null;
      const { _cote, ...reste } = c;
      return { ...reste, plateforme: reste.plateforme || (ref && ref.extension) || "", numero: (ref && ref.numero) || reste.numero, cote, etat: ETAT_LBC_DE_CARTE[c.etatCarte] || "", seule: cote != null && cote >= PRIX_MINI_SEULE };
    }))));
  }
  return { cartes: out, lot: lotCartes(out.filter((c) => !c.seule)) };
}
// Cadre d'une carte dans une photo de groupe : petit, contrairement au cadre d'un objet seul.
function cadreLibre(c) {
  if (!c || typeof c !== "object") return null;
  const n = (v) => { const x = Number(v); return isFinite(x) ? Math.max(0, Math.min(1, x)) : NaN; };
  const o = { x: n(c.x), y: n(c.y), w: n(c.w), h: n(c.h) };
  return [o.x, o.y, o.w, o.h].some(isNaN) || o.w < 0.02 || o.h < 0.02 ? null : o;
}
// Cote d'une carte sans cote connue, pour estimer un lot (prix courants du « vrac » : quelques centimes la commune).
const COTE_VRAC = (c) => (/holo|reverse|ultra|full|illustration|secr|gold|promo|rare/i.test(c.rarete || "") && !/^peu commune$/i.test(c.rarete || "") ? 0.3 : 0.05);
const LANGUE_COURTE = { "français": "FR", francais: "FR", anglais: "EN", japonais: "JP", allemand: "DE", italien: "IT", espagnol: "ES" };
/* Annonce d'un lot de cartes : titre, description et prix (80 % de la somme des cotes, au moins 5 €). */
export function lotCartes(cartes) {
  const l = (Array.isArray(cartes) ? cartes : []).filter((c) => c && c.titre);
  if (!l.length) return null;
  const somme = l.reduce((n, c) => n + (prix(c.cote) ?? COTE_VRAC(c)), 0);
  const holo = l.filter((c) => /holo/i.test(c.rarete || "") && !/reverse/i.test(c.rarete || "")).length, rev = l.filter((c) => /reverse/i.test(c.rarete || "")).length;
  const langues = [...new Set(l.map((c) => LANGUE_COURTE[String(c.region || "").toLowerCase()]).filter(Boolean))];
  const dont = [holo && `${holo} holo`, rev && `${rev} reverse`].filter(Boolean).join(" et ");
  const titre = `Lot de ${l.length} carte${l.length > 1 ? "s" : ""} Pokémon${langues.length === 1 ? " " + langues[0] : ""}${dont ? " dont " + dont : ""}`.slice(0, 100);
  const notables = l.filter((c) => !/^(commune|peu commune)$/i.test(c.rarete || "")).slice(0, 12);
  const nomC = (c) => [c.titre, c.numero].filter(Boolean).join(" ") + (c.rarete ? ` (${c.rarete.toLowerCase()})` : "");
  const desc = [
    `Lot de ${l.length} carte${l.length > 1 ? "s" : ""} Pokémon${langues.length === 1 ? ` en ${({ FR: "français", EN: "anglais", JP: "japonais", DE: "allemand", IT: "italien", ES: "espagnol" })[langues[0]]}` : ""}, ${l.length > 1 ? "toutes authentiques" : "authentique"}.`,
    notables.length ? `Dont : ${notables.map(nomC).join(", ")}${l.filter((c) => !/^(commune|peu commune)$/i.test(c.rarete || "")).length > notables.length ? "…" : ""}.` : "",
    l.length <= 25 ? `Cartes : ${l.map((c) => [c.titre, c.numero].filter(Boolean).join(" ")).join(", ")}.` : "La liste complète se voit sur les photos.",
    "Envoi soigné, cartes protégées, dans une enveloppe rigide.",
    "Remise en main propre ou envoi.",
  ].filter(Boolean).join("\n");
  return { titre, description: desc, prix: Math.max(PRIX_MINI_SEULE, rondCarte(somme * 0.8)), somme: Math.round(somme * 100) / 100, n: l.length };
}
// En dessous de ce prix, une carte se vend mieux dans un lot qu'à l'unité (frais d'envoi, temps passé).
export const PRIX_MINI_SEULE = 5;
// Prix ronds pour les cartes : à l'euro sous 10 €, puis multiples de 5, puis de 10 à partir de 100 €.
export const rondCarte = (x) => { if (x == null || !isFinite(x)) return null; if (x < 10) return Math.max(1, Math.round(x)); return rond(x); };

// Galerie : une courte légende par photo (ce qu'elle montre, défaut visible), dans l'ordre, pour la description « Photo 1 : … ».
/* Pas d'à-peu-près dans une annonce : on affirme ce que la photo montre, sinon on n'en parle pas.
   Filet de sécurité si le modèle glisse malgré la consigne un « apparemment », « semble », « visible »… */
export function affirme(t) {
  // Un passage incertain (« apparemment propre », « probablement testée ») ne devient pas une affirmation : on le retire.
  const DOUTE = /\b(?:apparemment|probablement|sans doute|a priori|à priori|vraisemblablement|semble-t-il|en apparence|il semble|semble|semblent|a l'air|ont l'air|para[iî]t|paraissent|peut-être|on dirait)\b/i;
  const ligne = (l) => {
    const m = /^([^:\n]{1,40}?)\s*:\s*(.*)$/.exec(l), tete = m ? m[1] : "", corps = m ? m[2] : l;
    const fin = /[.!]\s*$/.test(corps) ? "." : "";
    let parts = corps.replace(/[.!]\s*$/, "").split(/\s*,\s*/).filter((x) => x && !DOUTE.test(x));
    let c = parts.join(", ").replace(/\bvisiblement\s+/gi, "");
    c = c.replace(/\b((?:pas de|aucun|aucune|sans)\s+[\wÀ-ÿ'’-]+(?:\s+(?:ni|ou)\s+[\wÀ-ÿ'’-]+)*)\s+(?:visibles?|apparents?|apparentes?)\b/gi, "$1")
         .replace(/\b(défauts?|rayures?|chocs?|cassures?|traces?)\s+(?:visibles?|apparents?|apparentes?)\b/gi, "$1").trim();
    if (!c) return "";
    c = c.charAt(0).toUpperCase() + c.slice(1);
    return (tete ? tete + " : " + c.charAt(0).toLowerCase() + c.slice(1) : c) + fin;
  };
  return String(t || "").split("\n").map((l) => (l.trim() ? ligne(l.trim()) : "")).filter((l, i, a) => l || (i > 0 && a[i - 1])).join("\n").trim();
}
const CERTAIN = "Affirme seulement ce que la photo montre avec certitude ; n'emploie jamais « apparemment », « semble », « visiblement », « probablement », « a priori » ni « visible » ou « apparent » : si tu n'es pas sûr d'un point, n'en parle pas.";

const carte0 = (v) => v.categorie === "cartes";
// Retire d'une légende les mentions de jaunissement (« plastique légèrement jauni »…), en gardant le reste.
const sansJauni = (l) => {
  if (!/jaun/i.test(l)) return l;
  const [vue, ...reste] = l.split(" : ");
  const garde = (reste.length ? reste.join(" : ") : vue).split(/,\s*/).filter((c) => c && !/jaun/i.test(c));
  return reste.length ? vue + (garde.length ? " : " + garde.join(", ") : "") : garde.join(", ");
};
// Coupe un texte à n caractères sur une fin de mot, sans parenthèse ni ponctuation laissée en plan.
const court = (t, n) => { const v = t.split(/[,;(]/)[0].trim(); let c = t.length <= n ? t : v.length >= 3 && v.length <= n ? v : t.slice(0, n).replace(/\s+\S*$/, ""); c = c.replace(/\([^)]*$/, "").replace(/[\s,;:(/]+$/, ""); return c; };
// Jaunissement vu sur l'ensemble des photos, avec un modèle plus attentif et un effort normal.
async function jauniEnsemble(photos, quoi, trace) {
  const o = await claude([...photos.slice(0, 6).map(image), { type: "text", text: `Ces ${Math.min(photos.length, 6)} photos (dans l'ordre, numérotées à partir de 1) montrent ${quoi}, vendu d'occasion. Une seule question : le plastique a-t-il jauni ?
Le plastique gris d'origine (Nintendo 64, Super Nintendo, Game Boy, PlayStation) est un gris neutre, presque sans couleur ; jauni, il tire sur le crème, le beige ou l'orangé. Attention aux faux positifs, bien plus gênants qu'un oubli : une lumière chaude (ampoule, soleil couchant) ou le reflet d'une table en bois, d'un mur ou de la main donne une teinte crème à un plastique gris parfaitement sain, surtout sur la face tournée vers ce reflet, et l'ombre le rend plus foncé. Ce n'est PAS du jaunissement.
Ne conclus au jaunissement que si une zone du même plastique est nettement plus jaune ou beige qu'une autre zone éclairée de la même façon, et que ça se retrouve au même endroit sur plusieurs photos. Ignore l'étiquette, le bois, la peau. Dans le doute, réponds « non ».
Réponds uniquement par un objet JSON : {"jauni": "non", "certitude": "forte", "photos": [], "ou": ""}, où "jauni" vaut exactement "non", "leger" ou "net", "certitude" vaut "forte", "moyenne" ou "faible", "photos" liste les numéros des photos où ça se voit et "ou" dit où en 2 à 5 mots, commençant par « sur » (par exemple « sur les tranches »).` }], { max: 1500, timeout: 60000, brut: true, trace, model: process.env.CLAUDE_MODEL_FORT || "claude-sonnet-5-5" });
  const b = (o && o._texte) || "";
  const jauni = parmi((o && o.jauni) || (/"jauni"\s*:\s*"(non|leger|net)"/.exec(b) || [])[1], ["non", "leger", "net"], "non");
  const ph = (Array.isArray(o && o.photos) ? o.photos : []).map(Number).filter((n) => n >= 1 && n <= photos.length);
  const certitude = parmi((o && o.certitude) || (/"certitude"\s*:\s*"(forte|moyenne|faible)"/.exec(b) || [])[1], ["forte", "moyenne", "faible"], "faible");
  return { jauni, certitude, photos: [...new Set(ph)], ou: court(txt(o && o.ou, 300), 60) };
}
export async function legender(photos, v = {}, trace = null, progres = () => {}) {
  const l = (Array.isArray(photos) ? photos : []).slice(0, 12);
  if (!l.length) throw new IaError("Ajoute d'abord des photos.");
  l.forEach(checkPhoto);
  if (FAKE()) { for (let i = 0; i < l.length; i++) { progres({ etape: "photo", photo: i + 1, n: l.length }); await new Promise((ok) => setTimeout(ok, +process.env.IA_FAKE_MS || 0)); } return { legendes: l.map((_, i) => (i === 0 ? "Vue de face, étiquette en bon état" : "Détail, sans défaut")), jaunis: l.map(() => (process.env.IA_FAKE_JAUNI && !carte0(v) ? process.env.IA_FAKE_JAUNI : "non")) }; }
  const carte = v.categorie === "cartes";
  const quoi = carte ? ["la carte Pokémon " + (txt(v.titre, 160) || ""), txt(v.numero, 20), txt(v.plateforme, 60)].filter(Boolean).join(", ")
    : [txt(v.titre, 160), txt(v.plateforme, 60)].filter(Boolean).join(", ") || "un jeu vidéo d'occasion";
  const vues = carte ? "« Recto », « Verso », « Coin supérieur gauche », « Bord droit », « Surface holo », « Étiquette de gradation », « Boîtier gradé, dos »…"
    : "« Face avant » = côté avec la grande étiquette illustrée du jeu ; « Dos » = côté opposé, avec la petite étiquette de mentions légales ; « Connecteur », « Tranche gauche », « Tranche droite », « Dessus », « Boîte, face avant », « Boîte, dos », « Notice »…";
  const defauts = carte ? "point blanc sur un bord, coin émoussé, rayure sur l'holo, pli, centrage décalé…" : "rayure, étiquette décollée, coin abîmé, plastique jauni (un gris ou un blanc d'origine qui tire sur le jaune ou le beige, sans que la lumière de la photo l'explique : « plastique légèrement jauni » ou « plastique nettement jauni »)…";
  // Une requête par photo (en parallèle) : la légende ne peut pas être attribuée à une autre photo.
  const une = async (p) => {
    const o = await claude([image(p), { type: "text", text: `Cette photo montre ${quoi}, vendu d'occasion sur Le Bon Coin. Écris une légende courte en français (12 mots au plus) pour CETTE photo : d'abord la vue montrée, à choisir d'après ce qu'on voit réellement (${vues}), puis « : » et l'état de ce qui est montré, ou le défaut s'il y en a un (${defauts}). ${CERTAIN} Pas de point final.
${carte ? "" : `
Regarde aussi la couleur du plastique (cartouche, console, manette) : un gris ou un blanc d'origine qui tire sur le jaune, le beige ou l'orangé a jauni avec le temps ; le gris d'origine de la Nintendo 64, de la Super Nintendo ou de la Game Boy est un gris neutre, presque sans couleur. Une lumière chaude ou le reflet du bois, d'un mur ou de la main donne une teinte crème à un plastique sain : ce n'est pas du jaunissement. Réponds « leger » ou « net » seulement si une zone du plastique est nettement plus jaune qu'une autre zone éclairée pareil ; dans le doute, ou si l'objet n'est pas en plastique, « non ». Ne parle pas de jaunissement dans la légende : réponds-le seulement dans "jauni".`}
Réponds uniquement par un objet JSON, sans aucun texte avant ni après : ${carte ? `{"legende": "…"}` : `{"legende": "…", "jauni": "non"}, où "jauni" vaut exactement "non", "leger" ou "net"`}` }], { max: 800, timeout: 45000, brut: true, trace, effort: "low" });
    // Réponse mal formée : on récupère quand même la légende et le jaunissement dans le texte brut
    const brut = (o && o._texte) || "";
    const leg = affirme(txt((o && o.legende) || (/"legende"\s*:\s*"([^"]{2,200})"/.exec(brut) || [])[1], 200)).replace(/\.$/, "");
    const j = carte ? "non" : parmi((o && o.jauni) || (/"jauni"\s*:\s*"(non|leger|net)"/.exec(brut) || [])[1], ["non", "leger", "net"], /nettement jauni/i.test(leg) ? "net" : /jauni/i.test(leg) ? "leger" : "non");
    // Le jaunissement n'est écrit qu'après l'avis d'ensemble (plus fiable) : on l'ôte de la légende photo par photo.
    return { legende: sansJauni(leg).slice(0, 200), jauni: j };
  };
  // Deux requêtes à la fois au plus, et jusqu'à 3 essais par photo (limite de débit, service surchargé, réponse vide) :
  // six requêtes simultanées dépassaient la limite de l'API, seule la première photo était décrite.
  const out = new Array(l.length);
  let suivant = 0, jg = null;
  const ouvrier = async () => {
    while (suivant < l.length) {
      const i = suivant++;
      progres({ etape: "photo", photo: i + 1, n: l.length });
      let r = null, err = "";
      for (let essai = 0; essai < 3 && !(r && r.legende); essai++) {
        if (essai) await new Promise((ok) => setTimeout(ok, 1500 * essai * essai));
        try { r = await une(l[i]); if (!r.legende) err = "réponse vide"; } catch (e) { err = e.statut ? "erreur " + e.statut : "délai dépassé"; }
      }
      if (!(r && r.legende)) console.error("IA : légende de la photo", i + 1, "impossible :", err);
      out[i] = r && r.legende ? { ...r, erreur: "" } : { legende: "", jauni: "non", erreur: err };
    }
  };
  await Promise.all([ouvrier(), ouvrier(), carte ? null : (progres({ etape: "jauni", n: l.length }), jauniEnsemble(l, quoi, trace)).then((g) => { jg = g; }, () => {})]);
  // Décision : seulement si l'avis d'ensemble (toutes les photos, modèle attentif) est sûr de lui. Dans le doute, rien n'est signalé :
  // une lumière chaude ou le reflet du bois faisait passer des cartouches saines pour jaunies.
  const oui = jg && jg.jauni !== "non" && (jg.certitude === "forte" || (jg.jauni === "net" && jg.certitude === "moyenne"));
  const votes = out.map((x, i) => (x.legende && x.jauni !== "non" ? i + 1 : 0)).filter(Boolean);
  for (const x of out) if (x.legende) x.jauni = "non";
  if (oui) {
    const cibles = [...new Set([...jg.photos, ...votes])].filter((n) => out[n - 1] && out[n - 1].legende);
    (cibles.length ? cibles : [out.findIndex((x) => x.legende) + 1]).forEach((n, k) => {
      const x = out[n - 1];
      x.jauni = jg.jauni;
      // On retire ce que la légende affirmait du plastique (« plastique gris », « sans défaut »…) pour ne pas se contredire.
      const [vue, ...reste] = x.legende.split(" : ");
      const garde = reste.join(" : ").split(/,\s*/).filter((c) => c && !/plastique|défaut|rayure|\bgris\b|\buni\b|impeccable|parfait/i.test(c));
      const ou = k === 0 && jg.ou ? " " + (/^(sur|aux?|à|en|dans)\b/i.test(jg.ou) ? jg.ou : "(" + jg.ou + ")") : "";
      const dit = (jg.jauni === "net" ? "plastique nettement jauni" : "plastique légèrement jauni") + ou;
      x.legende = (reste.length ? vue + " : " + [...garde, dit].join(", ") : (garde.length ? x.legende + ", " : "") + dit).slice(0, 200);
    });
  }
  if (!out.some((x) => x.legende)) throw new IaError("Je n'ai pas pu décrire les photos (" + (out[0].erreur || "erreur") + "), réessaie.");
  return { legendes: out.map((x) => x.legende), jaunis: out.map((x) => x.jauni), erreurs: out.map((x) => x.erreur) };
}

/* ===== Réponse aux acheteurs (extension, messagerie Le Bon Coin) =====
   La conversation est le texte visible de la page de messagerie, copié par l'extension : on demande au modèle
   de retrouver le dernier message de l'acheteur et de proposer trois réponses du vendeur, sympas et diplomates. */
// Prix ronds : multiples de 5, de 10 à partir de 100 € (vers le haut pour un plancher, au plus proche sinon).
export const rond = (x, haut = false) => { if (x == null || !isFinite(x)) return null; const pas = x >= 100 ? 10 : 5; return Math.max(pas, (haut ? Math.ceil : Math.round)(x / pas) * pas); };
// Toujours au moins un smiley dans une réponse aux acheteurs.
export const smiley = (t) => (!t || /\p{Extended_Pictographic}/u.test(t) ? t : t.replace(/\s*[.!]?\s*$/, (f) => (f.trim() === "!" ? " ! 🙂" : " 🙂")));
// Contenu d'un lot vu dans la messagerie (« Conker's Bad Fur Day Nintendo 64 PAL EUR loose », …) : on retrouve chaque
// jeu parmi les annonces du vendeur (mots du titre en commun) pour donner au modèle son prix, son état et son contenu.
const VIDES = new Set("the and les des une pour avec sans pal eur ntsc jeu jeux video nintendo sega sony console loose boite cartouche notice complet".split(" "));
const mots = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter((m) => m.length >= 3 && !VIDES.has(m));
export function contenuLot(articles, autres = []) {
  return (Array.isArray(articles) ? articles : []).slice(0, 10).map((t) => txt(t, 160)).filter(Boolean).map((t) => {
    const a = new Set(mots(t));
    let meilleur = null, score = 0;
    for (const x of Array.isArray(autres) ? autres : []) {
      const m = mots(x.nom || x.titre); if (!m.length) continue;
      const s = m.filter((w) => a.has(w)).length / m.length;
      if (s > score) { score = s; meilleur = x; }
    }
    return { titre: t, annonce: score >= 0.6 ? meilleur : null };
  });
}
// Coupe un texte sur un mot entier (avec « … »), jamais au milieu d'un mot.
const phrase = (t, n) => { const s = txt(t, 2000); if (s.length <= n) return s; const c = s.slice(0, n - 1); return c.slice(0, Math.max(c.lastIndexOf(" "), n * 0.6)).replace(/[\s,;:.-]+$/, "") + "…"; };
// Offre d'un acheteur face au prix affiché : écart en %, plancher (85 %), et contre-offre conseillée (≈ 95 % du prix,
// jamais sous le plancher, toujours au-dessus de l'offre). « basse » : sous le plancher.
export function analyseOffre(prixAffiche, offre) {
  const px = prix(prixAffiche), of = prix(offre);
  if (px == null || of == null || px <= 0) return null;
  const ecart = Math.round(((px - of) / px) * 100), plancher = rond(px * 0.85, true);
  let contre = Math.max(plancher, rond(px * 0.95));
  if (contre >= px) contre = px;
  return { prix: px, offre: of, ecart, plancher, contre, basse: of < plancher, acceptable: of >= plancher };
}
const OUTIL_REPONSES = {
  name: "proposer_reponses",
  description: "Propose les réponses du vendeur à l'acheteur.",
  schema: {
    type: "object",
    properties: {
      resume: { type: "string", description: "Ce que demande l'acheteur, en une phrase courte (25 mots au plus)." },
      intention: { type: "string", description: "Un mot-clé (offre_basse, disponibilite, envoi…)." },
      reponses: {
        type: "array", minItems: 1, maxItems: 3,
        items: {
          type: "object",
          properties: {
            approche: { type: "string", enum: ["contre_offre", "ferme", "couper_court", "accepter", "au_revoir", "info"] },
            titre: { type: "string", description: "2 à 4 mots." },
            texte: { type: "string", description: "La réponse, prête à envoyer." },
            gras: { type: "array", items: { type: "string" }, description: "2 à 4 passages clés copiés mot pour mot du texte : prix, décision, mode de remise ou d'envoi, date…" },
          },
          required: ["approche", "titre", "texte"],
        },
      },
    },
    required: ["resume", "reponses"],
  },
};
export async function repondre(conversation, a = {}, autres = [], contexte = {}) {
  const conv = txt(conversation, 5000);
  const lot = contexte && contexte.lot && prix(contexte.lot.prix) != null ? `L'acheteur négocie un LOT de ${Math.min(20, Number(contexte.lot.n) || 2)} articles au prix total de ${prix(contexte.lot.prix)} € (prix plancher du lot : ${rond(prix(contexte.lot.prix) * 0.85, true)} €).` : "";
  const articles = contexte && contexte.lot ? contenuLot(contexte.lot.articles, autres) : [];
  const somme = articles.length && articles.every((x) => x.annonce && prix(x.annonce.prix) != null) ? articles.reduce((n, x) => n + prix(x.annonce.prix), 0) : null;
  const detailLot = articles.length ? `Contenu exact du lot (appuie-toi sur CES jeux, cite-les par leur nom, et sur leur état et ce qui est inclus : loose, boîte, notice) :\n${articles.map((x) => `- ${x.titre}${x.annonce ? ` → dans ses annonces : ${prix(x.annonce.prix) != null ? `${prix(x.annonce.prix)} €` : "prix non renseigné"}${LIB_ETAT[x.annonce.etat] ? `, ${LIB_ETAT[x.annonce.etat]}` : ""}${LIB_CONTENU[x.annonce.contenu] ? `, ${LIB_CONTENU[x.annonce.contenu]}` : ""}` : ""}`).join("\n")}${somme != null ? `\nSomme des prix séparés : ${somme} €.` : ""}` : "";
  // L'offre officielle (« Voici l'offre de mm : 140 €. »), envoyée par l'extension ou relue dans la conversation.
  const mOffre = /offre de [^:\n]{1,60}:\s*(\d[\d\s\u00a0\u202f]{0,6})\s?€/gi; let vueOffre = null, mo;
  while ((mo = mOffre.exec(String(conversation || "")))) vueOffre = prix(mo[1].replace(/[\s\u00a0\u202f]/g, ""));
  const montantOffre = contexte && prix(contexte.offre) != null ? prix(contexte.offre) : vueOffre;
  const ana = !(contexte && contexte.lot) ? analyseOffre(a.prix, montantOffre) : null;
  const offre = montantOffre != null ? `Offre officielle reçue par Le Bon Coin : ${montantOffre} €.${ana ? ` Elle est ${ana.ecart > 0 ? `${ana.ecart} % sous` : "au niveau du"} prix affiché (${ana.prix} €) ; plancher : ${ana.plancher} €. ${ana.basse ? `C'EST UNE OFFRE TROP BASSE : ne l'accepte pas (pas de réponse « accepter »). Remercie, rappelle gentiment la valeur, et propose ${ana.contre} € dans la contre-offre (jamais moins de ${ana.plancher} €).` : "Elle est acceptable : une des réponses peut l'accepter (bouton « Accepter » de Le Bon Coin)."}` : ""}` : "";
  const qui = txt(contexte && contexte.acheteur, 40).replace(/[^\p{L}\p{N}' .-]/gu, "");
  // Ce que le vendeur veut répondre, en quelques mots (« dis-lui que je peux venir samedi pour 10 € de plus »).
  const consigne = txt(contexte && contexte.consigne, 400).replace(/"""/g, "");
  // Le vendeur a écrit le dernier message et l'acheteur n'a pas répondu : on complète, sans remercier ni resaluer.
  const suite = !!(consigne && contexte && contexte.suite);
  const precedentes = consigne && Array.isArray(contexte.precedentes) ? contexte.precedentes.slice(0, 3).map((x) => "- " + txt(x, 500).replace(/"""/g, "")).filter((x) => x.length > 3).join("\n") : "";
  if (conv.length < 5) throw new IaError("Je ne trouve pas de message à analyser dans cette conversation.");
  // Ce que le vendeur a déjà écrit dans cette conversation (bulles de droite) : à ne pas répéter.
  const deja = Array.isArray(contexte && contexte.mesMessages) ? contexte.mesMessages.slice(-4).map((x) => "- " + txt(x, 600).replace(/"""/g, "").replace(/\s*\n\s*/g, " ")).filter((x) => x.length > 5).join("\n") : "";
  const px = prix(a.prix);
  const fiche = [
    a.titre ? `Annonce : ${txt(a.titre, 160)}` : "", a.plateforme ? `${a.categorie === "cartes" ? "Extension" : "Console"} : ${txt(a.plateforme, 60)}` : "",
    a.categorie === "cartes" ? [a.numero && `Numéro : ${txt(a.numero, 20)}`, a.region && `Langue : ${txt(a.region, 30)}`, a.gradation ? `Gradée : ${txt(a.gradation, 30)}` : LIB_ETAT_CARTE[a.etatCarte] && `État collectionneur : ${LIB_ETAT_CARTE[a.etatCarte]}`].filter(Boolean).join("\n") : "",
    LIB_ETAT[a.etat] ? `État : ${LIB_ETAT[a.etat]}` : "", LIB_CONTENU[a.contenu] ? `Contenu : ${LIB_CONTENU[a.contenu]}` : "",
    px != null ? `Prix affiché : ${px} € (prix plancher conseillé : ${rond(px * 0.85, true)} €, ne jamais proposer moins)` : "",
    a.description ? `Description publiée : ${txt(a.description, 1200)}` : "",
  ].filter(Boolean).join("\n");
  const catalogue = (Array.isArray(autres) ? autres : []).slice(0, 40).map((x) => `- ${txt(x.titre, 120)}${prix(x.prix) != null ? ` : ${prix(x.prix)} €` : ""}${LIB_ETAT[x.etat] ? `, ${LIB_ETAT[x.etat]}` : ""}`).join("\n");
  if (FAKE() && consigne) return { resume: "Réponse rédigée d'après ta consigne.", intention: "consigne",
    reponses: [{ approche: "info", titre: "Ta réponse", texte: suite ? `Petite précision : ${consigne} 🙂` : `Bonjour, merci pour votre message ! ${consigne} 🙂` }] };
  if (FAKE() && /pas donner suite|ne donnerai pas suite|merci pour nos échanges/i.test(conv)) return { resume: "L'acheteur ne donne pas suite et clôt la discussion.", intention: "fin",
    reponses: [{ approche: "au_revoir", titre: "Au revoir", texte: "Merci à vous, bonne soirée 🙂" }, { approche: "au_revoir", titre: "Chaleureux", texte: "Merci pour l'échange Garnier, bonne soirée à vous 🙂" }, { approche: "au_revoir", titre: "Porte ouverte", texte: "Merci Garnier, bonne soirée ! N'hésitez pas si vous changez d'avis 🙂" }] };
  if (FAKE()) return { ...(ana ? { offre: ana } : {}), resume: "L'acheteur propose 20 €, bien en dessous du prix.", intention: "offre_basse",
    reponses: [
      { approche: "contre_offre", titre: "Contre-proposition", texte: "Bonjour, merci pour votre proposition ! 20 €, c'est un peu loin de la valeur du jeu. Je peux vous le faire à 42 € si ça vous va 🙂", gras: ["un peu loin de la valeur", "42 €"] },
      { approche: "ferme", titre: "Prix ferme", texte: "Bonjour, merci pour votre message ! Le prix est déjà calé sur la cote actuelle, je préfère le garder tel quel 🙂" },
      { approche: "couper_court", titre: "Couper court", texte: "Bonjour, merci pour votre proposition ! Je pense qu'on ne va pas réussir à s'entendre sur ce prix, je préfère en rester là. Bonne recherche à vous 🙂" },
    ] };
  const carte = a.categorie === "cartes";
  const conseilsCarte = carte ? `
Particularités des cartes Pokémon :
- envoi : la carte part sous sleeve et toploader, dans une enveloppe rigide (lettre suivie conseillée au-delà de 20 €) ;
- authenticité : la carte est authentique ; pour une carte de valeur, propose une photo supplémentaire (dos, bords, carte en lumière rasante) plutôt qu'un long discours ;
- état : parle avec les mots des collectionneurs (Near Mint, bords, coins, surface, centrage) sans rien ajouter à la fiche ;
- un acheteur qui demande une photo « avec son pseudo sur un papier » est une demande normale : accepte volontiers.
` : "";
  const consigneIA = `Tu aides un particulier qui vend ${carte ? "une carte Pokémon" : "un jeu vidéo"} d'occasion sur Le Bon Coin à répondre à un acheteur.${conseilsCarte}

Ce que vend le vendeur :
${fiche || "(pas de fiche, reste général sur l'objet)"}

${catalogue ? `Tous ses jeux en vente (pour reconnaître une offre groupée sur plusieurs annonces) :\n${catalogue}\n\n` : ""}${[qui ? `Prénom ou pseudo de l'acheteur : ${qui}` : "", lot, detailLot, offre].filter(Boolean).join("\n")}${qui || lot || offre ? "\n\n" : ""}Texte de la page de messagerie (copié tel quel ; il peut contenir des menus, des dates et les messages des deux personnes, le plus récent en bas) :
"""
${conv}
"""

${deja ? `Messages DÉJÀ envoyés par le vendeur dans cette conversation (du plus ancien au plus récent) :
${deja}

` : ""}Retrouve le DERNIER message de l'acheteur et ce qu'il veut (disponibilité, offre de prix, dernier prix, échange, lot, photos, état, envoi, main propre, paiement, relance…).
SI L'ACHETEUR SE RETIRE (il dit qu'il ne donnera pas suite, que c'est trop cher pour lui, qu'il laisse tomber, qu'il a trouvé ailleurs, ou il remercie pour l'échange et salue pour clore) : la négociation est finie. Mets "intention": "fin" et propose uniquement trois au revoir, approche « au_revoir » : une ou deux phrases courtes et cordiales (merci pour l'échange, bonne soirée ou bonne journée, éventuellement « n'hésitez pas si vous changez d'avis »), sans prix, sans contre-offre, sans argument, sans relancer, et sans reprendre AUCUN sujet déjà abordé (ni budget, ni prix, ni état, ni rareté, ni « je comprends »…) : juste un merci et une salutation. Trois variantes : une très courte, une chaleureuse, une qui laisse la porte ouverte.
${consigne ? "" : `Propose trois réponses du vendeur, prêtes à envoyer, qui vont plus ou moins loin, pour qu'il choisisse sa stratégie. Quand c'est une négociation (offre, lot, « dernier prix ? », relance insistante), les trois doivent couvrir :
  1. « contre_offre » : on reste ouvert et on propose un autre prix (ou un prix de lot), jamais sous le plancher ;
  2. « ferme » : on maintient le prix, gentiment, en expliquant la valeur ;
  3. « couper_court » : on clôt la discussion poliment et sans vexer (« on ne va pas réussir à s'entendre, bonne recherche ») ;
sinon (question, disponibilité, envoi…), trois formulations utiles et différentes, avec l'approche « info ». Si l'offre est raisonnable (au-dessus du plancher), l'une peut être « accepter ».
`}Pour chaque réponse :
- en français, vouvoiement, ton sympa, chaleureux et diplomate, jamais sec ni moralisateur ;
- écris comme un vrai passionné de retro qui parle à un autre, spontané et naturel, pas comme un service client : phrases simples, un peu d'enthousiasme, une touche d'humour léger si ça colle ; bannis les formules toutes faites (« c'est une belle attention », « je comprends tout à fait », « correspond au marché actuel », « n'hésitez pas à revenir vers moi », « je reste à votre disposition », « nous ne parvenons pas à nous entendre ») ; exemple du ton voulu face à « c'est pour mon fils » avec une offre trop basse : « Ah c'est chouette que votre fils s'intéresse à Conker, c'est un vrai culte de la N64 ! Par contre 140 €, je ne peux pas, je peux descendre à 180 € 🙂 » (adapte au jeu de la fiche, ne recopie pas cet exemple) ;
- toujours au moins un smiley sympa, du genre 🙂 (ou 😊, 👍 selon le cas), deux au plus, jamais moqueur ;
- tiens compte de TOUT l'historique : c'est la suite d'une discussion, pas un premier message. Ne répète jamais un argument que le vendeur a déjà donné (origine, testé, recherché, étiquette propre, boîte complète, prix calés sur le marché…), ne présente pas à nouveau l'objet, ne redis pas qu'il est rare ; réponds seulement au dernier message, avec du neuf qui fait avancer (une décision, un prix, une condition) ; reste cohérent avec les prix que le vendeur a déjà proposés ;
- 1 à 3 phrases courtes (plus court encore quand la discussion est déjà engagée) ; appelle l'acheteur par son prénom ou pseudo (« Bonjour Garnier, … » ou « Merci Garnier ! ») ; « Bonjour » ou « Bonsoir » seulement si le vendeur n'a pas encore salué dans la conversation ; sinon commence directement (« Merci Garnier, … ») ;
- n'invente rien sur l'objet au-delà de la fiche ; ne promets pas de date ou de frais précis ;
- prix ronds uniquement (multiples de 5 €, de 10 € à partir de 100 €), jamais de prix comme 172 € ;
- un « Offre reçue … Message automatique leboncoin » est l'offre officielle de l'acheteur : réponds à cette offre (l'accepter se fait avec le bouton « Accepter » de Le Bon Coin, la refuser ou contre-proposer par message) ; si l'acheteur ajoute une raison touchante (« c'est pour mon fils »), réagis-y avec un vrai mot personnel et sincère (pas une formule), puis dis clairement que ce prix-là n'est pas possible, sans brader ;
- prix : ne descends jamais sous le prix plancher ; face à une offre très basse, remercie, explique gentiment la valeur et propose un prix raisonnable ;
- lot : quand son contenu est donné, nomme les jeux du lot dans au moins deux réponses et argumente avec ce qu'ils sont (titre recherché, état, boîte ou loose) plutôt qu'avec « le jeu » ; ne parle jamais d'un jeu qui n'est pas dans le lot ;
- offre groupée sur plusieurs jeux : retrouve-les dans la liste, additionne leurs prix ; si l'offre est très en dessous, reste ferme mais sympa, sans vexer (rappelle que chaque jeu est au prix du marché), et propose un prix de lot qui ne descend pas sous 85 % de la somme ;
- refuse toujours poliment virement, mandat, lien externe, échange de numéro ou paiement hors Le Bon Coin, et propose le paiement sécurisé Le Bon Coin ;
- si le message est une arnaque probable, une des réponses le décline poliment.
${consigne ? `
LE PLUS IMPORTANT : le vendeur t'a dit lui-même ce qu'il veut répondre. C'est lui qui décide, sa consigne passe avant toutes les règles ci-dessus (prix, ton, plancher) :
"""
${consigne}
"""
${precedentes ? `Pour comprendre sa consigne, voici les propositions qu'il vient d'écarter :\n${precedentes}\n` : ""}Applique-la à la lettre : c'est le vendeur qui te parle à toi ; transforme ce qu'il dit en réponse à l'acheteur (vouvoiement) en gardant son idée, sa décision, son ton et SES PROPRES EXPRESSIONS, même familières ou décalées (par exemple « on finit nu » doit apparaître dans la réponse, adapté en « je finirais nu »), et mets tels quels chaque mot ou chiffre qu'il demande d'inclure. Les trois réponses reprennent toutes ses expressions. Approche : « ferme » ou « couper_court » pour un refus, « accepter » pour un accord, « contre_offre » pour un autre prix, « info » sinon. N'ajoute pas d'argument, de prix ni de condition qu'il n'a pas donnés. La première réponse est la plus fidèle possible à sa consigne ; les deux autres sont des variantes tout aussi fidèles (une plus courte, une plus chaleureuse). Garde le vouvoiement, le prénom et un smiley. Si la consigne est ambiguë, choisis l'interprétation la plus probable et dis-le dans « resume » (« J'ai compris que… »).
` : ""}${suite ? `
SUITE DE SON PROPRE MESSAGE : c'est le vendeur qui a écrit le dernier message et l'acheteur n'a rien répondu depuis. Ta réponse est un petit message de plus, juste après le sien, pour ajouter une information. Donc : pas de « merci », pas de « bonjour » ni de nouvelle salutation, pas le prénom de l'acheteur en ouverture, ne réponds à rien. Commence directement par l'information (par exemple « Petite précision : … », « J'oubliais : … », « Au fait, … »).
` : ""}Donne ta proposition avec l'outil « proposer_reponses » (trois réponses).`;
  let o = null;
  for (let essai = 0; essai < 2 && !(o && Array.isArray(o.reponses) && o.reponses.length); essai++) {
    try { o = await claude(consigneIA, { max: 2500, timeout: 35000, outil: OUTIL_REPONSES }); }
    catch (e) { if (essai || !(e instanceof IaError) || /configuré/.test(e.message)) throw e; console.error("IA réponse, nouvel essai :", e.message); }
  }
  const l = (o && Array.isArray(o.reponses) ? o.reponses : []).map((r) => ({ approche: parmi(r && r.approche, ["contre_offre", "ferme", "couper_court", "accepter", "au_revoir", "info"], "info"), titre: txt(r && r.titre, 40), texte: smiley(txt(r && r.texte, 700)) })).filter((r) => r.texte).slice(0, 3);
  // Passages à mettre en gras : seulement ceux qui figurent vraiment dans le texte.
  (o && Array.isArray(o.reponses) ? o.reponses : []).forEach((r, i) => { if (l[i] && r && Array.isArray(r.gras)) l[i].gras = r.gras.map((g) => txt(g, 60)).filter((g) => g.length >= 2 && l[i].texte.includes(g)).slice(0, 5); });
  if (!l.length) { console.error("IA réponse vide", JSON.stringify(o).slice(0, 300)); throw new IaError("Je n'ai pas réussi à proposer de réponse, réessaie."); }
  // Offre trop basse : jamais de réponse qui l'accepte telle quelle.
  // L'acheteur s'est retiré : seulement des au revoir, jamais de prix ni de relance.
  const fin = /^(fin|cloture|clôture|au_revoir|abandon|retrait)/i.test(txt(o && o.intention, 30)) || (l.length && l.every((r) => r.approche === "au_revoir" || r.approche === "couper_court") && l.some((r) => r.approche === "au_revoir"));
  if (fin) {
    const adieux = l.filter((r) => r.approche === "au_revoir" || !/\d\s?€/.test(r.texte)).map((r) => ({ ...r, approche: "au_revoir" }));
    if (adieux.length) l.splice(0, l.length, ...adieux);
    l.forEach((r) => { r.texte = sansSujet(r.texte); if (r.gras) r.gras = r.gras.filter((g) => r.texte.includes(g)); });
  }
  if (suite) l.forEach((r) => { r.texte = sansPolitesse(r.texte); if (r.gras) r.gras = r.gras.filter((g) => r.texte.includes(g)); });
  if (ana && ana.basse && l.some((r) => r.approche !== "accepter")) l.splice(0, l.length, ...l.filter((r) => r.approche !== "accepter"));
  return { resume: phrase(o.resume, 260), intention: txt(o.intention, 30), reponses: l, ...(ana ? { offre: ana } : {}) };
}

// Suite d'un message du vendeur : on retire un « Merci Sofian ! » ou un « Bonjour, » d'ouverture.
const OUVERTURE = /^\s*(?:(?:[Rr]e)?[Bb]onjour|[Bb]onsoir|[Ss]alut|[Hh]ello|[Cc]oucou|[Mm]erci(?: beaucoup| bien)?(?: pour [^,.!?]{0,60})?)(?:\s+(?:à vous|[A-ZÀ-Ý][\wÀ-ÿ-]*))?\s*[,.!…]*\s*(?:[\u{1F300}-\u{1FAFF}\u2600-\u27BF]\s*)*/u;
export function sansPolitesse(t) {
  let s = String(t);
  for (let i = 0; i < 2; i++) { const r = s.replace(OUVERTURE, ""); if (r === s) break; s = r; }
  s = s.trim();
  if (s.replace(/[\s\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").length < 8) return String(t);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Un au revoir ne reparle de rien (budget, prix, état…) : on retire les phrases qui reprennent un sujet.
const SUJET = /budget|prix|€|\boffre|\bétat\b|rare|valeur|comprends|compréhensible|dommage|cher\b|moyens/i;
export function sansSujet(t) {
  const phrases = String(t).match(/[^.!?…]+[.!?…]*\s*(?:[\u{1F300}-\u{1FAFF}\u2600-\u27BF]\s*)*/gu) || [t];
  const garde = phrases.filter((p) => !SUJET.test(p)).join("").trim();
  if (garde.replace(/[\s\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").length >= 8) return smiley(garde);
  const nom = (String(t).match(/\b(?:Merci|Bonsoir|Bonjour)\s+([A-ZÀ-Ý][\wÀ-ÿ-]*)/) || [])[1];
  const h = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hour12: false, timeZone: "Europe/Paris" }).format(new Date()));
  return `Merci${nom ? " " + nom : ""} pour l'échange, ${h >= 18 || h < 4 ? "bonne soirée" : "bonne journée"} 🙂`;
}

/* ===== Discussion sur une fiche =====
   Le vendeur écrit librement (« le code a déjà été utilisé », « baisse à 25 € », « annonce plus courte ») ;
   le modèle répond et renvoie les champs à modifier. Seuls les champs connus, avec des valeurs valides, passent. */
const CHAMPS_DIALOGUE = ["titre", "plateforme", "region", "categorie", "etat", "contenu", "origine", "modif", "particularites", "prixAchat", "prixDemande", "titreAnnonce", "texteAnnonce", "numero", "rarete", "edition", "gradation", "etatCarte"];
const ORIGINES_D = ["origine", "non_teste", "modifie", "repro", "hs"];
export function changementsSurs(c) {
  const out = {};
  if (!c || typeof c !== "object") return out;
  for (const k of CHAMPS_DIALOGUE) {
    if (!(k in c)) continue;
    const v = c[k];
    if (k === "prixAchat" || k === "prixDemande") { const p = prix(v); if (p != null) out[k] = p; }
    else if (k === "categorie") { if (CATEGORIES.includes(v)) out[k] = v; }
    else if (k === "etat") { if (ETATS.includes(v)) out[k] = v; }
    else if (k === "contenu") { if (CONTENUS.includes(v)) out[k] = v; }
    else if (k === "origine") { if (ORIGINES_D.includes(v)) out[k] = v; }
    else if (k === "etatCarte") { if (ETATS_CARTE.includes(v)) out[k] = v; }
    else if (k === "texteAnnonce") out[k] = affirme(txt(v, 4000));
    else out[k] = txt(v, { titre: 160, plateforme: 60, region: 30, modif: 160, particularites: 300, titreAnnonce: 100, numero: 20, rarete: 40, edition: 40, gradation: 30 }[k]);
  }
  return out;
}
export async function dialoguer(messages, fiche = {}) {
  const l = (Array.isArray(messages) ? messages : []).slice(-12)
    .map((m) => ({ role: m && m.role === "ia" ? "ia" : "vendeur", texte: txt(m && m.texte, 1500) })).filter((m) => m.texte);
  if (!l.length || l[l.length - 1].role !== "vendeur") throw new IaError("Écris d'abord ton message.");
  const f = {};
  for (const k of CHAMPS_DIALOGUE) if (fiche && fiche[k] != null && fiche[k] !== "") f[k] = k === "texteAnnonce" ? txt(fiche[k], 4000) : txt(fiche[k], 300);
  if (fiche && fiche.cote) { const c = coteDe(fiche.cote); if (c) f.cote = { conseille: c.conseille, bas: c.bas, haut: c.haut }; }
  if (FAKE()) {
    const dit = l[l.length - 1].texte, m = /(\d+(?:[.,]\d+)?)\s*(?:€|euros?)/i.exec(dit);
    if (m) return { reponse: `C'est noté, je mets le prix à ${m[1]} €.`, changements: { prixDemande: prix(m[1]) } };
    if (/code/i.test(dit)) return { reponse: "Compris : c'est la boîte seule, sans le code. J'ai mis la fiche et l'annonce à jour.", changements: changementsSurs({ contenu: "boite_vide", particularites: "Code de téléchargement déjà utilisé", texteAnnonce: (f.texteAnnonce || "") + "\nCode de téléchargement déjà utilisé." }) };
    return { reponse: "D'accord. Dis-moi ce que tu veux changer sur la fiche.", changements: {} };
  }
  const prompt = `Tu es l'assistant de RetroRevente. Tu aides un particulier à rédiger la fiche d'un objet (le plus souvent un jeu vidéo rétro) qu'il vend d'occasion sur Le Bon Coin. Il te parle librement : il corrige un détail, te donne une information, te demande un conseil ou un changement de style.

Fiche actuelle (JSON) :
${JSON.stringify(f, null, 1)}

Signification des champs :
- etat : « neuf », « tres_bon », « bon », « correct » ou « pieces » ;
- contenu : « seul » (loose : cartouche ou disque seul), « boite » (boîte sans notice), « complet » (boîte et notice), « boite_vide » (boîte sans le jeu, par exemple code déjà utilisé) ;
- origine : « origine » (d'origine, testé et fonctionnel), « non_teste », « modifie » (préciser dans modif), « repro » (reproduction), « hs » (pour pièces) ;
- particularites : ce qui est inclus ou non (ex. « Poster inclus, code déjà utilisé ») ;
- prixDemande, prixAchat : en euros ;
- pour une carte Pokémon (categorie « cartes ») : titre = nom de la carte, plateforme = extension, region = langue, numero (ex. « 4/102 »), rarete, edition (« 1re édition »…), gradation (ex. « PSA 9 »), etatCarte (« mint », « near_mint », « excellent », « good », « light_played », « played » ou « poor ») ; contenu et origine ne servent pas ;
- titreAnnonce : titre Le Bon Coin (100 caractères au plus) ; texteAnnonce : texte de l'annonce.

Conversation (le dernier message est celui du vendeur) :
${l.map((m) => (m.role === "ia" ? "Toi : " : "Vendeur : ") + m.texte).join("\n")}

Règles :
- Réponds en français, en tutoyant, en une à trois phrases simples. Dis ce que tu as changé.
- Ce que dit le vendeur sur son objet est vrai : reporte-le dans les champs concernés ET dans texteAnnonce, pour que tout reste cohérent.
- Quand tu modifies texteAnnonce, garde son style et tout ce qui reste vrai ; renvoie le texte complet. N'ajoute aucune information que le vendeur ou la fiche ne donne pas. N'emploie jamais « apparemment », « semble », « probablement », « a priori », « visible » ni « apparent ».
- Pour un conseil de prix, appuie-toi sur la cote si elle existe ; ne change prixDemande que si le vendeur le demande.
- Si le message n'appelle aucun changement (question, remerciement), réponds sans rien changer.
- Ne renvoie que les champs qui changent.

Réponds uniquement par un objet JSON : {"reponse": "…", "changements": {"champ": valeur, …}}`;
  const o = await claude([{ type: "text", text: prompt }], { max: 2500, timeout: 60000 });
  if (!o || typeof o.reponse !== "string") throw new IaError("Je n'ai pas compris, reformule ton message.");
  return { reponse: affirme(txt(o.reponse, 800)) || "C'est fait.", changements: changementsSurs(o.changements) };
}

/* Traduit en français le résumé anglais d'un jeu (descriptif de la fiche quand Wikipédia n'a pas d'article). */
export async function traduire(texte) {
  const t = txt(texte, 3000);
  if (!t || FAKE()) return "";
  const o = await claude(`Traduis en français ce résumé d'un jeu vidéo, fidèlement, sans rien ajouter ni retirer, dans un français naturel. Garde les noms propres (personnages, lieux, titres) tels qu'ils sont connus en France. Réponds uniquement par un objet JSON {"texte": "..."}.\n\n${t}`, { max: 2500, effort: "low" });
  return o && typeof o.texte === "string" ? txt(o.texte, 3000) : "";
}
