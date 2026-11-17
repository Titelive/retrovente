/* RetroRevente : thème clair/sombre, barre de lecture, retour en haut, apparitions et micro-interactions. */
(function () {
  var d = document, html = d.documentElement, calme = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var sys = matchMedia("(prefers-color-scheme: dark)");
  function lu() { try { return localStorage.getItem("rr-theme"); } catch (e) { return null; } }
  function applique(t) { html.setAttribute("data-theme", t); var m = d.querySelector('meta[name="theme-color"]'); if (m) m.content = t === "dark" ? "#141414" : "#1A1A1A"; }
  applique(lu() || (sys.matches ? "dark" : "light"));
  sys.addEventListener && sys.addEventListener("change", function (e) { if (!lu()) applique(e.matches ? "dark" : "light"); });

  function pret(f) { d.readyState === "loading" ? d.addEventListener("DOMContentLoaded", f) : f(); }
  pret(function () {
    var b = d.body;

    /* bouton de thème */
    var tb = d.createElement("button");
    tb.type = "button"; tb.className = "theme-bt";
    tb.innerHTML = '<svg class="soleil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg><svg class="lune" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8a8.4 8.4 0 1 0 10.8 10.8z"/></svg>';
    function etiq() { var s = html.getAttribute("data-theme") === "dark"; tb.setAttribute("aria-label", s ? "Passer en mode clair" : "Passer en mode sombre"); tb.title = tb.getAttribute("aria-label"); }
    etiq();
    tb.addEventListener("click", function () {
      var t = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
      if (!calme) { html.classList.add("theme-anim"); setTimeout(function () { html.classList.remove("theme-anim"); }, 500); }
      applique(t); etiq(); try { localStorage.setItem("rr-theme", t); } catch (e) {}
    });
    var place = d.querySelector("[data-theme-ici]");
    if (place) place.parentNode.insertBefore(tb, place);
    else { var hd = d.querySelector(".ed-menu .wrap, .barre .wrap"); if (hd) { var dern = hd.querySelector(":scope > .btn"); dern ? hd.insertBefore(tb, dern) : hd.appendChild(tb); } }

    /* barre de lecture + retour en haut */
    var barre = d.createElement("div"); barre.className = "lecture"; barre.setAttribute("aria-hidden", "true"); b.appendChild(barre);
    var haut = d.createElement("button"); haut.type = "button"; haut.className = "haut"; haut.setAttribute("aria-label", "Revenir en haut de la page");
    haut.innerHTML = '<svg class="anneau" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="25" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg><svg class="fleche" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/></svg>';
    b.appendChild(haut);
    var anneau = haut.querySelector("circle");
    haut.addEventListener("click", function () { scrollTo({ top: 0, behavior: calme ? "auto" : "smooth" }); });
    var att = false;
    function maj() {
      att = false;
      var max = html.scrollHeight - innerHeight, p = max > 0 ? Math.min(1, scrollY / max) : 0;
      barre.style.transform = "scaleX(" + p + ")";
      anneau.setAttribute("stroke-dashoffset", String(100 - p * 100));
      haut.classList.toggle("on", scrollY > innerHeight * .8);
    }
    addEventListener("scroll", function () { if (!att) { att = true; requestAnimationFrame(maj); } }, { passive: true });
    addEventListener("resize", maj); maj();

    /* apparitions : pages éditoriales automatiquement */
    d.querySelectorAll("article.ed > *:not(.fil), .liste-g > li, .legal > *").forEach(function (e) { if (!e.classList.contains("rv")) e.classList.add("rv"); });
    /* titres mot à mot */
    d.querySelectorAll("[data-mots]").forEach(function (h) {
      var i = 0;
      (function decoupe(n) {
        [].slice.call(n.childNodes).forEach(function (c) {
          if (c.nodeType === 3) {
            var f = d.createDocumentFragment();
            c.textContent.split(/(\s+)/).forEach(function (w) {
              if (!w) return;
              if (/^\s+$/.test(w)) { f.appendChild(d.createTextNode(w)); return; }
              var s = d.createElement("span"); s.className = "m"; s.textContent = w; s.style.transitionDelay = (i++ * 70) + "ms"; f.appendChild(s);
            });
            n.replaceChild(f, c);
          } else if (c.nodeType === 1) decoupe(c);
        });
      })(h);
      h.classList.add("mots");
    });
    var els = d.querySelectorAll(".rv, .mots");
    if ("IntersectionObserver" in window && !calme) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("vu"); io.unobserve(e.target); } });
      }, { rootMargin: "0px 0px -8% 0px" });
      var prec = null, k = 0;
      els.forEach(function (e) { if (e.parentNode === prec) k++; else { k = 0; prec = e.parentNode; } if (!e.style.transitionDelay) e.style.transitionDelay = Math.min(k, 5) * 80 + "ms"; io.observe(e); });
    } else els.forEach(function (e) { e.classList.add("vu"); });

    /* compteurs */
    d.querySelectorAll("[data-compte]").forEach(function (el) {
      var fin = parseFloat(el.getAttribute("data-compte")), suf = el.getAttribute("data-suffixe") || "";
      if (calme || !("IntersectionObserver" in window)) return;
      var n = el.firstChild; if (!n || n.nodeType !== 3) return;
      n.textContent = "0";
      var o = new IntersectionObserver(function (es) {
        if (!es[0].isIntersecting) return; o.disconnect();
        var t0 = performance.now(), dur = 1200;
        (function pas(t) { var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); n.textContent = Math.round(fin * e) + suf; if (p < 1) requestAnimationFrame(pas); })(t0);
      }, { threshold: .6 });
      o.observe(el);
    });

    if (calme) return;
    var fin = matchMedia("(hover: hover) and (pointer: fine)").matches;

    /* onde au clic sur les boutons */
    d.addEventListener("pointerdown", function (e) {
      var bt = e.target.closest && e.target.closest(".btn"); if (!bt || bt.disabled) return;
      var r = bt.getBoundingClientRect(), t = Math.max(r.width, r.height) * 2.2, o = d.createElement("span");
      o.className = "onde"; o.style.width = o.style.height = t + "px"; o.style.left = (e.clientX - r.left - t / 2) + "px"; o.style.top = (e.clientY - r.top - t / 2) + "px";
      bt.appendChild(o); setTimeout(function () { o.remove(); }, 650);
    });
    if (!fin) return;

    /* lueur qui suit la souris */
    d.querySelectorAll(".lueur").forEach(function (c) {
      c.addEventListener("pointermove", function (e) { var r = c.getBoundingClientRect(); c.style.setProperty("--mx", (e.clientX - r.left) + "px"); c.style.setProperty("--my", (e.clientY - r.top) + "px"); });
    });
    /* inclinaison 3D légère */
    d.querySelectorAll(".incline").forEach(function (c) {
      var base = "";
      c.addEventListener("pointerenter", function () { base = getComputedStyle(c).transform; base = base === "none" ? "" : base; c.style.transition = "transform .15s ease-out"; });
      c.addEventListener("pointermove", function (e) {
        var r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        c.style.transform = "perspective(900px) rotateX(" + (-y * 6) + "deg) rotateY(" + (x * 8) + "deg) translateY(-4px)";
      });
      c.addEventListener("pointerleave", function () { c.style.transition = "transform .6s cubic-bezier(.2,.8,.2,1)"; c.style.transform = ""; });
    });
    /* boutons aimantés */
    d.querySelectorAll(".aimant").forEach(function (bt) {
      bt.addEventListener("pointermove", function (e) { var r = bt.getBoundingClientRect(); bt.style.transform = "translate(" + ((e.clientX - r.left - r.width / 2) * .18) + "px," + ((e.clientY - r.top - r.height / 2) * .28) + "px)"; });
      bt.addEventListener("pointerleave", function () { bt.style.transform = ""; });
    });
  });
})();
