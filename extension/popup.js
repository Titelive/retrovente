var $ = function (id) { return document.getElementById(id); };
function statut(t, mauvais) { var s = $("s"); s.hidden = !t; s.textContent = t || ""; s.style.color = mauvais ? "#B3261E" : ""; }
function afficher(e) {
  $("co").hidden = !e.connecte; $("deco").hidden = e.connecte; $("lbc").hidden = $("sortir").hidden = !e.connecte;
  $("email").textContent = e.email || "";
}
function maj() {
  return rrDemander({ type: "etat" }).then(function (e) {
    afficher(e);
    if (e.connecte) return rrDemander({ type: "annonces" }).then(function (j) {
      statut(j.annonces.length ? j.annonces.length + (j.annonces.length > 1 ? " annonces prêtes." : " annonce prête.") : "Aucun article « En vente » pour le moment.");
    }, function (err) { if (err.status === 401) { afficher({ connecte: false }); } statut(err.message, true); });
  }).catch(function (err) { statut(err.message, true); });
}
$("f").addEventListener("submit", function (ev) {
  ev.preventDefault();
  statut("Connexion…");
  rrDemander({ type: "cle", cle: $("cle").value }).then(function () { $("cle").value = ""; return maj(); }, function (err) { statut(err.message, true); });
});
$("sortir").addEventListener("click", function () { rrDemander({ type: "deconnecter" }).then(maj); });
maj();
