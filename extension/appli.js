// Sur l'appli RetroRevente : signale que l'extension est installée et reçoit la clé quand on clique
// « Connecter l'extension » dans Mon compte. Seuls les messages de la page elle-même sont acceptés.
(function () {
  function dire(type, extra) { window.postMessage(Object.assign({ source: "retrorevente-extension", type: type }, extra || {}), location.origin); }
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (e.source !== window || e.origin !== location.origin || !d || d.source !== "retrorevente-app") return;
    if (d.type === "cle") rrDemander({ type: "cle", cle: d.cle, serveur: location.origin }).then(function (r) { dire("cle-ok", { email: r.email }); }, function (err) { dire("cle-erreur", { message: err.message }); });
    if (d.type === "deconnecter") rrDemander({ type: "deconnecter" }).catch(function () {});
  });
  function presente() { dire("present", { version: RR.runtime.getManifest().version }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", presente); else presente();
  window.addEventListener("load", presente);
})();
