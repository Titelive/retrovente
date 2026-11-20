// Lots : plusieurs articles de Mes articles vendus ensemble, dans une seule annonce.
// Le lot est lui-même un article (photos, annonce, prix, statut) qui porte la liste de ses articles (« articles ») ;
// chaque article du lot porte l'identifiant de son lot (« lot »). Fonctions pures, testées dans test/lots.test.mjs.

export const MIN_LOT = 2, MAX_LOT = 30;
// En dessous de ce prix, un article se vend mieux dans un lot qu'à l'unité (même seuil que les cartes et les films).
export const PRIX_PETIT = 5;
// Port moyen d'un petit colis (Mondial Relay, Colissimo point retrait) : ce que l'acheteur économise par envoi évité.
export const PORT_MOYEN = 4.5;

const num = (v) => (v == null || v === "" || !isFinite(+v) ? null : +v);
/** Valeur d'un article à l'unité : prix conseillé de sa cote, sinon le prix affiché. */
export const valeurArticle = (o) => num(o && o.cote && o.cote.conseille) ?? num(o && o.prixDemande);

/** Remise conseillée selon la taille du lot : l'acheteur gagne du temps et des frais de port, il attend un geste. */
export function remiseLot(n) {
  if (n >= 10) return 0.25;
  if (n >= 5) return 0.2;
  if (n >= 3) return 0.15;
  return 0.1;
}
// Prix ronds : à l'euro sous 10 €, puis par 5, puis par 10 à partir de 100 €.
export const rondLot = (x) => { if (x == null || !isFinite(x)) return null; if (x < 10) return Math.max(1, Math.round(x)); const pas = x >= 100 ? 10 : 5; return Math.round(x / pas) * pas; };

/** Cote d'un lot : somme à l'unité, ajustement conseillé, prix conseillé et prix pour vendre vite.
    theme : { nom, type, complet } quand le lot a une cohérence (licence, série, studio) :
    - un lot à thème plaît aux collectionneurs : la remise baisse de 5 points ;
    - une série complète sur son support vaut plus que ses morceaux : prime de 10 % au lieu d'une remise ;
    - un lot fait surtout de petits articles (moins de 5 €) garde sa remise : c'est le volume qui le vend. */
export function coteLot(articles, theme = null) {
  const l = (Array.isArray(articles) ? articles : []).filter(Boolean);
  const vals = l.map(valeurArticle), connus = vals.filter((v) => v != null);
  const somme = Math.round(connus.reduce((a, v) => a + v, 0) * 100) / 100;
  const petits = vals.filter((v) => v != null && v < PRIX_PETIT).length;
  const base = remiseLot(l.length), raisons = [];
  let ajust = -base;
  raisons.push(`Lot de ${l.length} : −${Math.round(base * 100)} %, l'acheteur paie un seul envoi au lieu de ${l.length}.`);
  if (theme && theme.complet) {
    ajust = 0.1;
    raisons.push(`${theme.nom ? theme.nom + " : s" : "S"}érie complète, elle vaut plus que la somme de ses jeux : +10 %.`);
  } else if (theme && theme.nom && petits * 2 < l.length) {
    ajust = Math.min(-0.05, ajust + 0.05);
    raisons.push(`Lot à thème (${theme.nom}) : il attire les collectionneurs, la remise baisse à ${Math.round(-ajust * 100)} %.`);
  }
  if (petits * 2 >= l.length && l.length >= 3 && !(theme && theme.complet)) raisons.push(`${petits} article${petits > 1 ? "s valent" : " vaut"} moins de ${PRIX_PETIT} € : seul${petits > 1 ? "s" : ""}, ${petits > 1 ? "ils partiraient" : "il partirait"} mal, en lot ${petits > 1 ? "ils trouvent" : "il trouve"} preneur.`);
  const px = (k) => (somme ? Math.max(PRIX_PETIT, rondLot(somme * (1 + k))) : null);
  return {
    n: l.length, somme, ajust, remise: -ajust,
    conseille: px(ajust),
    rapide: px(ajust - 0.1),
    sansPrix: l.length - connus.length,
    petits, raisons,
    port: Math.round((l.length - 1) * PORT_MOYEN),
    theme: theme && theme.nom ? { nom: String(theme.nom).slice(0, 60), type: theme.type || "", complet: !!theme.complet } : null,
  };
}

/** Partage un montant (prix de vente, frais) entre les articles, au prorata de leur valeur, au centime près. */
export function repartir(total, articles) {
  const l = Array.isArray(articles) ? articles : [];
  if (total == null || !l.length) return l.map(() => null);
  const c = Math.round(total * 100), vals = l.map(valeurArticle), connus = vals.filter((v) => v != null && v > 0);
  const moy = connus.length ? connus.reduce((a, v) => a + v, 0) / connus.length : 1;
  const poids = vals.map((v) => (v != null && v > 0 ? v : moy)), tot = poids.reduce((a, v) => a + v, 0);
  const parts = poids.map((p) => Math.floor((c * p) / tot));
  let reste = c - parts.reduce((a, v) => a + v, 0);
  // les centimes restants vont aux articles qui pèsent le plus
  const ordre = poids.map((p, i) => i).sort((a, b) => poids[b] - poids[a]);
  for (let k = 0; reste > 0; k = (k + 1) % ordre.length, reste--) parts[ordre[k]]++;
  return parts.map((x) => x / 100);
}

const NOMS = { jeux: ["jeu", "jeux"], consoles: ["console", "consoles"], accessoires: ["accessoire", "accessoires"], cartes: ["carte Pokémon", "cartes Pokémon"], films: ["film", "films"], autres: ["objet", "objets"] };
const ORDRE_ETAT = ["neuf", "tres_bon", "bon", "correct", "pieces"];
const FORMAT_COURT = { "Blu-Ray 4K UHD": "4K UHD", "Blu-Ray 4K UHD + Blu-Ray": "4K UHD" };
const et = (l) => (l.length < 2 ? l.join("") : l.slice(0, -1).join(", ") + " et " + l[l.length - 1]);

/** Ce que le lot a en commun : catégorie la plus présente, support commun, état le moins bon (on reste honnête). */
export function resumeLot(articles) {
  const l = articles.filter(Boolean), par = {};
  for (const o of l) par[o.categorie || "jeux"] = (par[o.categorie || "jeux"] || 0) + 1;
  const cats = Object.keys(par).sort((a, b) => par[b] - par[a] || Object.keys(NOMS).indexOf(a) - Object.keys(NOMS).indexOf(b));
  const supp = (o) => (o.categorie === "films" ? FORMAT_COURT[o.plateforme] || o.plateforme || "" : o.categorie === "cartes" ? "" : o.plateforme || "").trim();
  const s0 = supp(l[0] || {}), commun = s0 && l.every((o) => supp(o).toLowerCase() === s0.toLowerCase()) ? s0 : "";
  const etats = l.map((o) => ORDRE_ETAT.indexOf(o.etat)).filter((i) => i >= 0);
  return { categorie: cats[0] || "autres", par, cats, plateforme: commun, etat: etats.length ? ORDRE_ETAT[Math.max(...etats)] : "" };
}

/** Titre du lot : « Lot de 3 jeux Nintendo 64 », « Lot de 5 films Blu-Ray », « Lot Nintendo 64 : 1 console et 4 jeux ». */
export function titreLot(articles, theme = null) {
  const r = resumeLot(articles), n = articles.filter(Boolean).length;
  const part = (c) => `${r.par[c]} ${NOMS[c] ? NOMS[c][r.par[c] > 1 ? 1 : 0] : "objets"}`;
  // Lot à thème : le thème d'abord, c'est lui qu'on cherche sur Le Bon Coin (« Lot Banjo », « Lot Rareware »).
  if (theme && theme.nom && !["petits prix", "support"].includes(theme.type)) return `Lot ${theme.nom}${theme.complet ? " (série complète)" : ""} : ${et(r.cats.map(part))}${r.plateforme ? " " + r.plateforme : ""}`.slice(0, 100);
  const t = r.cats.length === 1 ? `Lot de ${part(r.cats[0])}${r.plateforme ? " " + r.plateforme : ""}` : `Lot${r.plateforme ? " " + r.plateforme : ""} : ${et(r.cats.map(part))}`;
  return (n ? t : "Lot").slice(0, 100);
}

const ETAT_TXT = { neuf: "neuf", tres_bon: "très bon état", bon: "bon état", correct: "état correct", pieces: "pour pièces" };
const CONT_TXT = { seul: "loose", boite: "en boîte sans notice", complet: "complet en boîte", boite_vide: "boîte seule" };
const eur = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace(".", ",")) + " €";

/** Une ligne par article dans la description : « Super Mario 64 (Nintendo 64), complet en boîte, très bon état ». */
export function ligneArticle(o, commun = "") {
  const film = o.categorie === "films", carte = o.categorie === "cartes";
  const supp = film ? FORMAT_COURT[o.plateforme] || o.plateforme : carte ? [o.numero, o.plateforme].filter(Boolean).join(", ") : o.plateforme;
  const nom = o.titre + (supp && supp.toLowerCase() !== String(commun).toLowerCase() ? ` (${supp})` : "");
  const det = [film && o.edition ? o.edition.split(/\s*,\s*/)[0] : "", carte ? o.gradation : "", !film && !carte ? CONT_TXT[o.contenu] : "", ETAT_TXT[o.etat]].filter(Boolean);
  return nom + (det.length ? ", " + det.join(", ") : "");
}

/** Annonce du lot sans l'IA : liste des articles, valeur à l'unité, un seul envoi. Sert aussi de secours à l'IA. */
export function annonceLotSimple(articles, prixLot, theme = null) {
  const l = articles.filter(Boolean), r = resumeLot(l), c = coteLot(l);
  const titre = titreLot(l, theme);
  const retro = l.every((o) => ["jeux", "consoles", "accessoires"].includes(o.categorie || "jeux"));
  const desc = [
    `${titre}${l.length <= 40 ? " :" : "."}`,
    ...l.slice(0, 40).map((o) => "- " + ligneArticle(o, r.plateforme)),
    "",
    theme && theme.complet ? `La série complète${r.plateforme ? " sur " + r.plateforme : ""}, réunie dans un seul lot.` : "",
    retro && l.every((o) => (o.origine || "origine") === "origine") ? "Tout est d'origine, testé et fonctionnel." : "",
    c.somme && prixLot && prixLot < c.somme ? `Vendus séparément, ils valent environ ${eur(Math.round(c.somme))} : le lot est à ${eur(prixLot)}.` : "",
    "Pas de vente à l'unité pour le moment.",
    "Remise en main propre ou envoi soigné, en un seul colis.",
  ].filter((x, i, a) => x !== "" || (i > 0 && a[i - 1] !== ""));
  return { titre, description: desc.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

/* ===== Lots proposés par thème =====
   Sans l'IA : mots en commun dans les titres (Zelda, Banjo, Star Wars…), quelques studios et lignées connus
   (Rareware, GoldenEye et Perfect Dark…), puis les petits prix d'une même catégorie. L'IA, elle, connaît
   toutes les licences, séries, studios et héritiers spirituels (voir ia.suggererLots). */
const VIDES = new Set("the of and for les des une aux avec dans pour sur edition édition collector collection version deluxe ultimate remastered definitive complete game games jeu jeux pack super new nouvelle plus edition hd remaster limited limitée steelbook coffret world adventure adventures".split(" "));
const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
// Studios et lignées : nom du thème, type, motifs des titres. Une liste courte et sûre ; l'IA complète.
export const THEMES_CONNUS = [
  { nom: "Rareware", type: "studio", re: /banjo|conker|goldeneye|golden eye|perfect dark|donkey kong (country|64)|diddy kong|jet force gemini|blast corps|killer instinct|battletoads|viva pinata|kameo|grabbed by the ghoulies|star fox adventures|r\.?c\.? pro-?am|snake rattle/ },
  { nom: "GoldenEye et Perfect Dark", type: "lignée", re: /goldeneye|golden eye|perfect dark/ },
  { nom: "Naughty Dog", type: "studio", re: /crash bandicoot|crash team racing|jak (and|&|et) daxter|jak (ii|2|3|x)|uncharted|the last of us/ },
  { nom: "Insomniac Games", type: "studio", re: /spyro|ratchet|resistance|sunset overdrive/ },
  { nom: "Star Wars", type: "licence", re: /star wars|lego star wars|rogue squadron|shadows of the empire|knights of the old republic|jedi|battlefront|clone wars/ },
  { nom: "Marvel", type: "univers", re: /marvel|spider-?man|x-?men|avengers|iron man|wolverine|hulk|captain america|guardians of the galaxy|deadpool|fantastic four|venom/ },
  { nom: "Disney", type: "univers", re: /disney|pixar|kingdom hearts|toy story|mickey|donald|aladdin|le roi lion|the lion king|epic mickey|monstres et cie|ratatouille|cars\b|frozen|la reine des neiges/ },
];
const mots = (t) => [...new Set(norm(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !VIDES.has(w)))];
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

/** Lots proposés à partir des articles libres (pas vendus, pas déjà dans un lot). Renvoie au plus `max` idées. */
export function suggestionsLocales(articles, max = 6) {
  const l = articles.filter(Boolean), out = [], vus = new Set();
  const ajouter = (nom, type, ids, raison) => {
    const k = [...ids].sort().join(",");
    if (ids.length < MIN_LOT || vus.has(k)) return;
    vus.add(k); out.push({ theme: nom, type, articles: ids.slice(0, MAX_LOT), complet: false, raison });
  };
  // 1. Séries : un mot rare en commun dans les titres (Zelda, Banjo, Mario Kart…). Les mots qui donnent le même groupe sont réunis (« Star Wars »). En premier : à composition égale, la série est plus parlante que le studio.
  const par = new Map();
  for (const o of l) for (const w of mots(o.titre)) { if (!par.has(w)) par.set(w, []); par.get(w).push(o); }
  const groupes = new Map();
  for (const [w, g] of par) {
    if (g.length < MIN_LOT || g.length > Math.max(3, l.length * 0.6)) continue;   // un mot partout n'est pas un thème
    const k = g.map((o) => o.id).sort().join(",");
    if (!groupes.has(k)) groupes.set(k, { mots: [], g });
    groupes.get(k).mots.push(w);
  }
  for (const { mots: ws, g } of [...groupes.values()].sort((a, b) => b.g.length - a.g.length)) {
    const t0 = norm(g[0].titre), nom = ws.sort((a, b) => t0.indexOf(a) - t0.indexOf(b)).slice(0, 3).map(cap).join(" ");
    ajouter(nom, "série", g.map((o) => o.id), `${g.length} ${nom} : une série se vend mieux réunie.`);
  }
  // 2. Studios, licences et lignées connus
  for (const t of THEMES_CONNUS) {
    const ids = l.filter((o) => t.re.test(norm(o.titre))).map((o) => o.id);
    ajouter(t.nom, t.type, ids, t.type === "studio" ? `Des jeux du studio ${t.nom} : les fans les cherchent ensemble.` : t.type === "lignée" ? "La même lignée de jeux : qui aime l'un veut l'autre." : `L'univers ${t.nom} réuni dans une seule annonce.`);
  }
  // 3. Petits prix d'une même catégorie (moins de 5 € : seuls, ils partent mal)
  const NOM_CAT = { jeux: "jeux", consoles: "consoles", accessoires: "accessoires", cartes: "cartes Pokémon", films: "films", autres: "objets" };
  for (const c of Object.keys(NOM_CAT)) {
    const g = l.filter((o) => (o.categorie || "jeux") === c && valeurArticle(o) != null && valeurArticle(o) < PRIX_PETIT);
    ajouter(`Les ${NOM_CAT[c]} à petit prix`, "petits prix", g.map((o) => o.id), `Moins de ${PRIX_PETIT} € pièce : seuls, ils coûtent presque autant en port qu'ils ne rapportent.`);
  }
  // 4. Un même support (au moins 3 jeux)
  const supp = new Map();
  for (const o of l) { const s = (o.categorie === "cartes" ? "" : o.plateforme || "").trim(); if (s && o.categorie !== "consoles") { const k = s.toLowerCase(); if (!supp.has(k)) supp.set(k, { s, g: [] }); supp.get(k).g.push(o); } }
  for (const { s, g } of [...supp.values()].sort((a, b) => b.g.length - a.g.length)) if (g.length >= 3) ajouter(`${g[0].categorie === "films" ? "Films" : "Jeux"} ${s}`, "support", g.map((o) => o.id), `${g.length} articles ${s} : un lot pour qui vient d'acheter la console.`);
  return out.slice(0, max);
}
