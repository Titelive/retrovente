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

  /* ===== Panneau ===== */
  var CSS = ":host{all:initial}*{box-sizing:border-box}" +
    ".b{position:fixed;right:18px;bottom:18px;z-index:2147483646;font:500 14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1A1A}" +
    ".rond{width:56px;height:56px;border-radius:50%;border:0;background:#1A1A1A;color:#D4F57A;font:700 15px/1 inherit;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25)}" +
    ".p{width:340px;max-width:calc(100vw - 36px);max-height:calc(100vh - 36px);overflow:auto;background:#fff;border-radius:20px;box-shadow:0 16px 48px rgba(0,0,0,.28);padding:16px;display:flex;flex-direction:column;gap:10px}" +
    ".t{display:flex;align-items:center;justify-content:space-between;gap:8px}.t b{font-size:15px}.t b span{background:#D4F57A;border-radius:6px;padding:1px 6px;margin-right:6px}" +
    ".x{border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:#62625C;padding:4px}" +
    "select,button{font:inherit}select{width:100%;padding:8px 10px;border:1px solid #E6E6DE;border-radius:10px;background:#fff;color:#1A1A1A}" +
    ".go{border:0;border-radius:999px;background:#1A1A1A;color:#fff;font-weight:700;padding:11px 16px;cursor:pointer}.go:hover{background:#333}" +
    ".c{display:grid;grid-template-columns:1fr auto;gap:6px 8px;align-items:center;font-size:13px}.c div{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#62625C}.c div b{color:#1A1A1A;font-weight:600}" +
    ".mini{border:1px solid #E6E6DE;background:#F6F6F1;border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer;color:#1A1A1A}.mini:hover{background:#F1FCD0}" +
    ".s{font-size:13px;color:#62625C;background:#F6F6F1;border-radius:10px;padding:8px 10px}.s.ok{background:#F1FCD0;color:#1A1A1A}.s.bad{background:#FDE8E4;color:#8A1F11}" +
    ".n{font-size:11.5px;color:#A3A39B}a{color:#1A1A1A}";

  function construire() {
    hote = document.createElement("div");
    hote.id = "retrorevente-extension";
    ombre = hote.attachShadow({ mode: "open" });
    try { var f = new CSSStyleSheet(); f.replaceSync(CSS); ombre.adoptedStyleSheets = [f]; }
    catch (e) { var st = document.createElement("style"); st.textContent = CSS; ombre.appendChild(st); }
    var b = document.createElement("div"); b.className = "b"; ombre.appendChild(b);
    document.documentElement.appendChild(hote);
    replie(true);
  }
  function el(tag, attrs, enfants) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === "texte") e.textContent = attrs[k]; else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
    (enfants || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function boite() { return ombre.querySelector(".b"); }
  function replie(oui) {
    var b = boite(); b.textContent = "";
    if (oui) { b.appendChild(el("button", { class: "rond", title: "RetroRevente : remplir l'annonce", "aria-label": "Ouvrir RetroRevente", texte: "RR", onclick: function () { replie(false); } })); return; }
    b.appendChild(el("div", { class: "p", role: "dialog", "aria-label": "RetroRevente" }, [
      el("div", { class: "t" }, [el("b", {}, [el("span", { texte: "RR" }), document.createTextNode("RetroRevente")]), el("button", { class: "x", "aria-label": "Réduire", texte: "×", onclick: function () { replie(true); } })]),
      el("div", { class: "corps" }),
      el("div", { class: "s", texte: "Chargement de tes annonces…" }),
      el("div", { class: "n", texte: "L'extension remplit les champs de l'écran affiché quand tu cliques. Tu gardes la main : c'est toi qui continues et publies." }),
    ]));
    charger();
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
  function dessiner() {
    var corps = ombre.querySelector(".corps"); corps.textContent = "";
    var l = etat.annonces;
    if (!l.length) { statut("Aucun jeu « En vente » dans RetroRevente. Prépare une annonce dans l'appli, puis reviens ici.", ""); corps.appendChild(el("button", { class: "go", texte: "Ouvrir RetroRevente", onclick: function () { window.open("https://retrorevente.fr/app/", "_blank", "noopener"); } })); return; }
    // Par défaut : la plus récente qui n'a pas encore de lien d'annonce.
    if (!etat.choisie || !l.some(function (a) { return a.id === etat.choisie.id; })) etat.choisie = l.find(function (a) { return !a.publiee; }) || l[0];
    var sel = el("select", { "aria-label": "Annonce à déposer", onchange: function () { etat.choisie = l.find(function (a) { return a.id === sel.value; }); dessiner(); } },
      l.map(function (a) { var o = el("option", { value: a.id, texte: a.titre + (a.prix != null ? " · " + a.prix + " €" : "") + (a.publiee ? " (déjà publiée)" : "") }); if (a.id === etat.choisie.id) o.selected = true; return o; }));
    var a = etat.choisie;
    var ligne = function (nom, val, copie) { return [el("div", { title: val }, [el("b", { texte: nom + " : " }), document.createTextNode(val || "—")]), copie ? el("button", { class: "mini", texte: "Copier", onclick: function () { copier(copie, nom); } }) : el("span")]; };
    var grille = el("div", { class: "c" }, [].concat(
      ligne("Titre", a.titre, a.titre),
      ligne("Description", a.description.replace(/\n/g, " "), a.description),
      ligne("Prix", a.prix != null ? a.prix + " €" : "", a.prix != null ? String(a.prix) : ""),
      ligne("État", ETAT_TXT[a.etat] || "", ""),
      [el("div", {}, [el("b", { texte: "Photo : " }), document.createTextNode(a.photo ? "oui" : "aucune")]), a.photo ? el("button", { class: "mini", texte: "Enregistrer", onclick: telecharger }) : el("span")]
    ));
    corps.appendChild(el("div", { style: "display:flex;flex-direction:column;gap:10px" }, [sel, grille, el("button", { class: "go", texte: "Remplir cette étape", onclick: function () { remplir().catch(function (e) { statut(e.message, "bad"); }); } })]));
    statut(DEPOT.test(location.pathname) ? "À chaque écran du dépôt, clique « Remplir cette étape »." : "Ouvre « Déposer une annonce » sur Le Bon Coin.", "");
  }
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
