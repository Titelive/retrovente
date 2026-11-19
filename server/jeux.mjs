// Infos d'un jeu pour sa fiche : jaquette, captures d'écran, descriptif, notes de la presse et des joueurs.
// - IGDB (igdb.com, Twitch) : jaquette, captures, année, genres, studio, notes. Gratuit, il faut une appli Twitch
//   (TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET). Images affichées depuis images.igdb.com, avec le lien vers IGDB.
// - Wikipédia en français : le descriptif (introduction de l'article, licence CC BY-SA 4.0, source citée).
//   Si Wikipédia n'a pas d'article, le résumé IGDB (en anglais) est traduit par l'IA.
// Les réponses sont gardées en base 30 jours (7 jours quand rien n'est trouvé) : un jeu n'est cherché qu'une fois.
import { db, now } from "./db.mjs";

db.exec(`CREATE TABLE IF NOT EXISTS jeux_infos (cle TEXT PRIMARY KEY, data TEXT NOT NULL, at TEXT NOT NULL)`);

const UA = "RetroRevente/1.0 (https://retrorevente.fr; bonjour@retrorevente.fr)";
const FAKE = () => process.env.IA_FAKE === "1" && !process.env.IGDB_URL;
const IGDB = () => (process.env.IGDB_URL || "https://api.igdb.com/v4").replace(/\/$/, "");
const WIKI = () => (process.env.WIKI_URL || "https://fr.wikipedia.org").replace(/\/$/, "");
const IMG = (taille, id) => `https://images.igdb.com/igdb/image/upload/t_${taille}/${id}.jpg`;
export const configure = () => !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET) || FAKE();

export const sansAccent = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
// « Super Mario 64 (PAL) - complet » → « super mario 64 » : ce qui suit une parenthèse ou un tiret n'est pas le nom du jeu.
const nomSeul = (t) => sansAccent(String(t || "").replace(/\s[-–—|]\s.*$/, "").replace(/[([].*$/, ""));
const ROMAINS = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
const mots = (s) => sansAccent(s).split(" ").filter(Boolean).map((m) => ROMAINS[m] || m).filter((m) => !["the", "le", "la", "les", "of", "de", "du", "des", "a", "and", "et"].includes(m));

// Noms des consoles tels qu'on les écrit en France → abréviations IGDB.
const ALIAS = [
  [/super nintendo|super nes|snes|super famicom/, ["snes", "sfam"]], [/\bnes\b|nintendo entertainment|famicom/, ["nes", "famicom"]],
  [/nintendo 64|\bn64\b/, ["n64"]], [/gamecube|\bngc\b/, ["ngc"]], [/wii u/, ["wiiu"]], [/\bwii\b(?! u)/, ["wii"]], [/switch 2/, ["switch 2", "ns2"]], [/switch/, ["switch"]],
  [/game boy advance|\bgba\b/, ["gba"]], [/game boy colou?r|\bgbc\b/, ["gbc"]], [/game boy(?! advance| colo)|\bgb\b/, ["gb"]], [/nintendo 3ds|\b3ds\b/, ["3ds"]], [/nintendo ds|\bnds\b|\bds\b/, ["nds"]],
  [/playstation 5|\bps5\b/, ["ps5"]], [/playstation 4|\bps4\b/, ["ps4"]], [/playstation 3|\bps3\b/, ["ps3"]], [/playstation 2|\bps2\b/, ["ps2"]], [/playstation vita|\bps ?vita\b/, ["vita"]],
  [/\bpsp\b|playstation portable/, ["psp"]], [/playstation|\bps1\b|\bpsx\b|\bpsone\b/, ["ps"]],
  [/xbox series/, ["series x|s"]], [/xbox one/, ["xone"]], [/xbox 360/, ["x360"]], [/xbox/, ["xbox"]],
  [/mega ?drive|genesis/, ["genesis/megadrive"]], [/master system/, ["sms"]], [/game gear/, ["gamegear"]], [/saturn/, ["saturn"]], [/dreamcast/, ["dc"]], [/mega ?cd|sega cd/, ["segacd"]], [/32x/, ["sega32"]],
  [/neo ?geo/, ["neogeoaes", "neogeomvs", "neo geo cd"]], [/atari 2600/, ["atari2600"]], [/\bpc\b|windows/, ["pc"]],
];
function abrevs(plateforme) { const p = sansAccent(plateforme); for (const [re, a] of ALIAS) if (re.test(p)) return a; return []; }
const surPlateforme = (jeu, plateforme) => {
  if (!plateforme) return false;
  const a = abrevs(plateforme), p = sansAccent(plateforme);
  return (jeu.platforms || []).some((x) => a.includes(String(x.abbreviation || "").toLowerCase()) || (p && sansAccent(x.name) === p));
};

/* Score d'un résultat IGDB pour le nom et la console de la fiche. */
export function score(jeu, titre, plateforme) {
  const voulu = mots(nomSeul(titre)), noms = [jeu.name, ...((jeu.alternative_names || []).map((x) => x.name))];
  let s = 0;
  for (const n of noms) {
    const m = mots(n);
    if (!m.length) continue;
    const communs = voulu.filter((x) => m.includes(x)).length, egal = communs === voulu.length && communs === m.length;
    s = Math.max(s, egal ? 10 : communs === voulu.length ? 6 - Math.min(3, m.length - communs) : (4 * communs) / Math.max(voulu.length, m.length));
  }
  if (surPlateforme(jeu, plateforme)) s += 4;
  if (jeu.cover) s += 0.5;
  if (jeu.version_parent) s -= 1;   // édition spéciale : on préfère le jeu de base
  return s;
}

/* ===== IGDB ===== */
let jeton = null;
async function jetonTwitch() {
  if (jeton && jeton.fin > Date.now() + 60_000) return jeton.cle;
  const u = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(process.env.TWITCH_CLIENT_ID)}&client_secret=${encodeURIComponent(process.env.TWITCH_CLIENT_SECRET)}&grant_type=client_credentials`;
  const r = await fetch(u, { method: "POST", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("Twitch " + r.status);
  const j = await r.json();
  jeton = { cle: j.access_token, fin: Date.now() + (j.expires_in || 3600) * 1000 };
  return jeton.cle;
}
const CHAMPS = "name,slug,url,summary,first_release_date,cover.image_id,screenshots.image_id,artworks.image_id,genres.name,platforms.name,platforms.abbreviation,involved_companies.developer,involved_companies.company.name,aggregated_rating,aggregated_rating_count,rating,rating_count,alternative_names.name,version_parent";
async function igdb(requete) {
  const h = { "Client-ID": process.env.TWITCH_CLIENT_ID || "", accept: "application/json", "content-type": "text/plain" };
  if (!process.env.IGDB_URL) h.Authorization = "Bearer " + (await jetonTwitch());
  const r = await fetch(IGDB() + "/games", { method: "POST", headers: h, body: requete, signal: AbortSignal.timeout(8000) });
  if (r.status === 401) jeton = null;
  if (!r.ok) throw new Error("IGDB " + r.status);
  return r.json();
}
const echappe = (s) => String(s).replace(/["\\]/g, " ").slice(0, 120);
async function chercherIgdb(titre, plateforme, ref) {
  if (ref) return { choisi: (await igdb(`fields ${CHAMPS}; where id = ${Number(ref)};`))[0] || null, autres: [] };
  const nom = String(titre).replace(/\s[-–—|]\s.*$/, "").replace(/[([].*$/, "").trim() || titre;
  const liste = await igdb(`search "${echappe(nom)}"; fields ${CHAMPS}; limit 15;`);
  if (!Array.isArray(liste) || !liste.length) return { choisi: null, autres: [] };
  const notes = liste.map((j) => ({ j, s: score(j, titre, plateforme) })).sort((a, b) => b.s - a.s);
  const choisi = notes[0].s >= 5 ? notes[0].j : null;   // sinon on ne devine pas : la personne choisit dans la liste
  return { choisi, autres: notes.filter((x) => x.j !== choisi).slice(0, 6).map((x) => resumeAutre(x.j)) };
}
const annee = (j) => (j.first_release_date ? new Date(j.first_release_date * 1000).getUTCFullYear() : null);
const resumeAutre = (j) => ({ ref: j.id, nom: String(j.name || ""), annee: annee(j), plateformes: (j.platforms || []).map((p) => p.abbreviation || p.name).filter(Boolean).slice(0, 4).join(", ") });

/* ===== Wikipédia (descriptif en français) ===== */
async function wikipedia(titre, plateforme, nomIgdb) {
  const essais = [...new Set([nomIgdb, String(titre).replace(/[([].*$/, "").trim()].filter(Boolean))];
  for (const nom of essais) {
    const q = new URLSearchParams({ action: "query", format: "json", formatversion: "2", generator: "search", gsrsearch: `${nom} jeu vidéo`, gsrlimit: "5", gsrnamespace: "0",
      prop: "extracts|info", exintro: "1", explaintext: "1", exlimit: "5", inprop: "url", redirects: "1" });
    const r = await fetch(`${WIKI()}/w/api.php?${q}`, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) continue;
    const pages = (((await r.json()) || {}).query || {}).pages || [];
    pages.sort((a, b) => (a.index || 0) - (b.index || 0));
    const voulu = mots(nomSeul(nom));
    for (const p of pages) {
      const t = mots(String(p.title || "").replace(/\(.*\)/, "")), x = String(p.extract || "");
      // le bon article : son titre reprend tous les mots du nom du jeu, et c'est bien un jeu vidéo
      if (!voulu.every((m) => t.includes(m)) || t.length > voulu.length + 2 || !/jeu(x)? vid[ée]o/i.test(x.slice(0, 600))) continue;
      return { texte: couper(x, 900), source: { nom: "Wikipédia", url: p.fullurl || `${WIKI()}/wiki/${encodeURIComponent(p.title)}`, licence: "CC BY-SA 4.0" } };
    }
  }
  return null;
}
// Coupe proprement à la fin d'une phrase, sans les renvois de type « [1] ».
export function couper(t, max) {
  const s = String(t || "").replace(/\[\d+\]/g, "").replace(/\s*\n\s*/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (s.length <= max) return s;
  const bout = s.slice(0, max), fin = Math.max(bout.lastIndexOf(". "), bout.lastIndexOf(".\n"));
  return fin > max * 0.4 ? bout.slice(0, fin + 1) : bout.replace(/\s+\S*$/, "") + "…";
}

/* Met en forme ce que la fiche affiche. */
export function infosDe(j, desc, autres = []) {
  const dev = (j.involved_companies || []).filter((c) => c.developer && c.company).map((c) => c.company.name);
  const note = (v, n) => (typeof v === "number" && v > 0 && n > 0 ? { valeur: Math.round(v), nb: n } : null);
  const captures = [...(j.screenshots || []), ...(j.artworks || [])].filter((x) => x && x.image_id).slice(0, 8)
    .map((x) => ({ petite: IMG("screenshot_med", x.image_id), grande: IMG("720p", x.image_id) }));
  return {
    ref: j.id, nom: String(j.name || ""), annee: annee(j),
    plateformes: (j.platforms || []).map((p) => p.name).filter(Boolean).slice(0, 8),
    genres: (j.genres || []).map((g) => g.name).filter(Boolean).slice(0, 3),
    studio: [...new Set(dev)].slice(0, 2).join(", "),
    jaquette: j.cover && j.cover.image_id ? { petite: IMG("cover_big", j.cover.image_id), grande: IMG("1080p", j.cover.image_id) } : null,
    captures,
    description: desc ? desc.texte : "", descriptionSource: desc ? desc.source : null,
    notes: { presse: note(j.aggregated_rating, j.aggregated_rating_count), joueurs: note(j.rating, j.rating_count) },
    lien: String(j.url || (j.slug ? `https://www.igdb.com/games/${j.slug}` : "")),
    autres,
  };
}

/* Exemple hors ligne (IA_FAKE=1) : images dessinées, pour les tests et le développement. */
const svg = (w, h, fond, texte) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${fond[0]}"/><stop offset="1" stop-color="${fond[1]}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="52%" font-family="sans-serif" font-size="${Math.round(h / 9)}" font-weight="700" fill="#fff" text-anchor="middle">${texte}</text></svg>`);
function exemple(titre) {
  const caps = [["#2a7de1", "#7fd4ff"], ["#3fa34d", "#c8f08f"], ["#8e44ad", "#f39cc6"], ["#e67e22", "#f9d56e"], ["#16a085", "#a3e4d7"]];
  return {
    ref: 1074, nom: titre || "Super Mario 64", annee: 1996, plateformes: ["Nintendo 64", "Wii", "Wii U"], genres: ["Plateforme", "Aventure"], studio: "Nintendo EAD",
    jaquette: { petite: svg(264, 352, ["#c0392b", "#f1c40f"], "Jaquette"), grande: svg(600, 800, ["#c0392b", "#f1c40f"], "Jaquette") },
    captures: caps.map((c, i) => ({ petite: svg(569, 320, c, "Capture " + (i + 1)), grande: svg(1280, 720, c, "Capture " + (i + 1)) })),
    description: "Super Mario 64 est un jeu vidéo de plates-formes développé par Nintendo EAD et édité par Nintendo, sorti en 1996 au Japon et en Amérique du Nord, puis en 1997 en Europe, pour accompagner le lancement de la Nintendo 64. Premier épisode de la série Super Mario en trois dimensions, il met en scène Mario qui explore le château de la princesse Peach à la recherche des étoiles de puissance volées par Bowser.\nSalué par la critique pour sa caméra libre et sa liberté de mouvement, il est souvent cité parmi les jeux les plus influents de l'histoire.",
    descriptionSource: { nom: "Wikipédia", url: "https://fr.wikipedia.org/wiki/Super_Mario_64", licence: "CC BY-SA 4.0" },
    notes: { presse: { valeur: 94, nb: 18 }, joueurs: { valeur: 89, nb: 1460 } },
    lien: "https://www.igdb.com/games/super-mario-64",
    autres: [{ ref: 2327, nom: "Super Mario 64 DS", annee: 2004, plateformes: "NDS" }, { ref: 119388, nom: "Super Mario 3D All-Stars", annee: 2020, plateformes: "Switch" }],
  };
}

const lireCache = (cle, jours) => { const r = db.prepare("SELECT data, at FROM jeux_infos WHERE cle = ?").get(cle); return r && Date.now() - Date.parse(r.at) < jours * 864e5 ? JSON.parse(r.data) : undefined; };
const ecrireCache = (cle, v) => db.prepare("INSERT OR REPLACE INTO jeux_infos(cle, data, at) VALUES (?, ?, ?)").run(cle, JSON.stringify(v), now());

/* Infos d'un jeu, d'après son nom et sa console (ou le jeu IGDB choisi à la main : ref).
   Renvoie null si rien n'est trouvé ; { introuvable: true, autres } si plusieurs jeux sont possibles. */
export async function infosJeu({ titre, plateforme = "", ref = null }, traduire = null) {
  titre = String(titre || "").trim().slice(0, 160); plateforme = String(plateforme || "").trim().slice(0, 60);
  ref = ref && /^\d{1,9}$/.test(String(ref)) ? Number(ref) : null;
  if (!titre && !ref) return null;
  if (FAKE()) return /introuvable/i.test(titre) ? null : exemple(titre);
  if (!configure()) return null;
  const cle = ref ? "ref:" + ref : "q:" + nomSeul(titre) + "|" + abrevs(plateforme).join(",");
  const deja = lireCache(cle, 30);
  if (deja !== undefined && (deja && !deja.introuvable || lireCache(cle, 7) !== undefined)) return deja;

  const { choisi, autres } = await chercherIgdb(titre, plateforme, ref);
  if (!choisi) { const v = autres.length ? { introuvable: true, autres } : null; ecrireCache(cle, v); return v; }
  let desc = await wikipedia(titre, plateforme, choisi.name).catch((e) => { console.error("Wikipédia", e.message); return null; });
  if (!desc && choisi.summary && traduire) {
    const fr = await traduire(choisi.summary).catch((e) => { console.error("traduction", e.message); return ""; });
    if (fr) desc = { texte: couper(fr, 900), source: { nom: "IGDB (traduit)", url: String(choisi.url || ""), licence: "" } };
  }
  if (!desc && choisi.summary) desc = { texte: couper(choisi.summary, 900), source: { nom: "IGDB", url: String(choisi.url || ""), licence: "" } };
  const v = infosDe(choisi, desc, autres);
  ecrireCache(cle, v);
  if (!ref) ecrireCache("ref:" + choisi.id, { ...v, autres: [] });
  return v;
}
