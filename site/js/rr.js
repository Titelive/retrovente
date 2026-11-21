/* RetroRevente : thème clair/sombre, barre de lecture, retour en haut, apparitions et micro-interactions. */
(function () {
  var d = document, html = d.documentElement, calme = matchMedia("(prefers-reduced-motion: reduce)").matches || html.classList.contains("sans-anim");
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

    /* menu : burger, fond au défilement, page courante */
    var nav = d.getElementById("nav");
    if (nav) {
      var bg = nav.querySelector(".burger");
      function ferme() { nav.classList.remove("ouvert"); html.classList.remove("menu-ouvert"); bg && bg.setAttribute("aria-expanded", "false"); bg && bg.setAttribute("aria-label", "Ouvrir le menu"); }
      bg && bg.addEventListener("click", function () { var o = !nav.classList.contains("ouvert"); nav.classList.toggle("ouvert", o); html.classList.toggle("menu-ouvert", o); bg.setAttribute("aria-expanded", String(o)); bg.setAttribute("aria-label", o ? "Fermer le menu" : "Ouvrir le menu"); });
      nav.querySelectorAll(".nav-liens a").forEach(function (a) { a.addEventListener("click", ferme); var h = a.getAttribute("href"); if (h && h.charAt(0) === "/" && h.indexOf("#") < 0 && h.length > 1 && location.pathname.indexOf(h) === 0) a.setAttribute("aria-current", "page"); });
      d.addEventListener("keydown", function (e) { if (e.key === "Escape") ferme(); });
      addEventListener("resize", function () { if (innerWidth > 1020) ferme(); });
      if (nav.classList.contains("flottant")) { var colle = function () { nav.classList.toggle("colle", scrollY > 20); }; colle(); addEventListener("scroll", colle, { passive: true }); }
    }

    /* connecté : le lien « Connexion » devient le pseudo (et l'avatar) */
    var lienCx = d.querySelector('.nav-liens a[href="/app/"]:not(.nav-co)');
    if (lienCx) lienCx.classList.add("nav-compte");
    window.rrMoi = function (m) {
      if (!m) return;
      // la formule change l'habillage (badge, touches dorées ou holographiques) : voir « Habillage selon la formule » dans rr.css
      var fid = (m.formule && m.formule.id) || "gratuit"; d.documentElement.setAttribute("data-formule", fid); try { localStorage.setItem("rr-formule", fid); } catch (e) {}
      if (!lienCx) return;
      var nom = m.nom || "Mon compte", av = d.createElement("span");
      av.className = "av-mini"; av.setAttribute("aria-hidden", "true");
      if (m.avatar) av.style.backgroundImage = "url(" + m.avatar + ")"; else av.textContent = nom.charAt(0).toUpperCase();
      lienCx.innerHTML = ""; lienCx.appendChild(av); var t = d.createElement("span"); t.textContent = nom; lienCx.appendChild(t);
      if (fid !== "gratuit") { var bd = d.createElement("span"); bd.className = "badge-formule"; bd.textContent = { vendeur: "Vendeur", collectionneur: "Collectionneur", pass: "Pass" }[fid] || ""; lienCx.appendChild(bd); }
      lienCx.classList.add("nav-moi"); lienCx.href = "/app/?compte"; lienCx.title = "Mon compte";
      var cta = d.querySelectorAll(".nav-cta, .nav-cta-court");
      cta.forEach(function (c) { c.href = "/app/"; var s = c.querySelector("span"); if (s) s.textContent = "Mes articles"; else c.lastChild.textContent = "Mes articles"; });
    };
    if (/(?:^|;\s*)rr_co=1/.test(d.cookie) && !d.getElementById("app-rr")) {
      fetch("/api/moi", { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(window.rrMoi).catch(function () {});
    }

    /* listes déroulantes au design du site (la liste native reste en dessous pour la valeur et les événements) */
    var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    var VAL = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value"), IDX = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex");
    function habille(sel) {
      if (sel.dataset.habille || sel.multiple) return; sel.dataset.habille = "1";
      var w = d.createElement("div"); w.className = "choix"; sel.parentNode.insertBefore(w, sel); w.appendChild(sel); sel.classList.add("choix-natif"); sel.tabIndex = -1;
      var lab = sel.closest("label"), nom = lab ? lab.firstChild.textContent.trim() : (sel.getAttribute("aria-label") || "Choisir");
      var b = d.createElement("button"); b.type = "button"; b.className = "choix-bt"; b.setAttribute("aria-haspopup", "listbox"); b.setAttribute("aria-expanded", "false");
      var ul = d.createElement("ul"); ul.className = "choix-liste"; ul.setAttribute("role", "listbox"); ul.setAttribute("aria-label", nom); ul.tabIndex = -1;
      w.appendChild(b); w.appendChild(ul);
      function lib() { var o = sel.options[IDX.get.call(sel)]; b.innerHTML = '<span>' + esc(o ? o.text : "") + '</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'; b.setAttribute("aria-label", nom + " : " + (o ? o.text : "")); }
      function items() { return [].slice.call(ul.children); }
      function ouvre() {
        var cur = IDX.get.call(sel);
        ul.innerHTML = [].map.call(sel.options, function (o, i) { return '<li role="option" tabindex="-1" data-i="' + i + '" aria-selected="' + (i === cur) + '">' + esc(o.text) + '</li>'; }).join("");
        var r = b.getBoundingClientRect(); w.classList.toggle("haut", innerHeight - r.bottom < 280 && r.top > innerHeight - r.bottom);
        w.classList.add("ouvert"); b.setAttribute("aria-expanded", "true");
        var li = ul.children[Math.max(0, cur)]; li && li.focus({ preventScroll: true }); li && li.scrollIntoView({ block: "nearest" });
      }
      function ferme(f) { w.classList.remove("ouvert"); b.setAttribute("aria-expanded", "false"); if (f) b.focus(); }
      function choisit(i) { if (IDX.get.call(sel) !== i) { IDX.set.call(sel, i); sel.dispatchEvent(new Event("input", { bubbles: true })); sel.dispatchEvent(new Event("change", { bubbles: true })); } lib(); ferme(true); }
      b.addEventListener("click", function () { w.classList.contains("ouvert") ? ferme(false) : ouvre(); });
      b.addEventListener("keydown", function (e) { if (["ArrowDown", "ArrowUp", "Enter", " "].indexOf(e.key) >= 0) { e.preventDefault(); ouvre(); } });
      ul.addEventListener("click", function (e) { var li = e.target.closest("li"); if (li) choisit(+li.dataset.i); });
      ul.addEventListener("keydown", function (e) {
        var l = items(), i = l.indexOf(d.activeElement);
        if (e.key === "ArrowDown") { e.preventDefault(); (l[i + 1] || l[i]).focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); (l[i - 1] || l[i]).focus(); }
        else if (e.key === "Home") { e.preventDefault(); l[0].focus(); } else if (e.key === "End") { e.preventDefault(); l[l.length - 1].focus(); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (i >= 0) choisit(i); }
        else if (e.key === "Escape") { e.preventDefault(); ferme(true); } else if (e.key === "Tab") ferme(false);
        else if (e.key.length === 1) { var k = e.key.toLowerCase(), t = l.filter(function (x) { return x.textContent.trim().toLowerCase().indexOf(k) === 0; })[0]; t && t.focus(); }
      });
      d.addEventListener("pointerdown", function (e) { if (!w.contains(e.target)) ferme(false); });
      Object.defineProperty(sel, "value", { configurable: true, get: function () { return VAL.get.call(sel); }, set: function (v) { VAL.set.call(sel, v); lib(); } });
      Object.defineProperty(sel, "selectedIndex", { configurable: true, get: function () { return IDX.get.call(sel); }, set: function (v) { IDX.set.call(sel, v); lib(); } });
      lib();
    }
    d.querySelectorAll("select").forEach(habille);

    /* barre de lecture + retour en haut */
    var barre = d.createElement("div"); barre.className = "lecture"; barre.setAttribute("aria-hidden", "true"); b.appendChild(barre);
    var haut = d.createElement("button"); haut.type = "button"; haut.className = "vers-haut"; haut.setAttribute("aria-label", "Revenir en haut de la page");
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
      // le cadre est mesuré une seule fois à l'entrée : la carte inclinée ne doit pas « fuir » sous la souris (sinon le survol clignote)
      var r = null, raf = 0, px = 0, py = 0;
      c.addEventListener("pointerenter", function () { c.style.transform = ""; r = c.getBoundingClientRect(); c.style.transition = "transform .25s ease-out"; });
      c.addEventListener("pointermove", function (e) {
        if (!r) r = c.getBoundingClientRect(); px = (e.clientX - r.left) / r.width - .5; py = (e.clientY - r.top) / r.height - .5;
        if (!raf) raf = requestAnimationFrame(function () { raf = 0; c.style.transform = "perspective(1200px) rotateX(" + (-py * 3) + "deg) rotateY(" + (px * 4) + "deg)"; });
      });
      c.addEventListener("pointerleave", function () { r = null; if (raf) { cancelAnimationFrame(raf); raf = 0; } c.style.transition = "transform .6s cubic-bezier(.2,.8,.2,1)"; c.style.transform = ""; });
    });
    /* boutons aimantés */
    d.querySelectorAll(".aimant").forEach(function (bt) {
      bt.addEventListener("pointermove", function (e) { var r = bt.getBoundingClientRect(); bt.style.transform = "translate(" + ((e.clientX - r.left - r.width / 2) * .18) + "px," + ((e.clientY - r.top - r.height / 2) * .28) + "px)"; });
      bt.addEventListener("pointerleave", function () { bt.style.transform = ""; });
    });
  });

  // lueurs vertes en fond : ajoutées aux grandes sections et au pied de page
  (function(){// accueil : une couche par grande section (toute la largeur) ; autres pages et appli : une seule couche fixe derrière la page, sans bord visible
    if(!document.querySelector(".heros")){if(document.querySelector("body > .lueurs"))return;var f=document.createElement("div");f.className="lueurs fixe";f.setAttribute("aria-hidden","true");f.innerHTML="<i></i><i></i><i></i>";
      if(document.documentElement.getAttribute("data-theme")!=="dark")f.classList.add("clair-f");document.body.insertBefore(f,document.body.firstChild);return}
    var hotes=document.querySelectorAll("main > section, main > .s, .pied-site");
    hotes.forEach(function(h){if(h.querySelector(":scope > .lueurs"))return;var cs=getComputedStyle(h);if(cs.position==="static")h.style.position="relative";h.classList.add("a-lueurs");
      var m=(cs.backgroundColor||"").match(/[\d.]+/g),opaque=m&&(m[3]===undefined||+m[3]>.5);if(opaque?(+m[0]+ +m[1]+ +m[2])>480:document.documentElement.getAttribute("data-theme")!=="dark")h.classList.add("clair-l");
      var l=document.createElement("div");l.className="lueurs";l.setAttribute("aria-hidden","true");l.innerHTML="<i></i><i></i><i></i>";h.insertBefore(l,h.firstChild)})})();

  // Mise en gras automatique des mots importants d'un texte (prix, états, contenu, méthode…) : le texte est échappé d'abord.
  window.rrGras = function (t) {
    var e = String(t || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
    var mots = "jeu en loose|en loose|loose|complet en boîte|complet|CIB|en boîte|sans notice|avec notice|boîte et notice|PAL(?: EUR| FRA| française)?|NTSC(?:-[JU])?|médiane|moyenne|ventes? conclues?|dernières ventes|testée?s?|fonctionne(?: parfaitement)?|sauvegarde OK|très bon état|bon état|état neuf|comme neuf|étiquette (?:propre|nette|lisible)|rayures?|défauts?|remise en main propre|envoi soigné|négociation";
    e = e.replace(/(\d[\d\s\u202f.,]*\s?(?:€|\$|%))/g, "<strong>$1</strong>");
    e = e.replace(new RegExp("(^|[^\\wÀ-ÿ>])(" + mots + ")(?![\\wÀ-ÿ])", "gi"), "$1<strong>$2</strong>");
    return e;
  };
})();
