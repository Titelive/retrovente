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
// adresse sans fragment ni barre finale, pour comparer un lien cité aux pages réellement trouvées par la recherche
export const norme = (u) => { try { const x = new URL(u); x.hash = ""; return (x.host.replace(/^www\./, "") + x.pathname.replace(/\/$/, "") + x.search).toLowerCase(); } catch (e) { return ""; } };

export function coteDe(c) {
  if (!c || typeof c !== "object") return null;
  const o = { bas: prix(c.bas), haut: prix(c.haut), conseille: prix(c.conseille), rapide: prix(c.rapide), resume: txt(c.resume, 400), date: jour(c.date) || new Date().toISOString().slice(0, 10),
    sources: (Array.isArray(c.sources) ? c.sources : []).map(lien).filter(Boolean).slice(0, 4),
    methode: txt(c.methode, 400),
    releves: (Array.isArray(c.releves) ? c.releves : []).map((r) => r && typeof r === "object" ? { site: txt(r.site, 40), titre: txt(r.titre, 140), prix: prix(r.prix), date: jour(r.date), url: lien(r.url) } : null)
      .filter((r) => r && r.url && r.prix != null).slice(0, 6) };
  return o.conseille != null || o.bas != null ? o : null;
}

async function claude(content, { web = 0, max = 1500, timeout = 30000, model = "" } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new IaError("Le service d'IA n'est pas configuré.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(timeout),
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: model || process.env.CLAUDE_MODEL || "claude-haiku-5-5", max_tokens: max,
      ...(web ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: web }] } : {}),
      messages: [{ role: "user", content }],
    }),
  });
  if (!r.ok) { console.error("IA", r.status, (await r.text().catch(() => "")).slice(0, 300)); throw new IaError("Le service d'IA est momentanément indisponible, réessaie dans un instant."); }
  const d = await r.json();
  const t = (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const vus = new Set();
  for (const b of d.content || []) if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const x of b.content) if (x && x.url) vus.add(norme(x.url));
  for (const b of d.content || []) for (const c of b.citations || []) if (c && c.url) vus.add(norme(c.url));
  if (d.stop_reason === "max_tokens") console.error("IA : réponse coupée (max_tokens)", max);
  const o = lireJson(t);
  if (!o) console.error("IA : JSON illisible", t.slice(0, 400));
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

export async function identifier(photo) {
  if (FAKE()) { checkPhoto(photo); return { titre: "Super Mario 64", categorie: "jeux", plateforme: "Nintendo 64", region: "PAL EUR", etat: "bon", contenu: "complet", remarques: "Boîte légèrement frottée sur les coins.", annonce: "Super Mario 64 Nintendo 64 complet boîte notice PAL", description: "Super Mario 64 sur Nintendo 64, version française (PAL, NUS-NSMP-FRA).\nComplet en boîte (CIB) : boîte, notice et cartouche d'origine, testée et fonctionnelle.\nBon état général, coins de la boîte légèrement frottés.\nRemise en main propre ou envoi.", cadre: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 } }; }
  const consigne = `Cette photo montre un objet qu'un particulier va vendre d'occasion sur Le Bon Coin (le plus souvent un jeu vidéo, une console ou un accessoire). Identifie-le aussi précisément que possible à partir de ce qui est visible (étiquette, logo, boîte, références comme « NUS-NKXP-EUR »). Lis le texte de la jaquette : si le titre est lisible, considère l'objet comme reconnu même si tu ne connais pas ce jeu (il peut être sorti récemment).
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
"description" (texte de l'annonce en français, exactement dans ce style, 4 lignes courtes, honnête, sans prix ni émoji, sans inventer ce qui ne se voit pas :
« Conker's Bad Fur Day sur Nintendo 64, version européenne (PAL, NUS-NFUP-EUR).
Jeu en loose : cartouche seule, d'origine, testée et fonctionnelle, sans boîte ni notice.
Étiquette propre et bien lisible, cartouche en bon état.
Remise en main propre ou envoi. »
Ligne 1 : nom, console, version et référence si elle est lisible sur la photo. Ligne 2 : ce qui est fourni (« Jeu en loose : cartouche seule » ou « disque seul », « En boîte : … sans notice », « Complet en boîte (CIB) : boîte, notice et cartouche ») avec toujours « d'origine, testé(e) et fonctionnel(le) » accordé avec cartouche, disque ou console. Ligne 3 : l'état visible et un défaut s'il y en a. Ligne 4 : « Remise en main propre ou envoi. » ${CERTAIN})`;
  let o = await claude([image(photo), { type: "text", text: consigne }], { max: 1200 });
  // Pas reconnu du premier coup (jeu récent, photo difficile) : on passe la main à un modèle plus fort, qui peut chercher sur le web.
  if (!o || !o.trouve) {
    o = await claude([image(photo), { type: "text", text: consigne + `

Un premier essai n'a pas reconnu l'objet. Regarde attentivement la photo (titre, logos, console, classification d'âge, références) ; si besoin, fais une recherche web pour confirmer le titre exact et la plateforme, surtout pour un jeu récent. Termine ta réponse par l'objet JSON demandé.` }], { max: 2500, timeout: 60000, web: 3, model: process.env.CLAUDE_MODEL_FORT || "claude-sonnet-5-5" })
      // recherche web indisponible sur le compte : même modèle fort, sans le web
      .catch(() => claude([image(photo), { type: "text", text: consigne }], { max: 1500, timeout: 45000, model: process.env.CLAUDE_MODEL_FORT || "claude-sonnet-5-5" }))
      .catch((e) => { console.error("IA secours", e.message); return null; });
  }
  if (!o || !o.trouve) throw new IaError("Je n'ai pas reconnu le jeu. Essaie une photo plus nette où l'on voit bien l'étiquette ou la boîte.");
  return {
    titre: txt(o.titre, 160), categorie: parmi(o.categorie, CATEGORIES, "autres"), plateforme: txt(o.plateforme, 60), region: txt(o.region, 30),
    etat: parmi(o.etat, ETATS, ""), contenu: parmi(o.contenu, CONTENUS, ""), remarques: affirme(txt(o.remarques, 300)), annonce: txt(o.annonce, 100), description: affirme(txt(o.description, 1500)), cadre: cadreDe(o.cadre), rotation: [0, 90, 180, 270].includes(Number(o.rotation)) ? Number(o.rotation) : 0,
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
  if (FAKE()) return coteDe({ bas: 38, haut: 52, conseille: 49, rapide: 42, resume: "Ventes eBay conclues entre 38 et 52 € en complet ; annonces Le Bon Coin entre 40 et 60 €.", sources: ["https://www.ebay.fr/", "https://www.pricecharting.com/"],
    methode: "Médiane des ventes conclues récentes, dans le même état, puis prix affiché un peu au-dessus pour laisser place à la négociation.",
    releves: [{ site: "eBay", titre: "Exemple de vente conclue", prix: 45, date: "2026-11-02", url: "https://www.ebay.fr/" }, { site: "PriceCharting", titre: "Cote moyenne", prix: 48, date: "2026-11-10", url: "https://www.pricecharting.com/" }] });
  const quoi = [titre, txt(v.plateforme, 60), txt(v.region, 30), LIB_CONTENU[v.contenu], LIB_ETAT[v.etat]].filter(Boolean).join(", ");
  const o = await claude(`Estime la cote d'occasion en France, aujourd'hui, de cet objet vendu par un particulier : ${quoi}.
Cherche sur le web les prix réellement pratiqués : ventes conclues sur eBay France (objets vendus), annonces Le Bon Coin, et sites de cote comme PriceCharting ou Retroplace. Tiens compte de l'état et de ce qui est fourni (loose, en boîte, complet), qui changent beaucoup le prix des jeux rétro.
Réponds uniquement par un objet JSON avec les clés :
"bas" et "haut" (fourchette des prix de vente constatés, en euros),
"conseille" (prix à afficher sur Le Bon Coin, un peu au-dessus du prix de vente probable pour laisser de la marge à la négociation, arrondi à l'euro),
"rapide" (prix pour vendre en quelques jours),
"resume" (une ou deux phrases en français : sur quoi tu t'appuies et ce qui fait varier le prix),
"methode" (une phrase en français : comment tu as calculé le prix conseillé à partir des relevés),
"releves" (3 à 6 prix précis réellement lus pendant ta recherche, dans le même état si possible : objets avec "site" (eBay, PriceCharting, Le Bon Coin…), "titre" (intitulé de la vente ou de la page), "prix" (en euros, converti si besoin), "date" (AAAA-MM-JJ de la vente ou du relevé) et "url" (adresse exacte de la page où tu l'as lu, telle que donnée par la recherche ; n'invente jamais d'adresse)),
"sources" (2 à 4 adresses web consultées les plus utiles).`, { web: 5, max: 3500, timeout: 70000 });
  const c = coteDe(o);
  // on ne garde que les liens qui sont vraiment sortis de la recherche web
  if (c && o && o._vus && o._vus.size) { c.releves = c.releves.filter((r) => o._vus.has(norme(r.url))); c.sources = c.sources.filter((u) => o._vus.has(norme(u))); }
  if (!c) throw new IaError("Pas assez de prix trouvés pour estimer la cote. Précise le nom ou la console.");
  return c;
}

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

export async function legender(photos, v = {}) {
  const l = (Array.isArray(photos) ? photos : []).slice(0, 12);
  if (!l.length) throw new IaError("Ajoute d'abord des photos.");
  l.forEach(checkPhoto);
  if (FAKE()) return l.map((_, i) => (i === 0 ? "Vue de face, étiquette en bon état" : "Détail, sans défaut"));
  const quoi = [txt(v.titre, 160), txt(v.plateforme, 60)].filter(Boolean).join(", ") || "un jeu vidéo d'occasion";
  // Une requête par photo (en parallèle) : la légende ne peut pas être attribuée à une autre photo.
  const une = async (p) => {
    const o = await claude([image(p), { type: "text", text: `Cette photo montre ${quoi}, vendu d'occasion sur Le Bon Coin. Écris une légende courte en français (12 mots au plus) pour CETTE photo : d'abord la vue montrée, à choisir d'après ce qu'on voit réellement (« Face avant » = côté avec la grande étiquette illustrée du jeu ; « Dos » = côté opposé, avec la petite étiquette de mentions légales ; « Connecteur », « Tranche gauche », « Tranche droite », « Dessus », « Boîte, face avant », « Boîte, dos », « Notice »…), puis « : » et l'état de ce qui est montré, ou le défaut s'il y en a un (rayure, étiquette décollée, coin abîmé…). ${CERTAIN} Pas de point final.
Réponds uniquement par un objet JSON : {"legende": "…"}` }], { max: 200, timeout: 45000 });
    return affirme(txt(o && o.legende, 200)).replace(/\.$/, "");
  };
  const out = await Promise.all(l.map((p) => une(p).catch(() => "")));
  if (!out.some(Boolean)) throw new IaError("Je n'ai pas pu décrire les photos, réessaie.");
  return out;
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
export async function repondre(conversation, a = {}, autres = [], contexte = {}) {
  const conv = txt(conversation, 5000);
  const lot = contexte && contexte.lot && prix(contexte.lot.prix) != null ? `L'acheteur négocie un LOT de ${Math.min(20, Number(contexte.lot.n) || 2)} articles au prix total de ${prix(contexte.lot.prix)} € (prix plancher du lot : ${rond(prix(contexte.lot.prix) * 0.85, true)} €).` : "";
  const articles = contexte && contexte.lot ? contenuLot(contexte.lot.articles, autres) : [];
  const somme = articles.length && articles.every((x) => x.annonce && prix(x.annonce.prix) != null) ? articles.reduce((n, x) => n + prix(x.annonce.prix), 0) : null;
  const detailLot = articles.length ? `Contenu exact du lot (appuie-toi sur CES jeux, cite-les par leur nom, et sur leur état et ce qui est inclus : loose, boîte, notice) :\n${articles.map((x) => `- ${x.titre}${x.annonce ? ` → dans ses annonces : ${prix(x.annonce.prix) != null ? `${prix(x.annonce.prix)} €` : "prix non renseigné"}${LIB_ETAT[x.annonce.etat] ? `, ${LIB_ETAT[x.annonce.etat]}` : ""}${LIB_CONTENU[x.annonce.contenu] ? `, ${LIB_CONTENU[x.annonce.contenu]}` : ""}` : ""}`).join("\n")}${somme != null ? `\nSomme des prix séparés : ${somme} €.` : ""}` : "";
  const offre = contexte && prix(contexte.offre) != null ? `Offre officielle reçue par Le Bon Coin : ${prix(contexte.offre)} €.` : "";
  const qui = txt(contexte && contexte.acheteur, 40).replace(/[^\p{L}\p{N}' .-]/gu, "");
  if (conv.length < 5) throw new IaError("Je ne trouve pas de message à analyser dans cette conversation.");
  const px = prix(a.prix);
  const fiche = [
    a.titre ? `Annonce : ${txt(a.titre, 160)}` : "", a.plateforme ? `Console : ${txt(a.plateforme, 60)}` : "",
    LIB_ETAT[a.etat] ? `État : ${LIB_ETAT[a.etat]}` : "", LIB_CONTENU[a.contenu] ? `Contenu : ${LIB_CONTENU[a.contenu]}` : "",
    px != null ? `Prix affiché : ${px} € (prix plancher conseillé : ${rond(px * 0.85, true)} €, ne jamais proposer moins)` : "",
    a.description ? `Description publiée : ${txt(a.description, 1200)}` : "",
  ].filter(Boolean).join("\n");
  const catalogue = (Array.isArray(autres) ? autres : []).slice(0, 40).map((x) => `- ${txt(x.titre, 120)}${prix(x.prix) != null ? ` : ${prix(x.prix)} €` : ""}${LIB_ETAT[x.etat] ? `, ${LIB_ETAT[x.etat]}` : ""}`).join("\n");
  if (FAKE()) return { resume: "L'acheteur propose 20 €, bien en dessous du prix.", intention: "offre_basse",
    reponses: [
      { approche: "contre_offre", titre: "Contre-proposition", texte: "Bonjour, merci pour votre proposition ! 20 €, c'est un peu loin de la valeur du jeu. Je peux vous le faire à 42 € si ça vous va 🙂" },
      { approche: "ferme", titre: "Prix ferme", texte: "Bonjour, merci pour votre message ! Le prix est déjà calé sur la cote actuelle, je préfère le garder tel quel 🙂" },
      { approche: "couper_court", titre: "Couper court", texte: "Bonjour, merci pour votre proposition ! Je pense qu'on ne va pas réussir à s'entendre sur ce prix, je préfère en rester là. Bonne recherche à vous 🙂" },
    ] };
  const o = await claude(`Tu aides un particulier qui vend un jeu vidéo d'occasion sur Le Bon Coin à répondre à un acheteur.

Ce que vend le vendeur :
${fiche || "(pas de fiche, reste général sur l'objet)"}

${catalogue ? `Tous ses jeux en vente (pour reconnaître une offre groupée sur plusieurs annonces) :\n${catalogue}\n\n` : ""}${[qui ? `Prénom ou pseudo de l'acheteur : ${qui}` : "", lot, detailLot, offre].filter(Boolean).join("\n")}${qui || lot || offre ? "\n\n" : ""}Texte de la page de messagerie (copié tel quel ; il peut contenir des menus, des dates et les messages des deux personnes, le plus récent en bas) :
"""
${conv}
"""

Retrouve le DERNIER message de l'acheteur et ce qu'il veut (disponibilité, offre de prix, dernier prix, échange, lot, photos, état, envoi, main propre, paiement, relance…).
Propose trois réponses du vendeur, prêtes à envoyer, qui vont plus ou moins loin, pour qu'il choisisse sa stratégie. Quand c'est une négociation (offre, lot, « dernier prix ? », relance insistante), les trois doivent couvrir :
  1. « contre_offre » : on reste ouvert et on propose un autre prix (ou un prix de lot), jamais sous le plancher ;
  2. « ferme » : on maintient le prix, gentiment, en expliquant la valeur ;
  3. « couper_court » : on clôt la discussion poliment et sans vexer (« on ne va pas réussir à s'entendre, bonne recherche ») ;
sinon (question, disponibilité, envoi…), trois formulations utiles et différentes, avec l'approche « info ». Si l'offre est raisonnable (au-dessus du plancher), l'une peut être « accepter ».
Pour chaque réponse :
- en français, vouvoiement, ton sympa, chaleureux et diplomate, jamais sec ni moralisateur ;
- toujours au moins un smiley sympa, du genre 🙂 (ou 😊, 👍 selon le cas), deux au plus, jamais moqueur ;
- 1 à 4 phrases courtes ; appelle l'acheteur par son prénom ou pseudo (« Bonjour Garnier, … » ou « Merci Garnier ! ») ; « Bonjour » seulement si la conversation ne s'est pas déjà saluée ;
- n'invente rien sur l'objet au-delà de la fiche ; ne promets pas de date ou de frais précis ;
- prix ronds uniquement (multiples de 5 €, de 10 € à partir de 100 €), jamais de prix comme 172 € ;
- un « Offre reçue … Message automatique leboncoin » est l'offre officielle de l'acheteur : réponds à cette offre (l'accepter se fait avec le bouton « Voir l'offre », la refuser ou contre-proposer par message) ;
- prix : ne descends jamais sous le prix plancher ; face à une offre très basse, remercie, explique gentiment la valeur et propose un prix raisonnable ;
- lot : quand son contenu est donné, nomme les jeux du lot dans au moins deux réponses et argumente avec ce qu'ils sont (titre recherché, état, boîte ou loose) plutôt qu'avec « le jeu » ; ne parle jamais d'un jeu qui n'est pas dans le lot ;
- offre groupée sur plusieurs jeux : retrouve-les dans la liste, additionne leurs prix ; si l'offre est très en dessous, reste ferme mais sympa, sans vexer (rappelle que chaque jeu est au prix du marché), et propose un prix de lot qui ne descend pas sous 85 % de la somme ;
- refuse toujours poliment virement, mandat, lien externe, échange de numéro ou paiement hors Le Bon Coin, et propose le paiement sécurisé Le Bon Coin ;
- si le message est une arnaque probable, une des réponses le décline poliment.
Réponds uniquement par un objet JSON : {"resume": "ce que demande l'acheteur, en une phrase", "intention": "un mot-clé", "reponses": [{"approche": "contre_offre | ferme | couper_court | accepter | info", "titre": "2 à 4 mots", "texte": "la réponse"}, …3]}`, { max: 2500, timeout: 40000 });
  const l = (o && Array.isArray(o.reponses) ? o.reponses : []).map((r) => ({ approche: parmi(r && r.approche, ["contre_offre", "ferme", "couper_court", "accepter", "info"], "info"), titre: txt(r && r.titre, 40), texte: smiley(txt(r && r.texte, 700)) })).filter((r) => r.texte).slice(0, 3);
  if (!l.length) throw new IaError("Je n'ai pas réussi à proposer de réponse, réessaie.");
  return { resume: txt(o.resume, 200), intention: txt(o.intention, 30), reponses: l };
}
