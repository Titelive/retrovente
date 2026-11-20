// Cote d'un jeu : calcul déterministe et transparent à partir des prix relevés par l'IA.
// L'IA ne fait que la collecte (chaque relevé dit s'il s'agit d'une vente conclue, d'une annonce en ligne ou
// d'une cote, et dans quel état et avec quel contenu). Les chiffres affichés (fourchette, prix de vente probable,
// prix conseillé, prix pour vendre vite) et le texte « Méthode » sont calculés ici, à partir des mêmes nombres.

export const TYPES = ["vente", "annonce", "cote"];
const RANG_ETAT = { neuf: 0, tres_bon: 1, bon: 2, correct: 3, pieces: 4 };
export const LIB_ETAT = { neuf: "neuf", tres_bon: "très bon état", bon: "bon état", correct: "état correct", pieces: "pour pièces" };
export const LIB_CONTENU = { seul: "cartouche ou disque seul", boite: "en boîte sans notice", complet: "complet, boîte et notice", boite_vide: "boîte seule" };

// Poids d'un relevé selon sa proximité avec l'objet à vendre (1 = identique).
const POIDS_ECART_ETAT = [1, 0.6, 0.3, 0.15, 0.1];
const POIDS_CONTENU = {   // clés dans l'ordre alphabétique
  "boite|seul": 0.5, "boite|complet": 0.7, "complet|seul": 0.35,
  "boite_vide|seul": 0.15, "boite|boite_vide": 0.15, "boite_vide|complet": 0.15,
};
const INCONNU = 0.7;           // état ou contenu non précisé d'un côté ou de l'autre
const POIDS_COTE = 0.6;        // une cote (PriceCharting, Retroplace…) est une moyenne, souvent hors de France
const POIDS_ANCIEN = 0.5;      // relevé de plus d'un an
export const SEUIL = 0.25;     // en dessous, le relevé est trop différent pour entrer dans le calcul
export const MARGE = 0.10;     // marge de négociation ajoutée au prix de vente probable
export const REMISE_RAPIDE = 0.15;  // vendre vite : sous le prix de vente probable
const REMISE_ANNONCES = 0.15;  // faute de ventes conclues : une annonce se vend en général plus bas que son prix affiché

const arrondi = (n) => Math.round(n * 100) / 100;
export const eur = (n) => (Number.isInteger(arrondi(n)) ? String(arrondi(n)) : arrondi(n).toFixed(2).replace(".", ",")) + "\u00a0€";
const pct = (x) => Math.round(x * 100) + "\u00a0%";

export function poidsEtat(a, b) {
  if (!(a in RANG_ETAT) || !(b in RANG_ETAT)) return INCONNU;
  return POIDS_ECART_ETAT[Math.abs(RANG_ETAT[a] - RANG_ETAT[b])];
}
export function poidsContenu(a, b) {
  if (!a || !b) return INCONNU;
  if (a === b) return 1;
  return POIDS_CONTENU[[a, b].sort().join("|")] ?? 0.3;
}

export function poidsReleve(r, cible, auj = new Date()) {
  if (r.type === "annonce") return 0;
  let p = poidsEtat(r.etat, cible.etat) * poidsContenu(r.contenu, cible.contenu);
  if (r.type === "cote") p *= POIDS_COTE;
  if (r.date && (auj - new Date(r.date)) / 864e5 > 365) p *= POIDS_ANCIEN;
  return Math.round(p * 100) / 100;
}

// Médiane pondérée : le prix au-dessous duquel se trouve la moitié du poids total.
// Si la moitié tombe pile entre deux prix, on prend leur milieu.
export function medianePonderee(l) {
  const t = [...l].sort((a, b) => a.prix - b.prix), tot = t.reduce((s, x) => s + x.poids, 0);
  let cum = 0;
  for (let i = 0; i < t.length; i++) {
    cum += t[i].poids;
    if (Math.abs(cum - tot / 2) < 1e-9 && i + 1 < t.length) return (t[i].prix + t[i + 1].prix) / 2;
    if (cum > tot / 2) return t[i].prix;
  }
  return t[t.length - 1].prix;
}

// Devine le type d'un relevé quand l'IA ne l'a pas précisé (anciennes réponses).
export function typeDe(r) {
  if (TYPES.includes(r.type)) return r.type;
  const s = `${r.site} ${r.titre}`.toLowerCase();
  if (/pricecharting|retroplace|cote|argus/.test(s)) return "cote";
  if (/en ligne|en vente|annonce(?! vendue)/.test(s)) return "annonce";
  return "vente";
}

const pluriel = (n, un, plus) => `${n} ${n > 1 ? plus : un}`;
const libType = { vente: ["vente conclue", "ventes conclues"], cote: ["cote", "cotes"] };

/* releves : [{site, titre, prix, date, url, type, etat, contenu}] ; cible : {etat, contenu}.
   Renvoie null s'il n'y a aucun prix exploitable. */
export function calculerCote(releves, cible = {}, auj = new Date()) {
  const rs = releves.map((r) => ({ ...r, type: typeDe(r) })).map((r) => ({ ...r, poids: poidsReleve(r, cible, auj) }));
  let base = rs.filter((r) => r.type !== "annonce" && r.poids >= SEUIL);
  let depuisAnnonces = false;
  if (!base.length) base = rs.filter((r) => r.type !== "annonce" && r.poids > 0);   // rien de vraiment comparable : on prend ce qu'il y a
  if (!base.length) {
    const ann = rs.filter((r) => r.type === "annonce");
    if (!ann.length) return null;
    depuisAnnonces = true;
    base = ann.map((r) => ({ ...r, poids: poidsEtat(r.etat, cible.etat) * poidsContenu(r.contenu, cible.contenu), prixCalcul: arrondi(r.prix * (1 - REMISE_ANNONCES)) }));
  }
  base = base.map((r) => ({ ...r, prixCalcul: r.prixCalcul ?? r.prix }));
  const pts = base.map((r) => ({ prix: r.prixCalcul, poids: r.poids }));
  const bas = Math.min(...pts.map((p) => p.prix)), haut = Math.max(...pts.map((p) => p.prix));
  const probable = arrondi(medianePonderee(pts));

  // Annonces en ligne comparables : elles ne comptent pas comme des ventes, mais ce sont les concurrentes de l'acheteur.
  const annComp = rs.filter((r) => r.type === "annonce").map((r) => ({ prix: r.prix, poids: poidsEtat(r.etat, cible.etat) * poidsContenu(r.contenu, cible.contenu) })).filter((r) => r.poids >= SEUIL);
  const plafondAnnonces = !depuisAnnonces && annComp.length ? arrondi(medianePonderee(annComp)) : null;

  // Prix affiché : le prix probable plus la marge de négociation, arrondi à l'euro. Plafond : le prix médian des annonces
  // concurrentes quand il y en a (au-delà, les acheteurs ne viennent pas), sinon le plus haut des prix constatés.
  const voulu = Math.round(probable * (1 + MARGE));
  const plafond = plafondAnnonces ?? haut, limite = voulu > plafond ? (plafondAnnonces != null ? "annonces" : "haut") : "";
  let conseille = Math.min(voulu, Math.floor(plafond));
  if (conseille < probable - 0.5) conseille = Math.round(probable);
  // Vendre vite : sous le prix probable, sans descendre sous le prix le plus bas constaté s'il est en dessous.
  let rapide = Math.round(bas < probable - 0.5 ? Math.max(bas, probable * (1 - REMISE_RAPIDE)) : probable * (1 - REMISE_RAPIDE));
  if (rapide > probable) rapide = Math.floor(probable);
  if (rapide >= conseille) rapide = null;

  const cle = (r) => r.url + "|" + r.prix, compte = new Map(base.map((r) => [cle(r), r.poids]));
  const sortie = rs.map((r) => ({ ...r, poids: compte.get(cle(r)) ?? r.poids, compte: compte.has(cle(r)) }))
    .sort((a, b) => (b.compte - a.compte) || (b.poids - a.poids) || (b.prix - a.prix));
  const annonces = rs.filter((r) => r.type === "annonce");
  const ecartes = rs.filter((r) => r.type !== "annonce" && !compte.has(cle(r)));

  const quoi = [LIB_CONTENU[cible.contenu], LIB_ETAT[cible.etat]].filter(Boolean).join(", ");
  const phr = [];
  const fourchette = bas === haut ? `${eur(bas)}` : `de ${eur(bas)} à ${eur(haut)}`;
  if (depuisAnnonces) {
    phr.push(`Je n'ai trouvé aucune vente conclue : je pars ${base.length > 1 ? `des ${base.length} annonces en ligne` : "de l'annonce en ligne"}, moins ${pct(REMISE_ANNONCES)} (une annonce se vend en général sous son prix affiché), soit ${fourchette}.`);
  } else {
    const parType = ["vente", "cote"].map((t) => [t, base.filter((r) => r.type === t).length]).filter(([, n]) => n).map(([t, n]) => pluriel(n, ...libType[t])).join(" et ");
    const types = new Set(base.map((r) => r.type)).size;
    phr.push(`Je compte ${types > 1 ? `${pluriel(base.length, "prix", "prix")} (${parType})` : parType}${quoi ? `${", pondéré" + (types > 1 ? "" : "e") + (base.length > 1 ? "s" : "")} selon ${base.length > 1 ? "leur" : "sa"} ressemblance avec ton objet (${quoi})` : ""} : ${fourchette}.`);
  }
  phr.push(base.length > 1 ? `Leur médiane pondérée donne le prix de vente probable : ${eur(probable)}.` : `Ce seul prix sert de prix de vente probable : ${eur(probable)}.`);
  const ecart = conseille - probable;
  const pourquoi = limite === "annonces" ? `sans dépasser le prix médian des annonces concurrentes (${eur(plafondAnnonces)})` : limite === "haut" ? "sans dépasser le plus haut des prix constatés" : "";
  phr.push(ecart > 0.5 ? `Prix conseillé ${eur(conseille)} : ${eur(arrondi(ecart))} de marge pour la négociation${pourquoi ? ", " + pourquoi : ` (+${pct(MARGE)})`}.`
    : `Prix conseillé ${eur(conseille)}, au niveau du prix probable : ${pourquoi ? pourquoi.replace(/^sans dépasser/, "plus cher, il dépasserait") : "pas de marge possible"}, et les acheteurs iraient voir ailleurs.`);
  if (rapide != null) phr.push(rapide <= bas + 0.5 && bas < probable - 0.5 ? `Pour vendre vite, ${eur(rapide)} : le prix le plus bas constaté.` : `Pour vendre vite, ${eur(rapide)} : ${pct(REMISE_RAPIDE)} sous le prix probable.`);
  const annPrix = rs.filter((r) => r.type === "annonce").map((r) => r.prix);
  if (annPrix.length && !depuisAnnonces) { const a = Math.min(...annPrix), b = Math.max(...annPrix); phr.push(`${annPrix.length > 1 ? `Les ${annPrix.length} annonces encore en ligne (${a === b ? eur(a) : `de ${eur(a)} à ${eur(b)}`}) ne sont pas comptées comme des ventes` : `L'annonce encore en ligne (${eur(a)}) n'est pas comptée comme une vente`}${plafondAnnonces != null ? (annPrix.length > 1 ? ", mais elles servent de repère : ce sont tes concurrentes" : ", mais elle sert de repère : c'est ta concurrente") : ""}.`); }
  if (ecartes.length) phr.push(`${pluriel(ecartes.length, "prix est écarté", "prix sont écartés")}, trop différent${ecartes.length > 1 ? "s" : ""} de ton objet (état ou contenu).`);

  return { bas, haut, probable, conseille, rapide, methode: phr.join(" "), releves: sortie, depuisAnnonces };
}
