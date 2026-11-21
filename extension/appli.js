// Sur l'appli RetroRevente : signale que l'extension est installée et reçoit la clé quand on clique
// « Connecter l'extension » dans Mon compte. Seuls les messages de la page elle-même sont acceptés.
(function () {
  function dire(type, extra) { window.postMessage(Object.assign({ source: "retrorevente-extension", type: type }, extra || {}), location.origin); }
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (e.source !== window || e.origin !== location.origin || !d || d.source !== "retrorevente-app") return;
    if (d.type === "cle") rrDemander({ type: "cle", cle: d.cle, serveur: location.origin }).then(function (r) { dire("cle-ok", { email: r.email }); }, function (err) { dire("cle-erreur", { message: err.message }); });
    // Bouton « Le Bon Coin » d'une fiche : l'article à déposer, repris par l'extension sur la page de dépôt.
    if (d.type === "deposer" && /^[a-f0-9]{16}$/.test(String(d.id || ""))) { try { RR.storage.local.set({ aDeposer: { id: d.id, at: Date.now() } }); } catch (err) {} }
    // Bouton « Créer l'annonce sur eBay » : l'article que l'extension remplira sur la page de mise en vente eBay.
    if (d.type === "deposer-ebay" && /^[a-f0-9]{16}$/.test(String(d.id || ""))) { try { RR.storage.local.set({ aDeposerEbay: { id: d.id, at: Date.now() } }); } catch (err) {} }
    if (d.type === "deconnecter") rrDemander({ type: "deconnecter" }).catch(function () {});
  });
  // Cet onglet devient celui où l'on revient après une publication sur Le Bon Coin.
  function ici() { if (document.visibilityState !== "hidden") rrDemander({ type: "appli" }).catch(function () {}); }
  ici(); document.addEventListener("visibilitychange", ici); window.addEventListener("focus", ici);
  RR.runtime.onMessage.addListener(function (m) {
    if (m && m.type === "publiee") dire("publiee", { id: m.id, titre: m.titre, url: m.url });
  });
  function presente() { dire("present", { version: RR.runtime.getManifest().version }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", presente); else presente();
  window.addEventListener("load", presente);
})();
