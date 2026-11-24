// Vues et favoris de tes annonces, lus sur « Mes annonces » (Le Bon Coin) et Seller Hub / Mes ventes (eBay).
// Deux sources, réunies : les réponses JSON que la page reçoit (stats-page.js, monde principal) et le texte affiché
// sur chaque annonce (« 128 vues », « 7 favoris », colonnes « Vues » et « Observateurs » d'eBay).
// Les lignes { id, vues, favoris } partent vers RetroRevente, qui les range dans la fiche dont le lien correspond.
// RR_STATS.lire() sert aussi à l'app Mac, qui ouvre ces pages en arrière-plan sans les montrer.
var RR_STATS = (typeof RR_STATS !== "undefined" && RR_STATS) || (function () {
  var norm = function (s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s  ]+/g, " ").trim().toLowerCase(); };
  function site(loc) {
    var h = (loc || location).hostname, p = (loc || location).pathname;
    if (/(^|\.)leboncoin\.fr$/.test(h)) return /mes-annonces|\/compte\/(part|pro)?\/?|\/dashboard/.test(p) ? "lbc" : "";
    if (/(^|\.)ebay\.fr$/.test(h)) return /^\/sh\/(lst|ovw)|^\/mye\/myebay\/(selling|v2\/selling)|^\/myb\/(Selling|Active)/i.test(p) ? "ebay" : "";
    return "";
  }
  // « 1 234 », « 1,2 k », « 12 » → nombre
  function nb(t) {
    var m = /(\d+(?:[.,]\d+)?)\s*(k|m)?\b/i.exec(String(t || "").replace(/(\d)[\s  .](?=\d{3}\b)/g, "$1"));
    if (!m) return null;
    var n = parseFloat(m[1].replace(",", ".")); if (m[2]) n *= /k/i.test(m[2]) ? 1e3 : 1e6;
    return isFinite(n) ? Math.round(n) : null;
  }
  var MOT_VUES = "vues?|visites?|consultations?|affichages?|views?|visits?";
  var MOT_FAV = "favoris|mises? en favoris?|ajouts? (aux|en) favoris|sauvegardes?|observateurs?|watchers?|personnes? (qui )?(suivent|surveillent|interessees)|suivi par|j.aime";
  var NUM = "(\\d{1,3}(?:[ .]\\d{3})+|\\d+(?:,\\d)?\\s?k\\b|\\d+)";
  var APRES_V = new RegExp(NUM + "\\s*(" + MOT_VUES + ")\\b"), AVANT_V = new RegExp("\\b(" + MOT_VUES + ")\\s*:?\\s*" + NUM);
  var APRES_F = new RegExp(NUM + "\\s*(" + MOT_FAV + ")"), AVANT_F = new RegExp("\\b(" + MOT_FAV + ")\\s*:?\\s*(?:par\\s+)?" + NUM);
  var dansTexte = function (t, apres, avant) { var m = apres.exec(t); if (m) return nb(m[1]); m = avant.exec(t); return m ? nb(m[m.length - 1]) : null; };
  // Indices d'une icône ou d'un champ : attributs, titre de l'icône, symbole utilisé.
  function indices(x) {
    var t = [];
    for (var e = x, i = 0; e && i < 3; e = e.parentElement, i++) {
      ["aria-label", "title", "data-qa-id", "data-test-id", "data-testid", "data-test", "data-icon", "class", "name"].forEach(function (a) { var v = e.getAttribute && e.getAttribute(a); if (v && typeof v === "string") t.push(v); });
    }
    [].forEach.call(x.querySelectorAll ? x.querySelectorAll("svg title, svg use, [aria-label], [data-icon], [data-qa-id], [data-test-id], [data-testid]") : [], function (y) {
      t.push(y.textContent || "", y.getAttribute("href") || y.getAttribute("xlink:href") || "", y.getAttribute("aria-label") || "", y.getAttribute("data-icon") || "", y.getAttribute("data-qa-id") || "", y.getAttribute("data-test-id") || "", y.getAttribute("data-testid") || "", String(y.className && y.className.baseVal != null ? y.className.baseVal : y.className || ""));
    });
    return norm(t.join(" "));
  }
  var ICONE_V = /\b(eye|oeil|view|views|vues?|visit\w*)\b|visitcount|viewcount|eye-?outline|_views?\b/, ICONE_F = /\b(heart|coeur|favou?rites?|favoris|saved|bookmark|watch\w*|observ\w*)\b|watchcount|heart-?outline|_fav/;
  // Compteurs d'une carte d'annonce : texte (« 128 vues ») puis icônes suivies d'un nombre (œil, cœur).
  function compteursCarte(c) {
    var t = norm(c.innerText || c.textContent || ""), r = { vues: dansTexte(t, APRES_V, AVANT_V), favoris: dansTexte(t, APRES_F, AVANT_F) };
    [].forEach.call(c.querySelectorAll("[aria-label], [title]"), function (x) {
      var a = norm((x.getAttribute("aria-label") || "") + " " + (x.getAttribute("title") || ""));
      if (r.vues == null) r.vues = dansTexte(a, APRES_V, AVANT_V);
      if (r.favoris == null) r.favoris = dansTexte(a, APRES_F, AVANT_F);
    });
    if (r.vues != null && r.favoris != null) return r;
    // petits blocs « icône + nombre » : le nombre seul, l'icône dit ce qu'il compte
    [].forEach.call(c.querySelectorAll("span, div, p, li, td, button"), function (x) {
      if (x.children.length > 4) return;
      var tx = (x.innerText || x.textContent || "").trim();
      if (!/^\d[\d\s .,]*\s*k?$/i.test(tx) || tx.length > 9) return;
      // l'icône voisine (avant ou après le nombre), ou le petit bloc qui les réunit tous les deux
      var p = x.parentElement, ind = indices(x) + " " + (x.previousElementSibling ? indices(x.previousElementSibling) : "") + " " + (x.nextElementSibling ? indices(x.nextElementSibling) : "");
      if (p && p.children.length <= 2 && !ICONE_V.test(ind) && !ICONE_F.test(ind)) ind += " " + indices(p);
      var v = ICONE_V.test(ind), f = ICONE_F.test(ind);
      if (v && !f && r.vues == null) r.vues = nb(tx);
      else if (f && !v && r.favoris == null) r.favoris = nb(tx);
    });
    return r;
  }
  function idLien(href, s) {
    var m = s === "ebay" ? /\/itm\/(?:[^/?#]+\/)?(\d{9,15})/.exec(href || "") : /\/ad\/[a-z_]+\/(\d{6,15})/.exec(href || "");
    return m ? m[1] : "";
  }
  // Bloc de l'annonce autour de son lien : on remonte tant qu'il ne contient pas d'autre annonce.
  function carte(a, s, id) {
    var c = a;
    for (var i = 0; i < 9 && c.parentElement && c.parentElement !== document.body; i++) {
      var p = c.parentElement, autres = [].some.call(p.querySelectorAll(s === "ebay" ? "a[href*='/itm/']" : "a[href*='/ad/']"), function (y) { var j = idLien(y.getAttribute("href"), s); return j && j !== id; });
      if (autres || (p.innerText || "").length > 2500) break;
      c = p;
    }
    return c;
  }
  // eBay Seller Hub : tableau avec colonnes « Vues » / « Observateurs » (ou classes visitCount / watchCount).
  function tableauEbay(l) {
    [].forEach.call(document.querySelectorAll("table"), function (tb) {
      var tete = [].slice.call(tb.querySelectorAll("thead th, tr:first-child th"));
      var col = function (re, cls) { for (var i = 0; i < tete.length; i++) { var h = tete[i]; if (re.test(norm(h.innerText || h.textContent)) || cls.test(String(h.className || "") + " " + (h.getAttribute("data-test-id") || ""))) return i; } return -1; };
      var iv = col(/\b(vues?|visites?|views?|consultations?)\b/, /visit|view/i), ifv = col(/observ|suivi|watch|favori|interess/, /watch/i);
      [].forEach.call(tb.querySelectorAll("tbody tr"), function (tr) {
        var a = tr.querySelector("a[href*='/itm/']"), id = a && idLien(a.getAttribute("href"), "ebay");
        if (!id) { var m = /\b(\d{12})\b/.exec(tr.innerText || ""); id = m ? m[1] : ""; }
        if (!id) return;
        var cel = tr.querySelectorAll("td, th"), lc = function (i, cls) { var x = i >= 0 && cel[i] ? cel[i] : tr.querySelector("[class*='" + cls + "']"); return x ? nb(x.innerText || x.textContent) : null; };
        var v = lc(iv, "visitCount"), f = lc(ifv, "watchCount");
        if (v != null || f != null) l[id] = { id: id, vues: v, favoris: f };
      });
    });
  }
  /** Lignes lues dans la page affichée : [{ id, vues, favoris }]. */
  function lire() {
    var s = site(); if (!s) return { site: "", annonces: [] };
    var l = {};
    if (s === "ebay") tableauEbay(l);
    [].forEach.call(document.querySelectorAll(s === "ebay" ? "a[href*='/itm/']" : "a[href*='/ad/']"), function (a) {
      var id = idLien(a.getAttribute("href"), s); if (!id || (l[id] && l[id].vues != null && l[id].favoris != null)) return;
      var r = compteursCarte(carte(a, s, id));
      if (r.vues == null && r.favoris == null) return;
      var p = l[id] || { id: id, vues: null, favoris: null };
      if (p.vues == null) p.vues = r.vues; if (p.favoris == null) p.favoris = r.favoris;
      l[id] = p;
    });
    return { site: s, annonces: Object.keys(l).map(function (k) { return l[k]; }) };
  }
  // Lignes venues des réponses JSON (stats-page.js) : elles priment sur le texte, qui peut être arrondi (« 1,2 k »).
  var json = {};
  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data || e.data.source !== "rr-stats" || !Array.isArray(e.data.lignes)) return;
    e.data.lignes.slice(0, 500).forEach(function (x) { if (x && /^\d{6,15}$/.test(String(x.id))) { var p = json[x.id] || {}; json[x.id] = { id: String(x.id), vues: x.vues != null ? x.vues : p.vues, favoris: x.favoris != null ? x.favoris : p.favoris }; } });
    if (RR_STATS.surNouveau) RR_STATS.surNouveau();
  });
  /** Tout ce qui est connu pour cette page : texte affiché complété par le JSON. */
  function tout() {
    var r = lire();
    if (!r.site) return r;
    var parId = {}; r.annonces.forEach(function (x) { parId[x.id] = x; });
    Object.keys(json).forEach(function (id) { var j = json[id], p = parId[id] || (parId[id] = { id: id, vues: null, favoris: null }); if (j.vues != null) p.vues = j.vues; if (j.favoris != null) p.favoris = j.favoris; });
    r.annonces = Object.keys(parId).map(function (k) { return parId[k]; }).filter(function (x) { return x.vues != null || x.favoris != null; });
    return r;
  }
  return { site: site, lire: lire, tout: tout, nb: nb, surNouveau: null };
})();

// Dans l'extension : envoi à RetroRevente quand la page change, et relevé discret toutes les 3 heures.
(function () {
  if (typeof RR === "undefined" || !RR || !RR.runtime || !RR.runtime.id || typeof rrDemander !== "function" || window.__rrStatsExt) return;
  window.__rrStatsExt = true;
  var envoye = "", minuterie = null, cadre = window.top !== window;
  function envoyer() {
    var r = RR_STATS.tout(); if (!r.site || !r.annonces.length) return;
    var sig = JSON.stringify(r.annonces); if (sig === envoye) return;
    envoye = sig;
    var cle = {}; cle["statsAt_" + r.site] = Date.now();
    rrDemander({ type: "stats", site: r.site, annonces: r.annonces }).then(function () { try { RR.storage.local.set(cle); } catch (e) {} }).catch(function () { envoye = ""; });
  }
  var plusTard = function () { clearTimeout(minuterie); minuterie = setTimeout(envoyer, 1500); };
  RR_STATS.surNouveau = plusTard;
  if (RR_STATS.site()) {
    new MutationObserver(plusTard).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    plusTard();
  }
  // Relevé discret : sur une autre page du site, un cadre invisible charge « Mes annonces » (ou Seller Hub) au plus
  // toutes les 3 heures, si des annonces y sont liées. Si le site refuse d'être chargé dans un cadre, rien ne se passe.
  if (cadre || RR_STATS.site()) return;
  var ebay = /ebay\.fr$/.test(location.hostname), cleAt = "statsAt_" + (ebay ? "ebay" : "lbc"), cleEssai = "statsEssai_" + (ebay ? "ebay" : "lbc");
  setTimeout(function () {
    RR.storage.local.get(["cle", cleAt, cleEssai]).then(function (s) {
      if (!s || !s.cle || document.hidden) return;
      var der = Math.max(s[cleAt] || 0, s[cleEssai] || 0); if (Date.now() - der < 3 * 3600e3) return;
      var o = {}; o[cleEssai] = Date.now(); RR.storage.local.set(o);
      var f = document.createElement("iframe");
      f.src = ebay ? "https://www.ebay.fr/sh/lst/active" : "https://www.leboncoin.fr/compte/part/mes-annonces";
      f.setAttribute("aria-hidden", "true"); f.tabIndex = -1; f.title = "RetroRevente";
      f.style.cssText = "position:fixed;left:-10000px;top:0;width:1200px;height:900px;border:0;opacity:0;pointer-events:none";
      document.documentElement.appendChild(f);
      setTimeout(function () { f.remove(); }, 45000);
    }).catch(function () {});
  }, 8000);
})();
