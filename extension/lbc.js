// Sur leboncoin.fr : panneau RetroRevente.
// - Dépôt d'annonce : le jeu choisi (par défaut le plus récent pas encore publié) remplit tout seul chaque écran
//   (titre, catégorie, description, état, prix, photo), comme si la personne tapait, puis clique « Continuer » (option
//   « Continuer tout seul »). Elle ne clique jamais sur « Publier » : la publication reste à la personne.
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
  var CATEGORIES_LBC = { cartes: ["Collection", "Cartes à collectionner", "Jeux & Jouets"], jeux: ["Jeux vidéo"], consoles: ["Consoles", "Consoles & Jeux vidéo"], accessoires: ["Consoles", "Accessoires"], autres: [] };
  var ETAT_TXT = { neuf: "Neuf", tres_bon: "Très bon état", bon: "Bon état", correct: "État correct", pieces: "Pour pièces" };

  var hote, ombre, etat = { annonces: null, choisie: null, photo: null, compte: {}, auto: true };
  etat.continuer = true;
  try { RR.storage.local.get(["auto", "continuer"]).then(function (r) { if (r && r.auto === false) etat.auto = false; if (r && r.continuer === false) etat.continuer = false; }); } catch (e) {}

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
  // Un texte déjà présent qui ne vient ni de nous ni de la personne (Le Bon Coin pré-remplit la description avec son
  // IA, souvent fausse) est remplacé par celui de RetroRevente. Ce que la personne tape est toujours gardé, même
  // quand Le Bon Coin réaffiche le champ sur l'écran suivant (aperçu avant publication).
  var dejaRempli = new WeakMap();   // champ → { id du jeu, nature du champ }
  var tapeParLaPersonne = new WeakSet(), corrige = {};
  document.addEventListener("input", function (e) {
    if (!e.target || (hote && hote.contains(e.target))) return;
    if (!e.isTrusted) {   // Le Bon Coin réécrit un champ que nous avions rempli : on repasse dessus
      var x = dejaRempli.get(e.target);
      if (x && e.target.value !== x.v && etat.auto) setTimeout(function () { if (!enCours) { enCours = true; remplir(false).catch(function () {}).then(function () { enCours = false; }); } }, 300);
      return;
    }
    tapeParLaPersonne.add(e.target);
    var d = dejaRempli.get(e.target); if (d) corrige[d.id + ":" + d.nature] = true;
  }, true);
  function aRemplir(el, a, force, nature) {
    if (force) return true;
    var par = dejaRempli.get(el);
    if (corrige[a.id + ":" + nature]) return false;        // corrigé par la personne : on ne touche plus
    if (par && par.id === a.id) return el.value !== par.v && (par.n || 0) < 3; // sauf si Le Bon Coin a réécrit par-dessus (3 fois au plus)
    if (tapeParLaPersonne.has(el) && !par) return false;   // la personne y a écrit elle-même
    return true;                                           // vide, pré-rempli par Le Bon Coin, ou rempli avec un autre jeu
  }
  function poser(el, v, a, force, nature) { if (!aRemplir(el, a, force, nature)) return false; var avant = dejaRempli.get(el); dejaRempli.set(el, { id: a.id, nature: nature, v: v, n: avant && avant.id === a.id ? (avant.n || 0) + 1 : 0 }); if (el.value === v) return false; ecrire(el, v); return true; }
  function groupeDejaChoisi(el) {
    var g = el.closest("fieldset, [role=radiogroup], [role=listbox]") || (el.parentElement && el.parentElement.parentElement);
    return !!(g && g.querySelector("input[type=radio]:checked, [aria-checked=true], [aria-selected=true]"));
  }
  async function remplir(force) {
    var a = etat.choisie; if (!a) return [];
    var fait = [], k = function (x) { return a.id + ":" + x; };
    var titre = champ("input:not([type]), input[type=text], input[type=search]", /titre|title|subject|objet de l.annonce/, /recherch|search|ville|adresse|code postal|localisation/);
    if (titre && poser(titre, a.titre, a, force, "titre")) fait.push("titre");
    var desc = champ("textarea", /descr|body|texte|annonce/) || [].filter.call(document.querySelectorAll("textarea"), visible)[0];
    if (desc && poser(desc, a.description, a, force, "description")) fait.push("description");
    var prix = champ("input", /prix|price/, /livraison|envoi|poids/);
    if (prix && a.prix != null && poser(prix, String(a.prix), a, force, "prix")) fait.push("prix");
    if (a.etat && ETATS_LBC[a.etat]) {
      var ch = choisir(ETATS_LBC[a.etat], force ? null : groupeDejaChoisi);
      if (ch === "ok") fait.push("état");
      else if (!ch && (force || (etat.compte[k("etat")] || 0) < 2)) {
        etat.compte[k("etat")] = (etat.compte[k("etat")] || 0) + 1;
        if ((await ouvrirDeroulantEtat(a, force)) && choisir(ETATS_LBC[a.etat]) === "ok") fait.push("état");
      }
    }
    if (!titre && !desc && !prix && a.categorie && CATEGORIES_LBC[a.categorie].length && (force || !etat.compte[k("cat")])) {
      if (choisir(CATEGORIES_LBC[a.categorie])) { etat.compte[k("cat")] = true; fait.push("catégorie"); }
    }
    var fic = photoFichier();
    if (fic && a.photo && (force || !etat.compte[k("photo")])) {
      etat.compte[k("photo")] = true;
      try {
        var fichiers = await fichiersPhotos(a), n = 0;
        if (fic.multiple) { deposer(fic, fichiers); n = fichiers.length; }
        else {
          // Champ à une seule photo : on les envoie l'une après l'autre, dans l'ordre de la fiche.
          for (var i = 0; i < fichiers.length; i++) {
            var f2 = i === 0 ? fic : photoFichier(); if (!f2) break;
            deposer(f2, [fichiers[i]]); n++;
            await attendre(900);
          }
        }
        fait.push(n > 1 ? n + " photos" : "photo");
      } catch (e) { etat.compte[k("photo")] = false; statut("Photos non ajoutées : " + e.message, "bad"); }
    }
    if (fait.length && !etat.compte[k("compte")]) { etat.compte[k("compte")] = true; rrDemander({ type: "rempli" }).catch(function () {}); }
    if (fait.length) {
      etat.journal = (etat.journal || []).concat(fait.filter(function (x) { return (etat.journal || []).indexOf(x) < 0; }));
      statut("Rempli automatiquement : " + fait.join(", ") + (etat.continuer ? ". Je passe à l'écran suivant dans un instant." : ". Relis, puis clique « Continuer » sur Le Bon Coin."), "ok");
      if (fait.some(function (x) { return /photo/.test(x); })) etat.photosA = Date.now();
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
      remplir(false).catch(function () {}).then(function () { enCours = false; planifierContinuer(); });
    }, 350);
  });

  /* ===== « Continuer » tout seul =====
     Quand l'écran est rempli et que la page ne bouge plus, l'extension clique « Continuer », une seule fois par écran.
     Elle s'abstient s'il reste un champ obligatoire vide, si une erreur est affichée, si la personne est en train
     d'agir sur la page, ou pendant l'envoi des photos. Jamais « Publier » : sur l'écran final, la main revient à la personne. */
  var derniereAction = 0, minuterieSuite = null, ecransPasses = {};
  ["keydown", "pointerdown", "wheel"].forEach(function (t) {
    document.addEventListener(t, function (e) { if (e.isTrusted && !(hote && e.composedPath && e.composedPath().indexOf(hote) >= 0)) derniereAction = Date.now(); }, true);
  });
  function boutons(re) {
    return [].filter.call(document.querySelectorAll("button, [role=button], input[type=submit]"), function (b) {
      return visible(b) && re.test(norm(b.textContent || b.value || "")) && !b.closest("nav, header, footer");
    });
  }
  function cleEcran() {
    var h = [].find.call(document.querySelectorAll("main h1, main h2, h1, h2"), visible);
    var champs = [].filter.call(document.querySelectorAll("input, textarea, select, [role=combobox]"), function (x) { return visible(x) && !(hote && hote.contains(x)); }).slice(0, 6).map(description).join("/");
    return location.pathname + "|" + (h ? norm(h.textContent).slice(0, 80) : "") + "|" + champs.slice(0, 200);
  }
  function obligatoireVide() {
    return [].some.call(document.querySelectorAll("input[required], textarea[required], select[required], [aria-required=true]"), function (x) {
      return visible(x) && !(hote && hote.contains(x)) && x.type !== "file" && x.type !== "radio" && x.type !== "checkbox" && "value" in x && !String(x.value || "").trim();
    });
  }
  function erreurAffichee() {
    return [].some.call(document.querySelectorAll("[role=alert], [aria-invalid=true]"), function (x) { return visible(x) && (x.getAttribute("aria-invalid") === "true" || (x.textContent || "").trim().length > 3); });
  }
  function planifierContinuer() {
    clearTimeout(minuterieSuite);
    if (!etat.auto || !etat.continuer || !etat.choisie || !DEPOT.test(location.pathname)) return;
    minuterieSuite = setTimeout(continuerSiPret, 1600 + Math.round(Math.random() * 600));
  }
  function continuerSiPret() {
    if (!etat.auto || !etat.continuer || !etat.choisie || enCours) return;
    var cle = cleEcran();
    if (ecransPasses[cle]) return;
    if (boutons(/^(publier|deposer mon annonce|valider et publier|mettre en ligne)/).length) { statut("Dernier écran : relis l'annonce, puis clique « Publier » toi-même.", "ok"); return; }
    var b = boutons(/^continuer$/)[0];
    if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return;
    var attente = Math.max(derniereAction + 4000, (etat.photosA || 0) + 4000) - Date.now();
    if (attente > 0 || [].some.call(document.querySelectorAll("[role=progressbar], [aria-busy=true]"), visible)) { minuterieSuite = setTimeout(continuerSiPret, Math.max(attente, 800)); return; }
    if (obligatoireVide()) { statut("Il reste un champ obligatoire à remplir sur cet écran, puis clique « Continuer ».", "bad"); return; }
    if (erreurAffichee()) { statut("Le Bon Coin signale un champ à corriger : corrige-le, puis clique « Continuer ».", "bad"); return; }
    ecransPasses[cle] = true;
    b.click();
  }
  function demarrerAuto() {
    observateur.disconnect();
    // Mémorise le jeu en cours de dépôt : son lien sera repris tout seul une fois l'annonce publiée.
    if (etat.choisie && !etat.choisie.lot) { try { RR.storage.local.set({ depot: { id: etat.choisie.id, titre: etat.choisie.titre, at: Date.now() } }); } catch (e) {} }
    if (!etat.auto || !etat.choisie) return;
    observateur.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style"] });
    remplir(false).catch(function () {}).then(planifierContinuer);
  }

  var attendre = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
  function deposer(champ, fichiers) {
    var dt = new DataTransfer(); fichiers.forEach(function (f) { dt.items.add(f); });
    champ.files = dt.files;
    champ.dispatchEvent(new Event("input", { bubbles: true }));
    champ.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // Toutes les photos de la fiche, dans l'ordre de la galerie RetroRevente (la première sert de couverture).
  async function fichiersPhotos(a) {
    if (!etat.photo || etat.photo.id !== a.id) {
      var ids = Array.isArray(a.photos) && a.photos.length ? a.photos : [""];
      var nom = (a.nom || "photo").normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 50) || "photo";
      var l = [];
      for (var j = 0; j < ids.length; j++) {
        var r = await rrDemander({ type: "photo", id: a.id, photo: ids[j] });
        var bin = atob(r.base64), b = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
        l.push(new File([b], nom + (ids.length > 1 ? "-" + (j + 1) : "") + ".jpg", { type: r.type || "image/jpeg" }));
      }
      etat.photo = { id: a.id, fichiers: l };
    }
    return etat.photo.fichiers;
  }
  // « État » en liste déroulante maison (« Choisissez ») : on l'ouvre pour que l'option devienne cliquable.
  // Une valeur déjà choisie est respectée, sauf « Remplir à nouveau ».
  async function ouvrirDeroulantEtat(a, force) {
    var cand = [].filter.call(document.querySelectorAll("[role=combobox], [aria-haspopup], button, input[readonly], div[tabindex]"), visible);
    var d = cand.find(function (el) {
      if (/^etat\b/.test(description(el))) return true;
      for (var p = el.parentElement, n = 0; p && n < 4; p = p.parentElement, n++) {
        var lab = [].find.call(p.querySelectorAll("label, legend, p, span, div"), function (x) { return x.childElementCount === 0 && !el.contains(x) && /^etat\s*\*?$/.test(norm(x.textContent)); });
        if (lab) return lab.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
      }
      return false;
    });
    if (!d) return false;
    var vu = norm(d.value || d.textContent || "");
    if (!force && vu && !/^choisi/.test(vu)) return false;   // déjà choisi
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (t) { d.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); });
    await attendre(350);
    return true;
  }

  /* ===== Panneau (charte RetroRevente : vert anis, noir doux, Rubik + Figtree) ===== */
  var MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var RACCOURCI = MAC ? "⌘K" : "Ctrl K";
  // Logo du site (police Righteous, en tracés SVG) : la couleur suit le thème via currentColor.
  var LOGO = '<svg xmlns="http://www.w3.org/2000/svg" height="26" aria-hidden="true" focusable="false" viewBox="0 0 396 80"> <path fill="currentColor" fill-rule="evenodd" d="M 26 20 L 54 20 C 61 20 65 24 67 33 L 71 51 C 73 60 64 65 57 58 L 50 51 L 30 51 L 23 58 C 16 65 7 60 9 51 L 13 33 C 15 24 19 20 26 20 Z M 24 30 L 30 30 L 30 35 L 35 35 L 35 41 L 30 41 L 30 46 L 24 46 L 24 41 L 19 41 L 19 35 L 24 35 Z M 51 27 L 59 27 L 55 34 L 62 34 L 48 49 L 51 39 L 44 39 Z"/> <path fill="#D4F57A" d="M 51 27 L 59 27 L 55 34 L 62 34 L 48 49 L 51 39 L 44 39 Z"/> <path fill="currentColor" d="M93.81 29.95V43.36H100.52Q101.89 43.36 103.11 42.83Q104.32 42.31 105.24 41.4Q106.15 40.49 106.67 39.26Q107.2 38.03 107.2 36.65Q107.2 35.28 106.67 34.05Q106.15 32.82 105.24 31.91Q104.32 31 103.11 30.48Q101.89 29.95 100.52 29.95ZM93.81 56.74H87.11V23.24H100.52Q102.36 23.24 104.07 23.72Q105.77 24.2 107.26 25.08Q108.74 25.95 109.97 27.18Q111.19 28.41 112.07 29.9Q112.94 31.4 113.42 33.1Q113.9 34.81 113.9 36.65Q113.9 38.38 113.47 40.02Q113.04 41.65 112.23 43.13Q111.43 44.6 110.26 45.84Q109.09 47.07 107.64 47.98L111.36 56.74H104.23L101.31 49.99L93.81 50.04ZM127.57 50.62Q127.94 50.74 128.32 50.78Q128.69 50.81 129.06 50.81Q130 50.81 130.86 50.55Q131.73 50.3 132.49 49.82Q133.25 49.34 133.84 48.65Q134.44 47.96 134.81 47.12L139.48 51.82Q138.6 53.08 137.44 54.08Q136.28 55.09 134.94 55.79Q133.6 56.49 132.11 56.85Q130.63 57.21 129.06 57.21Q126.42 57.21 124.1 56.23Q121.78 55.25 120.03 53.5Q118.29 51.75 117.29 49.33Q116.29 46.91 116.29 44.01Q116.29 41.05 117.29 38.59Q118.29 36.14 120.03 34.41Q121.78 32.68 124.1 31.73Q126.42 30.77 129.06 30.77Q130.63 30.77 132.12 31.14Q133.62 31.51 134.96 32.22Q136.31 32.92 137.47 33.93Q138.64 34.95 139.53 36.21ZM130.84 37.47Q130.4 37.31 129.96 37.26Q129.53 37.22 129.06 37.22Q127.76 37.22 126.6 37.69Q125.44 38.17 124.59 39.06Q123.74 39.95 123.25 41.2Q122.76 42.45 122.76 44.01Q122.76 44.36 122.79 44.81Q122.83 45.25 122.91 45.71Q122.99 46.16 123.11 46.58Q123.22 47 123.41 47.33ZM155.28 56.74Q152.96 56.74 150.93 55.87Q148.9 54.99 147.37 53.46Q145.84 51.93 144.96 49.9Q144.09 47.87 144.09 45.55V38.13H140.98V31.77H144.09V21.77H150.44V31.77H160.11V38.13H150.44V45.55Q150.44 46.56 150.81 47.44Q151.19 48.31 151.84 48.97Q152.5 49.62 153.38 50.01Q154.27 50.39 155.28 50.39H160.11V56.74ZM170.06 56.74H163.69V31.73H165.23L167.33 34.69Q168.87 33.29 170.83 32.53Q172.8 31.77 174.9 31.77H180.53V38.13H174.9Q173.89 38.13 173.01 38.5Q172.12 38.87 171.46 39.53Q170.81 40.18 170.44 41.07Q170.06 41.96 170.06 42.96ZM207.67 44.01Q207.67 46.82 206.67 49.23Q205.67 51.65 203.94 53.42Q202.21 55.18 199.88 56.2Q197.56 57.21 194.9 57.21Q192.26 57.21 189.93 56.2Q187.61 55.18 185.87 53.42Q184.13 51.65 183.12 49.23Q182.12 46.82 182.12 44.01Q182.12 41.16 183.12 38.73Q184.13 36.3 185.87 34.54Q187.61 32.78 189.93 31.77Q192.26 30.77 194.9 30.77Q197.56 30.77 199.88 31.71Q202.21 32.66 203.94 34.4Q205.67 36.14 206.67 38.58Q207.67 41.02 207.67 44.01ZM201.25 44.01Q201.25 42.47 200.75 41.22Q200.25 39.97 199.38 39.07Q198.52 38.17 197.36 37.69Q196.2 37.22 194.9 37.22Q193.59 37.22 192.43 37.69Q191.27 38.17 190.42 39.07Q189.57 39.97 189.08 41.22Q188.59 42.47 188.59 44.01Q188.59 45.46 189.08 46.7Q189.57 47.94 190.42 48.85Q191.27 49.76 192.43 50.29Q193.59 50.81 194.9 50.81Q196.2 50.81 197.36 50.32Q198.52 49.83 199.38 48.94Q200.25 48.05 200.75 46.79Q201.25 45.53 201.25 44.01ZM218.58 29.95V43.36H225.29Q226.67 43.36 227.88 42.83Q229.1 42.31 230.01 41.4Q230.92 40.49 231.44 39.26Q231.97 38.03 231.97 36.65Q231.97 35.28 231.44 34.05Q230.92 32.82 230.01 31.91Q229.1 31 227.88 30.48Q226.67 29.95 225.29 29.95ZM218.58 56.74H211.88V23.24H225.29Q227.13 23.24 228.84 23.72Q230.54 24.2 232.03 25.08Q233.51 25.95 234.74 27.18Q235.96 28.41 236.84 29.9Q237.72 31.4 238.2 33.1Q238.67 34.81 238.67 36.65Q238.67 38.38 238.24 40.02Q237.81 41.65 237 43.13Q236.2 44.6 235.03 45.84Q233.86 47.07 232.41 47.98L236.13 56.74H229L226.08 49.99L218.58 50.04ZM252.34 50.62Q252.71 50.74 253.09 50.78Q253.46 50.81 253.84 50.81Q254.77 50.81 255.63 50.55Q256.5 50.3 257.26 49.82Q258.02 49.34 258.61 48.65Q259.21 47.96 259.58 47.12L264.26 51.82Q263.37 53.08 262.21 54.08Q261.05 55.09 259.71 55.79Q258.37 56.49 256.88 56.85Q255.4 57.21 253.84 57.21Q251.2 57.21 248.87 56.23Q246.55 55.25 244.81 53.5Q243.07 51.75 242.06 49.33Q241.06 46.91 241.06 44.01Q241.06 41.05 242.06 38.59Q243.07 36.14 244.81 34.41Q246.55 32.68 248.87 31.73Q251.2 30.77 253.84 30.77Q255.4 30.77 256.9 31.14Q258.39 31.51 259.73 32.22Q261.08 32.92 262.25 33.93Q263.41 34.95 264.3 36.21ZM255.61 37.47Q255.17 37.31 254.74 37.26Q254.3 37.22 253.84 37.22Q252.53 37.22 251.37 37.69Q250.22 38.17 249.36 39.06Q248.51 39.95 248.02 41.2Q247.53 42.45 247.53 44.01Q247.53 44.36 247.56 44.81Q247.6 45.25 247.68 45.71Q247.76 46.16 247.88 46.58Q248 47 248.18 47.33ZM274.6 56.74 265.07 31.73H272.34L277.8 47.33L283.25 31.73H290.54L281.01 56.74ZM302.92 50.62Q303.29 50.74 303.67 50.78Q304.04 50.81 304.41 50.81Q305.35 50.81 306.21 50.55Q307.08 50.3 307.84 49.82Q308.59 49.34 309.19 48.65Q309.79 47.96 310.16 47.12L314.83 51.82Q313.94 53.08 312.79 54.08Q311.63 55.09 310.29 55.79Q308.95 56.49 307.46 56.85Q305.98 57.21 304.41 57.21Q301.77 57.21 299.45 56.23Q297.12 55.25 295.38 53.5Q293.64 51.75 292.64 49.33Q291.63 46.91 291.63 44.01Q291.63 41.05 292.64 38.59Q293.64 36.14 295.38 34.41Q297.12 32.68 299.45 31.73Q301.77 30.77 304.41 30.77Q305.98 30.77 307.47 31.14Q308.97 31.51 310.31 32.22Q311.66 32.92 312.82 33.93Q313.99 34.95 314.88 36.21ZM306.19 37.47Q305.74 37.31 305.31 37.26Q304.88 37.22 304.41 37.22Q303.1 37.22 301.95 37.69Q300.79 38.17 299.94 39.06Q299.09 39.95 298.6 41.2Q298.11 42.45 298.11 44.01Q298.11 44.36 298.14 44.81Q298.18 45.25 298.26 45.71Q298.34 46.16 298.46 46.58Q298.57 47 298.76 47.33ZM324.46 56.74H318.08V31.73H319.62L321.72 34.15Q323.27 32.75 325.22 31.99Q327.17 31.23 329.29 31.23Q331.58 31.23 333.61 32.11Q335.65 32.99 337.17 34.52Q338.68 36.05 339.56 38.09Q340.44 40.14 340.44 42.45V56.74H334.06V42.45Q334.06 41.47 333.68 40.59Q333.31 39.71 332.66 39.06Q332 38.41 331.14 38.03Q330.27 37.66 329.29 37.66Q328.29 37.66 327.4 38.03Q326.51 38.41 325.86 39.06Q325.2 39.71 324.83 40.59Q324.46 41.47 324.46 42.45ZM357.51 56.74Q355.2 56.74 353.17 55.87Q351.14 54.99 349.61 53.46Q348.08 51.93 347.2 49.9Q346.32 47.87 346.32 45.55V38.13H343.22V31.77H346.32V21.77H352.68V31.77H362.35V38.13H352.68V45.55Q352.68 46.56 353.05 47.44Q353.43 48.31 354.08 48.97Q354.73 49.62 355.62 50.01Q356.51 50.39 357.51 50.39H362.35V56.74ZM375.88 50.62Q376.25 50.74 376.62 50.78Q377 50.81 377.37 50.81Q378.3 50.81 379.17 50.55Q380.03 50.3 380.79 49.82Q381.55 49.34 382.15 48.65Q382.74 47.96 383.12 47.12L387.79 51.82Q386.9 53.08 385.75 54.08Q384.59 55.09 383.25 55.79Q381.9 56.49 380.42 56.85Q378.94 57.21 377.37 57.21Q374.73 57.21 372.41 56.23Q370.08 55.25 368.34 53.5Q366.6 51.75 365.6 49.33Q364.59 46.91 364.59 44.01Q364.59 41.05 365.6 38.59Q366.6 36.14 368.34 34.41Q370.08 32.68 372.41 31.73Q374.73 30.77 377.37 30.77Q378.94 30.77 380.43 31.14Q381.93 31.51 383.27 32.22Q384.61 32.92 385.78 33.93Q386.95 34.95 387.84 36.21ZM379.15 37.47Q378.7 37.31 378.27 37.26Q377.84 37.22 377.37 37.22Q376.06 37.22 374.91 37.69Q373.75 38.17 372.9 39.06Q372.04 39.95 371.55 41.2Q371.06 42.45 371.06 44.01Q371.06 44.36 371.1 44.81Q371.13 45.25 371.21 45.71Q371.3 46.16 371.41 46.58Q371.53 47 371.72 47.33Z"/> </svg>';
  function marque() { var b = el("b", { class: "marque", role: "img", "aria-label": "RetroRevente" }); b.innerHTML = LOGO; return b; }
  var CSS = ":host{all:initial}*{box-sizing:border-box}[hidden]{display:none!important}" +
    ".b{--anis:#D4F57A;--anis-p:#F1FCD0;--vert-p:#E9F7EC;--vert-t:#CBEBD3;--vert-f:#14401F;--rouge-p:#FCEDEA;--rouge-t:#F6D3CB;--rouge-f:#6A1E12;--nuit:#1A1A1A;--carte:#fff;--papier:#F6F6F1;--encre:#1A1A1A;--gris:#62625C;--gris-c:#A3A39B;--trait:#E6E6DE;--titre:'RR Rubik',ui-rounded,'Arial Rounded MT Bold',system-ui,sans-serif;--texte:'RR Figtree','Avenir Next',ui-sans-serif,system-ui,sans-serif;--ease:cubic-bezier(.2,.8,.2,1);" +
      "position:fixed;right:18px;bottom:18px;z-index:2147483646;font:500 14px/1.45 var(--texte);color:var(--encre);-webkit-font-smoothing:antialiased}" +
    "@media (prefers-color-scheme:dark){.b{--carte:#1E1E1E;--papier:#262626;--encre:#F4F4EE;--gris:#A6A69E;--gris-c:#7A7A72;--trait:#333;--anis-p:#2A3414;--vert-p:#1C2E21;--vert-t:#2D4A35;--vert-f:#BFE8C8;--rouge-p:#33201D;--rouge-t:#553029;--rouge-f:#F6C4B9}}" +
    "button,input{font:inherit;color:inherit}" +
    ".rond{position:relative;width:58px;height:58px;border-radius:50%;border:0;background:var(--nuit);color:var(--anis);font:800 17px/1 var(--titre);letter-spacing:-.5px;cursor:pointer;box-shadow:0 10px 28px rgba(0,0,0,.28);transition:transform .25s var(--ease)}" +
    ".rond:hover{transform:translateY(-2px) rotate(-4deg)}" +
    ".rond kbd{position:absolute;right:50%;bottom:calc(100% + 8px);transform:translateX(50%);white-space:nowrap;font:600 11px/1 var(--texte);color:var(--encre);background:var(--carte);border:1px solid var(--trait);border-radius:7px;padding:5px 7px;opacity:0;pointer-events:none;transition:opacity .2s}" +
    ".rond:hover kbd,.rond:focus-visible kbd{opacity:1}" +
    ".p{position:relative;width:360px;max-width:calc(100vw - 36px);max-height:calc(100vh - 36px);overflow:auto;background:var(--carte);border-radius:26px;box-shadow:0 18px 50px rgba(0,0,0,.3);padding:18px;display:flex;flex-direction:column;gap:12px;animation:monte .3s var(--ease)}" +
    "@keyframes monte{from{opacity:0;transform:translateY(10px) scale(.98)}}" +
    ".t{display:flex;align-items:center;justify-content:space-between;gap:8px}.t b{font:700 17px/1 var(--titre);letter-spacing:-.3px;display:flex;align-items:center;gap:8px}" +
    ".marque{display:flex;color:var(--encre)}.marque svg{display:block;height:26px;width:auto}" +
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
    ".rep{display:flex;flex-direction:row;align-items:flex-start;gap:10px;text-align:left;border:1px solid var(--trait);background:var(--papier);border-radius:14px;padding:9px 12px;cursor:pointer;transition:border-color .2s,background .2s}.rep:hover{border-color:var(--anis);background:var(--anis-p)}" +
    ".ia{display:flex;flex-direction:column;gap:7px;background:var(--nuit);color:#fff;border-radius:18px;padding:12px;--papier:rgba(255,255,255,.06);--trait:rgba(255,255,255,.14);--gris:#B8B8B0;--encre:#fff}" +
    ".ia-t{display:flex;align-items:center;justify-content:space-between;gap:8px}.ia-t b{font:700 14px/1.2 var(--titre);display:flex;gap:6px;align-items:center}.etoile{color:var(--anis)}" +
    ".ia .mini{color:#fff}.ia .mini:hover:not(:disabled){background:var(--anis);border-color:var(--anis);color:var(--nuit)}.mini:disabled{opacity:.55;cursor:default}.ia-r{margin:0;font-size:12.5px;color:#B8B8B0}.ia-r.charge{animation:pulse 1.2s ease-in-out infinite}@keyframes pulse{50%{opacity:.45}}" +
    ".rep.fort{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.14)}.rep.fort:hover{background:rgba(212,245,122,.14);border-color:var(--anis)}.rep.fort b{color:var(--anis)}.rep .plein{display:block;-webkit-line-clamp:unset;color:#E8E8E2}" +
    ".ap{font-style:normal;font:700 10.5px/1 var(--texte);letter-spacing:.03em;text-transform:uppercase;border-radius:999px;padding:3px 7px;margin-right:7px;vertical-align:1px;background:rgba(255,255,255,.12);color:#fff}.ap-contre_offre{background:var(--anis);color:var(--nuit)}.ap-couper_court{background:#F3B9AE;color:#5A1A10}.ap-accepter{background:#BFE8C8;color:#14401F}" +
    ".rep .ico{flex:none;width:30px;height:30px;border-radius:10px;background:var(--anis-p);color:var(--nuit);display:grid;place-items:center}.rep .ic{width:17px;height:17px}.rep .q{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}" +
    ".rep .ap2{font-size:12.5px;color:var(--gris);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.rep strong{color:var(--encre);font-weight:800}" +
    ".rep.fort .ico{background:var(--anis);color:var(--nuit)}.rep.fort strong{color:#fff;font-weight:800}" +
    ".emo{flex:none;width:34px;height:34px;border-radius:11px;background:var(--carte);border:1px solid var(--trait);display:grid;place-items:center;font-size:19px;line-height:1}.opt.actif .emo{border-color:var(--anis)}" +
    ".grp{margin:6px 2px 0;font:700 11px/1 var(--texte);letter-spacing:.06em;text-transform:uppercase;color:var(--gris)}.grp:first-child{margin-top:0}" +
    // Couleur pastel selon le sens de la réponse : vert quand on va dans le sens de l'acheteur, rouge quand on refuse.
    "details.types>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;font:600 11px/1 var(--texte);letter-spacing:.08em;text-transform:uppercase;color:var(--gris);padding:10px 2px}" +
    "details.types>summary::-webkit-details-marker{display:none}details.types>summary::after{content:'';width:7px;height:7px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);margin:-3px 6px 0 0;transition:transform .2s}" +
    "details.types[open]>summary::after{transform:rotate(-135deg);margin-top:3px}details.types>summary:hover{color:var(--encre)}.ia .clair{margin-top:8px;background:var(--anis);color:var(--nuit);border-color:var(--anis)}" +
    ".rond-ia{display:inline-block;width:13px;height:13px;margin-right:7px;vertical-align:-2px;border:2px solid rgba(212,245,122,.3);border-top-color:var(--anis);border-radius:50%;animation:tourne .8s linear infinite}@keyframes tourne{to{transform:rotate(360deg)}}" +
    ".ia-r.charge{animation:none}.parler.attente textarea{opacity:.55;cursor:wait}.parler.attente .clair{min-width:74px;cursor:wait}.parler.attente .clair .rond-ia{margin:0;border-color:rgba(26,26,26,.25);border-top-color:var(--nuit)}" +
    ".parler{display:flex;gap:8px;align-items:flex-end;margin-top:4px}.parler textarea{flex:1;min-width:0;resize:vertical;font:13px/1.4 var(--texte);color:#fff;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:8px 10px;outline:none}" +
    ".parler textarea::placeholder{color:#9A9A92}.parler textarea:focus{border-color:var(--anis)}.parler .clair{margin:0}" +
    ".s:empty{display:none}.rep.s-plus{background:var(--vert-p);border-color:var(--vert-t)}.rep.s-plus .ico{background:var(--vert-t);color:var(--vert-f)}" +
    ".rep.s-moins{background:var(--rouge-p);border-color:var(--rouge-t)}.rep.s-moins .ico{background:var(--rouge-t);color:var(--rouge-f)}" +
    ".rep.s-plus:hover,.rep.s-moins:hover{border-color:var(--encre)}" +
    ".rep.fort.s-plus{background:rgba(191,232,200,.13);border-color:rgba(191,232,200,.35)}.rep.fort.s-plus .ico{background:#BFE8C8;color:#14401F}.rep.fort.s-plus b{color:#CFF0D6}" +
    ".rep.fort.s-moins{background:rgba(243,185,174,.13);border-color:rgba(243,185,174,.35)}.rep.fort.s-moins .ico{background:#F3B9AE;color:#5A1A10}.rep.fort.s-moins b{color:#F8CFC6}" +
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
      el("div", { class: "t" }, [marque(), el("button", { class: "x", "aria-label": "Réduire", title: "Réduire (Échap)", texte: "×", onclick: function () { replie(true); } })]),
      el("div", { class: "corps" }),
      el("div", { class: "s", texte: "Chargement de tes annonces…" }),
      el("div", { class: "n", texte: mode() === "messages" ? "Un clic place la réponse dans la zone de message : relis, puis envoie." : "Chaque écran du dépôt se remplit et passe tout seul. Sur le dernier, tu relis et tu cliques « Publier »." }),
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

  /* Un émoji par jeu, pour le repérer d'un coup d'œil : d'après le nom quand on le reconnaît, sinon tiré d'une
     palette, et toujours différent d'un jeu à l'autre dans la liste. */
  var EMOJIS_JEU = [
    [/mario ?kart/, "🏎️"], [/yoshi/, "🦖"], [/luigi/, "👻"], [/mario|peach/, "🍄"], [/zelda|link/, "🗡️"], [/kirby/, "🌸"], [/conker/, "🐿️"], [/pok[eé]mon|pikachu/, "⚡"],
    [/sonic/, "🦔"], [/donkey|diddy/, "🦍"], [/banjo/, "🐻"], [/final fantasy/, "🔮"], [/indiana|jones/, "🤠"], [/metroid/, "🚀"], [/star ?wars|rogue squadron/, "🌌"],
    [/fifa|pes|foot|soccer/, "⚽"], [/tetris/, "🧱"], [/crash/, "🌀"], [/spyro|dragon/, "🐉"], [/goldeneye|007|bond/, "🕵️"], [/resident evil|zombie/, "🧟"],
    [/street fighter|tekken|smash/, "🥊"], [/tony hawk|skate/, "🛹"], [/gran turismo|f-?zero|wave race|course|racing/, "🏁"], [/metal gear/, "📦"], [/castlevania/, "🦇"],
    [/pac-?man/, "🟡"], [/tomb raider/, "🏺"], [/harry potter/, "🧙"], [/lego/, "🧩"], [/rayman/, "✊"], [/animal crossing/, "🍃"], [/pikmin/, "🌱"], [/fire emblem/, "🔥"],
    [/kingdom hearts/, "🗝️"], [/gta|grand theft/, "🚓"], [/call of duty|battlefield/, "🎖️"], [/minecraft/, "⛏️"], [/splatoon/, "🦑"], [/xenoblade|chrono/, "⏳"],
  ];
  var PALETTE = ["🎮", "🕹️", "👾", "🎲", "💎", "🌟", "🍀", "🎯", "🚀", "🦄", "🌈", "🍒", "🐸", "🦊", "🐙", "🌵", "🍉", "🎸", "🛸", "🪐", "🐢", "🦋", "🍩", "🎈", "🧸", "🐳", "🦉", "🌻"];
  function emojis(l) {
    var pris = {}, out = {};
    l.forEach(function (a) {
      var n = norm(a.titre + " " + (a.nom || "")), e = "";
      if (a.lot) e = "📦";
      else if (a.categorie === "consoles") e = "🕹️";
      else if (a.categorie === "cartes") e = "🃏";
      var k = EMOJIS_JEU.find(function (x) { return x[0].test(n); }); if (k) e = k[1];
      if (!e || pris[e]) { var h = 0; for (var i = 0; i < String(a.id).length; i++) h = (h * 31 + String(a.id).charCodeAt(i)) >>> 0; for (var j = 0; j < PALETTE.length; j++) { var c = PALETTE[(h + j) % PALETTE.length]; if (!pris[c]) { e = c; break; } } }
      pris[e] = true; out[a.id] = e;
    });
    return out;
  }
  var emojiDe = function (a) { if (a && a.lot) return "📦"; if (!etat.emojis) etat.emojis = emojis(etat.annonces || []); return (a && etat.emojis[a.id]) || "🎮"; };

  function dessiner() {
    etat.emojis = emojis(etat.annonces || []);
    var corps = ombre.querySelector(".corps"); corps.textContent = "";
    var l = etat.annonces;
    if (!l.length) { statut("Aucun article « En vente » dans RetroRevente. Prépare une annonce dans l'appli, puis reviens ici.", ""); corps.appendChild(el("button", { class: "go", texte: "Ouvrir RetroRevente", onclick: function () { window.open("https://retrorevente.fr/app/", "_blank", "noopener"); } })); return; }
    // Par défaut : la plus récente qui n'a pas encore de lien d'annonce.
    if (!etat.choisie || (!etat.choisie.lot && !etat.choisie.externe && !l.some(function (a) { return a.id === etat.choisie.id; }))) etat.choisie = l.find(function (a) { return !a.publiee; }) || l[0];
    var a = etat.choisie;
    var choix = el("button", { class: "choix", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": "Annonce à déposer : " + a.titre + ". Changer (" + RACCOURCI + ")", onclick: function () { liste.hidden ? ouvrirListe() : fermerListe(); } }, [
      el("span", { class: "emo", "aria-hidden": "true", texte: emojiDe(a) }),
      el("span", { class: "q" }, [el("span", { class: "nom", texte: a.titre }), el("span", { class: "meta", texte: metaTxt(a) || "Changer d'article" })]),
      a.prix != null ? el("span", { class: "px", texte: prixTxt(a) }) : null,
      el("kbd", { class: "k", texte: RACCOURCI }),
    ]);
    var champ = el("input", { type: "text", placeholder: "Rechercher un jeu, une carte, une console…", "aria-label": "Rechercher une annonce", autocomplete: "off", spellcheck: "false", role: "combobox", "aria-controls": "rr-opts", "aria-expanded": "true" });
    var opts = el("ul", { class: "opts", id: "rr-opts", role: "listbox", "aria-label": "Annonces en vente" });
    var liste = el("div", { class: "liste" }, [el("label", { class: "cherche" }, [loupe(), champ]), opts]);
    liste.hidden = true;
    var actif = 0, vus = [];
    function rendre() {
      var r = filtrer(champ.value); vus = r.l; opts.textContent = "";
      if (actif >= vus.length) actif = Math.max(0, vus.length - 1);
      if (!vus.length) { opts.appendChild(el("li", { class: "vide", texte: "Aucun article ne correspond à « " + champ.value.trim() + " »." })); champ.removeAttribute("aria-activedescendant"); return; }
      vus.forEach(function (x, i) {
        var nom = el("span", { class: "nom" }, [surligne(x.titre, r.mots)]);
        if (x.publiee) nom.appendChild(el("span", { class: "pub", texte: "publiée" }));
        opts.appendChild(el("li", { class: "opt" + (i === actif ? " actif" : ""), id: "rr-o" + i, role: "option", "aria-selected": String(x.id === a.id),
          onmousedown: function (e) { e.preventDefault(); }, onmousemove: function () { if (actif !== i) { actif = i; marquer(); } }, onclick: function () { prendre(x); } },
          [el("span", { class: "emo", "aria-hidden": "true", texte: emojiDe(x) }), el("span", { class: "q" }, [nom, el("span", { class: "meta", texte: metaTxt(x) })]), x.prix != null ? el("span", { class: "px", texte: prixTxt(x) }) : null]));
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
      else { etat.manuel = conversationActuelle(); statut("Réponses complétées pour « " + x.titre + " ».", "ok"); }
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
      // Réponses types repliées quand l'IA répond ; ouvertes d'office si l'IA n'est pas incluse dans la formule.
      var types = el("details", { class: "types" }, [el("summary", { texte: "Réponses types" }), reponsesUI(a)]);
      if (etat.typesOuvert != null ? etat.typesOuvert : etat.iaBloquee) types.open = true;
      types.addEventListener("toggle", function () { etat.typesOuvert = types.open; });
      corps.appendChild(el("div", { class: "pile" }, [haut, ia, types]));
      dessinerIA(ia);
      statut(a.lot ? "📦 Lot de " + a.n + " articles à " + a.prix + " € repéré" + (a.articles ? " : " + a.plateforme + "." : ". Ouvre « Lot de " + a.n + " articles » pour que je voie les articles inclus.") : "", "");
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
    var suite = el("label", { class: "auto" }, [
      el("input", { type: "checkbox", role: "switch", onchange: function (e) { etat.continuer = e.target.checked; try { RR.storage.local.set({ continuer: etat.continuer }); } catch (x) {} if (etat.continuer) planifierContinuer(); else { clearTimeout(minuterieSuite); statut("Tu cliques « Continuer » toi-même.", ""); } } }),
      el("span", { class: "rail" }), "Continuer tout seul",
    ]);
    suite.querySelector("input").checked = etat.continuer;
    var actions = el("div", { class: "actions" }, [bascule, suite, el("button", { class: "mini", type: "button", title: "Réécrire tous les champs de l'écran avec cet article", texte: "Remplir à nouveau", onclick: function () { remplir(true).then(function (f) { if (!f.length) statut("Rien à remplir sur cet écran.", ""); }).catch(function (e) { statut(e.message, "bad"); }); } })]);
    corps.appendChild(el("div", { class: "pile" }, [haut, grille, actions]));
    if (!etat.journal || !etat.journal.length) statut(etat.auto ? "Remplissage automatique activé : chaque écran du dépôt se remplit tout seul." : "Remplissage automatique en pause.", "");
  }

  /* ===== Réponses types aux acheteurs (messagerie) ===== */
  // La colonne de la conversation ouverte : on remonte depuis la zone de message tant que la largeur reste celle
  // d'une colonne (on évite la liste des autres conversations et l'encadré de l'annonce).
  function colonneConversation() {
    var z = zoneMessage(); if (!z) return document.querySelector("main") || document.body;
    var w0 = Math.max(260, (z.closest("form") || z.parentElement || z).getBoundingClientRect().width), c = z;
    while (c.parentElement && c.parentElement !== document.body && c.parentElement.getBoundingClientRect().width <= w0 * 1.3 + 60) c = c.parentElement;
    return c;
  }
  // L'encadré de l'annonce discutée (à côté de la conversation : « Lot de 2 articles · 203 € » ou titre et prix).
  function texteEncadre() {
    var c = colonneConversation(), t = "", x = c.nextElementSibling;
    while (x) { t += "\n" + (x.innerText || ""); x = x.nextElementSibling; }
    if (!t.trim() && c.parentElement) { var y = c.parentElement.nextElementSibling; while (y) { t += "\n" + (y.innerText || ""); y = y.nextElementSibling; } }
    return t.slice(0, 1500);
  }
  var entier = function (v) { var n = Math.round(parseFloat(String(v).replace(/\s/g, "").replace(",", "."))); return isFinite(n) && n > 0 ? n : null; };
  // Contenu d'un lot : quand la fenêtre « Lot de 2 articles » est ouverte, on lit ses lignes (une image et un titre
  // par jeu). On s'en souvient pour la suite de la conversation (même lot = même nombre d'articles et même prix).
  var lotsVus = {};
  try { RR.storage.local.get("lots").then(function (r) { if (r && r.lots) lotsVus = Object.assign(r.lots, lotsVus); }); } catch (e) {}
  function articlesLotAffiches(n) {
    var titres = [].filter.call(document.querySelectorAll("h1, h2, h3, h4, p, span, div"), function (x) {
      return x.childElementCount === 0 && visible(x) && new RegExp("^\\s*lot de " + n + " articles?\\s*$", "i").test(x.textContent || "") && !(hote && hote.contains(x));
    });
    for (var i = 0; i < titres.length; i++) {
      var c = titres[i];
      for (var k = 0; k < 6 && c.parentElement && c.parentElement !== document.body; k++) {
        c = c.parentElement;
        var lignes = [].filter.call(c.querySelectorAll("a, button, li, [role=button], [role=link]"), function (x) {
          return x.querySelector("img") && !x.parentElement.closest("a, button, li, [role=button], [role=link]") && !x.contains(titres[i]);
        }).map(function (x) { return (x.innerText || "").replace(/\s+/g, " ").trim(); })
          .filter(function (t) { return t.length >= 6 && t.length <= 200 && !/€|il y a|\d{1,2}:\d{2}/i.test(t); });
        if (lignes.length >= n) return lignes.length === n ? lignes : null;
      }
    }
    return null;
  }
  // Titre court pour les phrases : « Astérix and the Great Rescue – Sega Mega Drive PAL » → « Astérix and the Great Rescue ».
  function titreCourt(t) {
    return String(t || "").split(/\s[–—-]\s|\s\(|\s(?:nintendo|n64|snes|super nintendo|nes|game ?boy|gba|gbc|sega|mega ?drive|master system|dreamcast|saturn|playstation|ps[1-5]|psp|xbox|wii|gamecube|ds|3ds|switch|pal|ntsc|eur|fr|loose|complet|cib)\b/i)[0].trim() || t;
  }
  function lotLu() {
    var re = /lot de (\d{1,2}) articles?[\s·•|-]*(\d[\d\s\u202f\u00a0]{0,6}(?:[.,]\d{1,2})?)\s?€/i;
    var m = re.exec(texteEncadre() + "\n" + colonneConversation().innerText.slice(0, 600));
    // Mise en page inattendue : on cherche « Lot de N articles · prix » dans toute la page, hors liste des conversations
    // (là, le lot n'est pas suivi d'un prix).
    if (!m) m = re.exec(document.body.innerText.slice(0, 60000));
    if (!m) return null;
    var lot = { n: +m[1], prix: entier(m[2]) }, cle = lot.n + "|" + lot.prix, vus = articlesLotAffiches(lot.n);
    if (vus && (lotsVus[cle] || []).join("|") !== vus.join("|")) {
      lotsVus[cle] = vus;
      var garde = {}; Object.keys(lotsVus).slice(-30).forEach(function (k) { garde[k] = lotsVus[k]; });
      try { RR.storage.local.set({ lots: garde }); } catch (e) {}
    }
    if (lotsVus[cle]) lot.articles = lotsVus[cle];
    return lot;
  }
  function offreOfficielle() {
    var t = colonneConversation().innerText, m, r = null, re = /offre de [^:\n]{1,60}:\s*(\d[\d\s]{0,6}(?:[.,]\d{1,2})?)\s?€/gi;
    while ((m = re.exec(t))) r = entier(m[1]);
    return r;
  }
  // Prénom ou pseudo de l'acheteur : « Voici l'offre de Garnier », sinon le nom en tête de l'encadré.
  // Prénom de l'acheteur : « Voici l'offre de Garnier », sinon la signature de son message (« Cordialement, Evelyne »),
  // sinon son pseudo, au-dessus de sa note (« EM54Retro · ★ 5 (88) »).
  var PAS_UN_NOM = /^(aujourd'hui|hier|bonjour|bonsoir|merci|cordialement|envoyer|lu|vu|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|faire une offre|voir plus|description|criteres|signaler|bloquer)$/i;
  function acheteurLu() {
    var conv = colonneConversation().innerText;
    var m = /offre de ([^:\n]{1,40}?)\s*:/i.exec(conv);
    if (m) return m[1].trim();
    var l = conv.split("\n").map(function (x) { return x.trim(); }).filter(Boolean), nom = "";
    for (var i = 1; i < l.length; i++) {
      if (/^[\p{Lu}][\p{Ll}'’-]+(?: [\p{Lu}][\p{Ll}'’-]+)?$/u.test(l[i]) && !PAS_UN_NOM.test(norm(l[i]))
        && /(cordialement|salutations|bonne (journee|soiree|fin de journee)|merci( beaucoup| d'avance)?|a bientot|bien a vous|bises|amicalement)[\s.!,]*$/.test(norm(l[i - 1]))) nom = l[i];
    }
    if (nom) return nom;
    var e = (texteEncadre() + "\n" + conv.slice(0, 1500)).split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
    for (var j = 0; j + 1 < e.length; j++) {
      if (/^[★*]?\s*\d(?:[.,]\d)?\s*\(\d+\)$/.test(e[j + 1]) && /^[\p{L}\p{N}][\p{L}\p{N}' ._-]{1,28}$/u.test(e[j]) && !PAS_UN_NOM.test(norm(e[j]))) return e[j];
    }
    return "";
  }
  function personnaliser(t, nom) {
    if (!nom || /^Bonjour\s+\p{Lu}\p{Ll}/u.test(t)) return t;
    return t.replace(/^Bonjour\s*([,!]?)\s*/u, function (x, p, i, tout) { var suite = tout.slice(x.length); return "Bonjour " + nom + (p === "!" ? " ! " : /^\p{L}/u.test(suite) ? ", " : " "); });
  }
  // sur : ne renvoie qu'un jeu vraiment repéré (pas le jeu par défaut pendant qu'une conversation se charge).
  function deviner(sur) {
    var lot = lotLu();
    if (lot && lot.prix) {
      var noms = (lot.articles || []).map(titreCourt), liste = noms.length > 1 ? noms.slice(0, -1).join(", ") + " et " + noms[noms.length - 1] : "";
      return { id: "lot", lot: true, titre: "Lot de " + lot.n + " articles", nom: liste ? "le lot " + liste : "le lot de " + lot.n + " articles", plateforme: liste, prix: lot.prix, n: lot.n, articles: lot.articles, description: "" };
    }
    // Le jeu de l'encadré de l'annonce (à côté de la conversation), sinon celui dont parle la conversation : on compare
    // les mots du titre (apostrophes, accents et « PAL EU… » tronqués ne gênent pas).
    var enc = texteEncadre(), a = meilleurJeu(enc) || meilleurJeu(colonneConversation().innerText.slice(0, 20000));
    return a || jeuDeLEncadre(enc) || (sur ? null : etat.annonces[0]);
  }
  var VIDES = ("the and les des une pour avec sans pal eur ntsc jeu jeux video version edition complet loose boite cartouche notice " +
    "nintendo sony sega microsoft playstation xbox console tres bon etat").split(" ");
  function mots(t) {
    return norm(t).replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter(function (m) { return m.length >= 3 && VIDES.indexOf(m) < 0; });
  }
  function meilleurJeu(texte) {
    var vus = {}; mots(texte).forEach(function (m) { vus[m] = 1; });
    var meilleur = null, score = 0;
    (etat.annonces || []).forEach(function (a) {
      var m = mots(a.nom || a.titre); if (!m.length) return;
      var s = m.filter(function (x) { return vus[x]; }).length / m.length + m.length / 1000;   // à égalité, le titre le plus précis
      if (s > score) { score = s; meilleur = a; }
    });
    return score >= 0.6 ? meilleur : null;
  }
  // Jeu absent de RetroRevente : on reprend le titre et le prix affichés dans l'encadré (« Conker's Bad Fur Day … · 190 € »).
  function jeuDeLEncadre(enc) {
    var l = String(enc || "").split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
    for (var i = 0; i + 1 < l.length; i++) {
      var px = /^(\d[\d\s]{0,6})\s?€$/.exec(l[i + 1]);
      if (px && /\p{L}{3}/u.test(l[i]) && !/^lot de/i.test(l[i])) {
        var et = Object.keys(ETAT_TXT).find(function (k) { return ETAT_TXT[k] && enc.indexOf(ETAT_TXT[k]) >= 0; });
        return { id: "lbc", externe: true, titre: l[i].replace(/\.{3}|…$/, "").trim(), nom: titreCourt(l[i].replace(/\.{3}|…$/, "")), plateforme: "", prix: entier(px[1]), etat: et || "", description: "" };
      }
    }
    return null;
  }
  // Prix ronds : multiples de 5, de 10 à partir de 100 € (vers le haut pour un plancher).
  function rond(x, haut) { if (x == null || !isFinite(x)) return null; var pas = x >= 100 ? 10 : 5; return Math.max(pas, (haut ? Math.ceil : Math.round)(x / pas) * pas); }
  var CONTENU_TXT = { seul: "la cartouche (ou le disque) seule", boite: "en boîte, sans notice", complet: "complet, avec la boîte et la notice", boite_vide: "la boîte seule, sans le jeu" };
  // Dernière offre en euros lue dans la conversation ouverte (autre que notre prix), pour chiffrer les réponses.
  function offreLue(px) {
    var off = offreOfficielle(); if (off && px && off < px) return off;
    var t = colonneConversation().innerText.slice(-6000), m, r = null, re = /(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:€|euros?\b)/gi;
    while ((m = re.exec(t))) { var v = Math.round(parseFloat(m[1].replace(",", "."))); if (v > 0 && v !== px) r = v; }
    return px && r && r < px ? r : null;
  }
  // Réponses types : ton sympa et diplomate, vouvoiement, complétées avec le jeu choisi. {offre} et {milieu} viennent
  // de la dernière offre lue dans la conversation quand il y en a une.
  function reponses(a) {
    var nom = a.nom || a.titre, px = a.prix, offre = offreLue(px);
    var plancher = px ? rond(px * 0.85, true) : null;
    var milieu = px ? Math.max(plancher, rond(offre ? (offre + px) / 2 : px * 0.9)) : null;
    var lePrix = px ? px + " €" : "le prix affiché";
    var detail = [a.contenu && CONTENU_TXT[a.contenu] ? "C'est " + CONTENU_TXT[a.contenu] : "", a.etat && ETAT_TXT[a.etat] ? (a.contenu ? ", " : "Il est en ") + ETAT_TXT[a.etat].toLowerCase() : ""].join("");
    var det = detail ? detail + ". " : "";
    var votre = offre ? "vos " + offre + " €" : "votre proposition";
    // Pour un lot, on parle des jeux qu'il contient (« Conker's Bad Fur Day et Astérix and the Great Rescue »).
    var valeur = a.lot ? "de la valeur " + (a.n === 2 ? "des deux articles" : "des " + (a.n || "") + " articles").replace("  ", " ") + (a.plateforme ? " (" + a.plateforme + ")" : "") + " : le lot est déjà à " + lePrix + ", au prix du marché."
      : "de la valeur " + (a.categorie === "cartes" ? "de la carte : elle se vend" : "du jeu : il se vend") + " autour de " + lePrix + " en ce moment.";
    var l = [
      // Disponibilité
      { g: "Disponibilité", t: "Toujours disponible", m: "Bonjour, oui, " + nom + " est toujours disponible ! " + det + "Je peux l'envoyer ou le remettre en main propre, comme vous préférez." },
      { g: "Disponibilité", t: "Réservé pour quelqu'un", m: "Bonjour, merci pour votre message ! " + nom + " est réservé pour le moment. Si la vente ne se fait pas, je reviens vers vous en priorité, promis." },
      { g: "Disponibilité", t: "Déjà vendu", m: "Bonjour, désolé, " + nom + " vient de partir. Merci beaucoup pour votre intérêt, et bonne chasse pour la suite !" },
      // Négociation
      { g: "Négociation", t: "Offre vraiment trop basse", m: "Bonjour, merci pour votre proposition ! Je comprends l'envie de faire une bonne affaire, mais " + votre + ", c'est vraiment trop loin " + valeur + " " + (milieu ? "Je peux faire un geste à " + milieu + " € si ça vous tente." : "Je peux faire un petit geste si vous me faites une autre proposition.") },
      { g: "Négociation", t: "Offre un peu basse : on coupe la poire en deux", m: "Bonjour, merci pour l'offre ! On n'est pas si loin." + (milieu ? " Je vous propose de couper la poire en deux : " + milieu + " € et il est à vous." : " Faites-moi une proposition un peu plus haute et on devrait s'entendre.") },
      { g: "Négociation", t: "Prix ferme, poliment", m: "Bonjour, merci pour votre message ! Le prix de " + lePrix + " est déjà calé sur la cote actuelle (ventes réelles constatées), je préfère le garder tel quel. Il est en très bonne place, je ne suis pas pressé." },
      { g: "Négociation", t: "« C'est quoi votre dernier prix ? »", m: "Bonjour ! " + (plancher ? "Mon dernier prix serait " + plancher + " €, " : "Je peux faire un petit geste, ") + "envoi ou remise en main propre au choix. Ça vous irait ?" },
      { g: "Négociation", t: "Accepter l'offre", m: "Bonjour, c'est d'accord pour " + (offre ? offre + " €" : "votre offre") + " ! Envoyez-moi la demande d'achat sur Le Bon Coin et je m'en occupe rapidement." },
      { g: "Négociation", t: "Offre sans même un bonjour", m: "Bonjour 🙂 Merci pour l'intérêt ! " + (a.lot ? "Le lot" : "Le jeu") + " est à " + lePrix + ". Si vous avez une proposition raisonnable, je l'étudie volontiers." },
      { g: "Négociation", t: "Offre groupée bien trop basse", m: "Bonjour, merci pour votre intérêt pour plusieurs de mes jeux, ça me fait plaisir ! Par contre, votre proposition est vraiment loin de leur valeur : chacun est déjà au prix du marché. Pour un lot, je peux faire un vrai geste sur le total, dites-moi lesquels vous intéressent et je vous fais une proposition honnête." },
      { g: "Négociation", t: "Nouvelle contre-offre, la dernière", m: "Je comprends, merci d'avoir fait un pas ! " + (plancher ? "Je peux descendre une dernière fois à " + plancher + " €, " : "Je peux faire un dernier petit geste, ") + "mais ce sera vraiment mon minimum. Dites-moi si ça vous va." },
      { g: "Négociation", t: "Couper court poliment", m: "Merci pour votre proposition ! Je pense qu'on ne va pas réussir à s'entendre sur le prix, je préfère en rester là. Bonne recherche à vous, et peut-être à une prochaine fois." },
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
    return a.categorie === "cartes" ? reponsesCarte(l, a, nom) : l;
  }
  /* Cartes Pokémon : on garde la disponibilité, la négociation et la sécurité, et on remplace « Le jeu » et l'envoi
     par les questions propres aux cartes (état des bords, authenticité, envoi sous toploader). */
  var ETAT_CARTE_TXT = { mint: "Mint", near_mint: "Near Mint", excellent: "Excellent", good: "Good", light_played: "Light Played", played: "Played", poor: "Poor" };
  function reponsesCarte(l, a, nom) {
    var etatC = a.gradation ? "gradée " + a.gradation + ", boîtier intact" : ETAT_CARTE_TXT[a.etatCarte] ? "en état " + ETAT_CARTE_TXT[a.etatCarte] : "";
    var carte = [
      { g: "La carte", t: "État des bords et de la surface", m: "Bonjour ! La carte est " + (etatC || "en très bon état") + ". Je peux vous envoyer des photos en gros plan des bords, des coins et de la surface, recto et verso." },
      { g: "La carte", t: "Authenticité", m: "Bonjour, oui, c'est une carte authentique" + (a.region ? ", en " + String(a.region).toLowerCase() : "") + ". Je peux vous envoyer une photo du dos et une en lumière rasante pour vérifier la texture et l'holo." },
      { g: "La carte", t: "Photo avec votre pseudo", m: "Bien sûr, pas de souci ! Je vous envoie une photo de la carte à côté d'un papier avec votre pseudo dans la journée." },
      { g: "La carte", t: "Carte gradée ?", m: a.gradation ? "Bonjour ! Elle est gradée " + a.gradation + ", le boîtier est intact et le numéro de certification se vérifie sur le site de la société de gradation." : "Bonjour ! Elle n'est pas gradée, elle a été rangée sous sleeve. Vous pouvez tout à fait l'envoyer à gradation après l'achat." },
      { g: "La carte", t: "Pourquoi ce prix ?", m: "Bonjour, bonne question ! Je me base sur la cote Cardmarket du moment et sur les ventes réellement conclues (eBay, Le Bon Coin) pour cette carte, dans cette langue et cet état." },
      { g: "Envoi et remise", t: "Envoi protégé", m: "La carte part sous sleeve et toploader, dans une enveloppe rigide, avec la livraison Le Bon Coin (paiement sécurisé). Expédiée sous 48 h après la commande." },
      { g: "Envoi et remise", t: "Remise en main propre", m: "La remise en main propre est possible ! Dites-moi quel jour et quel secteur vous arrangent, et on se retrouve dans un lieu public." },
      { g: "Envoi et remise", t: "Colis envoyé", m: "C'est parti ! La carte est bien protégée et déposée, vous recevrez le suivi par Le Bon Coin. Merci pour votre achat !" },
      { g: "Négociation", t: "Lot de plusieurs cartes", m: "Bonjour, avec plaisir pour un lot ! Dites-moi quelles cartes vous intéressent et je vous fais un prix d'ensemble, avec un seul envoi pour réduire les frais." },
    ];
    var garde = l.filter(function (x) { return x.g !== "Le jeu" && x.g !== "Envoi et remise" && x.t !== "Lot de plusieurs jeux"; }).map(function (x) {
      return { g: x.g, t: x.t, m: x.m.replace(/\bLe jeu\b/g, "La carte").replace(/\ble jeu\b/g, "la carte").replace(/\bBon jeu\b/g, "Bonne collection").replace(/mes jeux/g, "mes cartes").replace(/chacun est/g, "chacune est").replace("Il est en très bonne place, je ne suis pas pressé.", "Je ne suis pas pressé.").replace("je vous le réserve", "je vous la réserve").replace("je le remettrai", "je la remettrai") };
    });
    var i = garde.findIndex(function (x) { return x.g === "Sécurité et suivi"; });
    return garde.slice(0, i < 0 ? garde.length : i).concat(carte, i < 0 ? [] : garde.slice(i));
  }
  /* ===== Réponse proposée par l'IA (lit la conversation ouverte) ===== */
  function texteConversation() {
    var t = colonneConversation().innerText || "", enc = texteEncadre().trim();
    var z = zoneMessage(); if (z && !(z instanceof HTMLTextAreaElement) && !(z instanceof HTMLInputElement) && z.innerText) t = t.split(z.innerText).join(" ");
    t = t.replace(/\n{3,}/g, "\n\n").trim().slice(-4200);
    return (enc ? "[Annonce concernée]\n" + enc.slice(0, 600) + "\n\n[Conversation]\n" : "") + t;
  }
  function conversationActuelle() { return location.pathname + "|" + texteEncadre().slice(0, 160); }
  function cleConversation() { var t = texteConversation(), l = lotLu(); return location.pathname + "|" + t.length + "|" + t.slice(-300) + "|" + (l && l.articles ? l.articles.join("|") : ""); }
  async function proposerIA(force, consigne) {
    var cle = cleConversation();
    if (!force && etat.ia && etat.ia.cle === cle) return;
    if (!force && colonneConversation().innerText.trim().length < 40) return;   // conversation en cours de chargement
    var precedentes = ((etat.ia && etat.ia.reponses) || []).map(function (r) { return r.texte; });
    etat.ia = { cle: cle, charge: true, consigne: consigne || "" }; rafraichirIA();
    try {
      var c = etat.choisie || {}, lot = lotLu() || (c.lot ? { n: c.n, prix: c.prix } : null);
      var r = await rrDemander({ type: "reponse", annonce: c.lot ? "" : (c.id || ""), conversation: texteConversation(), lot: lot, offre: offreOfficielle(), acheteur: acheteurLu(), consigne: consigne || "", precedentes: consigne ? precedentes : [] });
      if (etat.ia.cle !== cle) return;
      etat.ia = { cle: cle, resume: r.resume, reponses: r.reponses || [], consigne: consigne || "" };
      if (consigne) etat.brouillonIA = "";
    } catch (e) {
      if (etat.ia.cle === cle) etat.ia = { cle: cle, erreur: e.message, status: e.status };
      if (e.status === 402 || e.status === 403) {
        etat.iaBloquee = true;
        var d = ombre && ombre.querySelector("details.types"); if (d && etat.typesOuvert == null) d.open = true;
      }
    }
    rafraichirIA();
  }
  var APPROCHES = { contre_offre: "Contre-offre", ferme: "Ferme", couper_court: "Couper court", accepter: "Accepter" };
  function rafraichirIA() { var z = ombre && ombre.querySelector(".ia"); if (z) dessinerIA(z); }
  function dessinerIA(z) {
    z.textContent = "";
    var tete = el("div", { class: "ia-t" }, [el("b", {}, [el("span", { class: "etoile", texte: "✦" }), "Réponse proposée par l'IA"]),
      el("button", { class: "mini", type: "button", texte: "Autres idées", title: "Relire la conversation et proposer d'autres réponses", onclick: function () { proposerIA(true); } })]);
    if ((etat.ia || {}).charge) tete.lastChild.disabled = true;   // pas de 2e demande pendant que l'IA lit
    z.appendChild(tete);
    var i = etat.ia || {};
    if (i.charge) {
      z.appendChild(el("p", { class: "ia-r charge" }, [el("span", { class: "rond-ia", "aria-hidden": "true" }), i.consigne ? "Je rédige ta réponse…" : "Je lis le dernier message de l'acheteur…"]));
      if (i.consigne) z.appendChild(parlerIA(true));
      return;
    }
    if (i.erreur && (i.status === 402 || i.status === 403)) {
      z.appendChild(el("p", { class: "ia-r", texte: i.erreur }));
      z.appendChild(el("button", { class: "mini clair", type: "button", texte: i.status === 403 ? "Confirmer mon e-mail" : "Changer de formule", onclick: function () { window.open("https://retrorevente.fr/app/?compte", "_blank", "noopener"); } }));
      return;
    }
    if (i.erreur) { z.appendChild(el("p", { class: "ia-r", texte: i.erreur })); z.appendChild(parlerIA()); return; }
    if (i.consigne) z.appendChild(el("p", { class: "ia-r", texte: "D'après ta consigne : « " + i.consigne + " »" }));
    else if (i.resume) z.appendChild(el("p", { class: "ia-r", texte: i.resume }));
    var qui = acheteurLu();
    (i.reponses || []).forEach(function (r) {
      var ap = APPROCHES[r.approche];
      r = { approche: r.approche, titre: r.titre, texte: smiley(personnaliser(r.texte || "", qui)), gras: r.gras };
      z.appendChild(el("button", { class: "rep fort" + (sensIA(r) ? " s-" + sensIA(r) : ""), type: "button", "aria-label": "Placer dans la zone de message : " + r.texte, onclick: function () { inserer(r.texte); } }, [
        el("span", { class: "ico" }, [icone(ICONE_APPROCHE[r.approche] || "question")]),
        el("span", { class: "q" }, [el("b", {}, [ap ? el("i", { class: "ap ap-" + r.approche, texte: ap }) : null, r.titre || "Réponse"]), el("span", { class: "plein" }, [apercu(r.texte, r.gras)])]),
      ]));
    });
    z.appendChild(parlerIA());
  }
  // Aucune proposition ne convient : on dit à l'IA ce qu'on veut répondre, elle le rédige dans le même ton.
  function parlerIA(attente) {
    var champ = el("textarea", { rows: "2", placeholder: "Aucune ne convient ? Dis à l'IA quoi répondre…", "aria-label": "Ce que tu veux répondre", spellcheck: "true" });
    champ.value = etat.brouillonIA || "";
    if (attente) {   // pendant la rédaction : champ bloqué, bouton qui tourne
      champ.disabled = true; champ.setAttribute("aria-busy", "true");
      return el("div", { class: "parler attente" }, [champ, el("button", { class: "mini clair", type: "button", disabled: "", "aria-label": "Rédaction en cours" }, [el("span", { class: "rond-ia" })])]);
    }
    var envoyer = function () { var t = champ.value.trim(); if (t.length < 3) { champ.focus(); return; } etat.brouillonIA = t; proposerIA(true, t); };
    champ.addEventListener("input", function () { etat.brouillonIA = champ.value; });
    champ.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); envoyer(); } });
    return el("div", { class: "parler" }, [champ, el("button", { class: "mini clair", type: "button", texte: "Rédiger", onclick: envoyer })]);
  }
  // Nouveau message reçu ou autre conversation : nouvelles propositions (une seule demande à la fois, espacées).
  var veilleMsg = null, minuterieMsg = null;
  function veillerMessages() {
    if (veilleMsg) return;
    veilleMsg = new MutationObserver(function (muts) {
      if (mode() !== "messages" || !ouvert || !etat.annonces) return;
      if (muts.every(function (m) { return hote && (m.target === hote || hote.contains(m.target)); })) return;
      clearTimeout(minuterieMsg);
      minuterieMsg = setTimeout(function () {
        // Jamais pendant que la personne écrit à l'IA (ni pendant qu'une conversation se charge) : on n'interrompt pas.
        if (occupe() || colonneConversation().innerText.trim().length < 40) return;
        // Autre conversation (ou encadré chargé après coup) : le panneau se cale tout seul sur le jeu dont on parle,
        // sauf si la personne a choisi elle-même un jeu pour cette conversation.
        var c = etat.choisie, ici = conversationActuelle();
        if (etat.manuel !== ici) {
          var d = deviner(true);
          if (d && (!c || d.id !== c.id || d.titre !== c.titre || (d.articles || []).join("|") !== (c.articles || []).join("|"))) { etat.choisie = d; dessiner(); }
        }
        if (etat.ia && !etat.ia.charge && etat.ia.cle !== cleConversation()) proposerIA(false); }, 1500);
    });
    veilleMsg.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function occupe() {
    var f = ombre && ombre.activeElement;
    return !!(etat.ia && etat.ia.charge) || !!(f && f.matches && f.matches(".parler textarea")) || !!(etat.brouillonIA || "").trim();
  }
  function zoneMessage() {
    var l = [].filter.call(document.querySelectorAll("textarea, input:not([type]), input[type=text], [contenteditable=''], [contenteditable=true], [role=textbox]"), function (x) { return visible(x) && !x.disabled; });
    var bons = l.filter(function (x) { return /message|repon|ecri|reply|write/.test(description(x) + " " + norm(x.getAttribute("placeholder") || x.getAttribute("data-placeholder") || "")); });
    return bons[bons.length - 1] || l.filter(function (x) { return !(x instanceof HTMLInputElement); }).pop() || null;
  }
  function inserer(texte) {
    var z = zoneMessage();
    if (!z) return copier(texte, "Réponse") ;
    if (z instanceof HTMLTextAreaElement || z instanceof HTMLInputElement) {
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
  // Toujours un smiley, du genre 🙂, à la fin d'une réponse qui n'en a pas.
  function smiley(t) { return /\p{Extended_Pictographic}/u.test(t) ? t : t.replace(/\s*[.!]?\s*$/, function (f) { return f.trim() === "!" ? " ! 🙂" : " 🙂"; }); }
  /* Icônes (tracés au trait, 24 × 24) pour repérer les réponses d'un coup d'œil. */
  var ICONES = {
    ok: "M20 6 9 17l-5-5", horloge: "M12 7v5l3 2|c12,12,9", croix: "m15 9-6 6M9 9l6 6|c12,12,9", baisse: "M12 5v14M5 12l7 7 7-7",
    ciseaux: "M8.1 8.1 20 20M14.5 9.5 20 4M8.1 15.9l3-3|c6,6,3|c6,18,3", cadenas: "M7 11V7a5 5 0 0 1 10 0v4|r5,11,14,10", question: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01|c12,12,9",
    main: "M7 11V6a1.5 1.5 0 0 1 3 0v5M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L3.5 15a1.5 1.5 0 0 1 2.6-1.6L7 15",
    paquet: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9", echange: "M4 9h14l-3-3M20 15H6l3 3", manette: "M6 9h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5.2 2L15 14H9l-1.8 2A3 3 0 0 1 2 14v-1a4 4 0 0 1 4-4zM8 11v4M6 13h4M16 12h.01M18 14h.01",
    photo: "M4 8h3l2-3h6l2 3h3v11H4z|c12,13,3.5", globe: "M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18|c12,12,9", video: "M15 10l5-3v10l-5-3z|r3,7,12,10",
    etiquette: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z|c8,8,1.6", camion: "M3 6h11v10H3zM14 9h4l3 3v4h-7|c7,18,2|c17,18,2", repere: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z|c12,10,2.5",
    pieces: "M4 8c0 1.7 3.6 3 8 3s8-1.3 8-3-3.6-3-8-3-8 1.3-8 3zM4 8v4c0 1.7 3.6 3 8 3s8-1.3 8-3V8M4 12v4c0 1.7 3.6 3 8 3s8-1.3 8-3v-4", envoi: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
    bouclier: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z", lien: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M4 4l16 16",
    cloche: "M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 21a1.9 1.9 0 0 0 3.4 0", calendrier: "M3 9h18M8 3v4M16 3v4M10 13l4 4M14 13l-4 4|r3,5,18,16", coeur: "M12 20s-7.5-4.6-9.2-9.3A5 5 0 0 1 12 6a5 5 0 0 1 9.2 4.7C19.5 15.4 12 20 12 20z",
    stop: "M8 3h8l5 5v8l-5 5H8l-5-5V8zM8 12h8", relance: "M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5",
  };
  function icone(nom) {
    var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), d = ICONES[nom] || ICONES.question;
    [["viewBox", "0 0 24 24"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"], ["class", "ic"]].forEach(function (x) { svg.setAttribute(x[0], x[1]); });
    d.split("|").forEach(function (part) {
      var e, v;
      if (part[0] === "c") { v = part.slice(1).split(","); e = document.createElementNS(ns, "circle"); e.setAttribute("cx", v[0]); e.setAttribute("cy", v[1]); e.setAttribute("r", v[2]); }
      else if (part[0] === "r") { v = part.slice(1).split(","); e = document.createElementNS(ns, "rect"); e.setAttribute("x", v[0]); e.setAttribute("y", v[1]); e.setAttribute("width", v[2]); e.setAttribute("height", v[3]); e.setAttribute("rx", "2"); }
      else { e = document.createElementNS(ns, "path"); e.setAttribute("d", part); }
      svg.appendChild(e);
    });
    return svg;
  }
  var ICONE_DE = {
    "Toujours disponible": "ok", "Réservé pour quelqu'un": "horloge", "Déjà vendu": "croix", "Offre vraiment trop basse": "baisse",
    "Offre un peu basse : on coupe la poire en deux": "ciseaux", "Prix ferme, poliment": "cadenas", "« C'est quoi votre dernier prix ? »": "question",
    "Accepter l'offre": "ok", "Offre sans même un bonjour": "main", "Offre groupée bien trop basse": "paquet", "Nouvelle contre-offre, la dernière": "relance",
    "Couper court poliment": "stop", "Lot de plusieurs jeux": "paquet", "Proposition d'échange": "echange", "État et fonctionnement": "manette",
    "Plus de photos": "photo", "Version et région": "globe", "Demande de test en vidéo": "video", "Pourquoi ce prix ?": "etiquette",
    "Envoi sécurisé": "camion", "Remise en main propre": "repere", "Frais de port": "pieces", "Colis envoyé": "envoi",
    "Paiement hors Le Bon Coin : refus poli": "bouclier", "Lien ou site suspect": "lien", "Acheteur qui ne répond plus": "cloche",
    "Rendez-vous manqué": "calendrier", "Merci après la vente": "coeur",
  };
  // Sens des réponses : « plus » va dans le sens de l'acheteur (vert pastel), « moins » refuse ou freine (rouge pastel).
  var SENS_DE = {
    "Toujours disponible": "plus", "Accepter l'offre": "plus", "Offre un peu basse : on coupe la poire en deux": "plus", "« C'est quoi votre dernier prix ? »": "plus",
    "Lot de plusieurs jeux": "plus", "État et fonctionnement": "plus", "Plus de photos": "plus", "Version et région": "plus", "Demande de test en vidéo": "plus",
    "Envoi sécurisé": "plus", "Remise en main propre": "plus", "Colis envoyé": "plus", "Merci après la vente": "plus",
    "Réservé pour quelqu'un": "moins", "Déjà vendu": "moins", "Offre vraiment trop basse": "moins", "Prix ferme, poliment": "moins", "Offre groupée bien trop basse": "moins",
    "Couper court poliment": "moins", "Proposition d'échange": "moins", "Paiement hors Le Bon Coin : refus poli": "moins", "Lien ou site suspect": "moins",
  };
  // Sens d'une réponse de l'IA : d'après son approche, sinon d'après ses mots (un refus classé « info » reste rouge).
  function sensIA(r) {
    if (SENS_APPROCHE[r.approche]) return SENS_APPROCHE[r.approche];
    var t = norm((r.titre || "") + " " + (r.texte || ""));
    if (/\brefus|je refuse|ne souhaite pas|pas (donner )?suite|ne me deplacerai pas|en rester la|pas possible/.test(t)) return "moins";
    if (/c'est d'accord|j'accepte|avec plaisir|toujours disponible/.test(t)) return "plus";
    return "";
  }
  var SENS_APPROCHE = { accepter: "plus", ferme: "moins", couper_court: "moins" };
  var ICONE_APPROCHE = { contre_offre: "relance", ferme: "cadenas", couper_court: "stop", accepter: "ok", info: "question" };
  // Mots importants en gras dans les aperçus (le texte inséré, lui, reste normal).
  var IMPORTANT = /(\d[\d\s]*(?:[.,]\d+)?\s?€|toujours disponible|réservé|vendu|prix ferme|dernier prix|minimum|paiement sécurisé(?: Le Bon Coin)?|pas de virement|lien(?:s)? externes?|main propre|livraison Le Bon Coin|expédié sous 48 h|d'origine, testé et fonctionnel|couper la poire en deux|geste|lot|échanger|d'autres photos|vidéo|avis|remettrai en vente|en rester là|c'est d'accord|trop loin|PAL européenne|ventes réellement conclues)/gi;
  // gras : passages clés choisis par l'IA (copiés du texte), en plus des mots importants habituels.
  function apercu(texte, gras) {
    var f = document.createDocumentFragment(), i = 0, m, re = IMPORTANT;
    var l = (gras || []).filter(function (g) { return g && texte.indexOf(g) >= 0; }).sort(function (a, b) { return b.length - a.length; });
    if (l.length) re = new RegExp(l.map(function (g) { return g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|") + "|" + IMPORTANT.source, "gi");
    re.lastIndex = 0;
    while ((m = re.exec(texte))) { f.appendChild(document.createTextNode(texte.slice(i, m.index))); f.appendChild(el("strong", { texte: m[0] })); i = m.index + m[0].length; }
    f.appendChild(document.createTextNode(texte.slice(i)));
    return f;
  }

  function reponsesUI(a) {
    var qui = acheteurLu();
    var tout = reponses(a).map(function (r) { return { g: r.g, t: r.t, m: smiley(personnaliser(r.m, qui)) }; });
    var champ = el("input", { type: "text", placeholder: "Chercher une réponse (offre, envoi, photos…)", "aria-label": "Chercher une réponse", autocomplete: "off", spellcheck: "false" });
    var zone = el("div", { class: "reps" });
    function rendre() {
      var mots = norm(champ.value).split(" ").filter(Boolean), g = "";
      zone.textContent = "";
      tout.filter(function (r) { var h = norm(r.g + " " + r.t + " " + r.m); return mots.every(function (m) { return h.indexOf(m) >= 0; }); }).forEach(function (r) {
        if (r.g !== g) { g = r.g; zone.appendChild(el("p", { class: "grp", texte: g })); }
        zone.appendChild(el("button", { class: "rep" + (SENS_DE[r.t] ? " s-" + SENS_DE[r.t] : ""), type: "button", "aria-label": r.t + " : " + r.m, onclick: function () { inserer(r.m); } }, [
          el("span", { class: "ico" }, [icone(ICONE_DE[r.t])]),
          el("span", { class: "q" }, [el("b", {}, [surligne(r.t, mots)]), el("span", { class: "ap2" }, [apercu(r.m)])]),
        ]));
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
      var f = (await fichiersPhotos(etat.choisie))[0], u = URL.createObjectURL(f);
      var a = el("a", { href: u, download: f.name }); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 10000);
      statut("Photo enregistrée dans tes téléchargements.", "ok");
    } catch (e) { statut(e.message, "bad"); }
  }

  /* ===== Lien des annonces publiées, repris tout seul dans la fiche RetroRevente =====
     - juste après un dépôt : la page de l'annonce (ou le lien de la confirmation) est associée au jeu déposé ;
     - sur « Mes annonces » : chaque annonce dont le titre correspond à un jeu sans lien est associée. */
  var AD = /\/ad\/[a-z_]+\/\d{6,}/, liesSession = {}, annoncesCache = null, minuterieLiens = null;
  function urlAnnonce(href) { try { var u = new URL(href, location.href); var m = AD.exec(u.pathname); return u.hostname === "www.leboncoin.fr" && m ? "https://www.leboncoin.fr" + m[0] : ""; } catch (e) { return ""; } }
  function lier(id, url, titre) {
    if (!id || !url || liesSession[id] === url) return;
    liesSession[id] = url;
    rrDemander({ type: "lien", annonce: id, url: url }).then(function () {
      if (hote && ouvert && ombre) statut("Lien de l'annonce « " + titre + " » enregistré dans RetroRevente.", "ok");
      (annoncesCache || []).forEach(function (a) { if (a.id === id) a.publiee = true; });
    }).catch(function () { delete liesSession[id]; });
  }
  async function liensAuto() {
    var p = location.pathname;
    var mesAnnonces = /mes-annonces|\/compte\/|\/annonces\/(en-ligne|actives)/.test(p), pageAnnonce = AD.test(p), depot = DEPOT.test(p);
    if (!mesAnnonces && !pageAnnonce && !depot) return;
    var st = {}; try { st = (await RR.storage.local.get("depot")) || {}; } catch (e) {}
    var d = st.depot && Date.now() - st.depot.at < 3 * 3600e3 ? st.depot : null;
    if (d && (pageAnnonce || depot)) {
      var url = pageAnnonce ? urlAnnonce(location.href) : "";
      if (pageAnnonce) { var t = norm(document.title + " " + ((document.querySelector("h1") || {}).textContent || "")); if (t.indexOf(norm(d.titre).slice(0, 40)) < 0) url = ""; }
      if (!url && depot) { var a = [].find.call(document.querySelectorAll("a[href*='/ad/']"), function (x) { return urlAnnonce(x.href); }); if (a) url = urlAnnonce(a.href); }
      if (url) { lier(d.id, url, d.titre); try { RR.storage.local.remove("depot"); } catch (e) {} return; }
    }
    if (!mesAnnonces) return;
    if (!annoncesCache) { try { annoncesCache = (await rrDemander({ type: "annonces" })).annonces || []; } catch (e) { return; } }
    var sans = annoncesCache.filter(function (a) { return !a.publiee && a.titre; });
    if (!sans.length) return;
    [].forEach.call(document.querySelectorAll("a[href*='/ad/']"), function (x) {
      var url = urlAnnonce(x.href); if (!url) return;
      var carte = x.closest("li, article, [data-test-id], [data-qa-id]") || x, t = norm(x.innerText + " " + (x.title || "") + " " + (x.getAttribute("aria-label") || "") + " " + carte.innerText.slice(0, 400));
      var a = sans.find(function (y) { return t.indexOf(norm(y.titre)) >= 0; });
      if (a) lier(a.id, url, a.titre);
    });
  }
  new MutationObserver(function () { clearTimeout(minuterieLiens); minuterieLiens = setTimeout(function () { liensAuto().catch(function () {}); }, 1200); })
    .observe(document.documentElement, { childList: true, subtree: true });

  /* ===== Apparition pendant le dépôt et dans la messagerie (Le Bon Coin change de page sans recharger) ===== */
  var vu = "", vuMode = "";
  function suivre() {
    if (location.pathname === vu) return;
    vu = location.pathname;
    liensAuto().catch(function () {});
    var m = mode();
    if (m && !hote) construire();
    if (hote) hote.style.display = m ? "" : "none";
    if (!m) { observateur.disconnect(); vuMode = ""; return; }
    if (m !== vuMode) {
      vuMode = m;
      if (m === "messages") { etat.choisie = null; veillerMessages(); replie(false); }   // messagerie : panneau ouvert, réponse IA proposée
      else if (!ouvert) replie(false);   // dépôt : le panneau s'ouvre et le remplissage démarre tout seul
      else { dessiner(); demarrerAuto(); }
    } else if (m === "messages" && ouvert && etat.annonces) { if (!occupe()) { etat.choisie = deviner(true) || etat.choisie || deviner(); dessiner(); } }   // autre conversation
  }
  suivre();
  setInterval(suivre, 800);
})();
