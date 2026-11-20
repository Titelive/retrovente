// Pont de l'app Mac : remplace les API d'extension (browser.storage, browser.runtime) utilisées par commun.js,
// lbc.js, appli.js et popup.js. Injecté avant eux, dans le même « monde » isolé (la page Le Bon Coin ne le voit pas).
// Chaque appel part vers l'app (Swift) par webkit.messageHandlers.rr, qui répond par une promesse.
// __RR_CONFIG__ est remplacé par l'app : { version, ressources: { "polices/x.woff2": "data:…" } }.
(function () {
  if (window.__rrPont) return;
  var CONFIG = __RR_CONFIG__;
  var canal = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.rr;
  function appeler(op, donnees) {
    if (!canal) return Promise.reject(new Error("App RetroRevente introuvable."));
    return canal.postMessage({ op: op, donnees: donnees === undefined ? null : JSON.stringify(donnees) })
      .then(function (r) { return r == null ? undefined : JSON.parse(r); });
  }
  function cles(k) {
    if (k == null) return { liste: null, defauts: {} };
    if (typeof k === "string") return { liste: [k], defauts: {} };
    if (Array.isArray(k)) return { liste: k.map(String), defauts: {} };
    return { liste: Object.keys(k), defauts: k };
  }
  var ecouteurs = [];
  var api = {
    storage: {
      local: {
        get: function (k) {
          var c = cles(k);
          return appeler("lire", c.liste).then(function (r) { return Object.assign({}, c.defauts, r || {}); });
        },
        set: function (o) { return appeler("ecrire", o || {}).then(function () {}); },
        remove: function (k) { return appeler("effacer", cles(k).liste || []).then(function () {}); },
        clear: function () { return appeler("effacer", null).then(function () {}); },
      },
    },
    runtime: {
      id: "fr.retrorevente.mac",
      getManifest: function () { return { version: CONFIG.version, name: "RetroRevente", mac: CONFIG.mac }; },
      getURL: function (p) { p = String(p || "").replace(/^\//, ""); return CONFIG.ressources[p] || ("rrext://app/" + p); },
      sendMessage: function (m) { return appeler("message", m); },
      onMessage: {
        addListener: function (f) { if (typeof f === "function") ecouteurs.push(f); },
        removeListener: function (f) { ecouteurs = ecouteurs.filter(function (x) { return x !== f; }); },
      },
    },
  };
  // Message envoyé par l'app (publication, raccourci « ouvrir la recherche »).
  Object.defineProperty(window, "__rrPont", { value: {
    recevoir: function (m) { ecouteurs.slice().forEach(function (f) { try { f(m, { id: api.runtime.id }, function () {}); } catch (e) {} }); return true; },
  } });
  window.browser = api;
})();
