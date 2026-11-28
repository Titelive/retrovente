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
    correct: ["État satisfaisant - fonctionnel", "État satisfaisant", "Satisfaisant", "État correct"],
    pieces: ["Pour pièces", "Pour pièce", "Hors service"],
  };
  // Catégories Le Bon Coin, la plus probable en premier. Les suggestions s'affichent « Électronique › Jeux vidéo » :
  // on compare le dernier niveau.
  var CATEGORIES_LBC = { cartes: ["Collection", "Cartes à collectionner", "Jeux & Jouets"], films: ["DVD - Films", "DVD / Films", "Films", "DVD"], jeux: ["Jeux vidéo", "Consoles & Jeux vidéo"], consoles: ["Consoles", "Consoles & Jeux vidéo"], accessoires: ["Consoles", "Accessoires informatique", "Accessoires"], autres: [] };
  // Objets connectés : la catégorie dépend du type d'appareil (écouteurs et casques dans « Photo, audio & vidéo »…).
  // Autres objets : on laisse Le Bon Coin proposer la catégorie d'après le titre.
  function categoriesLbc(a) {
    if (a.categorie !== "connectes") return CATEGORIES_LBC[a.categorie] || [];
    var t = norm(a.plateforme || "");
    if (/ecouteur|casque|enceinte|camera|drone/.test(t)) return ["Photo, audio & vidéo", "Accessoires téléphone & Objets connectés", "Audio"];
    if (/tablette|liseuse/.test(t)) return ["Tablettes & Liseuses"];
    return ["Téléphones & Objets connectés", "Accessoires téléphone & Objets connectés", "Objets connectés"];
  }
  function emojiObjet(a) { var t = String(a.plateforme || "").toLowerCase(); return a.categorie === "autres" ? "🛍️" : /couteur|casque/.test(t) ? "🎧" : /montre|bracelet/.test(t) ? "⌚" : /enceinte/.test(t) ? "🔊" : /phone|tablette|liseuse/.test(t) ? "📱" : /drone|cam/.test(t) ? "🚁" : "🔌"; }
  var ETAT_TXT = { neuf: "Neuf", tres_bon: "Très bon état", bon: "Bon état", correct: "État correct", pieces: "Pour pièces" };

  var hote, ombre, etat = { annonces: null, choisie: null, photo: null, compte: {}, auto: true };
  etat.continuer = true;
  etat.prevenir = true;
  etat.son = true;   // son « à toi » : activé par défaut, réglable à part de la notification
  etat.sonChoix = RR_SON_DEFAUT;   // pièce, power-up, jingle ou muet (sons dans commun.js)
  try { RR.storage.local.get(["auto", "continuer", "prevenir", "son", "sonChoix", "sansNego", "refuserSansAvis"]).then(function (r) { if (r && r.sansNego != null) { etat.sansNego = !!r.sansNego; etat.sansNegoChoisi = true; } if (r && r.refuserSansAvis === false) etat.refuserSansAvis = false; if (r && (RR_SONS[r.sonChoix] || r.sonChoix === "muet")) etat.sonChoix = r.sonChoix; else if (r && r.son === false) etat.sonChoix = "muet"; etat.son = etat.sonChoix !== "muet"; if (etat.panneauSon) etat.panneauSon(); if (r && r.auto === false) etat.auto = false; if (r && r.continuer === false) etat.continuer = false; if (r && r.prevenir === false) etat.prevenir = false; }); } catch (e) {}

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
  // Prix : le champ de Le Bon Coin est masqué/formaté et peut ignorer une valeur posée directement (il gardait
  // son prix suggéré). On tape donc vraiment le nombre (sélection + insertText), puis on relit.
  function taper(el, v) {
    try {
      el.focus(); el.select();
      jeTape = true; var ok = document.execCommand && document.execCommand("insertText", false, v); jeTape = false;
      if (ok && chiffres(el.value) === v) { el.dispatchEvent(new Event("change", { bubbles: true })); el.dispatchEvent(new Event("blur", { bubbles: true })); return; }
    } catch (e) {}
    ecrire(el, v);
  }
  var chiffres = function (t) { return String(t || "").replace(/[.,]\d{1,2}\s*€?\s*$/, "").replace(/\D/g, ""); };
  function champPrix() { return champ("input", /prix|price/, /livraison|envoi|poids/); }
  // Le prix affiché sur Le Bon Coin diffère de celui de la fiche (et la personne ne l'a pas corrigé elle-même) ?
  function prixFaux() {
    var a = etat.choisie; if (!a || a.lot || a.prix == null || corrige[a.id + ":prix"]) return null;
    var p = champPrix(); if (!p) return null;
    var lu = chiffres(p.value); if (!lu) return null;
    return +lu === Math.round(a.prix) ? null : { champ: p, lu: +lu, voulu: Math.round(a.prix) };
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
  var jeTape = false;   // nos propres frappes (insertText) arrivent comme des événements « de confiance »
  document.addEventListener("input", function (e) {
    if (!e.target || (hote && hote.contains(e.target)) || jeTape) return;
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
  function poser(el, v, a, force, nature, ecrit) { if (!aRemplir(el, a, force, nature)) return false; var avant = dejaRempli.get(el); dejaRempli.set(el, { id: a.id, nature: nature, v: v, n: avant && avant.id === a.id ? (avant.n || 0) + 1 : 0 }); if (el.value === v) return false; (ecrit || ecrire)(el, v); return true; }
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
    var prix = champPrix();
    if (prix && a.prix != null && poser(prix, String(Math.round(a.prix)), a, force, "prix", taper)) fait.push("prix");
    if (a.etat && ETATS_LBC[a.etat]) {
      var ch = "";
      if (force || (etat.compte[k("etatcb")] || 0) < 3) {   // liste à saisie : 3 essais au plus (pas de boucle)
        ch = await choisirCombobox(/^etat\b/, ETATS_LBC[a.etat], force);
        if (ch === "ok") etat.compte[k("etatcb")] = (etat.compte[k("etatcb")] || 0) + 1;
      }
      if (!ch) ch = choisir(ETATS_LBC[a.etat], force ? null : groupeDejaChoisi);
      if (ch === "ok") fait.push("état");
      else if (!ch && (force || (etat.compte[k("etat")] || 0) < 2)) {
        etat.compte[k("etat")] = (etat.compte[k("etat")] || 0) + 1;
        if ((await ouvrirDeroulantEtat(a, force)) && choisir(ETATS_LBC[a.etat]) === "ok") fait.push("état");
      }
    }
    if (a.categorie && categoriesLbc(a).length && (force || !etat.compte[k("cat")]) && zoneCategorie()) {
      var cat = await choisirCategorie(a, force);
      if (cat) { etat.compte[k("cat")] = true; if (cat === "ok") fait.push("catégorie"); }
    }
    if (champAdresse() && (await remplirAdresse(a, force)) === "ok") fait.push("adresse");
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
      statut("Rempli automatiquement : " + fait.join(", ") + (boutons(FINAL).length ? "." : etat.continuer && boutons(/^continuer$/).length ? ". Je passe à l'écran suivant dans un instant." : ". Relis, puis clique « Continuer » sur Le Bon Coin."), "ok");
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
  function categorieVide() {
    if (!zoneCategorie()) return false;
    var r = [].filter.call(document.querySelectorAll("input[type=radio]"), function (x) { return !(hote && hote.contains(x)); });
    var choisie = r.some(function (x) { return x.checked; }) || [].some.call(document.querySelectorAll("[role=radio][aria-checked=true]"), visible);
    var dd = deroulant(CAT_DESC, CAT_LIB);
    if (!r.length && !dd) return false;   // simple rappel « Catégorie : … », rien à choisir ici
    var liste = !!(dd && valeurDe(dd));
    return !choisie && !liste;
  }
  function obligatoireVide() {
    if (categorieVide()) return true;
    // Le Bon Coin marque les champs obligatoires d'un « * » dans le libellé, sans attribut required.
    if ([].some.call(document.querySelectorAll("input[role=combobox], input[type=text], input:not([type]), textarea"), function (x) {
      return visible(x) && !(hote && hote.contains(x)) && /\*\s*$/.test(libelleDe(x)) && !String(x.value || "").trim();
    })) return true;
    return [].some.call(document.querySelectorAll("input[required], textarea[required], select[required], [aria-required=true]"), function (x) {
      return visible(x) && !(hote && hote.contains(x)) && x.type !== "file" && x.type !== "radio" && x.type !== "checkbox" && "value" in x && !String(x.value || "").trim();
    });
  }
  function erreurAffichee() {
    if ([].some.call((document.querySelector("main") || document.body).querySelectorAll("span, p, div"), function (x) { return x.childElementCount <= 1 && /^ce champ est (requis|obligatoire)/.test(norm(x.textContent)) && visible(x) && !(hote && hote.contains(x)); })) return true;
    return [].some.call(document.querySelectorAll("[role=alert], [aria-invalid=true]"), function (x) { return visible(x) && (x.getAttribute("aria-invalid") === "true" || (x.textContent || "").trim().length > 3); });
  }
  function planifierContinuer() {
    clearTimeout(minuterieSuite);
    if (!etat.auto || !etat.choisie || !DEPOT.test(location.pathname)) return;
    minuterieSuite = setTimeout(continuerSiPret, 1600 + Math.round(Math.random() * 600));
  }
  /* ===== « À toi » : son + notification quand la personne doit agir =====
     Écran final (« Publier », « Déposer sans booster mon annonce »…), champ obligatoire resté vide ou erreur affichée.
     Une seule alerte par écran. Le bouton à cliquer est mis en évidence ; l'extension ne le clique jamais et ne coche
     jamais d'option payante. */
  var FINAL = /^(publier|deposer (sans booster )?(mon |l.|votre )?annonce|valider et publier|mettre en ligne)/;
  var alertesVues = {}, titreAvant = null, clignote = null;
  // Son « à toi » : Safari bloque l'audio tant qu'on n'a pas touché la page. On garde donc un seul AudioContext,
  // débloqué au premier clic ou à la première touche (même pendant le dépôt), et un <audio> en secours.
  var audio = null, sonWav = {};
  function contexteAudio() {
    if (!audio) { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; try { audio = new C(); } catch (e) { return null; } }
    return audio;
  }
  function debloquerSon(e) {
    if (e && !e.isTrusted) return;
    var c = contexteAudio(); if (!c) return;
    try { if (c.state !== "running") c.resume(); var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch (x) {}
    try { var a = new Audio(wav()); a.volume = 0; a.play().then(function () { a.pause(); }, function () {}); } catch (x) {}
  }
  ["pointerdown", "keydown", "touchstart"].forEach(function (t) { window.addEventListener(t, debloquerSon, { capture: true, passive: true }); });
  function choixSon(cle) { return RR_SONS[cle] ? cle : (RR_SONS[etat.sonChoix] ? etat.sonChoix : RR_SON_DEFAUT); }
  function wav(cle) { cle = choixSon(cle); return sonWav[cle] || (sonWav[cle] = "data:audio/wav;base64," + rrSonWav64(cle)); }
  function jouer(c, cle) {
    var x = rrRendreSon(choixSon(cle)), b = c.createBuffer(1, x.length, RR_TAUX), s = c.createBufferSource();
    b.getChannelData(0).set(x); s.buffer = b; s.connect(c.destination); s.start(c.currentTime + 0.02);
  }
  // 1. Son joué par l'app Mac (NSSound, via le message natif de Safari) : ne dépend pas des règles audio de la page.
  // 2. Sinon (Chrome, Firefox, ou app trop ancienne) : son web.
  function sonWeb(cle) {
    var c = contexteAudio(), secours = function () { try { var a = new Audio(wav(cle)); a.volume = 0.8; a.play().then(function () { etat.dernierSon = "web <audio> ok"; }, function (e) { etat.dernierSon = "web <audio> bloqué (" + (e && e.name) + ")"; }); } catch (e) { etat.dernierSon = "web impossible"; } };
    if (!c) return secours();
    var fait = false, go = function () { if (fait) return; fait = true; if (c.state === "running") { jouer(c, cle); etat.dernierSon = "web AudioContext ok"; } else secours(); };
    if (c.state === "running") return go();
    try { c.resume().then(go, go); } catch (e) {}
    setTimeout(go, 400);   // Safari peut laisser resume() en attente sans geste : on passe au secours
  }
  // cle : le son à jouer (aperçu dans le panneau), sinon celui choisi. « Muet » : rien.
  function sonner(cle) {
    cle = cle || etat.sonChoix; if (cle === "muet") { etat.dernierSon = "muet"; return; }
    cle = choixSon(cle);
    var fini = false, web = function (pourquoi) { if (fini) return; fini = true; etat.sonNatif = pourquoi; sonWeb(cle); };
    var t = setTimeout(function () { web("délai dépassé"); }, 1500);
    rrDemander({ type: "son", wav: rrSonWav64(cle) }).then(function (r) {
      clearTimeout(t); if (fini) return;
      if (r && r.ok) { fini = true; etat.sonNatif = "ok"; etat.dernierSon = "app Mac (" + (r.via || "natif") + ")"; }
      else web((r && (r.erreur || r.error)) || "indisponible");
    }, function (e) { clearTimeout(t); web((e && e.message) || "erreur"); });

  }
  function clignoterTitre(txt) {
    if (clignote || document.hasFocus()) return;
    titreAvant = document.title; var on = false;
    clignote = setInterval(function () { document.title = (on = !on) ? "🔔 " + txt : titreAvant; }, 1000);
    var stop = function () { clearInterval(clignote); clignote = null; document.title = titreAvant; window.removeEventListener("focus", stop); };
    window.addEventListener("focus", stop);
  }
  function mettreEnAvant(b) {
    if (!b || b.__rrVu) return; b.__rrVu = true;
    try { b.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {}
    b.style.outline = "3px solid #D4F57A"; b.style.outlineOffset = "4px";
    try { b.animate([{ boxShadow: "0 0 0 0 rgba(212,245,122,.9)" }, { boxShadow: "0 0 0 14px rgba(212,245,122,0)" }], { duration: 1200, iterations: 6 }); } catch (e) {}
  }
  function aToi(cle, titre, texte, bouton) {
    mettreEnAvant(bouton);
    if (alertesVues[cle]) return; alertesVues[cle] = true;
    if (etat.son) sonner();
    if (!etat.prevenir) return;
    clignoterTitre(titre);
    rrDemander({ type: "alerte", titre: titre, texte: texte }).then(function (r) {
      if (r && r.ok) return;
      // Safari : notification de la page, seulement si la personne l'a autorisée depuis le panneau.
      if (window.Notification && Notification.permission === "granted" && !document.hasFocus()) { try { new Notification(titre, { body: texte, tag: "retrorevente", silent: true }); } catch (e) {} }
    }).catch(function () {});
  }
  function optionPayanteCochee() {
    return [].some.call(document.querySelectorAll("input[type=checkbox]:checked, [role=checkbox][aria-checked=true]"), function (x) {
      if (hote && hote.contains(x)) return false;
      var z = x.closest("label") || x.parentElement; for (var n = 0; z && n < 3 && !/€/.test(z.textContent); n++) z = z.parentElement;
      return !!(z && /€/.test(z.textContent));
    });
  }
  function verifierFinal() {
    var f = boutons(FINAL)[0];
    if (!f) return false;
    var nom = (f.textContent || f.value || "Publier").trim().replace(/\s+/g, " ");
    var payant = optionPayanteCochee();
    statut("À toi : relis l'annonce, puis clique « " + nom + " » toi-même. " + (payant ? "Attention : une option payante est cochée : décoche-la si tu n'en veux pas." : "Aucune option payante n'est cochée."), payant ? "bad" : "toi");
    aToi("final:" + cleEcran(), "À toi de finaliser l'annonce", "Clique « " + nom + " » pour publier" + (etat.choisie ? " « " + etat.choisie.titre + " »" : "") + ".", f);
    return true;
  }
  // Bloqué (champ vide, erreur) : on prévient si c'est encore le cas 4 s plus tard (le temps que tout se remplisse).
  function bloque(cle, texte) {
    statut(texte, "bad");
    clearTimeout(etat.minBloque);
    etat.minBloque = setTimeout(function () {
      if (cleEcran() !== cle || ecransPasses[cle] || enCours) return;
      if (obligatoireVide() || erreurAffichee()) aToi("bloque:" + cle, "RetroRevente a besoin de toi", texte);
    }, 4000);
  }
  /* ===== Après « Déposer sans booster » : retour sur l'onglet RetroRevente, avec des confettis =====
     Seul un vrai clic de la personne sur le bouton final compte. L'annonce est tenue pour envoyée quand le bouton a
     disparu sans erreur affichée (même après un changement de page : le suivi est gardé une minute). */
  document.addEventListener("click", function (e) {
    if (!e.isTrusted || !DEPOT.test(location.pathname)) return;
    var b = e.target && e.target.closest && e.target.closest("button, a, [role=button], input[type=submit]");
    if (!b || (hote && hote.contains(b)) || !FINAL.test(norm(b.textContent || b.value || ""))) return;
    var a = etat.choisie; if (!a || a.lot || a.externe) return;
    var p = { id: a.id, titre: a.nom || a.titre, at: Date.now() };
    depotRecent = true;
    try { RR.storage.local.set({ publication: p }); } catch (x) {}
    suivrePublication(p);
  }, true);
  var suiviPub = null;
  // Page « Votre annonce sera en ligne dans quelques secondes » (boutons « Déposer une nouvelle annonce » et
  // « Voir mes annonces ») : la publication est faite, même si on n'a pas vu le clic.
  function confirmationDepot() {
    var t = norm(((document.querySelector("main") || document.body).innerText || "").slice(0, 4000));
    if (/votre annonce (sera en ligne|sera visible|est en ligne|a bien ete (envoyee|deposee|publiee|enregistree))/.test(t)) return true;
    return !!(boutons(/^voir mes annonces/).length && boutons(/^deposer une nouvelle annonce/).length);
  }
  // Seulement après un dépôt commencé avec RetroRevente (inutile de lire la page sinon).
  var confirmationFetee = false, depotRecent = false;
  try { RR.storage.local.get(["publication", "depot"]).then(function (r) { r = r || {}; depotRecent = !!((r.publication && Date.now() - r.publication.at < 10 * 60000) || (r.depot && !r.depot.fete && Date.now() - r.depot.at < 3 * 3600e3)); }); } catch (e) {}
  async function guetterConfirmation() {
    if (!depotRecent || confirmationFetee || !confirmationDepot()) return;
    confirmationFetee = true;
    var st = {}; try { st = (await RR.storage.local.get(["publication", "depot"])) || {}; } catch (e) {}
    var p = st.publication && Date.now() - st.publication.at < 10 * 60000 ? st.publication : null;
    var d = st.depot && !st.depot.fete && Date.now() - st.depot.at < 3 * 3600e3 ? st.depot : null;
    if (!p && d) { p = { id: d.id, titre: d.titre, at: Date.now() }; try { await RR.storage.local.set({ publication: p }); } catch (e) {} }
    if (!p) return;
    if (d) { try { await RR.storage.local.set({ depot: Object.assign({}, d, { fete: true }) }); } catch (e) {} }
    clearInterval(suiviPub); publiee(p);
  }
  function suivrePublication(p) {
    clearInterval(suiviPub);
    suiviPub = setInterval(function () {
      if (Date.now() - p.at > 60000) { clearInterval(suiviPub); return; }
      if (confirmationDepot()) { clearInterval(suiviPub); publiee(p); return; }
      if (boutons(FINAL).length || erreurAffichee()) return;
      clearInterval(suiviPub); publiee(p);
    }, 1000);
  }
  async function publiee(p) {
    try { var st = (await RR.storage.local.get("publication")) || {}; if (!st.publication || st.publication.at !== p.at) return; await RR.storage.local.remove("publication"); } catch (x) {}
    var lien = [].map.call(document.querySelectorAll("a[href*='/ad/']"), function (x) { return urlAnnonce(x.href); }).filter(Boolean)[0] || "";
    statut("Annonce publiée ! Je ferme Le Bon Coin et te ramène sur RetroRevente.", "ok");
    if (lien) lier(p.id, lien, p.titre);
    // Son de confettis (sauf si le son est réglé sur « Muet ») et notification ; RetroRevente fait pleuvoir les confettis.
    if (etat.sonChoix !== "muet") sonner("confettis");
    rrDemander({ type: "alerte", titre: "Annonce publiée !", texte: "« " + (p.titre || "Ton annonce") + " » est en ligne sur Le Bon Coin." }).catch(function () {});
    // L'arrière-plan te remet sur RetroRevente puis ferme cet onglet, le temps que le son se termine.
    rrDemander({ type: "publiee", id: p.id, titre: p.titre, url: lien, fermer: true }).catch(function () {});
  }
  try { RR.storage.local.get("publication").then(function (r) { if (r && r.publication && Date.now() - r.publication.at < 60000) suivrePublication(r.publication); }); } catch (e) {}
  function continuerSiPret() {
    if (!etat.auto || !etat.choisie || enCours) return;
    if (verifierFinal()) return;
    if (!etat.continuer) return;
    var cle = cleEcran();
    if (ecransPasses[cle]) return;
    var b = boutons(/^continuer$/)[0];
    if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return;
    var attente = Math.max(derniereAction + 4000, (etat.photosA || 0) + 4000) - Date.now();
    if (attente > 0 || [].some.call(document.querySelectorAll("[role=progressbar], [aria-busy=true]"), visible)) { minuterieSuite = setTimeout(continuerSiPret, Math.max(attente, 800)); return; }
    // Jamais « Continuer » avec un prix différent de la fiche : on retape deux fois, puis on s'arrête et on prévient.
    var pf = prixFaux();
    if (pf) {
      var kp = etat.choisie.id + ":prixok"; etat.compte[kp] = (etat.compte[kp] || 0) + 1;
      if (etat.compte[kp] <= 2) { taper(pf.champ, String(pf.voulu)); minuterieSuite = setTimeout(continuerSiPret, 1200); return; }
      var tx = "Le prix sur Le Bon Coin (" + pf.lu + " €) n'est pas celui de ta fiche (" + pf.voulu + " €). Corrige-le, puis clique « Continuer ».";
      statut(tx, "bad"); aToi("prix:" + cle, "Prix à vérifier", tx, pf.champ); return;
    }
    var ca = champAdresse();
    if (ca && !String(ca.value || "").trim()) {
      var tA = etat.adresse ? "Le Bon Coin n'a pas reconnu l'adresse « " + etat.adresse + " ». Choisis une suggestion dans le champ Adresse, puis clique « Continuer »."
                            : "Le Bon Coin demande où se trouve le bien. Tape ta ville ou ton adresse, choisis une suggestion, puis clique « Continuer ».";
      statut(tA, "bad"); aToi("adresse:" + cle, "Adresse du bien", tA, ca); return;
    }
    if (obligatoireVide()) { bloque(cle, "Il reste un champ obligatoire à remplir sur cet écran, puis clique « Continuer »."); return; }
    if (erreurAffichee()) { bloque(cle, "Le Bon Coin signale un champ à corriger : corrige-le, puis clique « Continuer »."); return; }
    ecransPasses[cle] = true;
    b.click();
  }
  function demarrerAuto() {
    observateur.disconnect();
    // Mémorise le jeu en cours de dépôt : son lien sera repris tout seul une fois l'annonce publiée.
    if (etat.choisie && !etat.choisie.lot) { depotRecent = true; try { RR.storage.local.set({ depot: { id: etat.choisie.id, titre: etat.choisie.titre, at: Date.now() } }); } catch (e) {} }
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
  /* Liste à saisie (Le Bon Coin : <input role=combobox> + bouton « Ouvrir la liste » + <ul role=listbox> dont les
     options restent dans la page, cachées). On ouvre la liste comme un clic de la personne, puis on clique l'option. */
  // Le libellé visible d'un champ (« État * »), sans son id ni son texte d'aide.
  function libelleDe(x) {
    var lb = x.getAttribute("aria-labelledby");
    if (lb) { var t = lb.split(/\s+/).map(function (id) { var e = document.getElementById(id); return e ? e.textContent : ""; }).join(" "); if (norm(t)) return norm(t); }
    if (x.labels && x.labels.length) return norm(x.labels[0].textContent);
    return norm(x.getAttribute("aria-label") || "");
  }
  function cliquer(x) {
    ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach(function (t) { x.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); });
    x.click();
  }
  function texteOption(o) {
    var lb = o.getAttribute("aria-labelledby"), x = lb && document.getElementById(lb.split(/\s+/)[0]);
    return norm((x || o).textContent);
  }
  async function choisirCombobox(reDesc, libelles, force) {
    var champ = [].find.call(document.querySelectorAll("input[role=combobox], [role=combobox]"), function (x) { return !(hote && hote.contains(x)) && visible(x) && reDesc.test(libelleDe(x)); });
    if (!champ) return "";
    var vu = norm(champ.value != null ? champ.value : champ.textContent);
    if (!force && vu && !/^choisi/.test(vu)) return "deja";   // déjà choisi par la personne (ou par Le Bon Coin)
    var id = champ.id, liste = function () {
      return document.getElementById(champ.getAttribute("aria-controls") || "") || (id && document.getElementById(id + "-menu")) ||
        (champ.getAttribute("aria-labelledby") && document.querySelector("[role=listbox][aria-labelledby='" + champ.getAttribute("aria-labelledby").split(/\s+/)[0] + "']"));
    };
    var bouton = (id && document.getElementById(id + "-toggle-button")) || [].find.call((champ.closest("div") && champ.closest("div").parentElement || document).querySelectorAll("button"), function (b) { return /ouvrir|open/.test(norm(b.getAttribute("aria-label"))); });
    if (champ.getAttribute("aria-expanded") !== "true") { champ.focus(); cliquer(bouton || champ); await attendre(300); }
    var cibles = libelles.map(norm);
    for (var essai = 0; essai < 4; essai++) {
      var l = liste(), opts = l ? [].slice.call(l.querySelectorAll("[role=option]")) : [];
      var o = null;
      for (var i = 0; i < cibles.length && !o; i++) o = opts.find(function (x) { return texteOption(x) === cibles[i]; }) || opts.find(function (x) { return texteOption(x).indexOf(cibles[i]) === 0; });
      if (o) {
        if (o.getAttribute("aria-selected") === "true" && vu) return "deja";
        cliquer(o); await attendre(200);
        return "ok";
      }
      if (opts.length) return "";        // liste ouverte, mais aucune option ne convient
      await attendre(250);
    }
    return "";
  }
  /* ===== Remise du bien : « À quelle adresse se trouve le bien ? » =====
     Le Bon Coin n'accepte qu'une adresse choisie dans ses suggestions. L'adresse (ou la ville) enregistrée une fois
     dans RetroRevente est tapée, puis la suggestion qui lui correspond le mieux est choisie. */
  function champAdresse() {
    return [].find.call(document.querySelectorAll("input"), function (x) {
      if (!visible(x) || x.disabled || x.readOnly || /^(hidden|file|radio|checkbox|password|email)$/.test(x.type) || x.closest("header, nav, footer")) return false;
      var d = description(x) + " " + libelleDe(x);
      return /adresse|localisation|ville ou code postal/.test(d) && !/mail|telephone/.test(d);
    }) || null;
  }
  async function lireAdresse() {
    if (etat.adresseCompte) return (etat.adresse = etat.adresseCompte);
    try { var r = await RR.storage.local.get(["adresse"]); if (r && r.adresse) etat.adresse = String(r.adresse); } catch (e) {}
    return etat.adresse || "";
  }
  async function remplirAdresse(a, force) {
    var x = champAdresse(); if (!x) return "";
    if (!force && String(x.value || "").trim()) return "deja";
    var adr = await lireAdresse(); if (!adr) return "manque";
    var k = a.id + ":adresse"; if (!force && (etat.compte[k] || 0) >= 3) return ""; etat.compte[k] = (etat.compte[k] || 0) + 1;
    x.focus();
    var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    jeTape = true;
    try { x.select(); if (!(document.execCommand && document.execCommand("insertText", false, adr)) || x.value !== adr) { set.call(x, adr); x.dispatchEvent(new Event("input", { bubbles: true })); } } catch (e) { set.call(x, adr); x.dispatchEvent(new Event("input", { bubbles: true })); }
    jeTape = false;
    var mots = norm(adr).split(/[\s,]+/).filter(function (m) { return m.length > 1; });
    for (var i = 0; i < 16; i++) {
      await attendre(300);
      var opts = [].filter.call(document.querySelectorAll("[role=option], [role=listbox] li, [data-qa-id*=suggestion], [data-test-id*=suggestion]"), function (o) { return visible(o) && norm(o.textContent).length > 1; });
      if (!opts.length) continue;
      var score = function (o) { var t = norm(o.textContent); return mots.filter(function (m) { return t.indexOf(m) >= 0; }).length; };
      var o = opts.slice().sort(function (p, q) { return score(q) - score(p); })[0];
      cliquer(o); await attendre(400);
      return "ok";
    }
    return "";
  }
  // Adresse choisie par la personne dans les suggestions : gardée pour les prochains dépôts.
  document.addEventListener("click", function (e) {
    if (!e.isTrusted || !DEPOT.test(location.pathname) || !e.target.closest || !e.target.closest("[role=option], [role=listbox] li")) return;
    setTimeout(function () {
      var x = champAdresse(), v = x && String(x.value || "").trim();
      if (v && v.length > 3 && v !== etat.adresse) { etat.adresse = v; try { RR.storage.local.set({ adresse: v }); } catch (er) {} }
    }, 500);
  }, true);
  function ouvrirDeroulantEtat(a, force) { return ouvrirDeroulant(/^etat\b/, /^etat\s*\*?$/, force); }
  // Liste déroulante maison (pas un <select>) repérée par son libellé : on l'ouvre comme un clic de la personne.
  function deroulant(reDesc, reLibelle) {
    var cand = [].filter.call(document.querySelectorAll("[role=combobox], [aria-haspopup], select, button, input[readonly], div[tabindex]"), function (x) { return visible(x) && !(hote && hote.contains(x)) && !/^(publier|continuer|valider|suivant|deposer)/.test(norm(x.textContent))
      // une vraie liste : pas un bloc qui contient des boutons radio ou tout un formulaire
      && (x.textContent || "").length < 80 && !x.querySelector("input[type=radio], [role=radio], input:not([type=hidden]):not([readonly]), textarea"); });
    return cand.find(function (el) {
      if (reDesc.test(description(el)) || reDesc.test(libelleDe(el))) return true;
      for (var p = el.parentElement, n = 0; p && n < 4; p = p.parentElement, n++) {
        var lab = [].find.call(p.querySelectorAll("label, legend, p, span, div"), function (x) { return (x.textContent || "").length < 60 && !el.contains(x) && !x.contains(el) && reLibelle.test(norm(x.textContent)); });
        if (lab) return lab.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
      }
      return false;
    }) || null;
  }
  // Valeur affichée d'une liste déroulante (« » ou « Choisissez » = rien de choisi).
  function valeurDe(d) { var v = d.tagName === "SELECT" ? (d.selectedIndex > 0 ? d.options[d.selectedIndex].textContent : "") : (d.value || d.textContent || ""); v = norm(v); return /^choisi/.test(v) ? "" : v; }
  async function ouvrirDeroulant(reDesc, reLibelle, force) {
    var d = deroulant(reDesc, reLibelle);
    if (!d || d.tagName === "SELECT") return false;
    if (!force && valeurDe(d)) return false;   // déjà choisi
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (t) { d.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); });
    await attendre(350);
    return true;
  }

  /* ===== Diagnostic =====
     Résumé de la structure de l'écran (balises, rôles, noms, libellés courts), sans les valeurs des champs : la
     personne le colle dans la discussion quand un écran n'est pas reconnu. */
  function diagnostic() {
    var lignes = ["RetroRevente " + RR.runtime.getManifest().version + " · " + location.pathname + " · " + navigator.userAgent.replace(/.*(Version\/[\d.]+|Chrome\/[\d.]+|Firefox\/[\d.]+).*/, "$1"),
      "son=" + etat.sonChoix + " prevenir=" + etat.prevenir + " dernierSon=" + (etat.dernierSon || "-") + " natif=" + (etat.sonNatif || "-") + " audio=" + (audio ? audio.state : "-") + " notif=" + (window.Notification ? Notification.permission : "-"),
      "zoneCategorie=" + zoneCategorie() + " categorieVide=" + categorieVide() + " choisie=" + !!etat.choisie + " cat=" + (etat.choisie && etat.choisie.categorie)];
    var main = document.querySelector("main") || document.body;
    (function parcours(n, prof) {
      if (lignes.length > 260 || prof > 22 || (hote && n === hote)) return;
      var tag = n.tagName.toLowerCase();
      if (/^(script|style|svg|path|noscript|link|meta)$/.test(tag)) { if (tag === "svg") lignes.push(" ".repeat(prof) + "<svg>"); return; }
      var a = [];
      ["role", "type", "name", "id", "for", "data-qa-id", "data-test-id", "data-testid", "aria-label", "aria-checked", "aria-selected", "aria-expanded", "aria-haspopup", "aria-labelledby", "tabindex"].forEach(function (k) { var v = n.getAttribute(k); if (v != null) a.push(k + "=" + String(v).slice(0, 40)); });
      if (n.matches("input[type=radio], input[type=checkbox]")) a.push("checked=" + n.checked);
      var cls = (n.getAttribute("class") || "").split(/\s+/)[0]; if (cls) a.push("." + cls.slice(0, 24));
      var txt = [].filter.call(n.childNodes, function (c) { return c.nodeType === 3; }).map(function (c) { return c.textContent.trim(); }).join(" ").trim();
      if (n.matches("input, textarea")) txt = "";   // jamais ce que la personne a tapé
      var vis = visible(n) ? "" : " (caché)";
      if (a.length || txt || n.children.length) lignes.push(" ".repeat(prof) + "<" + tag + (a.length ? " " + a.join(" ") : "") + ">" + vis + (txt ? " « " + txt.slice(0, 50) + " »" : ""));
      [].forEach.call(n.children, function (c) { parcours(c, prof + 1); });
    })(main, 0);
    return lignes.join("\n");
  }
  function copierDiagnostic() {
    var t = diagnostic();
    var fini = function () { statut("Diagnostic copié : colle-le dans la discussion (⌘V).", "ok"); };
    try { navigator.clipboard.writeText(t).then(fini, function () { secours(); }); } catch (e) { secours(); }
    function secours() { var z = document.createElement("textarea"); z.value = t; z.style.position = "fixed"; z.style.opacity = "0"; document.body.appendChild(z); z.select(); try { document.execCommand("copy"); fini(); } catch (e) { statut("Copie impossible.", "bad"); } z.remove(); }
  }

  /* ===== Catégorie =====
     Le Bon Coin propose quelques catégories d'après le titre (« Électronique › Jeux vidéo », boutons radio), puis
     « Ou choisissez une autre catégorie » (liste déroulante). On coche la bonne suggestion ; sinon on ouvre la liste
     et on y choisit la catégorie. Un choix déjà fait par la personne est respecté. */
  var CAT_DESC = /categorie|category/, CAT_LIB = /^(ou )?(choisissez )?(une |la )?autre categorie\s*\*?$|^categorie\s*\*?$/;
  function feuille(t) { var x = String(t || "").split(/[›>»\/]/); return norm(x[x.length - 1]); }
  function zoneCategorie() {
    return [].some.call((document.querySelector("main") || document.body).querySelectorAll("h1, h2, h3, h4, h5, legend, label, p, span, div, strong, b"), function (x) {
      return (x.textContent || "").length < 60 && !(hote && hote.contains(x)) && /^(ou )?(choisissez )?(une |la )?(autre )?categorie\b/.test(norm(x.textContent)) && visible(x);
    });
  }
  function optionsCategorie() {
    return [].filter.call(document.querySelectorAll("label, [role=radio], [role=option], [role=menuitemradio], li, button"), function (el) {
      var t = el.textContent || "";
      return t.length < 90 && visible(el) && !el.closest("a[href], nav, header, footer") && !/^(publier|continuer|valider|suivant|deposer)/.test(norm(t));
    });
  }
  // « Électronique › Jeux vidéo » : sur Le Bon Coin le chevron est une icône, le texte devient « Électronique Jeux vidéo »
  // (voire « ÉlectroniqueJeux vidéo ») et le dernier niveau est en gras. On accepte le dernier niveau séparé, un
  // élément enfant qui porte exactement le libellé, ou un texte qui finit par le libellé.
  function correspond(x, cible) {
    if (feuille(x.textContent) === cible) return true;
    if ([].some.call(x.querySelectorAll("b, strong, span, p, div"), function (y) { return y.childElementCount === 0 && norm(y.textContent) === cible; })) return true;
    var t = norm(x.textContent);
    return t.length > cible.length && t.slice(-cible.length) === cible && t.length - cible.length < 30;
  }
  // Ligne qui porte le texte d'un bouton radio : son libellé, sinon le plus petit parent qui a du texte.
  function ligneRadio(r) {
    if (r.labels && r.labels.length && norm(r.labels[0].textContent)) return r.labels[0];
    var lb = r.getAttribute("aria-labelledby"), x = lb && document.getElementById(lb.split(/\s+/)[0]);
    if (x && norm(x.textContent)) return x;
    for (var p = r.parentElement, n = 0; p && n < 4; p = p.parentElement, n++) {
      var t = norm(p.textContent);
      if (t) return t.length < 90 ? p : null;
    }
    return null;
  }
  function cocherRadio(cibles, garde) {
    var radios = [].filter.call(document.querySelectorAll("input[type=radio], [role=radio]"), function (r) { return !(hote && hote.contains(r)) && !r.disabled && !r.closest("nav, header, footer"); });
    for (var i = 0; i < cibles.length; i++) {
      for (var j = 0; j < radios.length; j++) {
        var r = radios[j], ligne = ligneRadio(r);
        if (!ligne || !(visible(ligne) || visible(r)) || !correspond(ligne, cibles[i])) continue;
        if (r.checked || r.getAttribute("aria-checked") === "true") return "deja";
        if (garde && garde(r)) return "deja";
        if (visible(r)) r.click(); else ligne.click();
        if (r.matches("input") && !r.checked) r.click();
        return "ok";
      }
    }
    return "";
  }
  function cocherCategorie(cibles, garde) {
    var parRadio = cocherRadio(cibles, garde);
    if (parRadio) return parRadio;
    var cand = optionsCategorie();
    for (var i = 0; i < cibles.length; i++) {
      // Le plus petit élément qui porte le libellé (le label plutôt que la ligne entière).
      var el = cand.filter(function (x) { return correspond(x, cibles[i]); }).sort(function (x, y) { return x.textContent.length - y.textContent.length || (x.contains(y) ? 1 : -1); })[0];
      if (!el) continue;
      var radio = el.matches("label") ? (el.control || el.querySelector("input")) : el.querySelector("input[type=radio]");
      if ((radio && radio.checked) || el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true") return "deja";
      if (garde && garde(radio || el)) return "deja";
      (radio && !el.matches("label") ? radio : el).click();
      return "ok";
    }
    return "";
  }
  async function choisirCategorie(a, force) {
    var libs = categoriesLbc(a), cibles = libs.map(norm), k = a.id + ":catliste";
    var dd = deroulant(CAT_DESC, CAT_LIB);
    if (!force && dd && valeurDe(dd)) return "deja";   // la personne a déjà pris une catégorie dans la liste
    var r = cocherCategorie(cibles, force ? null : groupeDejaChoisi);
    if (r) return r;
    var cb = (force || (etat.compte[k + "cb"] || 0) < 3) ? await choisirCombobox(/categorie/, libs, force) : "";
    if (cb === "ok") etat.compte[k + "cb"] = (etat.compte[k + "cb"] || 0) + 1;
    if (cb) return cb;
    var c = choisir(libs);            // vrai <select> ou libellé exact
    if (c) return c;
    // Pas de suggestion qui convient : on attend un peu (elles arrivent après le titre), puis on ouvre la liste.
    var vue = etat.compte[a.id + ":catvue"] = etat.compte[a.id + ":catvue"] || Date.now();
    if (!force && Date.now() - vue < 2500) {   // on repasse une fois le délai écoulé, même si la page ne bouge plus
      clearTimeout(etat.catMin); etat.catMin = setTimeout(function () { if (!enCours) { enCours = true; remplir(false).catch(function () {}).then(function () { enCours = false; planifierContinuer(); }); } }, 2700);
      return "";
    }
    if (!force && (etat.compte[k] || 0) >= 2) return "";
    etat.compte[k] = (etat.compte[k] || 0) + 1;
    if (!(await ouvrirDeroulant(CAT_DESC, CAT_LIB, true))) return "";
    for (var i = 0; i < 6; i++) {        // la liste peut se charger en deux temps
      r = cocherCategorie(cibles);
      if (r) return r;
      await attendre(250);
    }
    return "";
  }

  /* ===== Panneau (charte RetroRevente : vert anis, noir doux, Rubik + Figtree) ===== */
  var MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var RACCOURCI = MAC ? "⌘K" : "Ctrl K";
  // Logo du site (police Plus Jakarta Sans, en tracés SVG) : la couleur suit le thème via currentColor.
  // Icônes pixel (9 × 9) des sons « à toi » : pièce, étoile, note, haut-parleur coupé.
  var ICONES_SON = (function () {
    var G = {
      piece:   ["...XXX...", "..XXXXX..", ".XXX.XXX.", ".XXX.XXX.", ".XXX.XXX.", ".XXX.XXX.", ".XXX.XXX.", "..XXXXX..", "...XXX..."],
      powerup: ["....X....", "...XXX...", "...XXX...", "XXXXXXXXX", ".XXXXXXX.", "..XXXXX..", "..XXXXX..", ".XXX.XXX.", ".X.....X."],
      jingle:  ["...XXXXXX", "...XXXXXX", "...X....X", "...X....X", "...X....X", ".XXX..XXX", "XXXX.XXXX", "XXXX.XXXX", ".XX...XX."],
      muet:    ["...X.....", "..XX.....", "XXXX.X..X", "XXXX..XX.", "XXXX..XX.", "XXXX.X..X", "..XX.....", "...X.....", "........."],
    }, r = {};
    Object.keys(G).forEach(function (k) {
      var d = "";
      G[k].forEach(function (l, y) { l.replace(/X+/g, function (m, x) { d += "M" + x + " " + y + "h" + m.length + "v1h-" + m.length + "z"; return m; }); });
      r[k] = '<svg viewBox="0 0 9 9" width="20" height="20" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><path fill="currentColor" d="' + d + '"/></svg>';
    });
    return r;
  })();
  var LOGO = RR_LOGO;
  function marque() { var b = el("b", { class: "marque", role: "img", "aria-label": "RetroRevente" }); b.innerHTML = LOGO; return b; }
  var CSS = ":host{all:initial}*{box-sizing:border-box}[hidden]{display:none!important}" +
    ".b{--anis:#D4F57A;--anis-p:#F1FCD0;--vert-p:#E9F7EC;--vert-t:#CBEBD3;--vert-f:#14401F;--rouge-p:#FCEDEA;--rouge-t:#F6D3CB;--rouge-f:#6A1E12;--nuit:#1A1A1A;--carte:#fff;--papier:#F6F6F1;--encre:#1A1A1A;--gris:#62625C;--gris-c:#A3A39B;--trait:#E6E6DE;--titre:'RR Rubik',ui-rounded,'Arial Rounded MT Bold',system-ui,sans-serif;--texte:'RR Figtree','Avenir Next',ui-sans-serif,system-ui,sans-serif;--ease:cubic-bezier(.2,.8,.2,1);" +
      "position:fixed;right:18px;bottom:18px;z-index:2147483646;font:500 14px/1.45 var(--texte);color:var(--encre);-webkit-font-smoothing:antialiased}" +
    "@media (prefers-color-scheme:dark){.b{--carte:#1E1E1E;--papier:#262626;--encre:#F4F4EE;--gris:#A6A69E;--gris-c:#7A7A72;--trait:#333;--anis-p:#2A3414;--vert-p:#1C2E21;--vert-t:#2D4A35;--vert-f:#BFE8C8;--rouge-p:#33201D;--rouge-t:#553029;--rouge-f:#F6C4B9}}" +
    "button,input{font:inherit;color:inherit}" +
    ".rond{position:relative;width:58px;height:58px;padding:0;border-radius:15px;border:0;background:transparent;cursor:pointer;box-shadow:0 10px 28px rgba(0,0,0,.28);transition:transform .25s var(--ease)}" +
    ".rond img{display:block;width:58px;height:58px;border-radius:15px}" +
    ".rond:hover{transform:translateY(-2px) rotate(-4deg)}" +
    ".rond kbd{position:absolute;right:50%;bottom:calc(100% + 8px);transform:translateX(50%);white-space:nowrap;font:600 11px/1 var(--texte);color:var(--encre);background:var(--carte);border:1px solid var(--trait);border-radius:7px;padding:5px 7px;opacity:0;pointer-events:none;transition:opacity .2s}" +
    ".rond:hover kbd,.rond:focus-visible kbd{opacity:1}" +
    ".p{position:relative;width:360px;max-width:calc(100vw - 36px);max-height:calc(100vh - 36px);overflow:auto;background:var(--carte);border-radius:26px;box-shadow:0 18px 50px rgba(0,0,0,.3);padding:18px;display:flex;flex-direction:column;gap:12px;animation:monte .3s var(--ease)}" +
    "@keyframes monte{from{opacity:0;transform:translateY(10px) scale(.98)}}" +
    ".t{display:flex;align-items:center;justify-content:space-between;gap:8px}.t b{font:700 17px/1 var(--titre);letter-spacing:-.3px;display:flex;align-items:center;gap:8px}" +
    ".marque{display:flex;color:var(--encre)}.marque svg{display:block;height:22px;width:auto}" +
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
    ".s{font-size:13px;color:var(--gris);background:var(--papier);border-radius:12px;padding:9px 11px}.s.ok{background:var(--anis-p);color:var(--encre)}.s.bad{background:#FDE8E4;color:#8A1F11}.s.toi{background:var(--anis);color:#1A1A1A;font-weight:700;animation:toi 1.2s ease-in-out 3}@keyframes toi{50%{transform:scale(1.02)}}" +
    ".n{font-size:11.5px;color:var(--gris-c)}" +
    ".pile{display:flex;flex-direction:column;gap:12px}.c{display:flex;flex-direction:column;gap:5px;font-size:13px}.c .l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--gris)}.c .l b{color:var(--encre);font-weight:600}" +
    ".actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}" +
    ".encart{margin:0;background:var(--papier);border:1px solid var(--trait);border-radius:18px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}" +
    ".encart-t{margin:0;font:700 11px/1 var(--texte);letter-spacing:.07em;text-transform:uppercase;color:var(--gris)}" +
    ".encart .c{gap:6px}" +
    ".tuiles-son{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}" +
    ".tuile-son{display:flex;align-items:center;gap:10px;min-width:0;border:1.5px solid var(--trait);background:var(--carte);color:var(--encre);border-radius:14px;padding:9px 11px;cursor:pointer;text-align:left;transition:border-color .2s,background .2s,transform .2s var(--ease)}" +
    ".tuile-son .ic{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:var(--papier);color:var(--encre)}.tuile-son .tx{display:flex;flex-direction:column;gap:2px;min-width:0}.tuile-son .nm{font:700 13px/1.1 var(--titre);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tuile-son .ds{font:500 11px/1.2 var(--texte);color:var(--gris)}" +
    ".tuile-son:hover{border-color:var(--nuit);transform:translateY(-1px)}.tuile-son:focus-visible{outline:2px solid var(--anis);outline-offset:2px}" +
    ".tuile-son[aria-checked=true]{background:var(--nuit);border-color:var(--nuit);color:#fff}.tuile-son[aria-checked=true] .ic{color:var(--anis);background:rgba(255,255,255,.08)}.tuile-son[aria-checked=true] .ds{color:#B8B8B0}" +
    ".tuile-son.joue .ic{animation:rr-saut .32s var(--ease) 2}@keyframes rr-saut{40%{transform:translateY(-4px) scale(1.12)}}" +
    "@media (prefers-reduced-motion:reduce){.tuile-son.joue .ic{animation:none}.tuile-son:hover{transform:none}}" +
    "@media (prefers-color-scheme:dark){.tuile-son:hover{border-color:var(--anis)}.tuile-son[aria-checked=true]{background:#0F0F0F;border-color:var(--anis)}}" +
    "@media (prefers-color-scheme:dark){.encart .auto input:checked+.rail{background:#3A3A36}}" +
    ".pastille{border:1.5px solid var(--trait);background:var(--carte);color:var(--encre);border-radius:999px;padding:7px 12px;font:600 12.5px/1 var(--texte);cursor:pointer;transition:border-color .2s,background .2s,transform .2s}" +
    ".pastille:hover{border-color:var(--nuit);transform:translateY(-1px)}.pastille[aria-checked=true]{background:var(--nuit);border-color:var(--nuit);color:var(--anis)}" +
    ".ia-nego{display:flex}.ia .pastille.nego{background:transparent;border-color:rgba(255,255,255,.22);color:#fff}.ia .pastille.nego[aria-checked=true]{background:var(--anis);border-color:var(--anis);color:var(--nuit)}" +
    ".pastille:focus-visible{outline:2px solid var(--anis);outline-offset:2px}" +
    "@media (prefers-color-scheme:dark){.pastille:hover{border-color:var(--anis)}.pastille[aria-checked=true]{background:var(--anis);border-color:var(--anis);color:#1A1A1A}}" +
    ".vente-t{margin:0;font-size:13px;line-height:1.4}.encart.vente .mini{align-self:flex-start;background:var(--anis);border-color:var(--anis);color:var(--nuit);padding:7px 12px}" +
    ".outils{display:flex;flex-wrap:wrap;gap:8px}.encart .mini{background:var(--carte);padding:7px 12px}" +
    ".auto{display:flex;align-items:center;gap:10px;font-weight:600;font-size:13.5px;cursor:pointer;position:relative}.auto input{position:absolute;opacity:0;width:1px;height:1px}" +
    ".rail{width:40px;height:24px;border-radius:999px;background:var(--trait);position:relative;transition:background .2s;flex:none}.rail::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .25s var(--ease)}" +
    ".auto input:checked+.rail{background:var(--nuit)}.auto input:checked+.rail::after{transform:translateX(16px);background:var(--anis)}.auto input:focus-visible+.rail{outline:2px solid var(--anis);outline-offset:2px}" +
    ".reps{display:flex;flex-direction:column;gap:6px;max-height:min(46vh,380px);overflow:auto;margin:0 -4px;padding:0 4px}" +
    ".rep{display:flex;flex-direction:row;align-items:flex-start;gap:10px;text-align:left;border:1px solid var(--trait);background:var(--papier);border-radius:14px;padding:9px 12px;cursor:pointer;transition:border-color .2s,background .2s}.rep:hover{border-color:var(--anis);background:var(--anis-p)}" +
    ".ia{display:flex;flex-direction:column;gap:7px;background:var(--nuit);color:#fff;border-radius:18px;padding:12px;--papier:rgba(255,255,255,.06);--trait:rgba(255,255,255,.14);--gris:#B8B8B0;--encre:#fff}" +
    ".ia-t{display:flex;align-items:center;justify-content:space-between;gap:8px}.ia-t b{font:700 14px/1.2 var(--titre);display:flex;gap:6px;align-items:center}.etoile{color:var(--anis)}" +
    ".ia-attente{margin:8px 0 6px;padding:12px 14px;border-radius:14px;background:rgba(212,245,122,.16);color:inherit;font:600 14px/1.45 var(--texte)}" +
    ".ia-verif{margin:0;font-size:12.5px;line-height:1.4;border-radius:10px;padding:7px 9px}.ia-verif.ok{background:rgba(212,245,122,.12);color:#D4F57A}.ia-verif.doute{background:rgba(255,196,0,.14);color:#FFD66B}" +
    ".ia-offre{margin:0;font-size:12.5px;line-height:1.4;border-radius:10px;padding:7px 9px;background:rgba(255,255,255,.07);color:#E8E8E2}.ia-offre.basse{background:rgba(246,196,185,.14);color:#F6D3CB}.ia-offre.ok{background:rgba(191,232,200,.12);color:#CBEBD3}.ia-offre b{font-weight:700}" +
    ".ia .mini{color:#fff}.ia .mini:hover:not(:disabled){background:var(--anis);border-color:var(--anis);color:var(--nuit)}.mini:disabled{opacity:.55;cursor:default}.ia-r{margin:0;font-size:12.5px;color:#B8B8B0}.ia-r.charge{animation:pulse 1.2s ease-in-out infinite}@keyframes pulse{50%{opacity:.45}}" +
    ".rep.fort{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.14)}.rep.fort:hover{background:rgba(212,245,122,.14);border-color:var(--anis)}.rep.fort b{color:var(--anis)}.rep .plein{display:block;-webkit-line-clamp:unset;color:#E8E8E2}" +
    ".ap{font-style:normal;font:700 10.5px/1 var(--texte);letter-spacing:.03em;text-transform:uppercase;border-radius:999px;padding:3px 7px;margin-right:7px;vertical-align:1px;background:rgba(255,255,255,.12);color:#fff}.ap-contre_offre{background:var(--anis);color:var(--nuit)}.ap-couper_court{background:#F3B9AE;color:#5A1A10}.ap-accepter{background:#BFE8C8;color:#14401F}" +
    ".rep .ico{flex:none;width:30px;height:30px;border-radius:10px;background:var(--anis-p);color:var(--nuit);display:grid;place-items:center}.rep .ic{width:17px;height:17px}.rep .q{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}" +
    ".rep .ap2{font-size:12.5px;color:var(--gris);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.rep strong{color:var(--encre);font-weight:800}" +
    ".rep.fort .ico{background:var(--anis);color:var(--nuit)}.rep.fort strong{color:#fff;font-weight:800}" +
    ".emo{flex:none;width:34px;height:34px;border-radius:11px;background:var(--carte);border:1px solid var(--trait);display:grid;place-items:center;font-size:19px;line-height:1}.emo.ph{background-size:cover;background-position:center}.opt.actif .emo{border-color:var(--anis)}" +
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
  // Panneau IA, version soignée : accent de la formule (anis, menthe, or, lilas), texte plus grand, contrastes nets.
  CSS += ".b{--anis-rgb:212,245,122}.b[data-formule=vendeur]{--anis:#5EF0C6;--anis-p:#DDFBF1;--anis-rgb:94,240,198}.b[data-formule=collectionneur]{--anis:#FFD23F;--anis-p:#FFF4CC;--anis-rgb:255,210,63}.b[data-formule=pass]{--anis:#C4A8FF;--anis-p:#EEE6FF;--anis-rgb:196,168,255}" +
    "@media (prefers-color-scheme:dark){.b[data-formule=vendeur]{--anis-p:#123329}.b[data-formule=collectionneur]{--anis-p:#33290A}.b[data-formule=pass]{--anis-p:#251C3D}}" +
    ".ia{position:relative;overflow:hidden;gap:10px;padding:16px;border-radius:20px;background:linear-gradient(165deg,#252523 0%,#151514 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.07),0 18px 40px -22px rgba(0,0,0,.6)}" +
    ".ia::before{content:'';position:absolute;right:-70px;top:-80px;width:200px;height:200px;border-radius:50%;background:radial-gradient(closest-side,rgba(var(--anis-rgb),.2),transparent);pointer-events:none}.ia>*{position:relative}" +
    ".ia-t b{font:800 15px/1.2 var(--titre);letter-spacing:-.2px;gap:8px}.etoile{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:7px;background:var(--anis);color:var(--nuit);font-size:12px}" +
    ".ia .mini{border-color:rgba(255,255,255,.22);font-weight:700;white-space:nowrap;flex:none}" +
    ".ia-attente{display:flex;gap:12px;align-items:center;margin:2px 0;padding:14px;border-radius:16px;background:rgba(255,255,255,.045);box-shadow:inset 0 0 0 1px rgba(var(--anis-rgb),.4)}" +
    ".ia-attente .em{flex:none;width:46px;height:46px;border-radius:14px;background:var(--anis);display:grid;place-items:center;font-size:23px;box-shadow:0 8px 20px -8px rgba(var(--anis-rgb),.7)}" +
    ".ia-attente p{margin:0;font:700 15px/1.4 var(--titre);color:#fff;letter-spacing:-.1px}" +
    ".ia-r{font-size:13.5px;line-height:1.5;color:#D2D2CA}.ia-offre{font-size:13px;line-height:1.45;padding:10px 12px;border-radius:12px}" +
    ".rep{padding:12px 14px;border-radius:16px;gap:12px}.rep b{font-size:14px}.rep .plein{font-size:13.5px;line-height:1.5;color:#EDEDE7}.rep .ico{width:34px;height:34px;border-radius:11px}" +
    ".rep.fort{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.1)}.rep.fort:hover{background:rgba(var(--anis-rgb),.1);border-color:var(--anis)}" +
    ".parler textarea{font-size:14px;padding:11px 12px;border-radius:14px;background:rgba(255,255,255,.07)}.ia .clair{font-weight:800;padding:10px 16px}";
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
    if (oui) { b.appendChild(el("button", { class: "rond", title: "RetroRevente : remplir l'annonce (" + RACCOURCI + ")", "aria-label": "Ouvrir RetroRevente", "aria-keyshortcuts": MAC ? "Meta+K" : "Control+K", onclick: function () { replie(false); } }, [el("img", { src: RR.runtime.getURL("icones/icone-128.png"), alt: "" }), el("kbd", { texte: RACCOURCI })])); return; }
    b.appendChild(el("div", { class: "p", role: "dialog", "aria-label": "RetroRevente" }, [
      el("div", { class: "t" }, [marque(), el("button", { class: "x", "aria-label": "Réduire", title: "Réduire (Échap)", texte: "×", onclick: function () { replie(true); } })]),
      el("div", { class: "corps" }),
      el("div", { class: "s", texte: "Chargement de tes annonces…" }),
      el("div", { class: "n", texte: mode() === "messages" ? "Un clic place la réponse dans la zone de message : relis, puis envoie." : "Chaque écran du dépôt se remplit et passe tout seul. Sur le dernier, un son te prévient : tu relis et tu publies toi-même." }),
    ]));
    charger().then(function () { if (puis) puis(); });
  }
  function statut(t, k) { var s = ombre.querySelector(".s"); if (s) { s.textContent = t; s.className = "s " + (k || ""); } }

  // Article à déposer : celui de la fiche d'où l'on vient (#rr=<id> ou message du site, moins de 2 h),
  // sinon le plus récemment modifié qui n'est pas encore publié. Jamais un vieil article par défaut.
  async function cibleDepot() {
    var l = etat.annonces || [], id = (/[#&]rr=([a-f0-9]{16})/.exec(location.hash) || [])[1], st = {};
    try { st = (await RR.storage.local.get("aDeposer")) || {}; } catch (e) {}
    var s = st.aDeposer && Date.now() - st.aDeposer.at < 2 * 3600e3 ? st.aDeposer : null;
    if (!id && s) id = s.id;
    var a = id && l.find(function (x) { return x.id === id; });
    if (id && !a) { try { var j = await rrDemander({ type: "annonces" }); etat.annonces = l = j.annonces || l; a = l.find(function (x) { return x.id === id; }); } catch (e) {} }
    if (a && !(a.publiee && !(location.hash.indexOf("rr=") >= 0))) { etat.choisie = a; etat.cible = a.id; return; }
    var t = function (x) { return Date.parse(x.modifie || "") || 0; };
    etat.choisie = l.filter(function (x) { return !x.publiee; }).sort(function (x, y) { return t(y) - t(x); })[0] || l[0] || null;
  }

  async function charger() {
    try {
      var j = await rrDemander({ type: "annonces" });
      etat.annonces = j.annonces || [];
      // Profil de vendeur (Mon compte) : « Prix ferme, pas de marchandage » coche d'office « Pas de négociation possible ».
      etat.vendeur = (j.profil && j.profil.vendeur) || {};
      if (j.profil && j.profil.adresse) etat.adresseCompte = String(j.profil.adresse);   // adresse de Mon compte : prioritaire
      if (!etat.sansNegoChoisi && etat.vendeur.prix === "ferme") etat.sansNego = true;
      var bx = ombre && ombre.querySelector(".b"); if (bx && j.profil && /^(vendeur|collectionneur|pass)$/.test(j.profil.formule || "")) bx.setAttribute("data-formule", j.profil.formule);
      if (mode() === "depot") await cibleDepot();
      if (mode() === "messages" && !etat.choisie) { etat.choisie = deviner(); if (deviner(true)) { etat.convPour = etat.choisiePour = idConversation(); etat.convDepuis = Date.now(); } }
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
    [/fifa|pes|foot|soccer/, "⚽"], [/tetris/, "🧱"], [/crash/, "🌀"], [/spyro|dragon/, "🐉"], [/perfect dark/, "🌙"], [/goldeneye|007|bond/, "🕵️"], [/resident evil|zombie/, "🧟"],
    [/street fighter|tekken|smash/, "🥊"], [/tony hawk|skate/, "🛹"], [/gran turismo|f-?zero|wave race|course|racing/, "🏁"], [/metal gear/, "📦"], [/castlevania/, "🦇"],
    [/pac-?man/, "🟡"], [/tomb raider/, "🏺"], [/harry potter/, "🧙"], [/lego/, "🧩"], [/rayman/, "✊"], [/animal crossing/, "🍃"], [/pikmin/, "🌱"], [/fire emblem/, "🔥"],
    [/kingdom hearts/, "🗝️"], [/gta|grand theft/, "🚓"], [/call of duty|battlefield/, "🎖️"], [/minecraft/, "⛏️"], [/splatoon/, "🦑"], [/xenoblade|chrono/, "⏳"],
  ];
  function emojis(l) {
    var out = {};
    l.forEach(function (a) {
      var n = norm(a.titre + " " + (a.nom || "")), e = "";
      if (a.lot) e = "📦";
      else if (a.categorie === "consoles") e = "🕹️";
      else if (a.categorie === "cartes") e = "🃏";
      else if (a.categorie === "films") e = "🎬";
      if (!a.lot && (a.categorie === "connectes" || a.categorie === "autres")) { out[a.id] = emojiObjet(a); return; }
      var k = EMOJIS_JEU.find(function (x) { return x[0].test(n); }); if (k) e = k[1];
      // Sans emoji parlant : la manette (la photo de l'article prend sa place dès qu'elle est chargée).
      out[a.id] = e || "🎮";
    });
    return out;
  }
  // Vignette d'un article : sa photo (chargée une fois), sinon un emoji.
  var vignettes = {};
  function vignette(a) {
    var v = el("span", { class: "emo", "aria-hidden": "true", texte: emojiDe(a) });
    if (a && a.photo && !a.lot && !a.externe && /^[a-f0-9]{16}$/.test(String(a.id || ""))) {
      (vignettes[a.id] = vignettes[a.id] || rrDemander({ type: "photo", id: a.id }).then(function (r) { return "data:" + (r.type || "image/jpeg") + ";base64," + r.base64; }))
        .then(function (u) { v.style.backgroundImage = "url(" + u + ")"; v.classList.add("ph"); v.textContent = ""; }, function () { delete vignettes[a.id]; });
    }
    return v;
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
      vignette(a),
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
          [vignette(x), el("span", { class: "q" }, [nom, el("span", { class: "meta", texte: metaTxt(x) })]), x.prix != null ? el("span", { class: "px", texte: prixTxt(x) }) : null]));
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
      else { etat.manuel = conversationActuelle(); etat.choisiePour = idConversation(); statut("Réponses complétées pour « " + x.titre + " ».", "ok"); }
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
      corps.appendChild(el("div", { class: "pile" }, [haut, venteUI(a), ia, types].filter(Boolean)));
      dessinerIA(ia);
      var nbj = a.lot ? jeuxDuLot(a) : 0;
      statut(a.lot ? "Lot de " + a.n + " articles" + (nbj > a.n ? " (" + nbj + " jeux)" : "") + " à " + a.prix + " € repéré" + (a.articles ? " : " + a.plateforme + "." : ". Ouvre « Lot de " + a.n + " articles » pour que je voie les articles inclus.") : "", "");
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
    var prevenir = el("label", { class: "auto", title: "Une notification quand c'est à toi de cliquer (dernier écran, champ à compléter)" }, [
      el("input", { type: "checkbox", role: "switch", onchange: function (e) {
        etat.prevenir = e.target.checked; try { RR.storage.local.set({ prevenir: etat.prevenir }); } catch (x) {}
        // Safari n'a pas les notifications d'extension : on demande l'autorisation pour cette page, au clic.
        if (etat.prevenir && /Apple/.test(navigator.vendor || "") && window.Notification && Notification.permission === "default") { try { Notification.requestPermission(); } catch (x) {} }
      } }),
      el("span", { class: "rail" }), "Me prévenir (notification)",
    ]);
    prevenir.querySelector("input").checked = etat.prevenir;
    // Son « à toi » : choix parmi les sons rétro, ou muet. Changer de son le fait entendre tout de suite.
    var sons = Object.keys(RR_SONS).filter(function (k) { return !RR_SONS[k].cache; }).concat(["muet"]);
    var choisirSon = function (k) {
      etat.sonChoix = k; etat.son = k !== "muet";
      try { RR.storage.local.set({ sonChoix: etat.sonChoix, son: etat.son }); } catch (x) {}
      if (etat.son) sonner(); etat.panneauSon();
    };
    // Une tuile par son : icône pixel, nom, et une ligne qui dit le caractère du son. Cliquer choisit et fait
    // entendre ; recliquer la tuile choisie la rejoue. Plus de bouton « Écouter » à part.
    var DESC_SON = { piece: "Tintant", powerup: "Montée", jingle: "Fanfare", muet: "Silence" };
    var tuiles = sons.map(function (k) {
      var t = el("button", { class: "tuile-son", type: "button", role: "radio", "data-son": k, title: k === "muet" ? "Pas de son quand c'est à toi" : "Choisir et écouter « " + RR_SONS[k].nom + " »", onclick: function () {
        choisirSon(k);
        if (k === "muet") return;
        t.classList.remove("joue"); void t.offsetWidth; t.classList.add("joue");
        clearTimeout(t.__fin); t.__fin = setTimeout(function () { t.classList.remove("joue"); }, Math.round(rrRendreSon(k).length / RR_TAUX * 1000));
      } }, [el("span", { class: "ic" }), el("span", { class: "tx" }, [el("span", { class: "nm", texte: k === "muet" ? "Muet" : RR_SONS[k].nom }), el("span", { class: "ds", texte: DESC_SON[k] || "" })])]);
      t.querySelector(".ic").innerHTML = ICONES_SON[k] || ICONES_SON.jingle;
      return t;
    });
    var choixListe = el("div", { class: "tuiles-son", role: "radiogroup", "aria-label": "Son quand c'est à toi" }, tuiles);
    choixListe.addEventListener("keydown", function (e) {
      if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].indexOf(e.key) < 0) return;
      e.preventDefault(); var i = sons.indexOf(etat.sonChoix), n = sons.length;
      var k = sons[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : n - 1)) % n]; choisirSon(k);
      var bt = choixListe.querySelector('[data-son="' + k + '"]'); if (bt) bt.focus();
    });
    etat.panneauSon = function () {
      tuiles.forEach(function (bt) { var on = bt.getAttribute("data-son") === etat.sonChoix; bt.setAttribute("aria-checked", on ? "true" : "false"); bt.tabIndex = on ? 0 : -1; });
    };
    etat.panneauSon();
    var encart = function (titre, enfants, cls) { return el("section", { class: "encart" + (cls ? " " + cls : "") }, [el("h3", { class: "encart-t", texte: titre })].concat(enfants)); };
    var outils = el("div", { class: "outils" }, [el("button", { class: "mini", type: "button", title: "Copie la structure de l'écran (sans ce que tu as tapé) pour que je corrige l'extension", texte: "Copier un diagnostic", onclick: function () { copierDiagnostic(); } }), el("button", { class: "mini", type: "button", title: "Réécrire tous les champs de l'écran avec cet article", texte: "Remplir à nouveau", onclick: function () { remplir(true).then(function (f) { if (!f.length) statut("Rien à remplir sur cet écran.", ""); }).catch(function (e) { statut(e.message, "bad"); }); } })]);
    corps.appendChild(el("div", { class: "pile" }, [haut,
      encart("L'annonce", [grille]),
      encart("Automatique", [bascule, suite, prevenir]),
      encart("Son quand c'est à toi", [choixListe], "son"),
      encart("Outils", [outils]),
    ]));
    if (!etat.journal || !etat.journal.length) statut(etat.auto ? "Remplissage automatique activé : chaque écran du dépôt se remplit tout seul." : "Remplissage automatique en pause.", "");
  }

  /* ===== Réponses types aux acheteurs (messagerie) ===== */
  // La colonne de la conversation ouverte : on remonte depuis la zone de message tant que la largeur reste celle
  // d'une colonne (on évite la liste des autres conversations et l'encadré de l'annonce).
  function colonneConversation() {
    var z = zoneMessage(); if (!z) return document.querySelector("main") || document.body;
    var w0 = Math.max(260, (z.closest("form") || z.parentElement || z).getBoundingClientRect().width), c = z;
    while (c.parentElement && c.parentElement !== document.body && c.parentElement.getBoundingClientRect().width <= w0 * 1.3 + 60) c = c.parentElement;
    // Zone de saisie plus étroite que la liste des messages : on remonte jusqu'à englober de vrais messages.
    var base = (z.closest("form") || z.parentElement || z), propre = function (x) { return ((x.innerText || "").length - (base.innerText || "").length); };
    for (var i = 0; i < 5 && propre(c) < 60 && c.parentElement && c.parentElement !== document.body && c.parentElement.getBoundingClientRect().width < innerWidth * 0.8; i++) c = c.parentElement;
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
  try { RR.storage.local.get("lots2").then(function (r) { if (r && r.lots2) lotsVus = Object.assign(r.lots2, lotsVus); }); RR.storage.local.remove("lots"); } catch (e) {}
  var DATE_LISTE = /il y a|\bhier\b|aujourd'hui|\s-\s(?:lun|mar|mer|jeu|ven|sam|dim)|\b\d{1,2} (?:janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc)\w*\.? \d{4}\b/i;
  function articlesLotAffiches(n) {
    var titres = [].filter.call(document.querySelectorAll("h1, h2, h3, h4, p, span, div"), function (x) {
      if (!(x.childElementCount === 0 && visible(x) && new RegExp("^\\s*lot de " + n + " articles?\\s*$", "i").test(x.textContent || "") && !(hote && hote.contains(x)))) return false;
      // Pas l'entrée « Lot de 2 articles » de la liste des conversations (à gauche) : elle porte une date.
      var entree = x.closest("a, li, button, [role=button], [role=link]");
      return !(entree && DATE_LISTE.test(entree.innerText || ""));
    });
    for (var i = 0; i < titres.length; i++) {
      var c = titres[i];
      for (var k = 0; k < 6 && c.parentElement && c.parentElement !== document.body; k++) {
        c = c.parentElement;
        var lignes = [].filter.call(c.querySelectorAll("a, button, li, [role=button], [role=link]"), function (x) {
          return x.querySelector("img") && !x.parentElement.closest("a, button, li, [role=button], [role=link]") && !x.contains(titres[i]);
        }).map(function (x) { return (x.innerText || "").replace(/\s+/g, " ").trim(); })
          .filter(function (t) { return t.length >= 6 && t.length <= 200 && !/€|\d{1,2}:\d{2}/i.test(t) && !DATE_LISTE.test(t); });
        // Des entrées de la liste des conversations : ce n'est pas le contenu du lot.
        if (c.querySelectorAll("a, li, [role=link]").length > 3 * n + 6) break;
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
    // Seulement l'annonce de CETTE conversation : jamais la liste des conversations ni le reste de la page.
    if (!m) return null;
    var lot = { n: +m[1], prix: entier(m[2]) }, cle = lot.n + "|" + lot.prix, vus = articlesLotAffiches(lot.n);
    if (vus && (lotsVus[cle] || []).join("|") !== vus.join("|")) {
      lotsVus[cle] = vus;
      var garde = {}; Object.keys(lotsVus).slice(-30).forEach(function (k) { garde[k] = lotsVus[k]; });
      try { RR.storage.local.set({ lots2: garde }); } catch (e) {}
    }
    if (lotsVus[cle]) lot.articles = lotsVus[cle];
    return lot;
  }
  function offreOfficielle() {
    var t = colonneConversation().innerText, m, r = null, re = /offre de [^:\n]{1,60}:\s*(\d[\d\s]{0,6}(?:[.,]\d{1,2})?)\s?€/gi;
    while ((m = re.exec(t))) r = entier(m[1]);
    // « Vendu ! Recevez 15,00 € » : le montant de la vente conclue l'emporte sur l'offre.
    var v = null, rv = /recevez\s+(\d[\d\s]{0,6}(?:[.,]\d{1,2})?)\s?€/gi;
    while ((m = rv.exec(t))) { var x = parseFloat(m[1].replace(/\s/g, "").replace(",", ".")); if (isFinite(x) && x > 0) v = Math.round(x * 100) / 100; }
    return v != null ? v : r;
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
    // Pseudo déjà en tête (« Bonjour Mick.8, … ») : on n'en remet pas un second.
    if (!nom || /^Bonjour\s+\p{Lu}\p{Ll}/u.test(t) || t.slice(0, 20 + nom.length).indexOf(nom) >= 0) return t;
    return t.replace(/^Bonjour\s*([,!]?)\s*/u, function (x, p, i, tout) { var suite = tout.slice(x.length); return "Bonjour " + nom + (p === "!" ? " ! " : /^\p{L}/u.test(suite) ? ", " : " "); });
  }
  /* Vente conclue sur Le Bon Coin (« Vendu ! », offre acceptée, paiement fait) : les annonces de RetroRevente qu'elle concerne.
     Un « Lot de 2 articles » Le Bon Coin = 2 annonces, dont chacune peut être un lot RetroRevente de plusieurs jeux. */
  var CONCLUE = /\bvendu\s?!|offre (?:a été )?accept[ée]e|vous avez accept[ée] (?:l'|son |cette )?offre|paiement (?:a été )?(?:effectué|reçu|validé)/i;
  function annoncesVendues(a) {
    if (!a) return [];
    if (a.lot) return (a.articles || []).map(function (t) { return meilleurJeu(t); }).filter(Boolean);
    return a.id && !a.externe && a.id !== "lbc" ? [a] : [];
  }
  function jeuxDuLot(a) {
    return (a.articles || []).reduce(function (n, t) { var x = meilleurJeu(t); return n + Math.max(1, (x && x.contient && x.contient.length) || 1); }, 0);
  }
  var vendusFaits = {};
  function venteUI(a) {
    var conv = colonneConversation().innerText;
    if (!CONCLUE.test(conv)) return null;
    var l = annoncesVendues(a), cle = idConversation(), fait = vendusFaits[cle];
    if (!l.length && !fait) return null;
    var px = offreOfficielle() || a.prix, noms = l.map(function (x) { return x.contient && x.contient.length ? titreCourt(x.nom || x.titre) + " (" + x.contient.length + " jeux)" : titreCourt(x.nom || x.titre); });
    var info = el("p", { class: "vente-t", texte: fait ? "Passé en Vendu dans RetroRevente : " + fait + "." : "Vente conclue" + (px ? " à " + px + " €" : "") + " : " + noms.join(" + ") + "." });
    var b = fait ? null : el("button", { class: "mini", type: "button", texte: "Passer en Vendu dans RetroRevente", onclick: function () {
      b.disabled = true; b.textContent = "Un instant…";
      rrDemander({ type: "vendu", ids: l.map(function (x) { return x.id; }), prix: px || null, remise: /main propre|en mains? propres?/i.test(conv) ? "main_propre" : "envoi" }).then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || "Impossible pour le moment.");
        vendusFaits[cle] = r.vendus.map(function (v) { return titreCourt(v.titre) + (v.prixVente != null ? " " + String(v.prixVente).replace(".", ",") + " €" : ""); }).join(", ");
        etat.annonces = etat.annonces.filter(function (x) { return !l.some(function (y) { return y.id === x.id; }); });
        statut("C'est noté dans RetroRevente : vendu" + (px ? " " + px + " €" : "") + ".", "ok");
        dessiner();
      }).catch(function (e) { b.disabled = false; b.textContent = "Passer en Vendu dans RetroRevente"; statut(e.message, "bad"); });
    } });
    return el("section", { class: "encart vente" }, [el("h3", { class: "encart-t", texte: "Vente conclue" }), info, b].filter(Boolean));
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
    // D'abord le titre de l'annonce (la description d'un lot cite d'autres jeux), à prix égal de préférence.
    var enc = texteEncadre(), e = jeuDeLEncadre(enc), px = e && e.prix;
    var a = (e && meilleurJeu(e.titre, px)) || meilleurJeu(enc, px) || meilleurJeu(colonneConversation().innerText.slice(0, 20000));
    return a || jeuDeLEncadre(enc) || (sur ? null : etat.annonces[0]);
  }
  var VIDES = ("the and les des une pour avec sans pal eur ntsc jeu jeux video version edition complet loose boite cartouche notice " +
    "nintendo sony sega microsoft playstation xbox console tres bon etat").split(" ");
  function mots(t) {
    return norm(t).replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter(function (m) { return m.length >= 3 && VIDES.indexOf(m) < 0; });
  }
  function meilleurJeu(texte, prix) {
    var vus = {}; mots(texte).forEach(function (m) { vus[m] = 1; });
    var meilleur = null, score = 0;
    (etat.annonces || []).forEach(function (a) {
      var m = mots(a.nom || a.titre); if (!m.length) return;
      var s = m.filter(function (x) { return vus[x]; }).length / m.length + m.length / 1000 + (prix != null && a.prix === prix ? 0.01 : 0);   // à égalité, le prix affiché puis le titre le plus précis
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
    // Prix plancher selon le profil de vendeur (patient ou pressé, souple ou ferme), 85 % par défaut, comme le serveur.
    var pv = etat.vendeur || {}, part = pv.prix === "ferme" ? 0.95 : Math.min(0.9, Math.max(0.75, 0.85 + (pv.rythme === "patient" ? 0.05 : pv.rythme === "rapide" ? -0.05 : 0) + (pv.prix === "souple" ? -0.05 : 0)));
    var plancher = px ? Math.min(px, rond(px * part, true)) : null;
    var milieu = px ? Math.max(plancher, rond(offre ? (offre + px) / 2 : px * 0.9)) : null;
    var lePrix = px ? px + " €" : "le prix affiché";
    var detail = [a.contenu && CONTENU_TXT[a.contenu] ? "C'est " + CONTENU_TXT[a.contenu] : "", a.etat && ETAT_TXT[a.etat] ? (a.contenu ? ", " : "Il est en ") + ETAT_TXT[a.etat].toLowerCase() : ""].join("");
    var det = detail ? detail + ". " : "";
    var votre = offre ? "vos " + offre + " €" : "votre proposition";
    // Pour un lot, on parle des jeux qu'il contient (« Conker's Bad Fur Day et Astérix and the Great Rescue »).
    var valeur = a.lot ? "de la valeur " + (a.n === 2 ? "des deux articles" : "des " + (a.n || "") + " articles").replace("  ", " ") + (a.plateforme ? " (" + a.plateforme + ")" : "") + " : le lot est déjà à " + lePrix + ", au prix du marché."
      : "de la valeur " + (a.categorie === "cartes" ? "de la carte : elle se vend" : a.categorie === "films" ? "du film dans cette édition : il se vend" : a.categorie === "connectes" ? "de l'appareil : ce modèle se vend" : a.categorie === "autres" ? "de l'objet : il se vend" : "du jeu : il se vend") + " autour de " + lePrix + " en ce moment.";
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
      pv.echanges === "oui" ? { g: "Négociation", t: "Proposition d'échange", m: "Bonjour, merci pour la proposition d'échange, pourquoi pas ! Qu'est-ce que vous auriez à proposer ? Envoyez-moi le titre, l'état et quelques photos 🙂" }
        : { g: "Négociation", t: "Proposition d'échange", m: "Bonjour, merci pour la proposition d'échange ! Pour l'instant je préfère vendre plutôt qu'échanger, mais si vous êtes intéressé à " + lePrix + ", je vous le réserve avec plaisir." },
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
    // Profil « Prix ferme, pas de marchandage » : on retire les réponses qui font un geste sur le prix.
    if (pv.prix === "ferme") l = l.filter(function (x) { return !/poire en deux|dernière$|dernier prix|trop basse$/.test(x.t); });
    return a.categorie === "cartes" ? reponsesCarte(l, a, nom) : a.categorie === "films" ? reponsesFilm(l, a, nom) : a.categorie === "connectes" ? reponsesConnecte(l, a, nom) : a.categorie === "autres" ? reponsesObjet(l, a, nom) : l;
  }
  // Mots du jeu remplacés par ceux de l'objet, dans les réponses gardées (disponibilité, négociation, sécurité).
  function sansJeu(l, Le, le) {
    return l.map(function (x) {
      return { g: x.g, t: x.t.replace(/plusieurs jeux/, "plusieurs articles"), m: x.m.replace(/\bLe jeu\b/g, Le).replace(/\ble jeu\b/g, le).replace(/Bon jeu avec /g, "Profitez bien de ").replace(/ et bon jeu !/g, " !").replace(/mes jeux/g, "mes articles").replace(/quels jeux/g, "quels articles") };
    });
  }
  /* Objets connectés : on garde la disponibilité, la négociation et la sécurité, et on remplace « Le jeu » et l'envoi
     par les questions propres aux appareils (batterie, compte réinitialisé, authenticité, hygiène, compatibilité, envoi). */
  function reponsesConnecte(l, a, nom) {
    var t = norm(a.plateforme || ""), audio = /ecouteur|casque/.test(t), apple = /apple|airpods|iphone|ipad|watch/i.test((a.marque || "") + " " + nom);
    var fourni = a.fourni ? String(a.fourni).split(/\s*,\s*/).map(function (x) { return x.charAt(0).toLowerCase() + x.slice(1); }).join(", ") : "";
    var cnt = [
      { g: "L'appareil", t: "État et fonctionnement", m: "Bonjour ! " + nom + " fonctionne parfaitement, je l'ai testé avant de le mettre en vente." + (a.etat && ETAT_TXT[a.etat] ? " Il est en " + ETAT_TXT[a.etat].toLowerCase() + "." : "") + (fourni ? " Il est fourni avec : " + fourni + "." : "") + " Je peux vous envoyer d'autres photos si vous voulez." },
      { g: "L'appareil", t: "État de la batterie", m: "Bonjour ! " + (a.batterie ? "La batterie est à " + a.batterie + (/%/.test(a.batterie) ? " de sa capacité d'origine" : "") + ". " : "") + "Je vous envoie une capture de l'état de la batterie, comme ça vous voyez par vous-même." },
      { g: "L'appareil", t: "Réinitialisé et dissocié", m: a.reinit ? "Bonjour ! Oui, il est réinitialisé et retiré de mon compte" + (apple ? " (Localiser désactivé)" : "") + " : vous pourrez l'associer au vôtre dès réception." : "Bonjour ! Je le réinitialise et je le retire de mon compte" + (apple ? " (Localiser désactivé)" : "") + " avant l'envoi : vous pourrez l'associer au vôtre dès réception." },
      { g: "L'appareil", t: "Authentique ?", m: "Bonjour ! Oui, c'est un original" + (/facture/i.test(a.fourni || "") ? ", et je fournis la facture d'achat" : "") + ". En main propre, je vous montre le numéro de série dans les réglages, vous pouvez le vérifier sur le site de la marque." },
      audio ? { g: "L'appareil", t: "Hygiène", m: "Bonjour ! " + (/casque/.test(t) ? "Le casque est nettoyé et les coussinets désinfectés" : "Les écouteurs sont nettoyés et désinfectés, embouts compris") + " avant l'envoi." } : null,
      apple && audio ? { g: "L'appareil", t: "Compatible Android ?", m: "Bonjour ! Oui, ils se connectent en Bluetooth à un téléphone Android. Certaines fonctions (bascule automatique, audio spatial personnalisé) sont réservées aux appareils Apple." } : null,
      { g: "L'appareil", t: "Pourquoi ce prix ?", m: "Bonjour, bonne question ! Je me base sur les ventes réellement conclues ces dernières semaines pour ce modèle d'occasion (eBay, Le Bon Coin), en dessous du prix d'un reconditionné." },
      { g: "Envoi et remise", t: "Envoi protégé", m: "Je l'envoie avec la livraison Le Bon Coin (paiement sécurisé), bien calé dans un carton rigide. Expédié sous 48 h après la commande." },
      { g: "Envoi et remise", t: "Remise en main propre", m: "La remise en main propre est possible, et vous pourrez le tester sur place ! Dites-moi quel jour et quel secteur vous arrangent, et on se retrouve dans un lieu public." },
      { g: "Envoi et remise", t: "Colis envoyé", m: "C'est parti ! Le colis est bien protégé et déposé, vous recevrez le suivi par Le Bon Coin. Merci pour votre achat !" },
    ].filter(Boolean);
    var garde = sansJeu(l.filter(function (x) { return x.g !== "Le jeu" && x.g !== "Envoi et remise"; }), "L'appareil", "l'appareil");
    var i = garde.findIndex(function (x) { return x.g === "Sécurité et suivi"; });
    return garde.slice(0, i < 0 ? garde.length : i).concat(cnt, i < 0 ? [] : garde.slice(i));
  }
  // Autres objets : les réponses générales, sans les questions propres aux jeux.
  function reponsesObjet(l, a, nom) {
    var obj = [
      { g: "L'objet", t: "État", m: "Bonjour ! " + nom + (a.etat && ETAT_TXT[a.etat] ? " est en " + ETAT_TXT[a.etat].toLowerCase() : " est en bon état") + ". Je peux vous envoyer d'autres photos si vous voulez." },
      { g: "L'objet", t: "Plus de photos", m: "Bien sûr ! Je vous envoie d'autres photos tout de suite, sous tous les angles." },
      { g: "L'objet", t: "Dimensions", m: "Bonjour ! Je le mesure et je vous envoie les dimensions dans la journée." },
    ];
    var garde = sansJeu(l.filter(function (x) { return x.g !== "Le jeu"; }), "L'objet", "l'objet");
    var i = garde.findIndex(function (x) { return x.g === "Envoi et remise"; });
    return garde.slice(0, i < 0 ? garde.length : i).concat(obj, i < 0 ? [] : garde.slice(i));
  }
  /* Films : on garde la disponibilité, la négociation et la sécurité, et on remplace « Le jeu » et l'envoi
     par les questions propres aux films (disques, langues et zone, steelbook, envoi protégé). */
  function reponsesFilm(l, a, nom) {
    var fmt = a.plateforme || "", ed = a.edition ? String(a.edition).split(/\s*,\s*/)[0] : "", steel = /steelbook/i.test(a.edition || "");
    var film = [
      { g: "Le film", t: "État des disques", m: "Bonjour ! Les disques sont lus et vérifiés, sans rayure qui gêne la lecture. Je peux vous envoyer une photo des disques en lumière rasante si vous voulez." },
      { g: "Le film", t: "Langues et sous-titres", m: "Bonjour ! " + (a.region ? "C'est indiqué au dos : " + String(a.region).replace(/^./, function (c) { return c.toLowerCase(); }) + ". " : "") + "Je vous envoie une photo du dos de la jaquette avec la liste des langues et des sous-titres, comme ça vous êtes sûr." },
      { g: "Le film", t: "Zone et lecteur", m: /4k|uhd/i.test(fmt) ? "Bonjour ! Les disques 4K UHD n'ont pas de zone : il se lit sur tous les lecteurs 4K. Le Blu-Ray éventuellement inclus se lit sur les lecteurs européens." : /dvd/i.test(fmt) ? "Bonjour ! C'est un DVD zone 2 (Europe), il se lit sur tous les lecteurs vendus en France." : "Bonjour ! C'est l'édition française, elle se lit sur les lecteurs Blu-Ray vendus en France (zone B)." },
      { g: "Le film", t: steel ? "État du steelbook" : "État du boîtier", m: steel ? "Bonjour ! Le steelbook est " + (a.etat === "neuf" ? "neuf, encore sous blister" : "en bon état, sans bosse") + ". Je peux vous envoyer des photos en gros plan des coins et des faces, pour que vous jugiez par vous-même." : "Bonjour ! Le boîtier est en bon état et la jaquette est propre. Je vous envoie d'autres photos si vous voulez." },
      { g: "Le film", t: "Pourquoi ce prix ?", m: "Bonjour, bonne question ! Je me base sur les ventes réellement conclues ces dernières semaines (eBay, Le Bon Coin, Rakuten) pour ce film" + (fmt ? " en " + fmt : "") + (ed ? ", dans cette édition (" + ed.toLowerCase() + ")" : "") + "." },
      { g: "Envoi et remise", t: "Envoi protégé", m: "Je l'envoie avec la livraison Le Bon Coin (paiement sécurisé), bien protégé : papier bulle et enveloppe rigide" + (steel ? ", le steelbook dans un film protecteur" : "") + ". Expédié sous 48 h après la commande." },
      { g: "Envoi et remise", t: "Remise en main propre", m: "La remise en main propre est possible ! Dites-moi quel jour et quel secteur vous arrangent, et on se retrouve dans un lieu public." },
      { g: "Envoi et remise", t: "Colis envoyé", m: "C'est parti ! Le film est bien protégé et déposé, vous recevrez le suivi par Le Bon Coin. Merci pour votre achat et bon film !" },
      { g: "Négociation", t: "Lot de plusieurs films", m: "Bonjour, avec plaisir pour un lot ! Dites-moi quels films vous intéressent et je vous fais un prix d'ensemble, avec un seul envoi pour réduire les frais." },
    ];
    var garde = l.filter(function (x) { return x.g !== "Le jeu" && x.g !== "Envoi et remise" && x.t !== "Lot de plusieurs jeux"; }).map(function (x) {
      return { g: x.g, t: x.t, m: x.m.replace(/\bLe jeu\b/g, "Le film").replace(/\ble jeu\b/g, "le film").replace(/\bBon jeu\b/g, "Bon film").replace(/mes jeux/g, "mes films") };
    });
    var i = garde.findIndex(function (x) { return x.g === "Sécurité et suivi"; });
    return garde.slice(0, i < 0 ? garde.length : i).concat(film, i < 0 ? [] : garde.slice(i));
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
    // « Envoyez une réponse rapide » : suggestions de l'IA de Le Bon Coin, jamais des messages de la conversation.
    blocsSuggestions(colonneConversation()).forEach(function (b) { var bt = (b.innerText || "").trim(); if (bt) t = t.split(bt).join(" "); });
    t = t.replace(/\n{3,}/g, "\n\n").trim().slice(-4200);
    return (enc ? "[Annonce concernée]\n" + enc.slice(0, 600) + "\n\n[Conversation]\n" : "") + t;
  }
  // Messages déjà envoyés par le vendeur : les bulles calées à droite de la conversation (pour que l'IA ne répète pas
  // ses arguments ni sa présentation).
  function mesMessages() {
    var col = colonneConversation(), cr = col.getBoundingClientRect(), z = zoneMessage(), vus = [], sugg = blocsSuggestions(col);
    if (cr.width < 200) return [];
    [].forEach.call(col.querySelectorAll("div, p, li, article, section"), function (x) {
      if ((hote && hote.contains(x)) || (z && (x.contains(z) || z.contains(x)))) return;
      if (sugg.some(function (b) { return b.contains(x) || x.contains(b); })) return;   // réponses rapides de Le Bon Coin
      var t = (x.innerText || "").trim(); if (t.length < 20 || t.length > 1500) return;
      var r = x.getBoundingClientRect();
      if (r.width < 120 || r.width > cr.width * 0.85) return;
      if (r.left - cr.left < cr.width * 0.2 || cr.right - r.right > 40) return;   // calée à droite
      if (vus.some(function (v) { return v.contains(x); })) return;
      vus = vus.filter(function (v) { return !x.contains(v); }); vus.push(x);
    });
    return vus.map(function (x) { return x.innerText.trim().replace(/\n{2,}/g, "\n").slice(0, 600); }).filter(function (t) { return !/^(offre|vous avez|message automatique)/i.test(t); }).slice(-4);
  }
  function conversationActuelle() { return location.pathname + "|" + texteEncadre().slice(0, 160); }
  // Le dernier message de la conversation est-il du vendeur (bulle calée à droite) ? Alors on attend l'acheteur.
  function dernierEstMoi() {
    // On regarde le dernier bout de texte affiché (position réelle du texte, pas de son bloc) : calé à droite = toi.
    var col = colonneConversation(), cr = col.getBoundingClientRect(), z = zoneMessage(), rb = null;
    if (cr.width < 200) return false;
    var w = document.createTreeWalker(col, NodeFilter.SHOW_TEXT), n, rg = document.createRange();
    while ((n = w.nextNode())) {
      if (!n.nodeValue.trim()) continue;
      var x = n.parentElement; if (!x || (hote && hote.contains(x)) || (z && (z.contains(x) || x.contains(z)))) continue;
      if (x.closest("button, a, form, [role=button], footer, script, style")) continue;   // boutons d'offre, saisie
      if (suggestionsLbc(x)) continue;   // « Envoyez une réponse rapide » : suggestions de Le Bon Coin, pas un message
      rg.selectNodeContents(n); var r = rg.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (!rb || r.bottom > rb.bottom + 1) rb = r;
    }
    // Calé à droite pour de vrai : commence loin du bord gauche et finit contre le bord droit (un bloc centré n'est pas à toi).
    return !!rb && rb.left > cr.left + cr.width * 0.3 && cr.right - rb.right < cr.width * 0.15;
  }
  // Bloc de suggestions de Le Bon Coin (titre « Envoyez une réponse rapide », boutons de réponses toutes faites) :
  // jamais pris pour un message de la conversation. (Une offre reçue, elle, compte : c'est l'acheteur qui a agi.)
  // Encadrés « Envoyez une réponse rapide » : le plus grand bloc qui commence par ce titre (titre + boutons).
  function blocsSuggestions(racine) {
    var l = [].filter.call((racine || document).querySelectorAll("div, section, aside, ul"), function (x) {
      if (hote && hote.contains(x)) return false;
      var t = norm((x.innerText || "").slice(0, 700));
      return /^(envoyez une reponse rapide|reponses? rapides?)\b/.test(t) && (x.innerText || "").length < 700;
    });
    return l.filter(function (x) { return !l.some(function (y) { return y !== x && y.contains(x); }); });
  }
  function suggestionsLbc(x) {
    for (var e = x, i = 0; e && i < 6; e = e.parentElement, i++) {
      var t = norm((e.innerText || "").slice(0, 200));
      if (/^(envoyez une reponse rapide|reponses? rapides?|suggestions?)\b/.test(t)) return true;
    }
    return false;
  }
  var ATTENTES = [
    "🎮 Ta réponse est partie. On attend l'acheteur… comme le chargement d'une cassette sur Amstrad.",
    "🕹️ La balle est dans son camp. Pong, mais en très lent.",
    "📼 Message envoyé ! L'acheteur rembobine la cassette, patience.",
    "⏳ À lui de jouer. Insert coin… ou au moins un message.",
    "🍄 Tu as répondu. Ton acheteur doit être dans un tuyau vert, il ressort bientôt.",
    "💾 Sauvegarde effectuée. En attente du joueur 2.",
  ];
  function cleConversation() { var t = texteConversation(), l = lotLu(); return location.pathname + "|" + t.length + "|" + t.slice(-300) + "|" + (l && l.articles ? l.articles.join("|") : ""); }
  async function proposerIA(force, consigne) {
    if (!choixAJour()) {
      if (recaler()) { dessiner(); return; }        // dessiner relance la proposition avec le bon article
      if (!choixAJour()) { clearTimeout(etat.minRecal); etat.minRecal = setTimeout(function () { proposerIA(force, consigne); }, 1200); return; }
    }
    var cle = cleConversation();
    if (!force && etat.ia && etat.ia.cle === cle) return;
    if (!force && colonneConversation().innerText.trim().length < 40) return;   // conversation en cours de chargement
    // Tu as répondu en dernier : rien à proposer tant que l'acheteur n'a pas écrit (« Autres idées » force quand même).
    if (!force && !consigne && dernierEstMoi()) { etat.ia = { cle: cle, attente: ATTENTES[cle.length % ATTENTES.length] }; rafraichirIA(); return; }
    var precedentes = ((etat.ia && etat.ia.reponses) || []).map(function (r) { return r.texte; });
    var idDepart = idConversation();
    etat.ia = { cle: cle, charge: true, consigne: consigne || "" }; rafraichirIA();
    try {
      var c = etat.choisie || {}, lot = lotLu() || (c.lot && choixAJour() ? { n: c.n, prix: c.prix } : null);
      var r = await rrDemander({ type: "reponse", annonce: c.lot ? "" : (c.id || ""), conversation: texteConversation(), lot: lot, offre: offreOfficielle(), acheteur: acheteurLu(), consigne: consigne || "", precedentes: consigne ? precedentes : [], mesMessages: mesMessages(), suite: !!consigne && dernierEstMoi(), dernierMoi: !consigne && dernierEstMoi(), refuserSansAvis: etat.refuserSansAvis !== false });
      if (!etat.ia || etat.ia.cle !== cle || idConversation() !== idDepart) { rafraichirIA(); return; }   // autre conversation entre-temps : réponse jetée
      etat.ia = { cle: cle, resume: r.resume, reponses: r.reponses || [], consigne: consigne || "", offre: r.offre || null, version: r.version || null, sansAvis: !!(r.acheteur && r.acheteur.sansAvis) };
      if (consigne) etat.brouillonIA = "";
    } catch (e) {
      if (etat.ia && etat.ia.cle === cle && idConversation() === idDepart) etat.ia = { cle: cle, erreur: e.message, status: e.status };
      if (e.status === 402 || e.status === 403) {
        etat.iaBloquee = true;
        var d = ombre && ombre.querySelector("details.types"); if (d && etat.typesOuvert == null) d.open = true;
      }
    }
    rafraichirIA();
  }
  var APPROCHES = { contre_offre: "Contre-offre", ferme: "Ferme", couper_court: "Couper court", accepter: "Accepter", au_revoir: "Au revoir" };
  function rafraichirIA() { var z = ombre && ombre.querySelector(".ia"); if (z) dessinerIA(z); }
  function dessinerIA(z) {
    z.textContent = "";
    var tete = el("div", { class: "ia-t" }, [el("b", {}, [el("span", { class: "etoile", texte: "✦" }), "L'IA te propose"]),
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
    if (i.attente) {
      var em = (/^(\S+)\s+/.exec(i.attente) || [])[1] || "⏳";
      z.appendChild(el("div", { class: "ia-attente" }, [el("span", { class: "em", "aria-hidden": "true", texte: em }), el("p", { texte: i.attente.slice(em.length).trim() })]));
      z.appendChild(el("p", { class: "ia-r", texte: "Je te propose une réponse dès qu'il t'écrit. Besoin de relancer ? Clique « Autres idées » ou dis à l'IA quoi écrire." }));
      z.appendChild(parlerIA());
      return;
    }
    if (i.offre && i.offre.ecart > 0) {
      var of = i.offre;
      z.appendChild(el("p", { class: "ia-offre " + (of.basse ? "basse" : "ok") }, [el("b", { texte: (of.insultante ? "Offre très basse : " : of.basse ? "Offre trop basse : " : "Offre correcte : ") + of.offre + " €" }),
        " soit " + of.ecart + " % sous ton prix (" + of.prix + " €)" + (of.insultante ? ". Au plus, un petit geste à " + of.contre + " €." : of.basse ? ". Contre-offre conseillée : " + of.contre + " € (plancher " + of.plancher + " €)." : ".")]));
    }
    if (i.consigne) z.appendChild(el("p", { class: "ia-r", texte: "D'après ta consigne : « " + i.consigne + " »" }));
    else if (i.resume) z.appendChild(el("p", { class: "ia-r", texte: i.resume }));
    // Langue ou compatibilité : ce qui a été vérifié, ou un rappel de vérifier avant d'envoyer.
    if (i.version && i.version.texte) z.appendChild(el("p", { class: "ia-verif " + (i.version.verifie ? "ok" : "doute"), texte: (i.version.verifie ? "✓ " : "⚠ ") + i.version.texte }));
    // Acheteur sans avis : ta règle s'applique, désactivable d'un clic (l'IA repropose alors des réponses normales).
    if (i.sansAvis) {
      z.appendChild(el("div", { class: "ia-nego" }, [el("button", { class: "pastille nego", type: "button", role: "switch", "aria-checked": String(etat.refuserSansAvis !== false), onclick: function () {
        etat.refuserSansAvis = etat.refuserSansAvis === false; try { RR.storage.local.set({ refuserSansAvis: etat.refuserSansAvis }); } catch (e) {} proposerIA(true);
      } }, [etat.refuserSansAvis !== false ? "✓ " : "+ ", "Refuser les acheteurs sans avis"])]));
    }
    var qui = acheteurLu(), choisie = etat.choisie || {};
    // Réponses qui tiennent le prix : on peut y ajouter « Pas de négociation possible… » d'un clic.
    var tient = (i.reponses || []).some(function (r) { return TIENT_PRIX[r.approche]; });
    if (tient) {
      var nego = el("button", { class: "pastille nego", type: "button", role: "switch", "aria-checked": String(!!etat.sansNego), onclick: function () {
        etat.sansNego = !etat.sansNego; try { RR.storage.local.set({ sansNego: etat.sansNego }); } catch (e) {} dessinerIA(z);
      } }, [etat.sansNego ? "✓ " : "+ ", "Pas de négociation possible"]);
      z.appendChild(el("div", { class: "ia-nego" }, [nego]));
    }
    (i.reponses || []).forEach(function (r) {
      var ap = APPROCHES[r.approche];
      var tx = r.fixe ? (r.texte || "") : smiley(personnaliser(r.texte || "", qui));   // message fixé par le vendeur : mot pour mot
      if (etat.sansNego && TIENT_PRIX[r.approche]) tx = avecSansNego(tx, choisie);
      r = { approche: r.approche, titre: r.titre, texte: tx, gras: (r.gras || []).concat(etat.sansNego && TIENT_PRIX[r.approche] ? ["Pas de négociation possible"] : []) };
      z.appendChild(el("button", { class: "rep fort" + (sensIA(r) ? " s-" + sensIA(r) : ""), type: "button", "aria-label": "Placer dans la zone de message : " + r.texte, onclick: function () { inserer(r.texte); } }, [
        el("span", { class: "ico" }, [icone(ICONE_APPROCHE[r.approche] || "question")]),
        el("span", { class: "q" }, [el("b", {}, [ap ? el("i", { class: "ap ap-" + r.approche, texte: ap }) : null, r.titre || "Réponse"]), el("span", { class: "plein" }, [apercu(r.texte, r.gras)])]),
      ]));
    });
    z.appendChild(parlerIA());
  }
  var TIENT_PRIX = { ferme: 1, couper_court: 1 };
  // « … je préfère le garder à 330 € 🙂 » → « … je préfère le garder à 330 €. Pas de négociation possible, les jeux sont dans la fourchette basse du marché 🙂 »
  function phraseSansNego(a) {
    var plusieurs = a && (a.lot || /^lot\b/i.test(a.titre || a.nom || ""));
    return "Pas de négociation possible, " + (plusieurs ? "les jeux sont" : "le jeu est") + " dans la fourchette basse du marché.";
  }
  function avecSansNego(t, a) {
    if (/pas de n[ée]gociation/i.test(t)) return t;
    var m = /(\s*(?:\p{Extended_Pictographic}\uFE0F?\s*)+)$/u.exec(t), fin = m ? m[1] : "", corps = (m ? t.slice(0, m.index) : t).replace(/\s+$/, "");
    if (!/[.!?…]$/.test(corps)) corps += ".";
    return corps + " " + phraseSansNego(a).replace(/\.$/, fin ? "" : ".") + (fin ? " " + fin.trim() : "");
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
        if (colonneConversation().innerText.trim().length < 40) return;
        // Autre conversation ouverte : on oublie tout de la précédente, même si l'IA lisait encore.
        if (etat.convPour !== idConversation() && !tape()) { recaler(); dessiner(); return; }
        if (occupe()) return;
        // Autre conversation (ou encadré chargé après coup) : le panneau se cale tout seul sur le jeu dont on parle,
        // sauf si la personne a choisi elle-même un jeu pour cette conversation.
        if (recaler()) dessiner();
        if (etat.ia && !etat.ia.charge && etat.ia.cle !== cleConversation()) proposerIA(false); }, 1500);
    });
    veilleMsg.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  /* Une conversation = un article. En changeant de conversation, on oublie l'article (ou le lot) de la précédente :
     on recale sur l'annonce affichée à côté de CETTE conversation, et l'IA attend que ce soit fait. */
  // Le Bon Coin peut garder la même adresse d'une conversation à l'autre : l'annonce affichée à côté compte aussi.
  function idConversation() { return location.pathname + location.search + "|" + norm(texteEncadre()).slice(0, 120); }
  function choixAJour() { return etat.choisiePour === idConversation(); }
  // Renvoie true si l'article choisi a changé (à redessiner).
  function recaler() {
    var id = idConversation(), c = etat.choisie;
    if (etat.convPour !== id) { etat.convPour = id; etat.convDepuis = Date.now(); etat.choisiePour = null; etat.manuel = null; etat.ia = null; etat.brouillonIA = ""; }
    if (etat.manuel && etat.manuel === conversationActuelle()) { etat.choisiePour = id; return false; }
    var d = deviner(true);
    if (!d && !choixAJour() && Date.now() - (etat.convDepuis || 0) > 5000) d = deviner(false);   // rien de repéré : l'article par défaut
    if (!d) return false;
    etat.choisiePour = id;
    if (!c || d.id !== c.id || d.titre !== c.titre || (d.articles || []).join("|") !== (c.articles || []).join("|")) { etat.choisie = d; return true; }
    return false;
  }
  function occupe() { return !!(etat.ia && etat.ia.charge) || tape(); }
  // La personne écrit une consigne à l'IA : on ne touche à rien.
  function tape() { var f = ombre && ombre.activeElement; return !!(f && f.matches && f.matches(".parler textarea")) || !!(etat.brouillonIA || "").trim(); }
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
  var SENS_APPROCHE = { accepter: "plus", ferme: "moins", couper_court: "moins", au_revoir: "plus" };
  var ICONE_APPROCHE = { contre_offre: "relance", ferme: "cadenas", couper_court: "stop", accepter: "ok", au_revoir: "ok", info: "question" };
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
  function lier(id, url, titre, prix) {
    var cle = url + "|" + (prix || "");
    if (!id || !url || liesSession[id] === cle) return;
    liesSession[id] = cle;
    rrDemander({ type: "lien", annonce: id, url: url, prix: prix || null }).then(function (r) {
      if (r && r.error) { delete liesSession[id]; return; }
      var ancien = null;
      (annoncesCache || []).forEach(function (a) { if (a.id === id) { a.publiee = true; a.url = url; if (r && r.prix != null) { ancien = a.prix; a.prix = r.prix; } } });
      (etat.annonces || []).forEach(function (a) { if (a.id === id && r && r.prix != null) a.prix = r.prix; });
      if (hote && ouvert && ombre) statut(r && r.prixChange ? "Prix de « " + titre + " » mis à jour dans RetroRevente : " + r.prix + " €" + (ancien != null ? " (avant " + ancien + " €)" : "") + "." : "Lien de l'annonce « " + titre + " » enregistré dans RetroRevente.", "ok");
    }).catch(function () { delete liesSession[id]; });
  }
  // Prix affiché sur la carte d'une annonce : un seul montant, sans compter un ancien prix barré.
  function prixAffiche(x) {
    var c = x;
    var u0 = urlAnnonce(x.href), autre = function (p) { return [].some.call(p.querySelectorAll("a[href*='/ad/']"), function (y) { var u = urlAnnonce(y.href); return u && u !== u0; }); };
    for (var i = 0; i < 5 && c.parentElement; i++) { var p = c.parentElement; if ((p.innerText || "").length > 500 || autre(p)) break; c = p; }
    var vus = {}, w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      var n = w.currentNode, e = n.parentElement; if (!e || !/\d\s?€/.test(n.nodeValue)) continue;
      if (e.closest("s,del,strike") || /line-through/.test(getComputedStyle(e).textDecorationLine || "")) continue;
      prixCarte(n.nodeValue).forEach(function (v) { if (v > 0) vus[v] = 1; });
    }
    var l = Object.keys(vus).map(Number);
    return l.length === 1 ? l[0] : null;
  }
  // Proximité entre un jeu et le texte d'une carte d'annonce : part des mots du titre retrouvés (0 à 1).
  function scoreTitre(a, texte) {
    var vus = {}; mots(texte).forEach(function (m) { vus[m] = 1; });
    return Math.max.apply(null, [a.titre, a.nom].filter(Boolean).map(function (t) {
      var m = mots(t); return m.length ? m.filter(function (x) { return vus[x]; }).length / m.length : 0;
    }).concat([0]));
  }
  function prixCarte(t) { return (String(t).match(/(\d[\d\s\u202f]{0,6})\s?€/g) || []).map(function (x) { return entier(x.replace(/[^\d]/g, "")); }); }
  // Texte de la carte qui entoure un lien d'annonce : on remonte tant que le bloc reste petit.
  function texteCarte(x) {
    var c = x, t = x.innerText + " " + (x.title || "") + " " + (x.getAttribute("aria-label") || "") + " " + ((x.querySelector("img[alt]") || {}).alt || "");
    for (var i = 0; i < 4 && c.parentElement; i++) {
      var p = c.parentElement, pt = p.innerText || "";
      if (pt.length > 500 || p.querySelectorAll("a[href*='/ad/']").length > 3) break;
      c = p; t += " " + pt;
    }
    return t;
  }
  // Associe chaque lien d'annonce visible au jeu qui lui ressemble le plus (un jeu ↔ une annonce), seulement si c'est net.
  function associer(sans, seuil, prixExige) {
    var paires = [];
    [].forEach.call(document.querySelectorAll("a[href*='/ad/']"), function (x) {
      var url = urlAnnonce(x.href); if (!url || (hote && hote.contains(x))) return;
      var t = texteCarte(x), px = prixCarte(t);
      sans.forEach(function (a) {
        var sc = scoreTitre(a, t); if (sc < seuil) return;
        var memePrix = a.prix != null && px.indexOf(a.prix) >= 0;
        if (prixExige && !memePrix) return;
        paires.push({ url: url, a: a, s: sc + (memePrix ? 0.5 : 0), lien: x });
      });
    });
    paires.sort(function (x, y) { return y.s - x.s; });
    var urls = {}, jeux = {};
    paires.forEach(function (p) {
      if (urls[p.url] || jeux[p.a.id]) return;
      // Deux jeux aussi proches pour la même annonce : on ne devine pas.
      if (paires.some(function (q) { return q.url === p.url && q.a.id !== p.a.id && q.s === p.s; })) { urls[p.url] = 1; return; }
      urls[p.url] = jeux[p.a.id] = 1; lier(p.a.id, p.url, p.a.titre, prixExige ? null : prixAffiche(p.lien));
    });
  }
  async function liensAuto() {
    var p = location.pathname;
    var mesAnnonces = /mes-annonces|\/compte\/|\/annonces\/(en-ligne|actives)/.test(p), pageAnnonce = AD.test(p), depot = DEPOT.test(p), messages = MESSAGES.test(p);
    if (!mesAnnonces && !pageAnnonce && !depot && !messages) return;
    var st = {}; try { st = (await RR.storage.local.get("depot")) || {}; } catch (e) {}
    var d = st.depot && Date.now() - st.depot.at < 3 * 3600e3 ? st.depot : null;
    if (d && (pageAnnonce || depot)) {
      var url = pageAnnonce ? urlAnnonce(location.href) : "";
      if (pageAnnonce) { var t = norm(document.title + " " + ((document.querySelector("h1") || {}).textContent || "")); if (t.indexOf(norm(d.titre).slice(0, 40)) < 0 && scoreTitre(d, t) < 0.8) url = ""; }
      if (!url && depot) { var a = [].find.call(document.querySelectorAll("a[href*='/ad/']"), function (x) { return urlAnnonce(x.href); }); if (a) url = urlAnnonce(a.href); }
      if (url) { lier(d.id, url, d.titre); try { RR.storage.local.remove("depot"); } catch (e) {} return; }
    }
    if (!mesAnnonces && !messages) return;
    if (!annoncesCache) { try { annoncesCache = (await rrDemander({ type: "annonces" })).annonces || []; } catch (e) { return; } }
    // « Mes annonces » : un prix changé sur Le Bon Coin est repris dans RetroRevente (annonces déjà liées).
    if (mesAnnonces) {
      var parUrl = {}; annoncesCache.forEach(function (a) { if (a.url) parUrl[a.url] = a; });
      [].forEach.call(document.querySelectorAll("a[href*='/ad/']"), function (x) {
        var u = urlAnnonce(x.href), a = u && parUrl[u]; if (!a || (hote && hote.contains(x))) return;
        var px = prixAffiche(x); if (px != null && px !== a.prix) lier(a.id, u, a.titre || a.nom, px);
      });
    }
    var sans = annoncesCache.filter(function (a) { return !a.publiee && (a.titre || a.nom); });
    if (!sans.length) return;
    // « Mes annonces » / profil : ce sont tes annonces, le titre suffit. Messagerie : il faut aussi le même prix
    // (une annonce d'un autre vendeur au titre proche ne doit pas être prise pour la tienne).
    associer(sans, messages ? 0.8 : 0.75, messages);
  }
  new MutationObserver(function () { clearTimeout(minuterieLiens); minuterieLiens = setTimeout(function () { liensAuto().catch(function () {}); }, 1200); })
    .observe(document.documentElement, { childList: true, subtree: true });

  /* ===== Bouton vert « Remplir avec RetroRevente » au-dessus du champ principal de l'écran de dépôt ===== */
  var boutonVert = null;
  function champDepot() {
    if (mode() !== "depot") return null;
    return champ("input:not([type]), input[type=text], input[type=search]", /titre|title|subject|objet de l.annonce/, /recherch|search|ville|adresse|code postal|localisation/)
      || [].filter.call(document.querySelectorAll("main input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), main textarea"), function (x) { return visible(x) && !x.disabled; })[0] || null;
  }
  function placerBoutonVert() {
    if (!boutonVert) boutonVert = rrBoutonRemplir(function () {
      if (!etat.choisie || !ouvert) return replie(false, function () { if (etat.choisie) remplirMaintenant(); else if (etat.ouvrirRecherche) etat.ouvrirRecherche(); });
      remplirMaintenant();
    }, "retrorevente-lbc-remplir", function () { return ombre && ombre.querySelector(".p, .rond"); });
    boutonVert.placer(champDepot());
    boutonVert.titre(etat.choisie ? "Remplir cet écran avec « " + etat.choisie.titre + " »" : "Choisir l'annonce à déposer");
  }
  function remplirMaintenant() {
    remplir(true).then(function (f) { if (!f.length) statut("Rien à remplir sur cet écran.", ""); }).catch(function (e) { statut(e.message, "bad"); });
  }

  /* ===== Messagerie native (app Mac) =====
     L'app Mac garde la messagerie Le Bon Coin chargée dans un navigateur caché (window.__rrNatif) et la lit ou l'écrit
     par ces fonctions : liste des conversations, fil d'une conversation, réponses de l'IA, envoi. Rien n'est envoyé sans
     un clic « Envoyer » dans l'app. Pas de panneau ni d'IA automatique dans ce navigateur-là. */
  var DATE_ENTREE = new RegExp(DATE_LISTE.source + "|\\b\\d{1,2}[:h]\\d{2}\\b|\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b|^(?:lun|mar|mer|jeu|ven|sam|dim)\\w*\\.?\\s*$|\\b\\d{1,2} (?:janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec)", "im");
  function entreesConversations() {
    var cand = [].filter.call(document.querySelectorAll("a[href], li, [role=link], [role=listitem], [role=button], button"), function (x) {
      if (!visible(x) || (hote && hote.contains(x)) || x.closest("header, nav, footer")) return false;
      var r = x.getBoundingClientRect(); if (r.left > innerWidth * 0.5 || r.height < 36 || r.height > 260) return false;
      var t = x.innerText || ""; return t.length > 3 && t.length < 700 && DATE_ENTREE.test(t);
    });
    // Rien dans la conversation ouverte (une bulle « Offre reçue · il y a 7 min » ressemble à une entrée de liste).
    var z = zoneMessage(), col = z ? colonneConversation() : null;
    var l = cand.filter(function (x) { return !cand.some(function (y) { return y !== x && y.contains(x); }) && !(col && (col.contains(x) || x.contains(col))); });
    // Une conversation est ouverte : seules comptent les entrées qui mènent à une conversation (lien de messagerie ou
    // vignette d'annonce). Les bulles de la conversation (« Merci. Au plaisir. 23:38 ») n'en ont pas.
    if (col) l = l.filter(function (x) {
      var a = x.matches("a[href]") ? x : x.querySelector("a[href]");
      return (a && /messag|conversation/i.test(a.getAttribute("href") || "")) || [].some.call(x.querySelectorAll("img"), function (i) { return i.getBoundingClientRect().width >= 28; });
    });
    // Les vraies entrées sont empilées dans une même colonne : même bord gauche et même largeur, à quelques pixels près.
    // On garde la colonne la plus fournie, ce qui écarte les morceaux de page égarés.
    var cles = {}, cle = function (x) { var r = x.getBoundingClientRect(); return Math.round(r.left / 8) + ":" + Math.round(r.width / 16); };
    l.forEach(function (x) { var k = cle(x); cles[k] = (cles[k] || 0) + 1; });
    var meilleure = Object.keys(cles).sort(function (a, b) { return cles[b] - cles[a]; })[0];
    if (meilleure && cles[meilleure] >= 2) l = l.filter(function (x) { return cle(x) === meilleure; });
    return l;
  }
  // Conversations sans annonce (chatbot promotionnel de Le Bon Coin, « Discussion avec le Père Noël »…) : ignorées.
  function horsAnnonce(e) { return /p[èe]re no[ëe]l|chatbot|assistant leboncoin|^discussion avec\b/i.test((e.lignes || []).slice(0, 2).join(" ")); }
  function cleEntree(x) {
    var a = x.matches("a[href]") ? x : x.querySelector("a[href]");
    if (a && /messag/.test(a.getAttribute("href") || "")) return a.getAttribute("href");
    return "t:" + norm(x.innerText || "").split(" ").slice(0, 12).join(" ");
  }
  function lireEntree(x) {
    // Les pastilles posées sur la vignette (« 2 » pour un lot de 2 articles, « +3 ») ne sont pas le nom de l'acheteur.
    var lignes = (x.innerText || "").split("\n").map(function (l) { return l.replace(/\s+/g, " ").trim(); }).filter(function (l) { return l && !/^\+?\d{1,3}$/.test(l); }).slice(0, 7);
    var img = [].find.call(x.querySelectorAll("img"), function (i) { return i.src && !/^data:/.test(i.src); });
    var gras = [].some.call(x.querySelectorAll("p, span, div"), function (e) { return e.childElementCount === 0 && (e.textContent || "").trim().length > 3 && +getComputedStyle(e).fontWeight >= 600; });
    var pastille = !!x.querySelector("[aria-label*='non lu' i], [title*='non lu' i], [data-qa-id*=unread], [data-test-id*=unread]");
    return { cle: cleEntree(x), lignes: lignes, image: img ? img.src : "", nonLu: pastille, gras: gras, active: x.getAttribute("aria-current") === "page" || x.getAttribute("aria-selected") === "true" };
  }
  function bulleDe(e, col) {
    for (var b = e, k = 0; b && b !== col && k < 6; b = b.parentElement, k++) {
      var st = getComputedStyle(b);
      if ((st.backgroundColor && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(st.backgroundColor)) || parseFloat(st.borderTopLeftRadius) >= 8) return b;
    }
    return e;
  }
  // Colonne de la liste des conversations (à gauche) : jamais lue comme des messages, jamais défilée pour l'historique.
  // Repérée sans tenir compte de la colonne de conversation (elle peut l'englober dans certaines mises en page).
  function paneListe() {
    var cand = [].filter.call(document.querySelectorAll("a[href], li, [role=link], [role=listitem]"), function (x) {
      if (!visible(x) || (hote && hote.contains(x)) || x.closest("header, nav, footer")) return false;
      var r = x.getBoundingClientRect(); if (r.left > innerWidth * 0.5 || r.height < 36 || r.height > 260) return false;
      var t = x.innerText || ""; if (!(t.length > 3 && t.length < 700 && DATE_ENTREE.test(t))) return false;
      var a = x.matches("a[href]") ? x : x.querySelector("a[href]");
      return (a && /messag|conversation/i.test(a.getAttribute("href") || "")) || [].some.call(x.querySelectorAll("img"), function (i) { return i.getBoundingClientRect().width >= 28; });
    });
    var es = cand.filter(function (x) { return !cand.some(function (y) { return y !== x && y.contains(x); }); });
    var cles = {}, cle = function (x) { var r = x.getBoundingClientRect(); return Math.round(r.left / 8) + ":" + Math.round(r.width / 16); };
    es.forEach(function (x) { var k = cle(x); cles[k] = (cles[k] || 0) + 1; });
    var m = Object.keys(cles).sort(function (a, b) { return cles[b] - cles[a]; })[0];
    if (!m || cles[m] < 3) return null;
    es = es.filter(function (x) { return cle(x) === m; });
    var p = es[0].parentElement, z = zoneMessage();
    while (p && !es.every(function (e) { return p.contains(e); })) p = p.parentElement;
    // Remonter tant que l'ancêtre ne contient que la liste (pas la zone de réponse) : toute la colonne de gauche.
    // (sans s'élargir : la liste est une colonne étroite, un parent bien plus large englobe aussi la conversation).
    while (p && p.parentElement && p.parentElement !== document.body && !(z && p.parentElement.contains(z))
           && p.parentElement.getBoundingClientRect().width <= p.getBoundingClientRect().width * 1.25 + 20) p = p.parentElement;
    return !p || p === document.body || (z && p.contains(z)) ? null : p;
  }
  var META = /^(?:\d{1,2}[:h]\d{2}|lu|vu|envoy[ée]|re[çc]u|distribu[ée]|lu à .*|vu à .*|envoy[ée] à .*)$/i;
  function filActuel() {
    var col = colonneConversation(), cr = col.getBoundingClientRect(), z = zoneMessage(), sugg = blocsSuggestions(col), out = [];
    var pane = paneListe();
    var w = document.createTreeWalker(col, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) {
      var t = (n.nodeValue || "").replace(/[ \t ]+/g, " ").trim(), e = n.parentElement;
      if (!t || !e || !visible(e) || (hote && hote.contains(e))) continue;
      if (z && (z === e || z.contains(e))) continue;
      if (pane && pane.contains(e)) continue;
      if (e.closest("textarea, [contenteditable]")) continue;
      // Libellé de bouton (« Accepter », « Refuser ») : écarté. Une carte d'offre cliquable, elle, est un vrai message.
      var bt = e.closest("button, [role=button]"); if (bt && (bt.innerText || "").trim().length < 40) continue;
      // Formulaire de saisie (petit, autour de la zone de réponse) : écarté ; un formulaire qui englobe le fil, non.
      var fm = e.closest("form"); if (fm && (!z || fm.contains(z)) && fm.getBoundingClientRect().height < cr.height * 0.4) continue;
      if (sugg.some(function (b) { return b.contains(e); })) continue;
      var b = bulleDe(e, col), r = b.getBoundingClientRect(); if (!r.width) continue;
      var g = r.left - cr.left, d = cr.right - r.right;
      var cote = r.width > cr.width * 0.88 || Math.abs(g - d) < 24 ? "centre" : g > d ? "moi" : "lui";
      var der = out[out.length - 1];
      if (META.test(t) && der) { der.meta = der.meta ? der.meta + " · " + t : t; continue; }
      if (der && der.el === b) { der.texte += "\n" + t; continue; }
      out.push({ el: b, cote: cote, texte: t, meta: "" });
    }
    var enc = texteEncadre().split("\n").map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 6);
    // Utilisateur bloqué : Le Bon Coin l'écrit dans la conversation, et la mise en page change (la liste et la fiche
    // « À propos de cet acheteur » se retrouvent dans la colonne). On le signale, et on écarte ces morceaux du fil.
    var BLOQUE = /l.utilisateur est bloqu|vous avez bloqu|impossible de recevoir ou d.envoyer des messages/i;
    var bloque = BLOQUE.test(col.innerText || "") || out.some(function (m) { return BLOQUE.test(m.texte); });
    var lignesListe = {};
    if (bloque) entreesConversations().forEach(function (x) { (x.innerText || "").split("\n").forEach(function (l) { l = norm(l); if (l) lignesListe[l] = 1; }); });
    var FICHE = /^(à propos de|a propos de|membre depuis|\d+ transactions?|temps de r[ée]ponse|derni[èe]re activit[ée]|l.utilisateur est bloqu|impossible de recevoir|r[ée]pond (en|g[ée]n[ée]ralement)|[()]$|[(]\s*\d+\s*[)]$|[0-5]([.,]\d)?$|-$)/i;
    out = out.filter(function (m) {
      var ls = m.texte.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
      if (!ls.length || FICHE.test(ls[0])) return false;
      // Entrée de liste égarée (« Antoine », « - », « avant-hier ») : jamais un message.
      if (ls.length <= 4 && ls.indexOf("-") > 0 && DATE_ENTREE.test(ls[ls.length - 1])) return false;
      if (ls.every(function (l) { return lignesListe[norm(l)] || l === "-" || DATE_ENTREE.test(l); })) return false;
      if (ls.length === 1 && norm(ls[0]) === norm(acheteurLu())) return false;
      return true;
    });
    // Rien trouvé bulle par bulle (mise en page inconnue, carte d'offre seule) : on garde le texte de la conversation,
    // paragraphe par paragraphe, plutôt qu'un fil vide.
    if (!out.length) {
      var brut = texteConversation().split("[Conversation]\n").pop();
      if (pane) (pane.innerText || "").split("\n").forEach(function (l) { l = norm(l); if (l) lignesListe[l] = 1; });
      out = brut.split(/\n{2,}/).map(function (p) { return p.split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l && !lignesListe[norm(l)] && !DATE_ENTREE.test(l); }).join("\n"); })
        .filter(function (t) { return t && !FICHE.test(t) && norm(t) !== norm(acheteurLu()); })
        .map(function (t) { return { cote: "lui", texte: t, meta: "" }; });
    }
    return { cle: idConversation(), acheteur: acheteurLu(), annonce: enc, dernierMoi: dernierEstMoi(), bloque: bloque,
             messages: out.map(function (m) { return { cote: m.cote, texte: m.texte.slice(0, 3000), meta: m.meta }; }).slice(-400) };
  }
  // Historique complet : Le Bon Coin ne charge que les derniers messages, les plus anciens arrivent en remontant le fil.
  // On remonte tout en haut jusqu'à ce que plus rien n'arrive, on lit, on redescend, et on recolle les deux lectures
  // (au cas où la page retirerait les messages sortis de l'écran).
  function zoneDefilement() {
    var col = colonneConversation(), z = zoneMessage(), best = null, pane = paneListe();
    var defile = function (x) { return x.scrollHeight > x.clientHeight + 40 && /(auto|scroll|overlay)/.test(getComputedStyle(x).overflowY); };
    [].forEach.call(col.querySelectorAll("div, section, main, ul, ol"), function (x) {
      if ((hote && hote.contains(x)) || (z && x.contains(z) && x !== col)) return;
      if (pane && (pane.contains(x) || x.contains(pane))) return;   // jamais la liste des conversations
      if (x.scrollHeight > x.clientHeight + 40 && (!best || x.scrollHeight > best.scrollHeight) && defile(x)) best = x;
    });
    for (var e = col; !best && e && e !== document.body; e = e.parentElement) if (defile(e) && !(pane && e.contains(pane))) best = e;
    return best;
  }
  function recoller(a, b) {
    var cle = function (m) { return m.cote + "|" + m.texte; }, kb = {};
    b.forEach(function (m) { kb[cle(m)] = 1; });
    if (a.every(function (m) { return kb[cle(m)]; })) return b;
    for (var k = Math.min(a.length, b.length); k > 0; k--) {
      var ok = true;
      for (var i = 0; i < k && ok; i++) ok = cle(a[a.length - k + i]) === cle(b[i]);
      if (ok) return a.concat(b.slice(k));
    }
    var j = b.length ? a.map(cle).indexOf(cle(b[0])) : -1;
    return j >= 0 ? a.slice(0, j).concat(b) : a.concat(b);
  }
  async function historiqueComplet() {
    var s = zoneDefilement(); if (!s) return filActuel();
    var h = -1, stable = 0;
    for (var i = 0; i < 40 && stable < 3; i++) {
      s.scrollTop = 0; s.dispatchEvent(new Event("scroll", { bubbles: true }));
      await attendre(500);
      if (s.scrollHeight === h) stable++; else stable = 0;
      h = s.scrollHeight;
    }
    var haut = filActuel();
    s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event("scroll", { bubbles: true }));
    await attendre(400);
    var f = filActuel();
    f.messages = recoller(haut.messages, f.messages).slice(-400);
    return f;
  }
  // Liste des conversations, ou null quand la page ne montre que la conversation ouverte (mise en page étroite) :
  // l'app garde alors la liste précédente au lieu de prendre les messages pour des conversations.
  function listeConversations() {
    var l = entreesConversations().map(lireEntree).filter(function (e) { return !horsAnnonce(e); }).slice(0, 80);
    return !l.length && zoneMessage() ? null : l;
  }
  // Entrée de la liste par sa clé ; si la clé a changé (texte de l'entrée modifié), par le nom et l'annonce.
  function entreeParCle(cle, lignes) {
    var es = entreesConversations(), x = es.find(function (e) { return cleEntree(e) === cle; });
    if (x || !lignes || !lignes.length) return x;
    var sig = function (l) { return l.filter(function (t) { return !DATE_ENTREE.test(t); }).slice(0, 2).map(norm).join("|"); }, s = sig(lignes);
    return es.find(function (e) { return sig(lireEntree(e).lignes) === s; });
  }
  window.rrMessagerie = {
    liste: function () { return { page: location.pathname, vide: /\baucun(e)? (message|conversation)|pas (encore )?de (message|conversation)/i.test(norm((document.querySelector("main") || document.body).innerText).slice(0, 3000)), connexion: [].some.call(document.querySelectorAll("input[type=password]"), visible), conversations: listeConversations(), fil: colonneConversation().innerText.trim().length > 40 && zoneMessage() ? filActuel() : null }; },
    fil: function () { return filActuel(); },
    // Supprime une conversation sur Le Bon Coin (après la confirmation demandée dans l'app) : on l'ouvre, on cherche
    // « Supprimer » (au besoin dans le menu « … » de la conversation), puis on confirme. Rien d'autre n'est cliqué.
    supprimer: async function (cle) {
      var x = entreesConversations().find(function (e) { return cleEntree(e) === cle; });
      if (!x) return { erreur: "introuvable" };
      cliquer(x.matches("a[href]") ? x : (x.querySelector("a[href]") || x));
      await attendre(1500);
      var boutons = function (racine) { return [].filter.call((racine || document).querySelectorAll("button, [role=button], [role=menuitem], a"), function (b) { return visible(b) && !(hote && hote.contains(b)); }); };
      var nom = function (b) { return norm((b.getAttribute("aria-label") || "") + " " + (b.innerText || "") + " " + (b.getAttribute("title") || "")); };
      var trouver = function (re, racine) { return boutons(racine).find(function (b) { return re.test(nom(b)); }); };
      var sup = trouver(/supprimer (la |cette )?(conversation|discussion)/i);
      if (!sup) {
        var menu = trouver(/plus d.options|^options|actions|menu|more|\.\.\.|…/i, colonneConversation().parentElement || document);
        if (menu) { cliquer(menu); await attendre(700); sup = trouver(/supprimer/i); }
      }
      if (!sup) return { erreur: "bouton" };
      cliquer(sup); await attendre(900);
      var dlg = document.querySelector("[role=dialog], [role=alertdialog], dialog[open]");
      var ok = dlg && trouver(/^(supprimer|confirmer|oui)/i, dlg);
      if (ok) { cliquer(ok); await attendre(1500); }
      var reste = entreesConversations().some(function (e) { return cleEntree(e) === cle; });
      return reste ? { erreur: "confirmation" } : { ok: true };
    },
    // Bloque l'acheteur sur Le Bon Coin (après la confirmation demandée dans l'app) : on ouvre la conversation, on cherche
    // « Bloquer » (au besoin dans le menu « … » de la conversation), puis on confirme. Rien d'autre n'est cliqué.
    bloquer: async function (cle, lignes) {
      var x = entreeParCle(cle, lignes);
      if (!x) return { erreur: "introuvable" };
      cliquer(x.matches("a[href]") ? x : (x.querySelector("a[href]") || x));
      await attendre(1500);
      var boutons = function (racine) { return [].filter.call((racine || document).querySelectorAll("button, [role=button], [role=menuitem], a"), function (b) { return visible(b) && !(hote && hote.contains(b)); }); };
      var nom = function (b) { return norm((b.getAttribute("aria-label") || "") + " " + (b.innerText || "") + " " + (b.getAttribute("title") || "")); };
      var trouver = function (re, racine) { return boutons(racine).find(function (b) { return re.test(nom(b)); }); };
      if (trouver(/d[ée]bloquer/i)) return { ok: true, deja: true, verifie: true };
      var bl = trouver(/^bloquer|bloquer (cet|l.)?(utilisateur|acheteur|membre|contact)/i);
      if (!bl) {
        var menu = trouver(/plus d.options|^options|actions|menu|more|\.\.\.|…/i, colonneConversation().parentElement || document);
        if (menu) { cliquer(menu); await attendre(700); if (trouver(/d[ée]bloquer/i)) return { ok: true, deja: true, verifie: true }; bl = trouver(/bloquer/i); }
      }
      if (!bl) return { erreur: "bouton" };
      cliquer(bl); await attendre(900);
      var dlg = document.querySelector("[role=dialog], [role=alertdialog], dialog[open]");
      var ok = dlg && trouver(/^(bloquer|confirmer|oui)/i, dlg);
      if (ok) { cliquer(ok); await attendre(1500); }
      // Vérification sur la page : un message « bloqué », ou « Débloquer » à la place de « Bloquer » (au besoin dans le menu).
      var dit = function () { return /(vous avez bloqu|utilisateur bloqu|membre bloqu|a [ée]t[ée] bloqu|est bloqu|bloqu[ée] avec succ)/i.test(norm(document.body.innerText)); };
      var verifie = dit() || !!trouver(/d[ée]bloquer/i);
      if (!verifie) {
        var m2 = trouver(/plus d.options|^options|actions|menu|more|\.\.\.|…/i, colonneConversation().parentElement || document);
        if (m2) { cliquer(m2); await attendre(700); verifie = !!trouver(/d[ée]bloquer/i); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }
      }
      return { ok: true, verifie: verifie };
    },
    ouvrir: async function (cle, lignes) {
      var x = entreeParCle(cle, lignes);
      if (!x) return { erreur: "introuvable" };
      var avant = idConversation(), cible = x.matches("a[href]") ? x : (x.querySelector("a[href]") || x);
      // Déjà ouverte sur la page (Le Bon Coin ouvre souvent la première conversation tout seul) : l'id ne changera pas,
      // on s'arrête dès que la colonne montre le bon acheteur et la bonne annonce au lieu d'attendre 10 s.
      var l = lireEntree(x).lignes.filter(function (t) { return !DATE_ENTREE.test(t); });
      var nom = norm(l[0] || ""), titre = norm((l[1] || "").replace(/(\.\.\.|…)$/, "")).slice(0, 40);
      var montre = function () { var t = norm(colonneConversation().innerText.slice(0, 2000)); return t.length > 40 && (!nom || t.indexOf(nom) >= 0) && (!titre || t.indexOf(titre) >= 0); };
      cliquer(cible);
      for (var i = 0; i < 40; i++) { await attendre(250); if ((idConversation() !== avant && colonneConversation().innerText.trim().length > 40) || (i >= 3 && montre())) break; }
      // Les messages arrivent parfois après l'en-tête : on attend qu'ils soient là (jusqu'à 4 s) avant de lire le fil.
      var f = null;
      for (var k = 0; k < 10; k++) { await attendre(k ? 400 : 600); f = filActuel(); if (f.messages.length && (!titre || montre())) break; }
      if (f && f.messages.length) f = await historiqueComplet();
      return f;
    },
    suggestions: async function (consigne) {
      if (!etat.annonces) { try { var j = await rrDemander({ type: "annonces" }); etat.annonces = j.annonces || []; etat.vendeur = (j.profil && j.profil.vendeur) || {}; } catch (e) {} }
      recaler(); if (!etat.choisie) etat.choisie = deviner(true) || deviner();
      var c = etat.choisie || {}, lot = lotLu() || (c.lot && choixAJour() ? { n: c.n, prix: c.prix } : null);
      try {
        var r = await rrDemander({ type: "reponse", annonce: c.lot ? "" : (c.id || ""), conversation: texteConversation(), lot: lot, offre: offreOfficielle(), acheteur: acheteurLu(), consigne: consigne || "", precedentes: [], mesMessages: mesMessages(), suite: !!consigne && dernierEstMoi(), dernierMoi: !consigne && dernierEstMoi(), refuserSansAvis: etat.refuserSansAvis !== false });
        var qui = acheteurLu();
        return { article: c.titre || "", resume: r.resume || "", offre: r.offre || null, version: r.version || null,
                 reponses: (r.reponses || []).map(function (x) { return { approche: x.approche || "", titre: x.titre || "", fixe: !!x.fixe, texte: x.fixe ? (x.texte || "") : smiley(personnaliser(x.texte || "", qui)) }; }) };
      } catch (e) { return { erreur: e.message || "Réponse impossible", status: e.status || 0 }; }
    },
    envoyer: async function (texte) {
      var z = zoneMessage(); if (!z) return { erreur: "Zone de message introuvable" };
      if (z instanceof HTMLTextAreaElement || z instanceof HTMLInputElement) { ecrire(z, texte); z.focus(); }
      else { z.focus(); var sel = window.getSelection(); sel.selectAllChildren(z); if (!document.execCommand("insertText", false, texte)) z.textContent = texte; z.dispatchEvent(new Event("input", { bubbles: true })); }
      await attendre(400);
      var zone = z.closest("form") || z.parentElement && z.parentElement.parentElement && z.parentElement.parentElement.parentElement || document;
      var b = [].find.call(zone.querySelectorAll("button, [role=button], input[type=submit]"), function (x) {
        return visible(x) && !x.disabled && x.getAttribute("aria-disabled") !== "true" && /envoy|send|submit/.test(norm((x.getAttribute("aria-label") || "") + " " + (x.getAttribute("title") || "") + " " + (x.textContent || "") + " " + (x.type || "")));
      });
      if (!b) return { erreur: "Bouton Envoyer introuvable : le message est écrit, ouvre Le Bon Coin pour l'envoyer." };
      cliquer(b);
      for (var i = 0; i < 16; i++) {
        await attendre(250);
        var v = z.isConnected ? (z.value != null ? z.value : z.textContent) : "";
        if (!String(v || "").trim()) return { ok: true, fil: filActuel() };
      }
      return { ok: true, incertain: true, fil: filActuel() };
    },
  };
  // Une erreur dans la page ne doit jamais laisser l'app attendre : chaque fonction renvoie { erreur } au lieu de lever.
  Object.keys(window.rrMessagerie).forEach(function (k) {
    var f = window.rrMessagerie[k];
    window.rrMessagerie[k] = async function () {
      try { return await f.apply(null, arguments); }
      catch (e) { return { erreur: "Lecture impossible (" + k + ")", pile: String((e && (e.stack || e.message)) || e).slice(0, 1500) }; }
    };
  });

  /* ===== Apparition pendant le dépôt et dans la messagerie (Le Bon Coin change de page sans recharger) ===== */
  var vu = "", vuMode = "";
  function suivre() {
    if (window.__rrNatif) return;   // navigateur caché de la messagerie native : ni panneau ni automatismes
    guetterConfirmation().catch(function () {});
    try { placerBoutonVert(); } catch (e) {}
    if (location.pathname === vu) return;
    confirmationFetee = false;
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
    } else if (m === "messages" && ouvert && etat.annonces) { if (!tape()) { etat.choisie = deviner(true) || etat.choisie || deviner(); dessiner(); } }   // autre conversation
  }
  suivre();
  setInterval(suivre, 800);
})();
