// Commun aux scripts de l'extension : API du navigateur (Safari et Firefox : browser.*, Chrome : chrome.*).
// On utilise uniquement la forme « promesse » des API, la seule commune aux trois (Firefox refuse les rappels sur browser.*).
var RR = globalThis.browser || globalThis.chrome;
/** Envoie un message au script d'arrière-plan et renvoie sa réponse (erreur si { error }). */
function rrDemander(msg) {
  return Promise.resolve().then(function () { return RR.runtime.sendMessage(msg); }).then(function (r) {
    if (!r) throw new Error("Pas de réponse de l'extension.");
    if (r.error) { var e = new Error(r.error); e.status = r.status; throw e; }
    return r;
  });
}
