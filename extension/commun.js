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
