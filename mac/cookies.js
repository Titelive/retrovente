// Fenêtres de cookies : l'app répond « Continuer sans accepter » / « Tout refuser » toute seule, et cache la fenêtre
// pendant ce temps (pas de flash). Le choix est gardé par le site, comme si la personne avait cliqué.
(function () {
  if (window.top !== window || window.__rrCookies) return;
  window.__rrCookies = true;
  var style = document.createElement("style");
  style.textContent = "#didomi-host,#didomi-popup,.didomi-popup-container,#onetrust-consent-sdk,#tarteaucitronRoot,#axeptio_overlay,.qc-cmp2-container,#sp_message_container{display:none!important}" +
    "html.didomi-popup-open,body.didomi-popup-open,body.didomi-popup-open-ios{overflow:auto!important;position:static!important}";
  (document.head || document.documentElement).appendChild(style);
  var BOUTONS = ["#didomi-notice-disagree-button", ".didomi-continue-without-agreeing", "#onetrust-reject-all-handler",
    "#tarteaucitronAllDenied2", "#axeptio_btn_dismiss", ".qc-cmp2-summary-buttons button[mode=secondary]"];
  var TEXTE = /^\s*(continuer sans accepter|tout refuser|refuser tout|refuser et fermer|je refuse)\s*[→›>]?\s*$/i;
  var ZONE = "#didomi-host,#onetrust-consent-sdk,#tarteaucitronRoot,#axeptio_overlay,.qc-cmp2-container,[id*=consent i],[class*=consent i],[id*=cookie i],[class*=cookie i],[role=dialog]";
  var fait = false;
  function essayer() {
    if (fait) return;
    for (var i = 0; i < BOUTONS.length; i++) { var b = document.querySelector(BOUTONS[i]); if (b) { b.click(); fait = true; return; } }
    var t = [].find.call(document.querySelectorAll("button,a,[role=button],span"), function (e) {
      return e.children.length < 3 && TEXTE.test(e.textContent || "") && e.closest(ZONE);
    });
    if (t) { t.click(); fait = true; }
  }
  var obs = new MutationObserver(essayer);
  function demarrer() { essayer(); if (!fait) obs.observe(document.documentElement, { childList: true, subtree: true }); setTimeout(function () { obs.disconnect(); }, 30000); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer); else demarrer();
})();
