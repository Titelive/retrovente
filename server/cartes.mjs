// Cartes Pokémon : état « collectionneur », correspondance avec les états Le Bon Coin, et cote Cardmarket
// lue dans la base libre TCGdex (api.tcgdex.net, sans clé, noms en français, prix Cardmarket mis à jour chaque jour).

// États des cartes, du meilleur au pire, tels que les collectionneurs les écrivent sur Cardmarket et eBay.
export const ETATS_CARTE = ["mint", "near_mint", "excellent", "good", "light_played", "played", "poor", ""];
export const LIB_ETAT_CARTE = { mint: "Mint", near_mint: "Near Mint", excellent: "Excellent", good: "Good", light_played: "Light Played", played: "Played", poor: "Poor" };
// Correspondance avec les états proposés par Le Bon Coin (champ « État » du dépôt).
export const ETAT_LBC_DE_CARTE = { mint: "neuf", near_mint: "tres_bon", excellent: "tres_bon", good: "bon", light_played: "correct", played: "correct", poor: "pieces" };
export const LANGUES_TCGDEX = { francais: "fr", "français": "fr", anglais: "en", english: "en", allemand: "de", italien: "it", espagnol: "es", portugais: "pt", japonais: "ja" };

// Partie avant la barre du numéro (« 4/102 » → « 4 », « TG05/TG30 » → « TG05 », « 025 » → « 25 »).
export const numLocal = (n) => String(n || "").split("/")[0].trim().replace(/^0+(?=\d)/, "").toUpperCase();
const total = (n) => { const m = /\/\s*0*(\d+)/.exec(String(n || "")); return m ? Number(m[1]) : null; };
const sansAccent = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function lire(url, timeout = 8000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { accept: "application/json" } });
  if (!r.ok) return null;
  return r.json();
}

/* Retrouve la carte dans TCGdex (nom + numéro, puis extension ou nombre de cartes de la série pour départager)
   et renvoie sa fiche et sa cote Cardmarket. null si TCGdex ne répond pas ou ne la connaît pas. */
export async function carteTcgdex(v, { base = process.env.TCGDEX_URL || "https://api.tcgdex.net/v2" } = {}) {
  const nom = String(v.titre || "").trim(), num = numLocal(v.numero);
  if (!nom || !num) return null;
  const langue = LANGUES_TCGDEX[sansAccent(v.region).split(" ")[0]] || "fr";
  const essais = langue === "fr" ? ["fr"] : [langue, "fr"];
  for (const lg of essais) {
    try {
      const liste = await lire(`${base}/${lg}/cards?name=${encodeURIComponent(nom)}`);
      if (!Array.isArray(liste)) continue;
      const cands = liste.filter((c) => c && numLocal(c.localId) === num).slice(0, 6);
      if (!cands.length) continue;
      const fiches = (await Promise.all(cands.map((c) => lire(`${base}/${lg}/cards/${encodeURIComponent(c.id)}`).catch(() => null)))).filter(Boolean);
      if (!fiches.length) continue;
      const ext = sansAccent(v.plateforme), tot = total(v.numero);
      const score = (f) => {
        const s = f.set || {}, n = sansAccent(s.name);
        return (ext && n && (n === ext ? 4 : n.includes(ext) || ext.includes(n) ? 2 : 0)) + (tot && s.cardCount && (s.cardCount.official === tot) ? 3 : 0);
      };
      fiches.sort((a, b) => score(b) - score(a));
      if (fiches.length > 1 && score(fiches[0]) === 0) return null;   // plusieurs cartes possibles, aucune ne colle : on ne devine pas
      return resumer(fiches[0], v);
    } catch (e) { console.error("TCGdex", e.message); }
  }
  return null;
}

// Cardmarket donne deux cotes par carte : normale, et « holo » (la version reverse pour les cartes récentes).
export function resumer(f, v = {}) {
  const cm = (f.pricing && f.pricing.cardmarket) || null, s = f.set || {};
  const reverse = /reverse/i.test(v.rarete || "") || (f.variants && f.variants.holo === false && f.variants.normal === false && f.variants.reverse === true);
  const k = (x) => (reverse ? x + "-holo" : x);
  const n = (x) => (cm && typeof cm[x] === "number" && cm[x] > 0 ? Math.round(cm[x] * 100) / 100 : null);
  const cote = cm ? { tendance: n(k("trend")), moyenne30: n(k("avg30")), bas: n(k("low")), moyenne: n(k("avg")), maj: String(cm.updated || "").slice(0, 10), variante: reverse ? "reverse" : "normale" } : null;
  return {
    id: String(f.id || ""), nom: String(f.name || ""), numero: `${f.localId || ""}${s.cardCount && s.cardCount.official ? "/" + s.cardCount.official : ""}`,
    extension: String(s.name || ""), rarete: String(f.rarity || ""), image: f.image ? f.image + "/high.webp" : "",
    premiereEdition: !!(f.variants && f.variants.firstEdition),
    cote: cote && (cote.tendance != null || cote.moyenne30 != null) ? cote : null,
  };
}

// Lien de recherche Cardmarket (pour vérifier la cote d'un clic ; TCGdex ne donne pas l'adresse exacte du produit).
export const lienCardmarket = (nom, ext) => `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent([nom, ext].filter(Boolean).join(" "))}`;
