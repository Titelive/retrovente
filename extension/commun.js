// Commun aux scripts de l'extension : API du navigateur (Safari et Firefox : browser.*, Chrome : chrome.*).
// On utilise uniquement la forme « promesse » des API, la seule commune aux trois (Firefox refuse les rappels sur browser.*).
var RR = globalThis.browser || globalThis.chrome;
/** Envoie un message au script d'arrière-plan et renvoie sa réponse (erreur si { error }).
 *  Safari endort l'arrière-plan et perd parfois le premier message : délai, puis un nouvel essai, puis, pour les
 *  lectures, un appel direct à RetroRevente avec la clé. On ne reste jamais bloqué sur « Chargement… ». */
var RR_DELAIS = { reponse: 45000, cle: 20000, annonces: 6000 };
function rrUneFois(msg, ms) {
  return new Promise(function (ok, ko) {
    var t = setTimeout(function () { var e = new Error("L'extension ne répond pas."); e.delai = true; ko(e); }, ms);
    Promise.resolve().then(function () { return RR.runtime.sendMessage(msg); }).then(function (r) { clearTimeout(t); ok(r); }, function (e) { clearTimeout(t); ko(e); });
  });
}
async function rrDirect(msg) {
  var s = await RR.storage.local.get(["cle", "serveur"]);
  if (!s.cle) { var e0 = new Error("Extension pas encore connectée à ton compte RetroRevente."); e0.status = 401; throw e0; }
  var base = /^(https:\/\/retrorevente\.fr|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/.test(s.serveur || "") ? s.serveur : "https://retrorevente.fr";
  var r = await fetch(base + "/api/extension/annonces", { cache: "no-store", credentials: "omit", headers: { Authorization: "Bearer " + s.cle } });
  var j = await r.json().catch(function () { return {}; });
  if (!r.ok) { var e = new Error(j.error || "RetroRevente ne répond pas (erreur " + r.status + ")."); e.status = r.status; throw e; }
  return j;
}
async function rrDemander(msg) {
  var ms = RR_DELAIS[msg.type] || 12000, r;
  try { r = await rrUneFois(msg, ms); }
  catch (e) {
    if (!e.delai && !/receiving end|could not establish|message port|disconnected/i.test(e.message || "")) throw e;
    try { r = await rrUneFois(msg, ms); }
    catch (e2) {
      if (msg.type === "annonces") return rrDirect(msg);
      throw new Error("L'extension ne répond pas. Recharge la page (⌘R), ou désactive puis réactive RetroRevente dans les réglages de Safari.");
    }
  }
  if (!r) { if (msg.type === "annonces") return rrDirect(msg); throw new Error("Pas de réponse de l'extension."); }
  if (r.error) { var e = new Error(r.error); e.status = r.status; throw e; }
  return r;
}

/* ===== Sons « à toi » : petits sons rétro façon console 8 bits, fabriqués ici (aucun fichier, aucune licence) =====
   Chaque note : [fréquence en Hz, début en s, durée en s]. Timbre doux : une onde carrée réduite à ses premières
   harmoniques (le grain « chiptune » sans le côté criard), mêlée à une onde triangle. */
var RR_SONS = {
  piece:   { nom: "Pièce",    carre: 0.55, notes: [[880, 0, 0.07], [1319, 0.07, 0.42]] },
  powerup: { nom: "Power-up", carre: 0.35, notes: [[523, 0, 0.05], [659, 0.04, 0.05], [784, 0.08, 0.05], [587, 0.13, 0.05], [740, 0.17, 0.05], [880, 0.21, 0.05], [659, 0.26, 0.05], [831, 0.30, 0.05], [988, 0.34, 0.05], [1319, 0.38, 0.34]] },
  jingle:  { nom: "Jingle",   carre: 0.25, notes: [[784, 0, 0.12], [1047, 0.12, 0.12], [1319, 0.24, 0.5], [1568, 0.24, 0.5]], echo: 0.22 },
  // Annonce publiée (pas proposé dans la liste) : « pop » de canon à confettis, puis pluie de petites notes scintillantes.
  confettis: { nom: "Confettis", cache: true, carre: 0.3, echo: 0.18,
    pops: [[0, 0.09, 1], [0.05, 0.07, 0.6]],
    notes: [[1047, 0.10, 0.06], [1568, 0.15, 0.06], [1319, 0.20, 0.06], [2093, 0.25, 0.06], [1760, 0.30, 0.06], [2637, 0.35, 0.06], [2093, 0.41, 0.06], [3136, 0.47, 0.30], [2637, 0.47, 0.30]] },
};
var RR_SON_DEFAUT = "piece";
var RR_TAUX = 22050;
var rrSonsRendus = {};
/** Échantillons du son (Float32Array, mono, RR_TAUX Hz), crête à 0,4. */
function rrRendreSon(cle) {
  if (rrSonsRendus[cle]) return rrSonsRendus[cle];
  var s = RR_SONS[cle] || RR_SONS[RR_SON_DEFAUT], fin = 0;
  s.notes.forEach(function (n) { fin = Math.max(fin, n[1] + n[2]); });
  var n = Math.ceil((fin + (s.echo ? 0.2 : 0) + 0.03) * RR_TAUX), x = new Float32Array(n), P = 2 * Math.PI;
  s.notes.forEach(function (no) {
    var f = no[0], d0 = Math.round(no[1] * RR_TAUX), m = Math.round(no[2] * RR_TAUX);
    for (var i = 0; i < m && d0 + i < n; i++) {
      var t = i / RR_TAUX, ph = P * f * t;
      // carré « adouci » (harmoniques 1, 3, 5, 7) et triangle (1, 3, 5)
      var carre = Math.sin(ph) + Math.sin(3 * ph) / 3 + Math.sin(5 * ph) / 5 + Math.sin(7 * ph) / 7;
      var tri = Math.sin(ph) - Math.sin(3 * ph) / 9 + Math.sin(5 * ph) / 25;
      var env = Math.min(1, t / 0.004) * Math.exp(-t * 5) * Math.min(1, (m - i) / (0.025 * RR_TAUX));
      x[d0 + i] += (s.carre * carre * 0.8 + (1 - s.carre) * tri) * env;
    }
  });
  // « Pop » : bruit blanc (pseudo-aléatoire fixe, donc toujours le même son) très bref, filtré vers les aigus.
  (s.pops || []).forEach(function (po) {
    var d0 = Math.round(po[0] * RR_TAUX), m = Math.round(po[1] * RR_TAUX), g = 1234567, avant = 0;
    for (var i = 0; i < m && d0 + i < n; i++) {
      g = (g * 1103515245 + 12345) % 2147483648; var b = g / 1073741824 - 1, t = i / RR_TAUX;
      x[d0 + i] += (b - avant) * 0.9 * po[2] * Math.min(1, t / 0.002) * Math.exp(-t * 45); avant = b;
    }
  });
  if (s.echo) { var r = Math.round(0.11 * RR_TAUX); for (var j = n - 1; j >= r; j--) x[j] += x[j - r] * s.echo; }
  var crete = 0; for (var k = 0; k < n; k++) crete = Math.max(crete, Math.abs(x[k]));
  for (var k2 = 0; k2 < n; k2++) x[k2] *= 0.4 / (crete || 1);
  return (rrSonsRendus[cle] = x);
}
/** Le même son en WAV 16 bits, encodé en base64 (pour <audio> et pour l'app Mac de Safari). */
function rrSonWav64(cle) {
  var x = rrRendreSon(cle), n = x.length, d = new DataView(new ArrayBuffer(44 + n * 2));
  var w = function (o, t) { for (var i = 0; i < t.length; i++) d.setUint8(o + i, t.charCodeAt(i)); };
  w(0, "RIFF"); d.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, RR_TAUX, true); d.setUint32(28, RR_TAUX * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, "data"); d.setUint32(40, n * 2, true);
  for (var i = 0; i < n; i++) d.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), true);
  var o = "", u = new Uint8Array(d.buffer); for (var k = 0; k < u.length; k += 8192) o += String.fromCharCode.apply(null, u.subarray(k, k + 8192));
  return btoa(o);
}

// Logo RetroRevente (SVG), partagé par les panneaux Le Bon Coin et eBay.
var RR_LOGO = '<svg xmlns="http://www.w3.org/2000/svg" height="22" aria-hidden="true" focusable="false" viewBox="6 16 388 50"> <path fill="currentColor" fill-rule="evenodd" d="M 26 20 L 54 20 C 61 20 65 24 67 33 L 71 51 C 73 60 64 65 57 58 L 50 51 L 30 51 L 23 58 C 16 65 7 60 9 51 L 13 33 C 15 24 19 20 26 20 Z M 24 30 L 30 30 L 30 35 L 35 35 L 35 41 L 30 41 L 30 46 L 24 46 L 24 41 L 19 41 L 19 35 L 24 35 Z M 51 27 L 59 27 L 55 34 L 62 34 L 48 49 L 51 39 L 44 39 Z"/> <path style="fill:var(--anis)" d="M 51 27 L 59 27 L 55 34 L 62 34 L 48 49 L 51 39 L 44 39 Z"/> <path fill="currentColor" d="M86.97 56.75V23.25H99.78Q103.25 23.25 105.92 24.46Q108.6 25.68 110.13 28.06Q111.65 30.44 111.65 33.95Q111.65 37.37 110.08 39.78Q108.51 42.18 105.85 43.39L113.5 56.75H105.67L97.4 41.96L101.9 44.61H93.94V56.75ZM93.94 38.54H99.83Q101.31 38.54 102.39 37.95Q103.47 37.37 104.08 36.34Q104.68 35.3 104.68 33.95Q104.68 32.56 104.08 31.52Q103.47 30.49 102.39 29.91Q101.31 29.32 99.83 29.32H93.94ZM128.29 57.29Q124.38 57.29 121.5 55.56Q118.62 53.83 117.05 50.9Q115.48 47.98 115.48 44.43Q115.48 40.74 117.12 37.86Q118.76 34.99 121.55 33.32Q124.33 31.66 127.84 31.66Q130.77 31.66 133.01 32.58Q135.26 33.5 136.81 35.17Q138.36 36.83 139.17 39.01Q139.98 41.19 139.98 43.75Q139.98 44.47 139.92 45.17Q139.85 45.87 139.67 46.36H121.28V41.42H135.85L132.65 43.75Q133.1 41.82 132.61 40.31Q132.11 38.81 130.88 37.93Q129.64 37.05 127.84 37.05Q126.09 37.05 124.83 37.91Q123.57 38.76 122.94 40.43Q122.31 42.09 122.45 44.47Q122.27 46.54 122.94 48.12Q123.62 49.69 125.01 50.57Q126.4 51.44 128.38 51.44Q130.18 51.44 131.46 50.72Q132.74 50.01 133.46 48.75L138.86 51.31Q138.14 53.11 136.59 54.46Q135.04 55.81 132.92 56.55Q130.81 57.29 128.29 57.29ZM155.77 57.02Q151.31 57.02 148.86 54.61Q146.41 52.21 146.41 47.89V38.04H142.28V32.2H142.5Q144.39 32.2 145.4 31.25Q146.41 30.31 146.41 28.42V26.62H153.16V32.2H158.91V38.04H153.16V47.44Q153.16 48.7 153.61 49.53Q154.06 50.36 155 50.77Q155.95 51.17 157.34 51.17Q157.66 51.17 158.06 51.13Q158.46 51.08 158.91 51.04V56.75Q158.24 56.84 157.39 56.93Q156.53 57.02 155.77 57.02ZM162.87 56.75V32.2H169.17V38.09L168.72 37.23Q169.53 34.13 171.39 33.03Q173.26 31.93 175.82 31.93H177.26V37.77H175.15Q172.67 37.77 171.14 39.28Q169.62 40.79 169.62 43.53V56.75ZM192.41 57.29Q188.77 57.29 185.78 55.63Q182.79 53.96 181.02 51.06Q179.24 48.16 179.24 44.47Q179.24 40.74 181.02 37.86Q182.79 34.99 185.78 33.32Q188.77 31.66 192.41 31.66Q196.06 31.66 199.02 33.32Q201.99 34.99 203.77 37.86Q205.54 40.74 205.54 44.47Q205.54 48.16 203.77 51.06Q201.99 53.96 199.02 55.63Q196.06 57.29 192.41 57.29ZM192.41 51.22Q194.26 51.22 195.63 50.36Q197 49.51 197.79 47.98Q198.57 46.45 198.57 44.47Q198.57 42.5 197.79 40.99Q197 39.48 195.63 38.61Q194.26 37.73 192.41 37.73Q190.57 37.73 189.18 38.61Q187.78 39.48 187 40.99Q186.21 42.5 186.21 44.47Q186.21 46.45 187 47.98Q187.78 49.51 189.18 50.36Q190.57 51.22 192.41 51.22ZM210 56.75V23.25H222.81Q226.27 23.25 228.95 24.46Q231.62 25.68 233.15 28.06Q234.68 30.44 234.68 33.95Q234.68 37.37 233.11 39.78Q231.53 42.18 228.88 43.39L236.53 56.75H228.7L220.43 41.96L224.92 44.61H216.97V56.75ZM216.97 38.54H222.86Q224.34 38.54 225.42 37.95Q226.5 37.37 227.11 36.34Q227.71 35.3 227.71 33.95Q227.71 32.56 227.11 31.52Q226.5 30.49 225.42 29.91Q224.34 29.32 222.86 29.32H216.97ZM251.32 57.29Q247.41 57.29 244.53 55.56Q241.65 53.83 240.08 50.9Q238.5 47.98 238.5 44.43Q238.5 40.74 240.15 37.86Q241.79 34.99 244.58 33.32Q247.36 31.66 250.87 31.66Q253.79 31.66 256.04 32.58Q258.29 33.5 259.84 35.17Q261.39 36.83 262.2 39.01Q263.01 41.19 263.01 43.75Q263.01 44.47 262.94 45.17Q262.88 45.87 262.7 46.36H244.31V41.42H258.87L255.68 43.75Q256.13 41.82 255.64 40.31Q255.14 38.81 253.91 37.93Q252.67 37.05 250.87 37.05Q249.12 37.05 247.86 37.91Q246.6 38.76 245.97 40.43Q245.34 42.09 245.47 44.47Q245.29 46.54 245.97 48.12Q246.64 49.69 248.04 50.57Q249.43 51.44 251.41 51.44Q253.21 51.44 254.49 50.72Q255.77 50.01 256.49 48.75L261.89 51.31Q261.17 53.11 259.62 54.46Q258.07 55.81 255.95 56.55Q253.84 57.29 251.32 57.29ZM274.66 56.75 264.99 32.2H272.27L278.97 50.77H276.19L282.89 32.2H290.17L280.5 56.75ZM304.97 57.29Q301.05 57.29 298.18 55.56Q295.3 53.83 293.72 50.9Q292.15 47.98 292.15 44.43Q292.15 40.74 293.79 37.86Q295.43 34.99 298.22 33.32Q301.01 31.66 304.52 31.66Q307.44 31.66 309.69 32.58Q311.93 33.5 313.49 35.17Q315.04 36.83 315.85 39.01Q316.66 41.19 316.66 43.75Q316.66 44.47 316.59 45.17Q316.52 45.87 316.34 46.36H297.95V41.42H312.52L309.33 43.75Q309.78 41.82 309.28 40.31Q308.79 38.81 307.55 37.93Q306.31 37.05 304.52 37.05Q302.76 37.05 301.5 37.91Q300.24 38.76 299.61 40.43Q298.98 42.09 299.12 44.47Q298.94 46.54 299.61 48.12Q300.29 49.69 301.68 50.57Q303.08 51.44 305.06 51.44Q306.85 51.44 308.14 50.72Q309.42 50.01 310.14 48.75L315.53 51.31Q314.81 53.11 313.26 54.46Q311.71 55.81 309.6 56.55Q307.48 57.29 304.97 57.29ZM320.61 56.75V32.2H326.91V37.05L326.55 35.98Q327.4 33.77 329.31 32.72Q331.23 31.66 333.79 31.66Q336.58 31.66 338.67 32.83Q340.76 34 341.93 36.09Q343.1 38.18 343.1 40.97V56.75H336.35V42.41Q336.35 40.97 335.79 39.93Q335.23 38.9 334.22 38.31Q333.2 37.73 331.86 37.73Q330.55 37.73 329.52 38.31Q328.48 38.9 327.92 39.93Q327.36 40.97 327.36 42.41V56.75ZM359.37 57.02Q354.92 57.02 352.47 54.61Q350.02 52.21 350.02 47.89V38.04H345.88V32.2H346.11Q348 32.2 349.01 31.25Q350.02 30.31 350.02 28.42V26.62H356.77V32.2H362.52V38.04H356.77V47.44Q356.77 48.7 357.22 49.53Q357.67 50.36 358.61 50.77Q359.55 51.17 360.95 51.17Q361.26 51.17 361.67 51.13Q362.07 51.08 362.52 51.04V56.75Q361.85 56.84 360.99 56.93Q360.14 57.02 359.37 57.02ZM378.31 57.29Q374.39 57.29 371.52 55.56Q368.64 53.83 367.06 50.9Q365.49 47.98 365.49 44.43Q365.49 40.74 367.13 37.86Q368.77 34.99 371.56 33.32Q374.35 31.66 377.86 31.66Q380.78 31.66 383.03 32.58Q385.28 33.5 386.83 35.17Q388.38 36.83 389.19 39.01Q390 41.19 390 43.75Q390 44.47 389.93 45.17Q389.86 45.87 389.68 46.36H371.29V41.42H385.86L382.67 43.75Q383.12 41.82 382.62 40.31Q382.13 38.81 380.89 37.93Q379.65 37.05 377.86 37.05Q376.1 37.05 374.84 37.91Q373.58 38.76 372.95 40.43Q372.32 42.09 372.46 44.47Q372.28 46.54 372.95 48.12Q373.63 49.69 375.02 50.57Q376.42 51.44 378.4 51.44Q380.19 51.44 381.48 50.72Q382.76 50.01 383.48 48.75L388.87 51.31Q388.15 53.11 386.6 54.46Q385.05 55.81 382.94 56.55Q380.82 57.29 378.31 57.29Z"/> </svg>';

/** Bouton vert « Remplir avec RetroRevente » (icône manette), posé au-dessus d'un champ de la page, à droite.
 *  Il s'efface quand une fenêtre du site couvre le champ. rrBoutonRemplir(clic).placer(champ) / .placer(null). */
function rrBoutonRemplir(clic, id, evite) {
  var h = null, champ = null;
  function creer() {
    h = document.createElement("div"); h.id = id || "retrorevente-remplir";
    var o = h.attachShadow({ mode: "open" }), st = document.createElement("style");
    st.textContent = ".r{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:6px 16px 6px 6px;background:#D4F57A;color:#1A1A1A;" +
      "font:700 14px/1 'RR Rubik',ui-rounded,system-ui,-apple-system,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.18);transition:transform .2s}" +
      ".r:hover{transform:translateY(-1px)}.r:focus-visible{outline:2px solid #1A1A1A;outline-offset:2px}.r img{display:block;width:30px;height:30px;border-radius:9px}";
    var b = document.createElement("button"); b.className = "r"; b.type = "button";
    var i = document.createElement("img"); i.src = RR.runtime.getURL("icones/icone-128.png"); i.alt = "";
    b.appendChild(i); b.appendChild(document.createTextNode("Remplir avec RetroRevente"));
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); clic(); });
    o.appendChild(st); o.appendChild(b);
    h.style.cssText = "position:fixed;z-index:2147483645;display:none";
    document.documentElement.appendChild(h);
    addEventListener("scroll", function () { placer(champ); }, true); addEventListener("resize", function () { placer(champ); });
  }
  function placer(c) {
    champ = c;
    if (!c || !c.isConnected) { if (h) h.style.display = "none"; return; }
    if (!h) creer();
    var r = c.getBoundingClientRect();
    if (r.width < 4 || r.bottom < 0 || r.top > innerHeight) { h.style.display = "none"; return; }
    var dessus = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + Math.min(r.height / 2, 20));
    if (dessus && dessus !== c && !c.contains(dessus) && !(dessus.contains && dessus.contains(c)) && dessus !== h) { h.style.display = "none"; return; }
    h.style.display = ""; var w = h.getBoundingClientRect();
    var haut = Math.max(4, r.top - w.height - 10), droite = r.right;
    // Pas sous le panneau RetroRevente : le bouton se décale à sa gauche.
    var p = evite && evite(), pr = p && p.getBoundingClientRect && p.getBoundingClientRect();
    if (pr && pr.width && haut < pr.bottom && haut + w.height > pr.top && droite > pr.left - 12) droite = pr.left - 12;
    h.style.top = Math.round(haut) + "px"; h.style.left = Math.round(Math.max(4, droite - w.width)) + "px";
  }
  return { placer: placer, hote: function () { return h; }, titre: function (t) { if (h) h.shadowRoot.querySelector("button").title = t; } };
}
