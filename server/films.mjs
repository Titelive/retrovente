// Films (Blu-Ray, Blu-Ray 4K UHD, DVD…) : formats et éditions, et infos pour la fiche du film
// (affiche, images, synopsis, réalisateur, casting, notes de la presse et des spectateurs).
// - TMDB (themoviedb.org) : affiche, images, synopsis en français, durée, genres, casting, note des spectateurs.
//   Clé gratuite (TMDB_API_KEY : clé API v3 ou jeton de lecture v4). Usage commercial : licence à demander à TMDB.
// - Wikidata : note de la presse (Metacritic) quand elle est connue, sans clé.
// - Sans clé TMDB : synopsis de Wikipédia en français (licence CC BY-SA 4.0) et infos Wikidata (année, réalisateur, genres, durée).
// Les réponses sont gardées en base 30 jours (7 jours quand rien n'est trouvé), dans la même table que les jeux.
import { db, now } from "./db.mjs";
import { sansAccent, couper } from "./jeux.mjs";

/* ===== Formats et éditions ===== */
export const FORMATS_FILM = ["Blu-Ray 4K UHD", "Blu-Ray 4K UHD + Blu-Ray", "Blu-Ray", "Blu-Ray 3D", "DVD", "HD DVD", "VHS"];
export const EDITIONS_FILM = ["Steelbook", "Édition collector", "Édition limitée", "Coffret", "Mediabook", "Digibook"];
// « 4K Ultra HD + Blu-ray » → « Blu-Ray 4K UHD + Blu-Ray », « bluray » → « Blu-Ray », « dvd » → « DVD ».
export function formatFilm(t) {
  const s = sansAccent(t);
  if (!s) return "";
  if (/\b(4k|uhd|ultra hd)\b/.test(s)) return /\+\s*/.test(String(t)) && /blu ?ray/.test(s.replace(/4k|uhd|ultra hd/g, "")) ? "Blu-Ray 4K UHD + Blu-Ray" : "Blu-Ray 4K UHD";
  if (/blu ?ray|\bbd\b/.test(s)) return /\b3d\b/.test(s) ? "Blu-Ray 3D" : "Blu-Ray";
  if (/hd ?dvd/.test(s)) return "HD DVD";
  if (/\bdvd\b/.test(s)) return "DVD";
  if (/\bvhs\b|cassette|\bk7\b/.test(s)) return "VHS";
  return String(t).trim().slice(0, 60);
}
// Format court pour les titres d'annonce et les groupes de « Mes articles ».
// « Steelbook, Édition limitée » → « Steelbook, édition limitée » (les noms de boîtiers gardent leur majuscule).
export const editionTexte = (e) => String(e || "").split(/\s*,\s*/).filter(Boolean).map((x) => (/book$/i.test(x) ? x : x.charAt(0).toLowerCase() + x.slice(1))).join(", ");
export const formatCourt = (f) => ({ "Blu-Ray 4K UHD": "4K UHD", "Blu-Ray 4K UHD + Blu-Ray": "4K UHD + Blu-Ray" })[f] || f;

/* ===== Fiche du film ===== */
db.exec(`CREATE TABLE IF NOT EXISTS jeux_infos (cle TEXT PRIMARY KEY, data TEXT NOT NULL, at TEXT NOT NULL)`);
const UA = "RetroRevente/1.0 (https://retrorevente.fr; bonjour@retrorevente.fr)";
const FAKE = () => process.env.IA_FAKE === "1" && !process.env.TMDB_URL && !process.env.WIKI_URL;
const TMDB = () => (process.env.TMDB_URL || "https://api.themoviedb.org/3").replace(/\/$/, "");
const WIKI = () => (process.env.WIKI_URL || "https://fr.wikipedia.org").replace(/\/$/, "");
const WIKIDATA = () => (process.env.WIKIDATA_URL || "https://www.wikidata.org").replace(/\/$/, "");
const IMG = (taille, chemin) => `https://image.tmdb.org/t/p/${taille}${chemin}`;
const cleTmdb = () => String(process.env.TMDB_API_KEY || "").trim();

async function lire(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { "user-agent": UA, accept: "application/json", ...(opts.headers || {}) }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(new URL(url).host + " " + r.status);
  return r.json();
}
// Clé v3 (32 caractères) dans l'adresse, jeton v4 (long, commence par « eyJ ») en en-tête.
function tmdb(chemin, params = {}) {
  const k = cleTmdb(), q = new URLSearchParams({ language: "fr-FR", ...params });
  const jeton = k.length > 40;
  if (k && !jeton) q.set("api_key", k);
  return lire(`${TMDB()}${chemin}?${q}`, jeton ? { headers: { authorization: "Bearer " + k } } : {});
}

// « Dune : Deuxième partie (Blu-Ray 4K) - steelbook » → « dune deuxieme partie »
const nomSeul = (t) => sansAccent(String(t || "").replace(/\s[-–—|]\s.*$/, "").replace(/[([].*$/, "").replace(/\b(blu ?ray|4k|uhd|dvd|steelbook|edition|collector)\b.*$/i, ""));
const VIDES = new Set(["the", "le", "la", "les", "l", "a", "an", "of", "de", "du", "des", "et", "and", "un", "une"]);
const ROMAINS = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
const mots = (s) => sansAccent(s).split(" ").filter(Boolean).map((m) => ROMAINS[m] || m).filter((m) => !VIDES.has(m));
const anneeDe = (d) => (/^\d{4}/.test(String(d || "")) ? Number(String(d).slice(0, 4)) : null);

/* Score d'un résultat TMDB pour le titre (français ou original) et l'année de la fiche. */
export function scoreFilm(f, titre, annee) {
  const voulu = mots(nomSeul(titre));
  if (!voulu.length) return 0;
  let s = 0;
  for (const n of [f.title, f.original_title]) {
    const m = mots(n);
    if (!m.length) continue;
    const communs = voulu.filter((x) => m.includes(x)).length, egal = communs === voulu.length && communs === m.length;
    s = Math.max(s, egal ? 10 : communs === voulu.length ? 6 - Math.min(3, m.length - communs) : (4 * communs) / Math.max(voulu.length, m.length));
  }
  const a = anneeDe(f.release_date), b = Number(annee) || null;
  if (a && b) s += a === b ? 4 : Math.abs(a - b) === 1 ? 2 : -2;
  if (f.poster_path) s += 0.5;
  s += Math.min(1, (Number(f.popularity) || 0) / 50);   // à titre égal, le film le plus connu
  return s;
}

const resumeAutre = (f) => ({ ref: f.id, nom: String(f.title || f.original_title || ""), annee: anneeDe(f.release_date), plateformes: f.original_title && f.original_title !== f.title ? String(f.original_title) : "" });

async function chercherTmdb(titre, annee, ref) {
  if (ref) return { choisi: { id: Number(ref) }, autres: [] };
  const nom = String(titre).replace(/\s[-–—|]\s.*$/, "").replace(/[([].*$/, "").trim() || titre;
  const j = await tmdb("/search/movie", { query: nom.slice(0, 120), include_adult: "false" });
  const liste = Array.isArray(j && j.results) ? j.results : [];
  if (!liste.length) return { choisi: null, autres: [] };
  const notes = liste.slice(0, 15).map((f) => ({ f, s: scoreFilm(f, titre, annee) })).sort((a, b) => b.s - a.s);
  const choisi = notes[0].s >= 5 ? notes[0].f : null;   // sinon on ne devine pas : la personne choisit dans la liste
  return { choisi, autres: notes.filter((x) => x.f !== choisi).slice(0, 6).map((x) => resumeAutre(x.f)) };
}

/* Note de la presse (Metacritic, sur 100) lue dans Wikidata, à partir de l'identifiant IMDb ou de l'élément Wikidata. */
const METACRITIC = "Q150248";
async function elementWikidata({ imdb, qid }) {
  if (!qid && imdb) {
    const j = await lire(`${WIKIDATA()}/w/api.php?${new URLSearchParams({ action: "query", format: "json", list: "search", srsearch: `haswbstatement:P345=${imdb}`, srlimit: "1" })}`);
    qid = ((((j || {}).query || {}).search || [])[0] || {}).title;
  }
  if (!/^Q\d+$/.test(String(qid || ""))) return null;
  const j = await lire(`${WIKIDATA()}/w/api.php?${new URLSearchParams({ action: "wbgetentities", format: "json", ids: qid, props: "claims" })}`);
  return ((j || {}).entities || {})[qid] || null;
}
const valeurs = (e, p) => (((e && e.claims) || {})[p] || []).map((c) => c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value).filter((v) => v != null);
export function notePresse(e) {
  for (const c of ((e && e.claims) || {}).P444 || []) {
    const par = (((c.qualifiers || {}).P447 || [])[0] || {}).datavalue;
    if (!par || !par.value || par.value.id !== METACRITIC) continue;
    const m = /^(\d{1,3})\s*\/\s*100$/.exec(String((c.mainsnak.datavalue || {}).value || "").trim());
    const nb = Number(((((c.qualifiers || {}).P7887 || [])[0] || {}).datavalue || {}).value?.amount) || 0;   // nombre de critiques, s'il est donné
    if (m) return { valeur: Number(m[1]), nb: nb || null, source: "Metacritic" };
  }
  return null;
}

/* Sans clé TMDB : Wikipédia en français (synopsis) + Wikidata (année, réalisateur, genres, durée, presse). */
async function wikipediaFilm(titre, annee) {
  const nom = String(titre).replace(/[([].*$/, "").trim();
  const q = new URLSearchParams({ action: "query", format: "json", formatversion: "2", generator: "search", gsrsearch: `${nom} film${annee ? " " + annee : ""}`, gsrlimit: "6", gsrnamespace: "0",
    prop: "extracts|info|pageprops", exintro: "1", explaintext: "1", exlimit: "6", inprop: "url", ppprop: "wikibase_item", redirects: "1" });
  const j = await lire(`${WIKI()}/w/api.php?${q}`);
  const pages = ((j || {}).query || {}).pages || [];
  pages.sort((a, b) => (a.index || 0) - (b.index || 0));
  const voulu = mots(nomSeul(nom));
  for (const p of pages) {
    const t = mots(String(p.title || "").replace(/\(.*\)/, "")), x = String(p.extract || "");
    // le bon article : son titre reprend les mots du film, et c'est bien un film (« … est un film américain réalisé par … »)
    if (!voulu.length || !voulu.every((m) => t.includes(m)) || t.length > voulu.length + 2 || !/\bfilm\b/i.test(x.slice(0, 400))) continue;
    return { page: p, texte: couper(x, 900), source: { nom: "Wikipédia", url: p.fullurl || `${WIKI()}/wiki/${encodeURIComponent(p.title)}`, licence: "CC BY-SA 4.0" } };
  }
  return null;
}
async function libelles(ids) {
  if (!ids.length) return {};
  const j = await lire(`${WIKIDATA()}/w/api.php?${new URLSearchParams({ action: "wbgetentities", format: "json", ids: ids.slice(0, 20).join("|"), props: "labels", languages: "fr|en" })}`);
  const out = {};
  for (const [id, e] of Object.entries((j && j.entities) || {})) out[id] = ((e.labels || {}).fr || (e.labels || {}).en || {}).value || "";
  return out;
}

/* Met en forme ce que la fiche affiche (même forme que la fiche d'un jeu, plus réalisateur, casting et durée). */
export function infosDeTmdb(f, desc, autres = [], presse = null) {
  const credits = f.credits || {};
  const real = (credits.crew || []).filter((c) => c.job === "Director").map((c) => c.name).filter(Boolean);
  const acteurs = (credits.cast || []).slice(0, 4).map((c) => c.name).filter(Boolean);
  const imgs = ((f.images || {}).backdrops || []).filter((x) => x && x.file_path).sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  const fonds = (imgs.length ? imgs : f.backdrop_path ? [{ file_path: f.backdrop_path }] : []).slice(0, 8).map((x) => ({ petite: IMG("w780", x.file_path), grande: IMG("w1280", x.file_path) }));
  const spect = typeof f.vote_average === "number" && f.vote_average > 0 && (f.vote_count || 0) >= 10 ? { valeur: Math.round(f.vote_average * 10), nb: f.vote_count } : null;
  return {
    ref: f.id, nom: String(f.title || f.original_title || ""), titreOriginal: f.original_title && f.original_title !== f.title ? String(f.original_title) : "",
    annee: anneeDe(f.release_date), duree: Number(f.runtime) || null,
    genres: (f.genres || []).map((g) => g.name).filter(Boolean).slice(0, 3),
    realisateur: real.slice(0, 2).join(", "), acteurs, studio: "",
    jaquette: f.poster_path ? { petite: IMG("w342", f.poster_path), grande: IMG("w780", f.poster_path) } : null,
    captures: fonds,
    description: desc ? desc.texte : "", descriptionSource: desc ? desc.source : null,
    notes: { presse: presse ? { valeur: presse.valeur, nb: presse.nb, source: presse.source } : null, joueurs: spect },
    lien: `https://www.themoviedb.org/movie/${f.id}`, source: "TMDB",
    autres,
  };
}

/* Exemple hors ligne (IA_FAKE=1) : images dessinées, pour les tests et le développement. */
const svg = (w, h, fond, texte) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${fond[0]}"/><stop offset="1" stop-color="${fond[1]}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="52%" font-family="sans-serif" font-size="${Math.round(h / 9)}" font-weight="700" fill="#fff" text-anchor="middle">${texte}</text></svg>`);
function exemple(titre) {
  const caps = [["#1b263b", "#e0a458"], ["#3d2c2e", "#f4d35e"], ["#0d1b2a", "#778da9"], ["#5f0f40", "#fb8b24"]];
  return {
    ref: 693134, nom: titre || "Dune : Deuxième partie", titreOriginal: "Dune: Part Two", annee: 2024, duree: 166, genres: ["Science-Fiction", "Aventure"],
    realisateur: "Denis Villeneuve", acteurs: ["Timothée Chalamet", "Zendaya", "Rebecca Ferguson", "Javier Bardem"], studio: "",
    jaquette: { petite: svg(342, 513, ["#8a4b14", "#f2c14e"], "Affiche"), grande: svg(780, 1170, ["#8a4b14", "#f2c14e"], "Affiche") },
    captures: caps.map((c, i) => ({ petite: svg(780, 439, c, "Image " + (i + 1)), grande: svg(1280, 720, c, "Image " + (i + 1)) })),
    description: "Paul Atréides s'unit à Chani et aux Fremen pour mener la révolte contre ceux qui ont anéanti sa famille. Hanté par de sombres prémonitions, il se trouve confronté au plus grand des dilemmes : choisir entre l'amour de sa vie et le destin de l'univers.",
    descriptionSource: { nom: "TMDB", url: "https://www.themoviedb.org/movie/693134", licence: "" },
    notes: { presse: { valeur: 79, nb: 67, source: "Metacritic" }, joueurs: { valeur: 82, nb: 6900 } },
    lien: "https://www.themoviedb.org/movie/693134", source: "TMDB",
    autres: [{ ref: 438631, nom: "Dune : Première partie", annee: 2021, plateformes: "Dune" }, { ref: 841, nom: "Dune", annee: 1984, plateformes: "" }],
  };
}

const lireCache = (cle, jours) => { const r = db.prepare("SELECT data, at FROM jeux_infos WHERE cle = ?").get(cle); return r && Date.now() - Date.parse(r.at) < jours * 864e5 ? JSON.parse(r.data) : undefined; };
const ecrireCache = (cle, v) => db.prepare("INSERT OR REPLACE INTO jeux_infos(cle, data, at) VALUES (?, ?, ?)").run(cle, JSON.stringify(v), now());

/* Infos d'un film, d'après son titre et son année (ou le film TMDB choisi à la main : ref).
   Renvoie null si rien n'est trouvé ; { introuvable: true, autres } si plusieurs films sont possibles. */
export async function infosFilm({ titre, annee = "", ref = null }) {
  titre = String(titre || "").trim().slice(0, 160);
  annee = /^\d{4}$/.test(String(annee || "").trim()) ? Number(String(annee).trim()) : null;
  ref = ref && /^\d{1,9}$/.test(String(ref)) ? Number(ref) : null;
  if (!titre && !ref) return null;
  if (FAKE()) return /introuvable/i.test(titre) ? null : exemple(titre);
  const avecTmdb = !!cleTmdb();
  const cle = "film:" + (ref && avecTmdb ? "ref:" + ref : (avecTmdb ? "q:" : "wiki:") + nomSeul(titre) + "|" + (annee || ""));
  const deja = lireCache(cle, 30);
  if (deja !== undefined && (deja && !deja.introuvable || lireCache(cle, 7) !== undefined)) return deja;

  let v = null;
  if (avecTmdb) {
    const { choisi, autres } = await chercherTmdb(titre, annee, ref);
    if (!choisi) { v = autres.length ? { introuvable: true, autres } : null; ecrireCache(cle, v); return v; }
    const f = await tmdb(`/movie/${choisi.id}`, { append_to_response: "credits,images,external_ids", include_image_language: "fr,null,en" });
    // Synopsis : TMDB en français ; sinon Wikipédia.
    let desc = f.overview ? { texte: couper(f.overview, 900), source: { nom: "TMDB", url: `https://www.themoviedb.org/movie/${f.id}`, licence: "" } } : null;
    if (!desc) desc = await wikipediaFilm(f.title || titre, anneeDe(f.release_date)).catch((e) => { console.error("Wikipédia", e.message); return null; });
    const imdb = (f.external_ids && f.external_ids.imdb_id) || f.imdb_id || "";
    const presse = await elementWikidata({ imdb: /^tt\d+$/.test(imdb) ? imdb : "", qid: (f.external_ids && f.external_ids.wikidata_id) || "" }).then(notePresse).catch((e) => { console.error("Wikidata", e.message); return null; });
    v = infosDeTmdb(f, desc, autres, presse);
    if (!ref) ecrireCache("film:ref:" + f.id, { ...v, autres: [] });
  } else {
    const w = await wikipediaFilm(titre, annee).catch((e) => { console.error("Wikipédia", e.message); return null; });
    if (w) {
      const e = await elementWikidata({ qid: (w.page.pageprops || {}).wikibase_item }).catch(() => null);
      const date = valeurs(e, "P577").map((x) => anneeDe(String(x.time || "").replace(/^\+/, ""))).filter(Boolean).sort()[0] || null;
      const ids = [...valeurs(e, "P57").map((x) => x.id), ...valeurs(e, "P136").map((x) => x.id), ...valeurs(e, "P161").slice(0, 4).map((x) => x.id)].filter(Boolean);
      const lib = await libelles([...new Set(ids)]).catch(() => ({}));
      const duree = valeurs(e, "P2047").map((x) => Math.round(Number(x.amount))).filter((x) => x > 0)[0] || null;
      v = {
        ref: null, nom: String(w.page.title || titre).replace(/\s*\((?:film|film,? \d{4}|\d{4})\)$/i, ""), titreOriginal: "", annee: date, duree,
        genres: valeurs(e, "P136").map((x) => lib[x.id]).filter(Boolean).map((g) => g.replace(/^film\s+(?:d(?:e\s+|['’]))?/i, "").replace(/^./, (c) => c.toUpperCase())).slice(0, 3),
        realisateur: valeurs(e, "P57").map((x) => lib[x.id]).filter(Boolean).slice(0, 2).join(", "), acteurs: valeurs(e, "P161").slice(0, 4).map((x) => lib[x.id]).filter(Boolean), studio: "",
        jaquette: null, captures: [], description: w.texte, descriptionSource: w.source,
        notes: { presse: notePresse(e), joueurs: null }, lien: "", source: "Wikipédia", autres: [],
      };
    }
  }
  ecrireCache(cle, v);
  return v;
}
