// Vues et favoris : écoute, dans la page elle-même (« monde principal »), les réponses JSON que Le Bon Coin et eBay
// chargent pour afficher « Mes annonces » ou Seller Hub, et y repère pour chaque annonce son nombre de vues et de
// favoris. Rien n'est envoyé nulle part : les lignes trouvées sont passées à stats.js par un message de la fenêtre.
// Ne lit que les réponses que la page reçoit déjà ; ne fait aucune requête.
(function () {
  if (window.__rrStatsPage) return;
  window.__rrStatsPage = true;

  var ID = /^(list_?id|listing_?id|ad_?id|item_?id|id)$/i;
  var VUES = /^(views?|nb_?views|views?_?count|count_?views|page_?views|visits?|visit_?count|nb_?visits|vues|nb_?vues|impressions_?detail)$/i;
  var FAV = /^(favou?rites?|nb_?favou?rites?|favou?rites?_?count|saved|saved_?count|saves|bookmarks?|bookmark_?count|watchers?|watch_?count|watchers?_?count|favoris|nb_?favoris|likes?)$/i;
  var nombre = function (v) { var n = typeof v === "string" ? Number(v.replace(/[\s ]/g, "")) : v; return typeof n === "number" && isFinite(n) && n >= 0 ? Math.round(n) : null; };

  // Compteurs d'un objet : clés directes, sous-objets « stats »/« counters », ou listes [{ name|key|type, value|count }].
  function compteurs(o, prof, r) {
    if (!o || typeof o !== "object" || prof > 3) return r;
    if (Array.isArray(o)) {
      o.forEach(function (x) {
        if (!x || typeof x !== "object") return;
        var k = x.name || x.key || x.type || x.label, v = x.value != null ? x.value : x.count != null ? x.count : x.total;
        if (typeof k === "string" && nombre(v) != null) { if (VUES.test(k) && r.vues == null) r.vues = nombre(v); else if (FAV.test(k) && r.favoris == null) r.favoris = nombre(v); }
        else if (prof < 3) compteurs(x, prof + 1, r);
      });
      return r;
    }
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      if (v && typeof v === "object") { if (prof < 3 && !ID.test(k)) compteurs(v, prof + 1, r); return; }
      if (VUES.test(k) && r.vues == null && nombre(v) != null) r.vues = nombre(v);
      else if (FAV.test(k) && r.favoris == null && nombre(v) != null) r.favoris = nombre(v);
    });
    return r;
  }
  function idDe(o) {
    for (var k in o) if (ID.test(k) && /^\d{6,15}$/.test(String(o[k]))) return String(o[k]);
    var u = o.url || o.link || o.href || o.itemUrl || o.viewItemURL;
    var m = typeof u === "string" && /\/(?:ad\/[a-z_]+|itm\/(?:[^/?#]+\/)?)(\d{6,15})/.exec(u);
    return m ? m[1] : "";
  }
  // Parcourt la réponse : chaque objet qui porte un identifiant d'annonce et au moins un compteur donne une ligne.
  function parcourir(o, l, prof) {
    if (!o || typeof o !== "object" || prof > 12 || l.length > 500) return;
    if (Array.isArray(o)) { o.forEach(function (x) { parcourir(x, l, prof + 1); }); return; }
    var id = idDe(o);
    if (id) {
      var c = compteurs(o, 0, {});
      if (c.vues != null || c.favoris != null) { l.push({ id: id, vues: c.vues != null ? c.vues : null, favoris: c.favoris != null ? c.favoris : null }); return; }
    }
    for (var k in o) if (o[k] && typeof o[k] === "object") parcourir(o[k], l, prof + 1);
  }
  window.__rrStatsJSON = function (j) { var l = []; parcourir(j, l, 0); return l; };
  function publier(texte, url) {
    if (!texte || texte.length > 5e6 || !/^[\s]*[\[{]/.test(texte)) return;
    try { var l = window.__rrStatsJSON(JSON.parse(texte)); if (l.length) window.postMessage({ source: "rr-stats", url: String(url || "").slice(0, 200), lignes: l }, location.origin); } catch (e) {}
  }
  var interessant = function (u) { return /leboncoin\.fr|ebay\.|\/api\/|graphql|dashboard|listing|seller|sh\//i.test(String(u || "")); };

  var f0 = window.fetch;
  if (f0) window.fetch = function (r, o) {
    var p = f0.apply(this, arguments);
    try {
      var u = typeof r === "string" ? r : r && r.url;
      if (interessant(u)) p.then(function (rep) { try { if (/json/.test(rep.headers.get("content-type") || "")) rep.clone().text().then(function (t) { publier(t, u); }, function () {}); } catch (e) {} }, function () {});
    } catch (e) {}
    return p;
  };
  var X = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (X) {
    var ouvrir = X.open, envoyer = X.send;
    X.open = function (m, u) { this.__rrUrl = u; return ouvrir.apply(this, arguments); };
    X.send = function () {
      var x = this;
      if (interessant(x.__rrUrl)) x.addEventListener("load", function () { try { if (!x.responseType || x.responseType === "text") publier(x.responseText, x.__rrUrl); else if (x.responseType === "json") window.postMessage({ source: "rr-stats", url: String(x.__rrUrl || "").slice(0, 200), lignes: window.__rrStatsJSON(x.response) }, location.origin); } catch (e) {} });
      return envoyer.apply(this, arguments);
    };
  }
  // Données déjà dans la page (rendu serveur : __NEXT_DATA__, état initial).
  function initiales() {
    [].forEach.call(document.querySelectorAll("script#__NEXT_DATA__, script[type='application/json']"), function (s) { publier(s.textContent, "page"); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initiales); else initiales();
})();
