var $ = function (id) { return document.getElementById(id); };
var MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
function statut(t, mauvais) { var s = $("s"); s.hidden = !t; s.textContent = t || ""; s.className = "s" + (mauvais ? " mal" : ""); }
function el(tag, cls, txt) { var x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; }

// Logo en ligne : l'éclair prend la couleur de la formule, comme sur le site.
fetch("img/logo-nuit.svg").then(function (r) { return r.text(); }).then(function (t) {
  var d = new DOMParser().parseFromString(t, "image/svg+xml").documentElement; if (!d || d.nodeName !== "svg") return;
  [].forEach.call(d.querySelectorAll("path"), function (p) { var f = (p.getAttribute("fill") || "").toUpperCase(); if (f === "#D4F57A") { p.removeAttribute("fill"); p.setAttribute("class", "eclair"); } else if (f === "#FFFFFF") p.setAttribute("fill", "currentColor"); });
  d.setAttribute("role", "img"); d.setAttribute("aria-label", "RetroRevente"); d.removeAttribute("width"); d.removeAttribute("height");
  $("logo").replaceChildren(document.importNode(d, true));
}).catch(function () {});

// Raccourcis : touches du système (Ctrl / Alt hors Mac).
if (!MAC) { $("kCherche").replaceChildren(el("kbd", "", "Ctrl"), el("kbd", "", "K")); $("kDepot").replaceChildren(el("kbd", "", "Alt"), el("kbd", "", "⇧"), el("kbd", "", "R")); }

function afficher(e) {
  $("co").hidden = $("qui").hidden = $("av").hidden = $("bas").hidden = !e.connecte;
  $("deco").hidden = $("quiDeco").hidden = !!e.connecte;
  $("email").textContent = e.email || "";
  if (!$("nom").textContent) $("nom").textContent = (e.email || "").split("@")[0];
}
function profil(p, email) {
  if (!p) return;
  if (/^(vendeur|collectionneur|pass)$/.test(p.formule || "")) document.documentElement.setAttribute("data-formule", p.formule); else document.documentElement.removeAttribute("data-formule");
  $("nom").textContent = p.nom || (email || "").split("@")[0];
  $("badge").textContent = p.formuleNom || "Découverte";
  var av = $("av");
  if (/^data:image\/(jpeg|png|webp);base64,/.test(p.avatar || "")) { av.style.backgroundImage = "url(" + p.avatar + ")"; av.textContent = ""; }
  else { av.style.backgroundImage = ""; av.textContent = (p.nom || email || "?").trim().charAt(0).toUpperCase(); }
}
var emoji = function (a) { var t = String(a.plateforme || "").toLowerCase(); return a.categorie === "cartes" ? "🃏" : a.categorie === "films" ? "🎬" : a.categorie === "consoles" ? "🕹️" : a.categorie === "autres" ? "🛍️" : a.categorie !== "connectes" ? "🎮" : /couteur|casque/.test(t) ? "🎧" : /montre|bracelet/.test(t) ? "⌚" : /enceinte/.test(t) ? "🔊" : /phone|tablette|liseuse/.test(t) ? "📱" : "🔌"; };
var photos = {};
function vignette(a, i) {
  var v = el("span", "vg", emoji(a));
  if (a.photo) (photos[a.id] = photos[a.id] || rrDemander({ type: "photo", id: a.id })).then(function (r) { if (r && r.base64) { v.style.backgroundImage = "url(data:" + r.type + ";base64," + r.base64 + ")"; v.textContent = ""; } }).catch(function () {});
  return v;
}
function annonces(l) {
  var t = function (a) { return Date.parse(a.modifie || "") || 0; };
  var pretes = l.filter(function (a) { return !a.publiee; }).sort(function (a, b) { return t(b) - t(a); }), n = pretes.length;
  $("pret").classList.remove("squelette");
  $("n").textContent = n;
  $("nTx").firstChild.textContent = n > 1 ? "annonces prêtes" : n ? "annonce prête" : "rien à déposer";
  $("nSous").textContent = n ? "à déposer sur Le Bon Coin" : l.length ? "tout est déjà en ligne" : "ajoute un article dans l'appli";
  var ul = $("liste"); ul.replaceChildren(); ul.hidden = !n;
  pretes.slice(0, 3).forEach(function (a, i) {
    var li = el("li"); li.appendChild(vignette(a, i)); li.appendChild(el("span", "t", a.titre || a.nom || "Article"));
    if (a.prix != null) li.appendChild(el("span", "px", a.prix + " €"));
    ul.appendChild(li);
  });
  if (n > 3) ul.appendChild(el("li", "autres", "+ " + (n - 3) + (n - 3 > 1 ? " autres articles" : " autre article")));
}
function maj() {
  statut("");
  return rrDemander({ type: "etat" }).then(function (e) {
    afficher(e);
    if (e.connecte) return rrDemander({ type: "annonces" }).then(function (j) { profil(j.profil, j.email || e.email); annonces(j.annonces || []); },
      function (err) { if (err.status === 401) afficher({ connecte: false }); statut(err.message, true); });
  }).catch(function (err) { statut(err.message, true); });
}
$("f").addEventListener("submit", function (ev) {
  ev.preventDefault();
  statut("Connexion…");
  rrDemander({ type: "cle", cle: $("cle").value }).then(function () { $("cle").value = ""; return maj(); }, function (err) { statut(err.message, true); });
});
$("sortir").addEventListener("click", function () { rrDemander({ type: "deconnecter" }).then(function () { document.documentElement.removeAttribute("data-formule"); $("nom").textContent = ""; return maj(); }); });
maj();
