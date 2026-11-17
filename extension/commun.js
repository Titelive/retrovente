// Commun aux scripts de l'extension : API du navigateur (Safari et Firefox : browser.*, Chrome : chrome.*).
var RR = globalThis.browser || globalThis.chrome;
/** Envoie un message au script d'arrière-plan et renvoie sa réponse (erreur si { error }). */
function rrDemander(msg) {
  return new Promise(function (ok, ko) {
    try {
      RR.runtime.sendMessage(msg, function (r) {
        var err = RR.runtime.lastError;
        if (err) return ko(new Error(err.message));
        if (!r) return ko(new Error("Pas de réponse de l'extension."));
        if (r.error) { var e = new Error(r.error); e.status = r.status; return ko(e); }
        ok(r);
      });
    } catch (e) { ko(e); }
  });
}
