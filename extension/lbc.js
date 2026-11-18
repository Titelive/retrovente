// Sur leboncoin.fr : panneau RetroRevente.
// - Dépôt d'annonce : le jeu choisi (par défaut le plus récent pas encore publié) remplit tout seul chaque écran
//   (titre, catégorie, description, état, prix, photo), comme si la personne tapait. L'extension ne clique jamais
//   sur « Continuer » ni « Publier » : relire et publier restent à la personne.
// - Messagerie : réponses types aux acheteurs, complétées avec l'annonce, insérées dans la zone de message
//   d'un clic. L'envoi reste à la personne.
// L'extension ne lit pas les annonces des autres et n'envoie rien à Le Bon Coin elle-même.
(function () {
  if (window.top !== window || window.__rrPanneau) return;
  window.__rrPanneau = true;

  var DEPOT = /^\/deposer-une-annonce/;
  var MESSAGES = /^\/(messages|messagerie)(\/|$)/;
  var mode = function () { return DEPOT.test(location.pathname) ? "depot" : MESSAGES.test(location.pathname) ? "messages" : ""; };
  // Libellés possibles des états sur Le Bon Coin (le plus probable en premier).
  var ETATS_LBC = {
    neuf: ["État neuf", "Neuf", "Neuf avec étiquette", "Neuf sans étiquette"],
    tres_bon: ["Très bon état"],
    bon: ["Bon état"],
    correct: ["État satisfaisant", "Satisfaisant", "État correct"],
    pieces: ["Pour pièces", "Pour pièce", "Hors service"],
  };
  var CATEGORIES_LBC = { jeux: ["Jeux vidéo"], consoles: ["Consoles", "Consoles & Jeux vidéo"], accessoires: ["Consoles", "Accessoires"], autres: [] };
  var ETAT_TXT = { neuf: "Neuf", tres_bon: "Très bon état", bon: "Bon état", correct: "État correct", pieces: "Pour pièces" };

  var hote, ombre, etat = { annonces: null, choisie: null, photo: null, compte: {}, auto: true };
  try { RR.storage.local.get("auto").then(function (r) { if (r && r.auto === false) etat.auto = false; }); } catch (e) {}

  /* ===== Outils DOM ===== */
  var norm = function (s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase(); };
  function visible(el) {
    if (!el || !el.isConnected) return false;
    if (hote && hote.contains(el)) return false;
    var r = el.getBoundingClientRect(), st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  }
  // Tout ce qui décrit un champ : name, id, placeholder, aria-label, libellé associé.
  function description(el) {
    var t = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.getAttribute("data-qa-id"), el.getAttribute("data-test-id")];
    if (el.labels) [].forEach.call(el.labels, function (l) { t.push(l.textContent); });
    var lb = el.getAttribute("aria-labelledby");
    if (lb) lb.split(/\s+/).forEach(function (id) { var x = document.getElementById(id); if (x) t.push(x.textContent); });
    var lab = el.closest("label"); if (lab) t.push(lab.textContent);
    return norm(t.filter(Boolean).join(" | "));
  }
  function champ(selecteur, motif, exclure) {
    var l = [].filter.call(document.querySelectorAll(selecteur), function (el) { return visible(el) && !el.disabled && !el.readOnly; });
    var bons = l.filter(function (el) { var d = description(el); return motif.test(d) && !(exclure && exclure.test(d)); });
    return bons[0] || null;
  }
  // Écrit une valeur comme une frappe (les formulaires React ignorent une simple affectation de .value).
  function ecrire(el, v) {
    var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var set = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  // Clique sur une option (bouton radio, case, élément de liste) dont le texte est exactement l'un des libellés.
  function choisir(libelles, garde) {
    var cibles = libelles.map(norm);
    var cand = document.querySelectorAll("label, button, [role=radio], [role=option], [role=button], [role=menuitemradio], li");
    for (var i = 0; i < cibles.length; i++) {
      for (var j = 0; j < cand.length; j++) {
        var el = cand[j];
        if (!visible(el) || norm(el.textContent) !== cibles[i]) continue;
        if (el.closest("a[href], nav, header, footer")) continue;   // jamais un lien du menu du site
        if (/^(publier|continuer|valider|suivant|deposer)/.test(norm(el.textContent))) continue;
        var radio = el.matches("label") ? (el.control || el.querySelector("input")) : null;
        if (radio && radio.checked) return "deja";
        if (el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true") return "deja";
        if (garde && garde(radio || el)) return "deja";   // la personne a déjà choisi autre chose : on respecte
        el.click();
        return "ok";
      }
    }
    // Liste déroulante classique.
    var sel = [].filter.call(document.querySelectorAll("select"), visible);
    for (var k = 0; k < sel.length; k++) {
      var o = [].find.call(sel[k].options, function (x) { return cibles.indexOf(norm(x.textContent)) >= 0; });
      if (o) { sel[k].value = o.value; sel[k].dispatchEvent(new Event("change", { bubbles: true })); return "ok"; }
    }
    return "";
  }
  function photoFichier() {
    var l = [].filter.call(document.querySelectorAll("input[type=file]"), function (el) { return !el.disabled && (!el.accept || /image|jpe?g|png/i.test(el.accept)); });
    return l.length ? l[0] : null;
  }

  /* ===== Remplissage automatique =====
     Dès qu'un jeu est choisi (par défaut le plus récent pas encore publié), chaque champ reconnu est rempli
     dès qu'il apparaît à l'écran. Un champ n'est rempli qu'une fois par jeu : ce que la personne corrige
     ensuite n'est jamais réécrit, et un choix déjà fait (état…) est respecté. « Continuer » et « Publier »
     restent à la personne. */
  var dejaRempli = new WeakMap();   // champ → id du jeu qui l'a rempli
  function aRemplir(el, a, force) {
    if (force) return true;
    var par = dejaRempli.get(el);
    if (par === a.id) return false;               // déjà fait pour ce jeu : on ne touche plus (corrections respectées)
    return !el.value || par !== undefined;       // vide, ou rempli par nous avec un autre jeu
  }
  function poser(el, v, a, force) { if (!aRemplir(el, a, force)) return false; if (el.value !== v) ecrire(el, v); dejaRempli.set(el, a.id); return true; }
  function groupeDejaChoisi(el) {
    var g = el.closest("fieldset, [role=radiogroup], [role=listbox]") || (el.parentElement && el.parentElement.parentElement);
    return !!(g && g.querySelector("input[type=radio]:checked, [aria-checked=true], [aria-selected=true]"));
  }
  async function remplir(force) {
    var a = etat.choisie; if (!a) return [];
    var fait = [], k = function (x) { return a.id + ":" + x; };
    var titre = champ("input:not([type]), input[type=text], input[type=search]", /titre|title|subject|objet de l.annonce/, /recherch|search|ville|adresse|code postal|localisation/);
    if (titre && poser(titre, a.titre, a, force)) fait.push("titre");
    var desc = champ("textarea", /descr|body|texte|annonce/) || [].filter.call(document.querySelectorAll("textarea"), visible)[0];
    if (desc && poser(desc, a.description, a, force)) fait.push("description");
    var prix = champ("input", /prix|price/, /livraison|envoi|poids/);
    if (prix && a.prix != null && poser(prix, String(a.prix), a, force)) fait.push("prix");
    if (a.etat && ETATS_LBC[a.etat] && choisir(ETATS_LBC[a.etat], force ? null : groupeDejaChoisi) === "ok") fait.push("état");
    if (!titre && !desc && !prix && a.categorie && CATEGORIES_LBC[a.categorie].length && (force || !etat.compte[k("cat")])) {
      if (choisir(CATEGORIES_LBC[a.categorie])) { etat.compte[k("cat")] = true; fait.push("catégorie"); }
    }
    var fic = photoFichier();
    if (fic && a.photo && (force || !etat.compte[k("photo")])) {
      etat.compte[k("photo")] = true;
      try {
        var f = await fichierPhoto(a);
        var dt = new DataTransfer(); dt.items.add(f);
        fic.files = dt.files;
        fic.dispatchEvent(new Event("input", { bubbles: true }));
        fic.dispatchEvent(new Event("change", { bubbles: true }));
        fait.push("photo");
      } catch (e) { etat.compte[k("photo")] = false; statut("Photo non ajoutée : " + e.message, "bad"); }
    }
    if (fait.length && !etat.compte[k("compte")]) { etat.compte[k("compte")] = true; rrDemander({ type: "rempli" }).catch(function () {}); }
    if (fait.length) {
      etat.journal = (etat.journal || []).concat(fait.filter(function (x) { return (etat.journal || []).indexOf(x) < 0; }));
      statut("Rempli automatiquement : " + fait.join(", ") + ". Relis, puis clique « Continuer » sur Le Bon Coin.", "ok");
    }
    return fait;
  }
  // Surveille la page : chaque nouvel écran du dépôt est rempli tout seul.
  var minuterie = null, enCours = false;
  var observateur = new MutationObserver(function (muts) {
    if (!etat.auto || !etat.choisie || !DEPOT.test(location.pathname)) return;
    if (muts.every(function (m) { return hote && (m.target === hote || hote.contains(m.target)); })) return;
    clearTimeout(minuterie);
    minuterie = setTimeout(function () {
      if (enCours) return; enCours = true;
      remplir(false).catch(function () {}).then(function () { enCours = false; });
    }, 350);
  });
  function demarrerAuto() {
    observateur.disconnect();
    if (!etat.auto || !etat.choisie) return;
    observateur.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style"] });
    remplir(false).catch(function () {});
  }

  async function fichierPhoto(a) {
    if (!etat.photo || etat.photo.id !== a.id) {
      var r = await rrDemander({ type: "photo", id: a.id });
      var bin = atob(r.base64), b = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      var nom = (a.nom || "photo").normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 50) || "photo";
      etat.photo = { id: a.id, fichier: new File([b], nom + ".jpg", { type: r.type || "image/jpeg" }) };
    }
    return etat.photo.fichier;
  }

  /* ===== Panneau (charte RetroRevente : vert anis, noir doux, Rubik + Figtree) ===== */
  var MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var RACCOURCI = MAC ? "⌘K" : "Ctrl K";
  var CSS = ":host{all:initial}*{box-sizing:border-box}[hidden]{display:none!important}" +
    ".b{--anis:#D4F57A;--anis-p:#F1FCD0;--nuit:#1A1A1A;--carte:#fff;--papier:#F6F6F1;--encre:#1A1A1A;--gris:#62625C;--gris-c:#A3A39B;--trait:#E6E6DE;--titre:'RR Rubik',ui-rounded,'Arial Rounded MT Bold',system-ui,sans-serif;--texte:'RR Figtree','Avenir Next',ui-sans-serif,system-ui,sans-serif;--ease:cubic-bezier(.2,.8,.2,1);" +
      "position:fixed;right:18px;bottom:18px;z-index:2147483646;font:500 14px/1.45 var(--texte);color:var(--encre);-webkit-font-smoothing:antialiased}" +
    "@media (prefers-color-scheme:dark){.b{--carte:#1E1E1E;--papier:#262626;--encre:#F4F4EE;--gris:#A6A69E;--gris-c:#7A7A72;--trait:#333;--anis-p:#2A3414}}" +
    "button,input{font:inherit;color:inherit}" +
    ".rond{position:relative;width:58px;height:58px;border-radius:50%;border:0;background:var(--nuit);color:var(--anis);font:800 17px/1 var(--titre);letter-spacing:-.5px;cursor:pointer;box-shadow:0 10px 28px rgba(0,0,0,.28);transition:transform .25s var(--ease)}" +
    ".rond:hover{transform:translateY(-2px) rotate(-4deg)}" +
    ".rond kbd{position:absolute;right:50%;bottom:calc(100% + 8px);transform:translateX(50%);white-space:nowrap;font:600 11px/1 var(--texte);color:var(--encre);background:var(--carte);border:1px solid var(--trait);border-radius:7px;padding:5px 7px;opacity:0;pointer-events:none;transition:opacity .2s}" +
    ".rond:hover kbd,.rond:focus-visible kbd{opacity:1}" +
    ".p{position:relative;width:360px;max-width:calc(100vw - 36px);max-height:calc(100vh - 36px);overflow:auto;background:var(--carte);border-radius:26px;box-shadow:0 18px 50px rgba(0,0,0,.3);padding:18px;display:flex;flex-direction:column;gap:12px;animation:monte .3s var(--ease)}" +
    "@keyframes monte{from{opacity:0;transform:translateY(10px) scale(.98)}}" +
    ".t{display:flex;align-items:center;justify-content:space-between;gap:8px}.t b{font:700 17px/1 var(--titre);letter-spacing:-.3px;display:flex;align-items:center;gap:8px}" +
    ".logo{background:var(--anis);color:var(--nuit);border-radius:8px;padding:4px 6px;font:800 13px/1 var(--titre)}" +
    ".x{border:0;background:none;width:32px;height:32px;border-radius:50%;font-size:20px;line-height:1;cursor:pointer;color:var(--gris)}.x:hover{background:var(--papier);color:var(--encre)}" +
    /* sélecteur d'annonce */
    ".sel{position:relative}" +
    ".choix{width:100%;display:flex;align-items:center;gap:10px;text-align:left;border:1.5px solid var(--trait);background:var(--papier);border-radius:16px;padding:10px 12px;cursor:pointer;transition:border-color .2s}" +
    ".choix:hover,.choix[aria-expanded=true]{border-color:var(--nuit)}@media (prefers-color-scheme:dark){.choix:hover,.choix[aria-expanded=true]{border-color:var(--anis)}}" +
    ".choix .q{flex:1;min-width:0}.nom{display:block;font:600 14px/1.3 var(--texte);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta{display:block;font-size:12px;color:var(--gris);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".px{flex:none;background:var(--anis);color:var(--nuit);border-radius:999px;padding:3px 9px;font:700 12.5px/1.2 var(--titre)}" +
    "kbd.k{flex:none;font:600 11px/1 var(--texte);color:var(--gris);border:1px solid var(--trait);background:var(--carte);border-radius:6px;padding:4px 6px}" +
    ".liste{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:2;background:var(--carte);border:1px solid var(--trait);border-radius:18px;box-shadow:0 18px 40px rgba(0,0,0,.22);padding:8px;display:flex;flex-direction:column;gap:6px;animation:monte .2s var(--ease)}" +
    ".cherche{display:flex;align-items:center;gap:8px;border-radius:12px;background:var(--papier);padding:0 10px}" +
    ".cherche svg{flex:none;color:var(--gris)}.cherche input{flex:1;min-width:0;border:0;background:none;outline:none;padding:10px 0;font-size:14px}" +
    ".opts{max-height:260px;overflow:auto;display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}" +
    ".opt{display:flex;align-items:center;gap:10px;border-radius:12px;padding:8px 10px;cursor:pointer}" +
    ".opt .q{flex:1;min-width:0}.opt.actif{background:var(--anis-p)}.opt[aria-selected=true] .nom::after{content:' ✓';color:#5E8A00}" +
    "mark{background:var(--anis);color:var(--nuit);border-radius:3px;padding:0 1px}" +
    ".vide{padding:14px 10px;color:var(--gris);font-size:13px;text-align:center}" +
    ".pub{font-size:11px;color:var(--gris);border:1px solid var(--trait);border-radius:999px;padding:1px 7px;margin-left:6px;vertical-align:1px}" +
    /* détail et actions */
    ".mini{border:1px solid var(--trait);background:var(--papier);border-radius:999px;padding:4px 11px;font-size:12px;font-weight:600;cursor:pointer}.mini:hover{background:var(--anis-p);border-color:var(--anis)}" +
    ".go{border:0;border-radius:999px;background:var(--anis);color:var(--nuit);font:600 15px/1 var(--texte);padding:14px 18px;cursor:pointer;transition:transform .25s var(--ease),box-shadow .25s var(--ease)}.go:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(191,229,76,.45)}" +
    ".s{font-size:13px;color:var(--gris);background:var(--papier);border-radius:12px;padding:9px 11px}.s.ok{background:var(--anis-p);color:var(--encre)}.s.bad{background:#FDE8E4;color:#8A1F11}" +
    ".n{font-size:11.5px;color:var(--gris-c)}" +
    ".pile{display:flex;flex-direction:column;gap:12px}.c{display:flex;flex-direction:column;gap:5px;font-size:13px}.c .l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--gris)}.c .l b{color:var(--encre);font-weight:600}" +
    ".actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}" +
    ".auto{display:flex;align-items:center;gap:10px;font-weight:600;font-size:13.5px;cursor:pointer;position:relative}.auto input{position:absolute;opacity:0;width:1px;height:1px}" +
    ".rail{width:40px;height:24px;border-radius:999px;background:var(--trait);position:relative;transition:background .2s;flex:none}.rail::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .25s var(--ease)}" +
    ".auto input:checked+.rail{background:var(--nuit)}.auto input:checked+.rail::after{transform:translateX(16px);background:var(--anis)}.auto input:focus-visible+.rail{outline:2px solid var(--anis);outline-offset:2px}" +
    ".reps{display:flex;flex-direction:column;gap:6px;max-height:min(46vh,380px);overflow:auto;margin:0 -4px;padding:0 4px}" +
    ".rep{display:flex;flex-direction:column;gap:2px;text-align:left;border:1px solid var(--trait);background:var(--papier);border-radius:14px;padding:9px 12px;cursor:pointer;transition:border-color .2s,background .2s}.rep:hover{border-color:var(--anis);background:var(--anis-p)}" +
    ".ia{display:flex;flex-direction:column;gap:7px;background:var(--nuit);color:#fff;border-radius:18px;padding:12px;--papier:rgba(255,255,255,.06);--trait:rgba(255,255,255,.14);--gris:#B8B8B0;--encre:#fff}" +
    ".ia-t{display:flex;align-items:center;justify-content:space-between;gap:8px}.ia-t b{font:700 14px/1.2 var(--titre);display:flex;gap:6px;align-items:center}.etoile{color:var(--anis)}" +
    ".ia .mini{color:#fff}.ia .mini:hover{color:var(--nuit)}.ia-r{margin:0;font-size:12.5px;color:#B8B8B0}.ia-r.charge{animation:pulse 1.2s ease-in-out infinite}@keyframes pulse{50%{opacity:.45}}" +
    ".rep.fort{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.14)}.rep.fort:hover{background:rgba(212,245,122,.14);border-color:var(--anis)}.rep.fort b{color:var(--anis)}.rep .plein{display:block;-webkit-line-clamp:unset;color:#E8E8E2}" +
    ".grp{margin:6px 2px 0;font:700 11px/1 var(--texte);letter-spacing:.06em;text-transform:uppercase;color:var(--gris)}.grp:first-child{margin-top:0}" +
    ".rep b{font:600 13.5px/1.3 var(--titre)}.rep span{font-size:12.5px;color:var(--gris);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}" +
    "button:focus-visible{outline:2px solid var(--anis);outline-offset:2px}.cherche input:focus{outline:none}.cherche:focus-within{box-shadow:inset 0 0 0 1.5px var(--anis-f,#BFE54C)}";
  function loupe() {
    var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    [["width", "16"], ["height", "16"], ["viewBox", "0 0 24 24"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2.2"], ["stroke-linecap", "round"]].forEach(function (a) { svg.setAttribute(a[0], a[1]); });
    var c = document.createElementNS(ns, "circle"); c.setAttribute("cx", "11"); c.setAttribute("cy", "11"); c.setAttribute("r", "7");
    var p = document.createElementNS(ns, "path"); p.setAttribute("d", "m20 20-3.5-3.5");
    svg.appendChild(c); svg.appendChild(p); return svg;
  }

  // Polices du site, embarquées dans l'extension (chargées en mémoire : pas de requête réseau, pas de souci de CSP).
  var polices = false;
  function chargerPolices() {
    if (polices || !document.fonts || typeof FontFace === "undefined") return; polices = true;
    [["RR Rubik", "polices/rubik-latin.woff2"], ["RR Figtree", "polices/figtree-latin.woff2"]].forEach(function (p) {
      fetch(RR.runtime.getURL(p[1])).then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { var f = new FontFace(p[0], b, { weight: "300 900" }); return f.load(); })
        .then(function (f) { document.fonts.add(f); }).catch(function () {});
    });
  }

  function construire() {
    hote = document.createElement("div");
    hote.id = "retrorevente-extension";
    ombre = hote.attachShadow({ mode: "open" });
    try { var f = new CSSStyleSheet(); f.replaceSync(CSS); ombre.adoptedStyleSheets = [f]; }
    catch (e) { var st = document.createElement("style"); st.textContent = CSS; ombre.appendChild(st); }
    var b = document.createElement("div"); b.className = "b"; ombre.appendChild(b);
    // Les touches tapées dans le panneau ne doivent pas déclencher les raccourcis de la page.
    b.addEventListener("keydown", function (e) {
      if (estRaccourci(e)) return;
      e.stopPropagation();
      if (e.key === "Escape" && !e.defaultPrevented && ouvert) { replie(true); var r = ombre.querySelector(".rond"); if (r) r.focus(); }
    });
    document.documentElement.appendChild(hote);
    chargerPolices();
    replie(true);
  }
  function el(tag, attrs, enfants) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === "texte") e.textContent = attrs[k]; else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
    (enfants || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function boite() { return ombre.querySelector(".b"); }
  var ouvert = false;
  function replie(oui, puis) {
    var b = boite(); b.textContent = ""; ouvert = !oui;
    if (oui) { b.appendChild(el("button", { class: "rond", title: "RetroRevente : remplir l'annonce (" + RACCOURCI + ")", "aria-label": "Ouvrir RetroRevente", "aria-keyshortcuts": MAC ? "Meta+K" : "Control+K", onclick: function () { replie(false); } }, ["RR", el("kbd", { texte: RACCOURCI })])); return; }
    b.appendChild(el("div", { class: "p", role: "dialog", "aria-label": "RetroRevente" }, [
      el("div", { class: "t" }, [el("b", {}, [el("span", { class: "logo", texte: "RR" }), "RetroRevente"]), el("button", { class: "x", "aria-label": "Réduire", title: "Réduire (Échap)", texte: "×", onclick: function () { replie(true); } })]),
      el("div", { class: "corps" }),
      el("div", { class: "s", texte: "Chargement de tes annonces…" }),
      el("div", { class: "n", texte: mode() === "messages" ? "Un clic place la réponse dans la zone de message : relis, puis envoie." : "Chaque écran du dépôt se remplit tout seul. Tu relis, tu cliques « Continuer », puis « Publier »." }),
    ]));
    charger().then(function () { if (puis) puis(); });
  }
  function statut(t, k) { var s = ombre.querySelector(".s"); if (s) { s.textContent = t; s.className = "s " + (k || ""); } }

  async function charger() {
    try {
      var j = await rrDemander({ type: "annonces" });
      etat.annonces = j.annonces || [];
      if (mode() === "messages" && !etat.choisie) etat.choisie = deviner();
      dessiner();
      if (mode() === "depot") demarrerAuto();
    } catch (e) {
      var corps = ombre.querySelector(".corps"); if (!corps) return;
      corps.textContent = "";
      if (e.status === 401 || /connect/i.test(e.message)) {
        statut("Connecte l'extension à ton compte RetroRevente.", "bad");
        corps.appendChild(el("button", { class: "go", texte: "Connecter mon compte", onclick: function () { window.open("https://retrorevente.fr/app/?compte", "_blank", "noopener"); } }));
      } else statut(e.message || "RetroRevente ne répond pas.", "bad");
    }
  }

  var prixTxt = function (a) { return a.prix != null ? a.prix + " €" : ""; };
  var metaTxt = function (a) { return [a.plateforme, ETAT_TXT[a.etat]].filter(Boolean).join(" · "); };
  function surligne(texte, mots) {
    // Met en valeur les mots cherchés (sans tenir compte des accents ni de la casse).
    var f = document.createDocumentFragment(), n = norm(texte), i = 0;
    if (!mots.length || n.length !== texte.length) { f.appendChild(document.createTextNode(texte)); return f; }
    var zones = [];
    mots.forEach(function (m) { var p = n.indexOf(m); if (p >= 0) zones.push([p, p + m.length]); });
    zones.sort(function (x, y) { return x[0] - y[0]; }).forEach(function (z) {
      if (z[0] < i) return;
      f.appendChild(document.createTextNode(texte.slice(i, z[0]))); f.appendChild(el("mark", { texte: texte.slice(z[0], z[1]) })); i = z[1];
    });
    f.appendChild(document.createTextNode(texte.slice(i)));
    return f;
  }
  // Abréviations courantes des consoles, pour chercher « n64 », « ps2 », « gba »…
  var ALIAS = [[/nintendo 64/, "n64"], [/game ?boy advance/, "gba"], [/game ?boy color/, "gbc"], [/game ?boy/, "gb"], [/super nintendo|super nes/, "snes"], [/gamecube/, "gc ngc"], [/nintendo ds/, "nds ds"], [/nintendo 3ds/, "3ds"], [/switch/, "nsw"], [/playstation 2/, "ps2"], [/playstation 3/, "ps3"], [/playstation 4/, "ps4"], [/playstation 5/, "ps5"], [/playstation( 1)?$|playstation one|psone/, "ps1 psx"], [/mega ?drive/, "md"], [/master system/, "sms"], [/dreamcast/, "dc"]];
  function alias(t) { var n = norm(t); return ALIAS.filter(function (x) { return x[0].test(n); }).map(function (x) { return x[1]; }).join(" "); }
  function filtrer(q) {
    var mots = norm(q).split(" ").filter(Boolean);
    return { mots: mots, l: etat.annonces.filter(function (a) { var h = norm([a.titre, a.nom, a.plateforme, alias(a.plateforme || a.titre), ETAT_TXT[a.etat], prixTxt(a)].join(" ")); return mots.every(function (m) { return h.indexOf(m) >= 0; }); }) };
  }

  function dessiner() {
    var corps = ombre.querySelector(".corps"); corps.textContent = "";
    var l = etat.annonces;
    if (!l.length) { statut("Aucun jeu « En vente » dans RetroRevente. Prépare une annonce dans l'appli, puis reviens ici.", ""); corps.appendChild(el("button", { class: "go", texte: "Ouvrir RetroRevente", onclick: function () { window.open("https://retrorevente.fr/app/", "_blank", "noopener"); } })); return; }
    // Par défaut : la plus récente qui n'a pas encore de lien d'annonce.
    if (!etat.choisie || !l.some(function (a) { return a.id === etat.choisie.id; })) etat.choisie = l.find(function (a) { return !a.publiee; }) || l[0];
    var a = etat.choisie;
    var choix = el("button", { class: "choix", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": "Annonce à déposer : " + a.titre + ". Changer (" + RACCOURCI + ")", onclick: function () { liste.hidden ? ouvrirListe() : fermerListe(); } }, [
      el("span", { class: "q" }, [el("span", { class: "nom", texte: a.titre }), el("span", { class: "meta", texte: metaTxt(a) || "Changer de jeu" })]),
      a.prix != null ? el("span", { class: "px", texte: prixTxt(a) }) : null,
      el("kbd", { class: "k", texte: RACCOURCI }),
    ]);
    var champ = el("input", { type: "text", placeholder: "Rechercher un jeu, une console…", "aria-label": "Rechercher une annonce", autocomplete: "off", spellcheck: "false", role: "combobox", "aria-controls": "rr-opts", "aria-expanded": "true" });
    var opts = el("ul", { class: "opts", id: "rr-opts", role: "listbox", "aria-label": "Annonces en vente" });
    var liste = el("div", { class: "liste" }, [el("label", { class: "cherche" }, [loupe(), champ]), opts]);
    liste.hidden = true;
    var actif = 0, vus = [];
    function rendre() {
      var r = filtrer(champ.value); vus = r.l; opts.textContent = "";
      if (actif >= vus.length) actif = Math.max(0, vus.length - 1);
      if (!vus.length) { opts.appendChild(el("li", { class: "vide", texte: "Aucun jeu ne correspond à « " + champ.value.trim() + " »." })); champ.removeAttribute("aria-activedescendant"); return; }
      vus.forEach(function (x, i) {
        var nom = el("span", { class: "nom" }, [surligne(x.titre, r.mots)]);
        if (x.publiee) nom.appendChild(el("span", { class: "pub", texte: "publiée" }));
        opts.appendChild(el("li", { class: "opt" + (i === actif ? " actif" : ""), id: "rr-o" + i, role: "option", "aria-selected": String(x.id === a.id),
          onmousedown: function (e) { e.preventDefault(); }, onmousemove: function () { if (actif !== i) { actif = i; marquer(); } }, onclick: function () { prendre(x); } },
          [el("span", { class: "q" }, [nom, el("span", { class: "meta", texte: metaTxt(x) })]), x.prix != null ? el("span", { class: "px", texte: prixTxt(x) }) : null]));
      });
      marquer();
    }
    function marquer() {
      [].forEach.call(opts.children, function (li, i) { li.classList.toggle("actif", i === actif); });
      var li = opts.children[actif]; if (li && li.id) { champ.setAttribute("aria-activedescendant", li.id); li.scrollIntoView({ block: "nearest" }); }
    }
    function prendre(x) {
      etat.choisie = x; dessiner();
      if (mode() === "depot") { statut("« " + x.titre + " » choisi : les champs se remplissent.", "ok"); demarrerAuto(); }
      else statut("Réponses complétées pour « " + x.titre + " ».", "ok");
      var f = ombre.querySelector(".rep, .go"); if (f) f.focus();
    }
    function ouvrirListe() {
      liste.hidden = false; choix.setAttribute("aria-expanded", "true"); champ.value = "";
      actif = Math.max(0, l.findIndex(function (x) { return x.id === a.id; })); rendre(); champ.focus();
    }
    function fermerListe() { liste.hidden = true; choix.setAttribute("aria-expanded", "false"); }
    champ.addEventListener("input", function () { actif = 0; rendre(); });
    champ.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (vus.length) { actif = (actif + 1) % vus.length; marquer(); } }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (vus.length) { actif = (actif - 1 + vus.length) % vus.length; marquer(); } }
      else if (e.key === "Enter") { e.preventDefault(); if (vus[actif]) prendre(vus[actif]); }
      else if (e.key === "Escape") { e.preventDefault(); fermerListe(); choix.focus(); }
    });
    liste.addEventListener("focusout", function (e) { if (!liste.contains(e.relatedTarget) && e.relatedTarget !== choix) setTimeout(fermerListe, 120); });
    etat.ouvrirRecherche = ouvrirListe;

    var haut = el("div", { class: "sel" }, [choix, liste]);
    if (mode() === "messages") {
      var ia = el("div", { class: "ia" });
      corps.appendChild(el("div", { class: "pile" }, [haut, ia, el("p", { class: "grp", texte: "Réponses types" }), reponsesUI(a)]));
      dessinerIA(ia);
      if (!etat.ia || etat.ia.cle !== cleConversation()) proposerIA(false);
      return;
    }
    var ligne = function (nom, val) { return el("div", { class: "l", title: val }, [el("b", { texte: nom + " : " }), val || "—"]); };
    var grille = el("div", { class: "c" }, [
      ligne("Titre", a.titre), ligne("Description", a.description.replace(/\n/g, " ")), ligne("Prix", prixTxt(a)), ligne("État", ETAT_TXT[a.etat] || ""),
      el("div", { class: "l" }, [el("b", { texte: "Photo : " }), a.photo ? "oui" : "aucune"]),
    ]);
    var bascule = el("label", { class: "auto" }, [
      el("input", { type: "checkbox", role: "switch", onchange: function (e) { etat.auto = e.target.checked; try { RR.storage.local.set({ auto: etat.auto }); } catch (x) {} if (etat.auto) demarrerAuto(); else { observateur.disconnect(); statut("Remplissage automatique en pause.", ""); } } }),
      el("span", { class: "rail" }), "Remplissage automatique",
    ]);
    bascule.querySelector("input").checked = etat.auto;
    var actions = el("div", { class: "actions" }, [bascule, el("button", { class: "mini", type: "button", title: "Réécrire tous les champs de l'écran avec ce jeu", texte: "Remplir à nouveau", onclick: function () { remplir(true).then(function (f) { if (!f.length) statut("Rien à remplir sur cet écran.", ""); }).catch(function (e) { statut(e.message, "bad"); }); } })]);
    corps.appendChild(el("div", { class: "pile" }, [haut, grille, actions]));
    if (!etat.journal || !etat.journal.length) statut(etat.auto ? "Remplissage automatique activé : chaque écran du dépôt se remplit tout seul." : "Remplissage automatique en pause.", "");
  }

  /* ===== Réponses types aux acheteurs (messagerie) ===== */
  function deviner() {
    // Le jeu dont le titre apparaît dans la conversation ouverte, sinon le plus récent.
    var t = norm((document.querySelector("main") || document.body).innerText).slice(0, 40000);
    var l = etat.annonces.slice().sort(function (x, y) { return (y.titre || "").length - (x.titre || "").length; });
    return l.find(function (a) { return a.titre && t.indexOf(norm(a.titre)) >= 0; }) || l.find(function (a) { return a.nom && t.indexOf(norm(a.nom)) >= 0; }) || etat.annonces[0];
  }
  var CONTENU_TXT = { seul: "la cartouche (ou le disque) seule", boite: "en boîte, sans notice", complet: "complet, avec la boîte et la notice" };
  // Dernière offre en euros lue dans la conversation ouverte (autre que notre prix), pour chiffrer les réponses.
  function offreLue(px) {
    var t = (document.querySelector("main") || document.body).innerText.slice(-6000), m, r = null, re = /(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:€|euros?\b)/gi;
    while ((m = re.exec(t))) { var v = Math.round(parseFloat(m[1].replace(",", "."))); if (v > 0 && v !== px) r = v; }
    return px && r && r < px ? r : null;
  }
  // Réponses types : ton sympa et diplomate, vouvoiement, complétées avec le jeu choisi. {offre} et {milieu} viennent
  // de la dernière offre lue dans la conversation quand il y en a une.
  function reponses(a) {
    var nom = a.nom || a.titre, px = a.prix, offre = offreLue(px);
    var milieu = px ? (offre ? Math.round((offre + px) / 2) : Math.round(px * 0.9)) : null;
    var plancher = px ? Math.round(px * 0.85) : null;
    var lePrix = px ? px + " €" : "le prix affiché";
    var detail = [a.contenu && CONTENU_TXT[a.contenu] ? "C'est " + CONTENU_TXT[a.contenu] : "", a.etat && ETAT_TXT[a.etat] ? (a.contenu ? ", " : "Il est en ") + ETAT_TXT[a.etat].toLowerCase() : ""].join("");
    var det = detail ? detail + ". " : "";
    var votre = offre ? "vos " + offre + " €" : "votre proposition";
    return [
      // Disponibilité
      { g: "Disponibilité", t: "Toujours disponible", m: "Bonjour, oui, " + nom + " est toujours disponible ! " + det + "Je peux l'envoyer ou le remettre en main propre, comme vous préférez." },
      { g: "Disponibilité", t: "Réservé pour quelqu'un", m: "Bonjour, merci pour votre message ! " + nom + " est réservé pour le moment. Si la vente ne se fait pas, je reviens vers vous en priorité, promis." },
      { g: "Disponibilité", t: "Déjà vendu", m: "Bonjour, désolé, " + nom + " vient de partir. Merci beaucoup pour votre intérêt, et bonne chasse pour la suite !" },
      // Négociation
      { g: "Négociation", t: "Offre vraiment trop basse", m: "Bonjour, merci pour votre proposition ! Je comprends l'envie de faire une bonne affaire, mais " + votre + ", c'est vraiment trop loin de la valeur du jeu : il se vend autour de " + lePrix + " en ce moment. " + (milieu ? "Je peux faire un geste à " + milieu + " € si ça vous tente." : "Je peux faire un petit geste si vous me faites une autre proposition.") },
      { g: "Négociation", t: "Offre un peu basse : on coupe la poire en deux", m: "Bonjour, merci pour l'offre ! On n'est pas si loin." + (milieu ? " Je vous propose de couper la poire en deux : " + milieu + " € et il est à vous." : " Faites-moi une proposition un peu plus haute et on devrait s'entendre.") },
      { g: "Négociation", t: "Prix ferme, poliment", m: "Bonjour, merci pour votre message ! Le prix de " + lePrix + " est déjà calé sur la cote actuelle (ventes réelles constatées), je préfère le garder tel quel. Il est en très bonne place, je ne suis pas pressé." },
      { g: "Négociation", t: "« C'est quoi votre dernier prix ? »", m: "Bonjour ! " + (plancher ? "Mon dernier prix serait " + plancher + " €, " : "Je peux faire un petit geste, ") + "envoi ou remise en main propre au choix. Ça vous irait ?" },
      { g: "Négociation", t: "Accepter l'offre", m: "Bonjour, c'est d'accord pour " + (offre ? offre + " €" : "votre offre") + " ! Envoyez-moi la demande d'achat sur Le Bon Coin et je m'en occupe rapidement." },
      { g: "Négociation", t: "Offre sans même un bonjour", m: "Bonjour 🙂 Merci pour l'intérêt ! Le jeu est à " + lePrix + ". Si vous avez une proposition raisonnable, je l'étudie volontiers." },
      { g: "Négociation", t: "Offre groupée bien trop basse", m: "Bonjour, merci pour votre intérêt pour plusieurs de mes jeux, ça me fait plaisir ! Par contre, votre proposition est vraiment loin de leur valeur : chacun est déjà au prix du marché. Pour un lot, je peux faire un vrai geste sur le total, dites-moi lesquels vous intéressent et je vous fais une proposition honnête." },
      { g: "Négociation", t: "Lot de plusieurs jeux", m: "Bonjour, avec plaisir pour un lot ! Dites-moi quels jeux vous intéressent et je vous fais un prix d'ensemble, avec un seul envoi pour réduire les frais." },
      { g: "Négociation", t: "Proposition d'échange", m: "Bonjour, merci pour la proposition d'échange ! Pour l'instant je préfère vendre plutôt qu'échanger, mais si vous êtes intéressé à " + lePrix + ", je vous le réserve avec plaisir." },
      // Le jeu
      { g: "Le jeu", t: "État et fonctionnement", m: "Bonjour ! " + nom + " est d'origine, testé et fonctionnel. " + det + "Je peux vous envoyer d'autres photos si vous voulez." },
      { g: "Le jeu", t: "Plus de photos", m: "Bien sûr ! Je vous envoie d'autres photos tout de suite : étiquette, dos de la boîte et cartouche (ou disque)." },
      { g: "Le jeu", t: "Version et région", m: "Bonjour ! C'est la version " + (/ntsc|jap|usa/i.test(a.titre) ? "indiquée dans le titre" : "PAL européenne (française)") + ", elle fonctionne sur les consoles françaises sans adaptateur." },
      { g: "Le jeu", t: "Demande de test en vidéo", m: "Bonjour, pas de souci ! Je vous fais une petite vidéo du jeu qui se lance et je vous l'envoie dans la journée." },
      { g: "Le jeu", t: "Pourquoi ce prix ?", m: "Bonjour, bonne question ! Je me base sur les ventes réellement conclues ces dernières semaines (eBay, Le Bon Coin, sites de cote). " + det + "C'est ce qui fait la différence avec les exemplaires moins complets ou abîmés." },
      // Envoi et remise
      { g: "Envoi et remise", t: "Envoi sécurisé", m: "Je peux l'envoyer avec la livraison Le Bon Coin : paiement sécurisé, colis bien protégé (papier bulle et carton), expédié sous 48 h après la commande." },
      { g: "Envoi et remise", t: "Remise en main propre", m: "La remise en main propre est possible ! Dites-moi quel jour et quel secteur vous arrangent, et on se retrouve dans un lieu public." },
      { g: "Envoi et remise", t: "Frais de port", m: "Les frais de port sont calculés automatiquement par Le Bon Coin selon le mode choisi (point relais, domicile). Je m'occupe d'un emballage soigné." },
      { g: "Envoi et remise", t: "Colis envoyé", m: "C'est parti ! Le colis est déposé, vous recevrez le suivi par Le Bon Coin. Merci pour votre achat et bon jeu !" },
      // Sécurité et suivi
      { g: "Sécurité et suivi", t: "Paiement hors Le Bon Coin : refus poli", m: "Merci pour votre message ! Pour votre sécurité comme pour la mienne, je passe uniquement par le paiement sécurisé Le Bon Coin : pas de virement, de lien externe, de mandat ni de numéro de téléphone. Ça protège nos deux côtés 🙂" },
      { g: "Sécurité et suivi", t: "Lien ou site suspect", m: "Merci, mais je ne clique pas sur les liens externes et ne partage pas mes coordonnées. Si vous êtes intéressé, la demande d'achat directement sur Le Bon Coin est parfaite." },
      { g: "Sécurité et suivi", t: "Acheteur qui ne répond plus", m: "Bonjour, je reviens vers vous pour " + nom + " : êtes-vous toujours intéressé ? Sans nouvelles d'ici demain soir, je le remettrai en vente. Belle journée !" },
      { g: "Sécurité et suivi", t: "Rendez-vous manqué", m: "Bonjour, je ne vous ai pas vu au rendez-vous, j'espère que tout va bien ! On peut en refixer un si vous êtes toujours intéressé, sinon pas de souci." },
      { g: "Sécurité et suivi", t: "Merci après la vente", m: "Merci beaucoup pour votre achat ! Bon jeu avec " + nom + ", et n'hésitez pas à laisser un avis, ça m'aide beaucoup." },
    ];
  }
  /* ===== Réponse proposée par l'IA (lit la conversation ouverte) ===== */
  function texteConversation() {
    var racine = document.querySelector("main") || document.body, t = racine.innerText || "";
    var z = zoneMessage(); if (z && !(z instanceof HTMLTextAreaElement) && z.innerText) t = t.split(z.innerText).join(" ");
    return t.replace(/\n{3,}/g, "\n\n").trim().slice(-4000);
  }
  function cleConversation() { var t = texteConversation(); return location.pathname + "|" + t.length + "|" + t.slice(-300); }
  async function proposerIA(force) {
    var cle = cleConversation();
    if (!force && etat.ia && etat.ia.cle === cle) return;
    etat.ia = { cle: cle, charge: true }; rafraichirIA();
    try {
      var r = await rrDemander({ type: "reponse", annonce: etat.choisie ? etat.choisie.id : "", conversation: texteConversation() });
      if (etat.ia.cle !== cle) return;
      etat.ia = { cle: cle, resume: r.resume, reponses: r.reponses || [] };
    } catch (e) { if (etat.ia.cle === cle) etat.ia = { cle: cle, erreur: e.message }; }
    rafraichirIA();
  }
  function rafraichirIA() { var z = ombre && ombre.querySelector(".ia"); if (z) dessinerIA(z); }
  function dessinerIA(z) {
    z.textContent = "";
    var tete = el("div", { class: "ia-t" }, [el("b", {}, [el("span", { class: "etoile", texte: "✦" }), "Réponse proposée par l'IA"]),
      el("button", { class: "mini", type: "button", texte: "Autres idées", title: "Relire la conversation et proposer d'autres réponses", onclick: function () { proposerIA(true); } })]);
    z.appendChild(tete);
    var i = etat.ia || {};
    if (i.charge) { z.appendChild(el("p", { class: "ia-r charge", texte: "Je lis le dernier message de l'acheteur…" })); return; }
    if (i.erreur) { z.appendChild(el("p", { class: "ia-r", texte: i.erreur })); return; }
    if (i.resume) z.appendChild(el("p", { class: "ia-r", texte: i.resume }));
    (i.reponses || []).forEach(function (r) {
      z.appendChild(el("button", { class: "rep fort", type: "button", title: "Placer dans la zone de message", onclick: function () { inserer(r.texte); } }, [el("b", { texte: r.titre || "Réponse" }), el("span", { class: "plein", texte: r.texte })]));
    });
  }
  // Nouveau message reçu ou autre conversation : nouvelles propositions (une seule demande à la fois, espacées).
  var veilleMsg = null, minuterieMsg = null;
  function veillerMessages() {
    if (veilleMsg) return;
    veilleMsg = new MutationObserver(function (muts) {
      if (mode() !== "messages" || !ouvert || !etat.annonces) return;
      if (muts.every(function (m) { return hote && (m.target === hote || hote.contains(m.target)); })) return;
      clearTimeout(minuterieMsg);
      minuterieMsg = setTimeout(function () { if (etat.ia && !etat.ia.charge && etat.ia.cle !== cleConversation()) proposerIA(false); }, 1500);
    });
    veilleMsg.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function zoneMessage() {
    var l = [].filter.call(document.querySelectorAll("textarea, [contenteditable=''], [contenteditable=true], [role=textbox]"), function (x) { return visible(x) && !x.disabled; });
    var bons = l.filter(function (x) { return /message|repon|ecri|reply|write/.test(description(x) + " " + norm(x.getAttribute("placeholder") || x.getAttribute("data-placeholder") || "")); });
    return bons[bons.length - 1] || l[l.length - 1] || null;
  }
  function inserer(texte) {
    var z = zoneMessage();
    if (!z) return copier(texte, "Réponse") ;
    if (z instanceof HTMLTextAreaElement) {
      ecrire(z, z.value.trim() ? z.value.replace(/\s+$/, "") + "\n" + texte : texte);
    } else {
      z.focus();
      var sel = window.getSelection(); sel.selectAllChildren(z); sel.collapseToEnd();
      if (!document.execCommand("insertText", false, (z.textContent.trim() ? "\n" : "") + texte)) z.textContent += texte;
      z.dispatchEvent(new Event("input", { bubbles: true }));
    }
    z.focus();
    statut("Réponse placée dans la zone de message : relis, puis envoie.", "ok");
  }
  function reponsesUI(a) {
    var tout = reponses(a);
    var champ = el("input", { type: "text", placeholder: "Chercher une réponse (offre, envoi, photos…)", "aria-label": "Chercher une réponse", autocomplete: "off", spellcheck: "false" });
    var zone = el("div", { class: "reps" });
    function rendre() {
      var mots = norm(champ.value).split(" ").filter(Boolean), g = "";
      zone.textContent = "";
      tout.filter(function (r) { var h = norm(r.g + " " + r.t + " " + r.m); return mots.every(function (m) { return h.indexOf(m) >= 0; }); }).forEach(function (r) {
        if (r.g !== g) { g = r.g; zone.appendChild(el("p", { class: "grp", texte: g })); }
        zone.appendChild(el("button", { class: "rep", type: "button", title: r.m, onclick: function () { inserer(r.m); } }, [el("b", {}, [surligne(r.t, mots)]), el("span", { texte: r.m })]));
      });
      if (!zone.children.length) zone.appendChild(el("p", { class: "vide", texte: "Aucune réponse ne correspond." }));
    }
    champ.addEventListener("input", rendre);
    champ.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); var b = zone.querySelector(".rep"); if (b) b.click(); } });
    rendre();
    return el("div", { class: "pile" }, [el("label", { class: "cherche" }, [loupe(), champ]), zone]);
  }

  /* ===== Raccourcis : ⌘K (Ctrl K) ouvre la recherche, Échap replie le panneau ===== */
  function estRaccourci(e) { return (MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key || "").toLowerCase() === "k"; }
  function ouvrirRecherche() {
    if (!hote || hote.style.display === "none") return false;
    if (!ouvert) { replie(false, function () { if (etat.ouvrirRecherche && ombre.querySelector(".choix")) etat.ouvrirRecherche(); }); return true; }
    if (etat.ouvrirRecherche && ombre.querySelector(".choix")) etat.ouvrirRecherche();
    return true;
  }
  window.addEventListener("keydown", function (e) {
    if (estRaccourci(e) && mode()) { if (ouvrirRecherche()) { e.preventDefault(); e.stopPropagation(); } return; }
  }, true);
  // Raccourci global de l'extension (⌥⇧R par défaut, réglable dans le navigateur) : relayé par l'arrière-plan.
  RR.runtime.onMessage.addListener(function (m) { if (m && m.type === "ouvrir-recherche") ouvrirRecherche(); });

  function copier(t, nom) {
    navigator.clipboard.writeText(t).then(function () { statut(nom + " copié.", "ok"); }, function () { statut("Copie impossible ici.", "bad"); });
  }
  async function telecharger() {
    try {
      var f = await fichierPhoto(etat.choisie), u = URL.createObjectURL(f);
      var a = el("a", { href: u, download: f.name }); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 10000);
      statut("Photo enregistrée dans tes téléchargements.", "ok");
    } catch (e) { statut(e.message, "bad"); }
  }

  /* ===== Apparition pendant le dépôt et dans la messagerie (Le Bon Coin change de page sans recharger) ===== */
  var vu = "", vuMode = "";
  function suivre() {
    if (location.pathname === vu) return;
    vu = location.pathname;
    var m = mode();
    if (m && !hote) construire();
    if (hote) hote.style.display = m ? "" : "none";
    if (!m) { observateur.disconnect(); vuMode = ""; return; }
    if (m !== vuMode) {
      vuMode = m;
      if (m === "messages") { etat.choisie = null; veillerMessages(); replie(false); }   // messagerie : panneau ouvert, réponse IA proposée
      else if (!ouvert) replie(false);   // dépôt : le panneau s'ouvre et le remplissage démarre tout seul
      else { dessiner(); demarrerAuto(); }
    } else if (m === "messages" && ouvert && etat.annonces) { etat.choisie = deviner(); dessiner(); }   // autre conversation
  }
  suivre();
  setInterval(suivre, 800);
})();
