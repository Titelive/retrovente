// IA : reconnaître un jeu sur une photo (fiche + annonce + cadre pour le recadrage) et estimer sa cote.
// Repris de la section Ventes du backoffice titelive. Clé ANTHROPIC_API_KEY ; modèle CLAUDE_MODEL facultatif.
// IA_FAKE=1 : réponses fictives, pour les tests et le développement sans clé.
export const CATEGORIES = ["jeux", "consoles", "accessoires", "autres"];
export const ETATS = ["neuf", "tres_bon", "bon", "correct", "pieces", ""];
export const CONTENUS = ["seul", "boite", "complet", ""];
export const MAX_PHOTO = 700_000;   // data URL ; la page réduit la photo à 1000 px avant l'envoi

export const txt = (v, n) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, n);
export const prix = (v) => { if (v == null || String(v).trim() === "") return null; const n = Number(String(v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) && n >= 0 && n < 1e6 ? Math.round(n * 100) / 100 : null; };
export const jour = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
export const parmi = (v, liste, def) => (liste.includes(v) ? v : def);
export const lien = (v) => { const s = txt(v, 500); try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch (e) { return ""; } };

export class IaError extends Error {}

export function coteDe(c) {
  if (!c || typeof c !== "object") return null;
  const o = { bas: prix(c.bas), haut: prix(c.haut), conseille: prix(c.conseille), rapide: prix(c.rapide), resume: txt(c.resume, 400), date: jour(c.date) || new Date().toISOString().slice(0, 10),
    sources: (Array.isArray(c.sources) ? c.sources : []).map(lien).filter(Boolean).slice(0, 4) };
  return o.conseille != null || o.bas != null ? o : null;
}

async function claude(content, { web = 0, max = 1500, timeout = 30000 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new IaError("Le service d'IA n'est pas configuré.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(timeout),
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || "claude-haiku-5-5", max_tokens: max,
      ...(web ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: web }] } : {}),
      messages: [{ role: "user", content }],
    }),
  });
  if (!r.ok) { console.error("IA", r.status, (await r.text().catch(() => "")).slice(0, 300)); throw new IaError("Le service d'IA est momentanément indisponible, réessaie dans un instant."); }
  const d = await r.json();
  const t = (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const m = /\{[\s\S]*\}/.exec(t);
  try { return m ? JSON.parse(m[0]) : null; } catch (e) { return null; }
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

export async function identifier(photo) {
  if (FAKE()) { checkPhoto(photo); return { titre: "Super Mario 64", categorie: "jeux", plateforme: "Nintendo 64", region: "PAL EUR", etat: "bon", contenu: "complet", remarques: "Boîte légèrement frottée sur les coins.", annonce: "Super Mario 64 Nintendo 64 complet boîte notice PAL", description: "Super Mario 64 pour Nintendo 64, version PAL française.\nComplet : boîte, notice et cartouche.\nBon état général, coins de la boîte légèrement frottés.\nCartouche testée, fonctionne parfaitement.\nRemise en main propre ou envoi.", cadre: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 } }; }
  const o = await claude([
    image(photo),
    { type: "text", text: `Cette photo montre un objet qu'un particulier va vendre d'occasion sur Le Bon Coin (le plus souvent un jeu vidéo, une console ou un accessoire). Identifie-le aussi précisément que possible à partir de ce qui est visible (étiquette, logo, boîte, références comme « NUS-NKXP-EUR »).
Réponds uniquement par un objet JSON avec les clés :
"trouve" (true si tu as reconnu l'objet, sinon false),
"titre" (nom exact et officiel, version française ou européenne si c'est elle, ex. « Kirby 64: The Crystal Shards »),
"categorie" (« jeux », « consoles », « accessoires » ou « autres »),
"plateforme" (console ou support, nom courant en français, ex. « Nintendo 64 », « PlayStation 2 » ; "" si sans objet),
"region" (ex. « PAL EUR », « NTSC-J » ; "" si inconnue),
"etat" (d'après la photo : « neuf », « tres_bon », « bon », « correct » ou « pieces » ; "" si impossible à dire),
"contenu" (« seul » si jeu en loose, c'est-à-dire cartouche ou disque sans boîte, « boite » si boîte sans notice visible, « complet » si boîte et notice ; "" si sans objet),
"remarques" (une phrase courte sur ce qui compte pour un acheteur : étiquette abîmée, rayures, éléments manquants… ; "" sinon),
${CADRE_CONSIGNE},
"rotation" (rotation en degrés, dans le sens des aiguilles d'une montre, à appliquer à la photo pour que l'étiquette ou le texte de l'objet soit à l'endroit : 0, 90, 180 ou 270),
"annonce" (titre d'annonce Le Bon Coin précis, 70 caractères au plus : nom du jeu, plateforme, région, puis « loose » si cartouche ou disque seul, « en boîte » ou « complet CIB » ; ex. « Kirby 64 Nintendo 64 PAL loose »),
"description" (texte de l'annonce en français, 3 à 6 lignes courtes, honnête et vendeur : ce que c'est, l'état et ce qui est fourni (dis « Jeu en loose » pour une cartouche ou un disque seul, « Complet en boîte (CIB) » pour boîte et notice), un défaut visible s'il y en a, puis « Remise en main propre ou envoi. » ; sans prix, sans émoji, sans inventer ce qui ne se voit pas).` },
  ], { max: 1200 });
  if (!o || !o.trouve) throw new IaError("Je n'ai pas reconnu le jeu. Essaie une photo plus nette où l'on voit bien l'étiquette ou la boîte.");
  return {
    titre: txt(o.titre, 160), categorie: parmi(o.categorie, CATEGORIES, "autres"), plateforme: txt(o.plateforme, 60), region: txt(o.region, 30),
    etat: parmi(o.etat, ETATS, ""), contenu: parmi(o.contenu, CONTENUS, ""), remarques: txt(o.remarques, 300), annonce: txt(o.annonce, 100), description: txt(o.description, 1500), cadre: cadreDe(o.cadre), rotation: [0, 90, 180, 270].includes(Number(o.rotation)) ? Number(o.rotation) : 0,
  };
}

export async function cadrer(photo) {
  if (FAKE()) { checkPhoto(photo); return { x: 0.15, y: 0.1, w: 0.7, h: 0.8 }; }
  const o = await claude([image(photo), { type: "text", text: `Repère sur cette photo l'objet qu'un particulier veut vendre (jeu vidéo, console, accessoire…). Réponds uniquement par un objet JSON avec la clé ${CADRE_CONSIGNE}.` }], { max: 200 });
  return cadreDe(o && o.cadre);
}

const LIB_ETAT = { neuf: "neuf", tres_bon: "très bon état", bon: "bon état", correct: "état correct", pieces: "pour pièces" };
const LIB_CONTENU = { seul: "jeu en loose (cartouche ou disque seul)", boite: "en boîte, sans notice", complet: "complet en boîte, CIB (boîte et notice)" };
export async function estimerCote(v) {
  const titre = txt(v.titre, 160);
  if (!titre) throw new IaError("Indique d'abord le nom du jeu.");
  if (FAKE()) return coteDe({ bas: 38, haut: 52, conseille: 49, rapide: 42, resume: "Ventes eBay conclues entre 38 et 52 € en complet ; annonces Le Bon Coin entre 40 et 60 €.", sources: ["https://www.ebay.fr/", "https://www.pricecharting.com/"] });
  const quoi = [titre, txt(v.plateforme, 60), txt(v.region, 30), LIB_CONTENU[v.contenu], LIB_ETAT[v.etat]].filter(Boolean).join(", ");
  const o = await claude(`Estime la cote d'occasion en France, aujourd'hui, de cet objet vendu par un particulier : ${quoi}.
Cherche sur le web les prix réellement pratiqués : ventes conclues sur eBay France (objets vendus), annonces Le Bon Coin, et sites de cote comme PriceCharting ou Retroplace. Tiens compte de l'état et de ce qui est fourni (loose, en boîte, complet), qui changent beaucoup le prix des jeux rétro.
Réponds uniquement par un objet JSON avec les clés :
"bas" et "haut" (fourchette des prix de vente constatés, en euros),
"conseille" (prix à afficher sur Le Bon Coin, un peu au-dessus du prix de vente probable pour laisser de la marge à la négociation, arrondi à l'euro),
"rapide" (prix pour vendre en quelques jours),
"resume" (une ou deux phrases en français : sur quoi tu t'appuies et ce qui fait varier le prix),
"sources" (2 à 4 adresses web consultées les plus utiles).`, { web: 4, max: 2500, timeout: 55000 });
  const c = coteDe(o);
  if (!c) throw new IaError("Pas assez de prix trouvés pour estimer la cote. Précise le nom ou la console.");
  return c;
}
