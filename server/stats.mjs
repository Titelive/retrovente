/* ===== Vues et favoris des annonces en ligne =====
   Le Bon Coin (« Mes annonces ») et eBay (Seller Hub, annonces en cours) affichent pour chaque annonce son nombre de
   vues et de mises en favori (eBay : « observateurs »). L'app Mac les relève en arrière-plan, l'extension quand la
   personne passe sur ces pages ; RetroRevente les range dans la fiche de l'article dont le lien correspond :
     stats: { lbc: { url, vues, favoris, at, hist: [{ j, v, f }] }, ebay: { … } }
   « hist » garde une valeur par jour (30 jours) pour dire ce qui a bougé cette semaine. */

export const SITES_STATS = ["lbc", "ebay"];
const JOURS_HIST = 30;

/** Identifiant numérique de l'annonce dans son lien (Le Bon Coin : /ad/<catégorie>/<id>, eBay : /itm/[titre/]<id>). */
export function idAnnonce(site, url) {
  const s = String(url || "");
  const m = site === "ebay" ? /\/itm\/(?:[^/?#]+\/)?(\d{9,15})(?:[/?#]|$)/.exec(s) : /\/ad\/[a-z_]+\/(\d{6,})(?:[/?#]|$)/.exec(s);
  return m ? m[1] : "";
}

const compte = (x) => { const n = Number(x); return Number.isFinite(n) && n >= 0 && n < 1e8 ? Math.round(n) : null; };

/** Lignes reçues (« [{ id, vues, favoris }] ») : nettoyées, au plus 500, une par annonce. */
export function lignesStats(l) {
  const vus = new Map();
  for (const x of Array.isArray(l) ? l.slice(0, 500) : []) {
    const id = String((x && x.id) || "").replace(/\D/g, "");
    if (id.length < 6 || id.length > 15) continue;
    const vues = compte(x.vues), favoris = compte(x.favoris);
    if (vues == null && favoris == null) continue;
    vus.set(id, { id, vues, favoris });
  }
  return [...vus.values()];
}

/** Nouvelle entrée de stats d'un site pour une fiche ; une valeur absente garde la précédente. */
export function majStats(avant, url, l, quand = new Date()) {
  const a = avant && avant.url === url ? avant : null;
  const vues = l.vues != null ? l.vues : a ? a.vues : null, favoris = l.favoris != null ? l.favoris : a ? a.favoris : null;
  const j = quand.toISOString().slice(0, 10);
  const hist = (a && Array.isArray(a.hist) ? a.hist : []).filter((h) => h && h.j !== j && h.j >= jourAvant(quand, JOURS_HIST));
  hist.push({ j, v: vues, f: favoris });
  hist.sort((x, y) => (x.j < y.j ? -1 : 1));
  return { url, vues, favoris, at: quand.toISOString(), hist };
}
const jourAvant = (d, n) => new Date(d.getTime() - n * 864e5).toISOString().slice(0, 10);

/** Les stats gardées quand la fiche est réécrite : seulement celles du lien encore en place. */
export function garderStats(stats, annonce, annonceEbay) {
  if (!stats || typeof stats !== "object") return null;
  const r = {};
  if (stats.lbc && annonce && stats.lbc.url === annonce) r.lbc = stats.lbc;
  if (stats.ebay && annonceEbay && stats.ebay.url === annonceEbay) r.ebay = stats.ebay;
  return Object.keys(r).length ? r : null;
}

/** Évolution sur n jours (vues et favoris gagnés), d'après l'historique. */
export function evolution(e, n = 7, quand = new Date()) {
  if (!e || !Array.isArray(e.hist) || !e.hist.length) return null;
  const limite = jourAvant(quand, n), base = e.hist.find((h) => h.j >= limite) || null;
  if (!base) return null;
  return { vues: e.vues != null && base.v != null ? e.vues - base.v : null, favoris: e.favoris != null && base.f != null ? e.favoris - base.f : null, depuis: base.j };
}
