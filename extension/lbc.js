// Sur leboncoin.fr : panneau RetroRevente pendant le dépôt d'une annonce.
// Le remplissage ne se fait QUE quand la personne clique « Remplir cette étape » : l'extension tape dans les champs
// visibles de l'étape en cours, comme le ferait la personne. Elle ne clique jamais sur « Continuer » ni « Publier »,
// ne lit pas les annonces des autres et n'envoie rien à Le Bon Coin elle-même.
(function () {
  if (window.top !== window || window.__rrPanneau) return;
  window.__rrPanneau = true;

  var DEPOT = /^\/deposer-une-annonce/;
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

  var hote, ombre, etat = { annonces: null, choisie: null, photo: null, compte: {} };

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
  function choisir(libelles) {
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

  /* ===== Remplissage de l'étape en cours ===== */
  async function remplir() {
    var a = etat.choisie; if (!a) return;
    var fait = [], reste = [];
    var titre = champ("input:not([type]), input[type=text], input[type=search]", /titre|title|subject|objet de l.annonce/, /recherch|search|ville|adresse|code postal|localisation/);
    if (titre) { if (titre.value !== a.titre) ecrire(titre, a.titre); fait.push("titre"); }
    var desc = champ("textarea", /descr|body|texte|annonce/) || [].filter.call(document.querySelectorAll("textarea"), visible)[0];
    if (desc) { if (desc.value !== a.description) ecrire(desc, a.description); fait.push("description"); }
    var prix = champ("input", /prix|price/, /livraison|envoi|poids/);
    if (prix && a.prix != null) { if (prix.value !== String(a.prix)) ecrire(prix, String(a.prix)); fait.push("prix"); }
    if (a.etat && ETATS_LBC[a.etat]) {
      var r = choisir(ETATS_LBC[a.etat]);
      if (r) fait.push("état");
      else if (!titre && !desc && /\betat\b/.test(norm(document.body.innerText).slice(0, 30000))) reste.push("l'état « " + ETAT_TXT[a.etat] + " »");
    }
    if (!titre && !desc && !prix && a.categorie && CATEGORIES_LBC[a.categorie].length) { if (choisir(CATEGORIES_LBC[a.categorie])) fait.push("catégorie"); }
    var fic = photoFichier();
    if (fic && a.photo && !etat.compte["photo:" + a.id]) {
      try {
        var f = await fichierPhoto(a);
        var dt = new DataTransfer(); dt.items.add(f);
        fic.files = dt.files;
        fic.dispatchEvent(new Event("input", { bubbles: true }));
        fic.dispatchEvent(new Event("change", { bubbles: true }));
        etat.compte["photo:" + a.id] = true; fait.push("photo");
      } catch (e) { reste.push("la photo (bouton « Photo » du panneau pour l'enregistrer)"); }
    }
    if (fait.length && !etat.compte["rempli:" + a.id]) { etat.compte["rempli:" + a.id] = true; rrDemander({ type: "rempli" }).catch(function () {}); }
    var msg = fait.length ? "Rempli : " + fait.join(", ") + "." : "Rien à remplir sur cet écran.";
    if (reste.length) msg += " À faire toi-même : " + reste.join(", ") + ".";
    msg += " Vérifie, puis clique « Continuer » sur Le Bon Coin.";
    statut(msg, fait.length ? "ok" : "");
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
    ".opt mark{background:var(--anis);color:var(--nuit);border-radius:3px;padding:0 1px}" +
    ".vide{padding:14px 10px;color:var(--gris);font-size:13px;text-align:center}" +
    ".pub{font-size:11px;color:var(--gris);border:1px solid var(--trait);border-radius:999px;padding:1px 7px;margin-left:6px;vertical-align:1px}" +
    /* détail et actions */
    ".c{display:grid;grid-template-columns:1fr auto;gap:7px 8px;align-items:center;font-size:13px}.c div{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--gris)}.c div b{color:var(--encre);font-weight:600}" +
    ".mini{border:1px solid var(--trait);background:var(--papier);border-radius:999px;padding:4px 11px;font-size:12px;font-weight:600;cursor:pointer}.mini:hover{background:var(--anis-p);border-color:var(--anis)}" +
    ".go{border:0;border-radius:999px;background:var(--anis);color:var(--nuit);font:600 15px/1 var(--texte);padding:14px 18px;cursor:pointer;transition:transform .25s var(--ease),box-shadow .25s var(--ease)}.go:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(191,229,76,.45)}" +
    ".s{font-size:13px;color:var(--gris);background:var(--papier);border-radius:12px;padding:9px 11px}.s.ok{background:var(--anis-p);color:var(--encre)}.s.bad{background:#FDE8E4;color:#8A1F11}" +
    ".n{font-size:11.5px;color:var(--gris-c)}" +
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
      el("div", { class: "n", texte: "L'extension remplit les champs de l'écran affiché quand tu cliques. Tu gardes la main : c'est toi qui continues et publies." }),
    ]));
    charger().then(function () { if (puis) puis(); });
  }
  function statut(t, k) { var s = ombre.querySelector(".s"); if (s) { s.textContent = t; s.className = "s " + (k || ""); } }

  async function charger() {
    try {
      var j = await rrDemander({ type: "annonces" });
      etat.annonces = j.annonces || [];
      dessiner();
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
    function prendre(x) { etat.choisie = x; dessiner(); statut("« " + x.titre + " » choisi. Clique « Remplir cette étape ».", "ok"); ombre.querySelector(".go").focus(); }
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

    var ligne = function (nom, val, copie) { return [el("div", { title: val }, [el("b", { texte: nom + " : " }), val || "—"]), copie ? el("button", { class: "mini", type: "button", texte: "Copier", onclick: function () { copier(copie, nom); } }) : el("span")]; };
    var grille = el("div", { class: "c" }, [].concat(
      ligne("Titre", a.titre, a.titre),
      ligne("Description", a.description.replace(/\n/g, " "), a.description),
      ligne("Prix", prixTxt(a), a.prix != null ? String(a.prix) : ""),
      ligne("État", ETAT_TXT[a.etat] || "", ""),
      [el("div", {}, [el("b", { texte: "Photo : " }), a.photo ? "oui" : "aucune"]), a.photo ? el("button", { class: "mini", type: "button", texte: "Enregistrer", onclick: telecharger }) : el("span")]
    ));
    corps.appendChild(el("div", { style: "display:flex;flex-direction:column;gap:12px" }, [el("div", { class: "sel" }, [choix, liste]), grille, el("button", { class: "go", type: "button", texte: "Remplir cette étape", onclick: function () { remplir().catch(function (e) { statut(e.message, "bad"); }); } })]));
    statut(DEPOT.test(location.pathname) ? "À chaque écran du dépôt, clique « Remplir cette étape »." : "Ouvre « Déposer une annonce » sur Le Bon Coin.", "");
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
    if (estRaccourci(e) && DEPOT.test(location.pathname)) { if (ouvrirRecherche()) { e.preventDefault(); e.stopPropagation(); } return; }
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

  /* ===== Apparition seulement pendant le dépôt (Le Bon Coin change de page sans recharger) ===== */
  var vu = "";
  function suivre() {
    if (location.pathname === vu) return;
    vu = location.pathname;
    var dedans = DEPOT.test(vu);
    if (dedans && !hote) construire();
    if (hote) hote.style.display = dedans ? "" : "none";
  }
  suivre();
  setInterval(suivre, 800);
})();
