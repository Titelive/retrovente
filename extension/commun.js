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
