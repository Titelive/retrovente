// Sur ebay.fr : RetroRevente aide aussi à vendre sur eBay.
// - Messagerie eBay : le panneau lit la conversation, retrouve l'article (lien /itm/ déjà enregistré, sinon titre et
//   prix) et l'offre de l'acheteur, puis l'IA propose trois réponses. Un clic place la réponse dans la zone de
//   message : la personne relit et envoie elle-même.
// - Mise en vente : sur « Commencer votre annonce », le titre de l'article choisi dans l'appli (bouton « Créer l'annonce
//   sur eBay ») est tapé et la recherche lancée ; dans le formulaire, l'état, le prix, les caractéristiques, la description
//   et les photos sont remplis une fois. L'extension ne clique jamais « Mettre en vente » : la personne relit et publie.
// - « Mes ventes », Seller Hub et confirmation de mise en vente : chaque annonce dont le titre (et, dans la messagerie,
//   le prix) correspond nettement à un article RetroRevente sans lien eBay voit son adresse /itm/ enregistrée dans la
//   fiche. En cas de doute entre deux articles, rien n'est lié.
// L'extension ne lit pas les annonces des autres pour elle-même, ne clique jamais « Envoyer » et n'envoie rien à eBay.
(function () {
  if (window.top !== window || window.__rrEbay) return;
  window.__rrEbay = true;

  var norm = function (s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase(); };
  var VIDES = ("the and les des une pour avec sans pal eur ntsc jeu jeux video version edition complet loose boite cartouche notice " +
    "nintendo sony sega microsoft playstation xbox console tres bon etat").split(" ");
  function mots(t) { return norm(t).replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter(function (m) { return m.length >= 3 && VIDES.indexOf(m) < 0; }); }

  // Pages : messagerie (mesg.ebay.fr, www.ebay.fr/mesg…, /cnt/…, …/messages) et pages vendeur (Seller Hub, Mon eBay ventes, mise en vente).
  function mode() {
    var h = location.hostname, p = location.pathname;
    if (/^mesg\./.test(h) || /^\/(mesg|mesh|cnt|msg)(\/|$)/i.test(p) || /\/messages?(\/|$)/i.test(p)) return "messages";
    // Mise en vente : « Commencer votre annonce » (/sl/prelist…), puis le formulaire (/lstng, /sl/list…).
    if (/^\/sl\/prelist(\/|$)/i.test(p) || champVente()) return "prelist";
    if (/^\/(lstng|sl\/(list|sell))(\/|$)/i.test(p)) return "formulaire";
    if (/^\/(sh|mys|sl)(\/|$)/i.test(p) || /^\/myb\/(Selling|ActiveListings|Summary)/i.test(p)) return "vendeur";
    return "";
  }

  // « Dites-nous ce que vous vendez » : reconnu par son texte, quelle que soit l'adresse de la page.
  var VENTE = /dites-nous ce que vous vendez|que vendez-vous|tell us what you.?re selling|what are you selling/;
  function champVente() {
    return [].filter.call(document.querySelectorAll("input, textarea"), function (x) {
      return VENTE.test(norm((x.getAttribute("placeholder") || "") + " " + (x.getAttribute("aria-label") || ""))) && visibleEl(x);
    })[0] || null;
  }

  /* ===== Annonces de la personne (lues une fois, puis gardées) ===== */
  var annonces = null, chargeEnCours = null;
  function charger() {
    if (annonces) return Promise.resolve(annonces);
    if (!chargeEnCours) chargeEnCours = rrDemander({ type: "annonces" }).then(function (j) { annonces = (j && j.annonces) || []; return annonces; }, function (e) { chargeEnCours = null; throw e; });
    return chargeEnCours;
  }

  /* ===== Liens /itm/ et prix ===== */
  var ITM = /\/itm\/(?:[^/?#]+\/)?(\d{9,15})(?:[/?#]|$)/;
  function urlItm(href) {
    try {
      var u = new URL(href, location.href), m = ITM.exec(u.pathname + (u.pathname.slice(-1) === "/" ? "" : "/"));
      if (!m && /^\/itm\/?$/.test(u.pathname) && /^\d{9,15}$/.test(u.searchParams.get("item") || "")) m = [0, u.searchParams.get("item")];
      return m && /(^|\.)ebay\.fr$/.test(u.hostname) ? "https://www.ebay.fr/itm/" + m[1] : "";
    } catch (e) { return ""; }
  }
  // Montants eBay : « 45,00 EUR », « EUR 45,00 », « 45,00 € ».
  var MONTANT = /(?:EUR\s?(\d[\d\s  .]{0,8}(?:,\d{2})?)|(\d[\d\s  .]{0,8}(?:,\d{2})?)\s?(?:EUR|€))/g;
  function montant(x) { var n = parseFloat(String(x).replace(/[\s  .]/g, "").replace(",", ".")); return isFinite(n) && n > 0 ? Math.round(n) : null; }
  function montants(t) { var l = [], m; MONTANT.lastIndex = 0; while ((m = MONTANT.exec(String(t)))) { var v = montant(m[1] || m[2]); if (v != null) l.push(v); } return l; }
  function scoreTitre(a, texte) {
    var vus = {}; mots(texte).forEach(function (m) { vus[m] = 1; });
    return Math.max.apply(null, [a.titre, a.nom].filter(Boolean).map(function (t) {
      var m = mots(t); return m.length ? m.filter(function (x) { return vus[x]; }).length / m.length : 0;
    }).concat([0]));
  }
  // Texte du bloc qui entoure un lien d'annonce : on remonte tant que le bloc reste petit et ne parle que de cette annonce.
  function texteCarte(x) {
    var c = x, t = (x.innerText || "") + " " + (x.title || "") + " " + (x.getAttribute("aria-label") || "") + " " + ((x.querySelector("img[alt]") || {}).alt || "");
    var u0 = urlItm(x.href);
    for (var i = 0; i < 4 && c.parentElement; i++) {
      var p = c.parentElement, pt = p.innerText || "";
      if (pt.length > 600 || [].some.call(p.querySelectorAll("a[href*='/itm/']"), function (y) { var u = urlItm(y.href); return u && u !== u0; })) break;
      c = p; t += " " + pt;
    }
    return t;
  }

  var liesSession = {};
  function lier(a, url) {
    if (!a || !url || liesSession[a.id] === url) return;
    liesSession[a.id] = url;
    rrDemander({ type: "lien", site: "ebay", annonce: a.id, url: url }).then(function (r) {
      if (r && r.error) { delete liesSession[a.id]; return; }
      a.urlEbay = url;
      bulle("Annonce eBay « " + (a.titre || a.nom) + " » enregistrée dans RetroRevente.");
      if (ombre) dessiner();
    }).catch(function () { delete liesSession[a.id]; });
  }
  // Associe chaque lien /itm/ visible à l'article qui lui ressemble le plus (un article ↔ une annonce), seulement si c'est net.
  // Dans la messagerie, il faut aussi le même prix : un objet d'un autre vendeur au titre proche n'est pas le tien.
  function associer(prixExige) {
    if (!annonces) return;
    var sans = annonces.filter(function (a) { return !a.urlEbay && (a.titre || a.nom); });
    if (!sans.length) return;
    var pris = {}; annonces.forEach(function (a) { if (a.urlEbay) pris[a.urlEbay] = 1; });
    var paires = [];
    [].forEach.call(document.querySelectorAll("a[href*='/itm/']"), function (x) {
      var url = urlItm(x.href); if (!url || pris[url] || (hote && hote.contains(x))) return;
      var t = texteCarte(x), px = montants(t);
      sans.forEach(function (a) {
        var sc = scoreTitre(a, t); if (sc < (prixExige ? 0.8 : 0.75)) return;
        var memePrix = a.prix != null && px.indexOf(a.prix) >= 0;
        if (prixExige && !memePrix) return;
        paires.push({ url: url, a: a, s: sc + (memePrix ? 0.5 : 0) });
      });
    });
    paires.sort(function (x, y) { return y.s - x.s; });
    var urls = {}, jeux = {};
    paires.forEach(function (p) {
      if (urls[p.url] || jeux[p.a.id]) return;
      if (paires.some(function (q) { return q.url === p.url && q.a.id !== p.a.id && q.s === p.s; })) { urls[p.url] = 1; return; }
      if (paires.some(function (q) { return q.a.id === p.a.id && q.url !== p.url && q.s === p.s && !urls[q.url]; })) { jeux[p.a.id] = 1; return; }
      urls[p.url] = jeux[p.a.id] = 1; lier(p.a, p.url);
    });
  }

  /* ===== Messagerie : conversation, article, offre ===== */
  function zoneTexte() {
    var c = document.querySelector("main, [role=main]") || document.body;
    var t = (c.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    return t.slice(-5000);
  }
  // L'article : d'abord un lien /itm/ déjà enregistré, sinon le titre le plus proche (avec le même prix).
  function deviner() {
    if (!annonces) return null;
    var parUrl = {}; annonces.forEach(function (a) { if (a.urlEbay) parUrl[a.urlEbay] = a; });
    var liens = [].map.call(document.querySelectorAll("a[href*='/itm/']"), function (x) { return hote && hote.contains(x) ? "" : urlItm(x.href); }).filter(Boolean);
    for (var i = liens.length - 1; i >= 0; i--) if (parUrl[liens[i]]) return parUrl[liens[i]];
    var t = zoneTexte(), px = montants(t), meilleur = null, sc0 = 0;
    annonces.forEach(function (a) { var s = scoreTitre(a, t) + (a.prix != null && px.indexOf(a.prix) >= 0 ? 0.3 : 0); if (s > sc0) { sc0 = s; meilleur = a; } });
    return sc0 >= 0.75 ? meilleur : null;
  }
  // Offre de l'acheteur : « Offre de 120,00 EUR », « a proposé 120,00 EUR », « Meilleure offre : EUR 120,00 » (la plus récente).
  function offreLue() {
    var t = zoneTexte(), re = /(?:offre|propos[ée]|propose|contre-offre)[^\n]{0,60}?(?:EUR\s?(\d[\d\s  .]{0,8}(?:,\d{2})?)|(\d[\d\s  .]{0,8}(?:,\d{2})?)\s?(?:EUR|€))/gi, m, v = null;
    while ((m = re.exec(t))) v = montant(m[1] || m[2]);
    return v;
  }

  /* ===== Panneau ===== */
  var hote, ombre, ouvert = true, etat = { choisie: null, ia: null, brouillon: "", cle: "" };
  var CSS =
    ".b{--anis:#D4F57A;--anis-p:#F1FCD0;--nuit:#1A1A1A;--carte:#fff;--papier:#F6F6F1;--encre:#1A1A1A;--gris:#62625C;--trait:#E6E6DE;--ebay:#0064D2;--titre:'RR Rubik',ui-rounded,'Arial Rounded MT Bold',system-ui,sans-serif;--texte:'RR Figtree',system-ui,-apple-system,'Segoe UI',sans-serif;--ease:cubic-bezier(.2,.8,.2,1);" +
    "position:fixed;right:18px;bottom:18px;z-index:2147483646;font:500 14px/1.45 var(--texte);color:var(--encre);-webkit-font-smoothing:antialiased}" +
    "@media (prefers-color-scheme:dark){.b{--carte:#1E1E1E;--papier:#262626;--encre:#F4F4EE;--gris:#A6A69E;--trait:#333;--anis-p:#2A3414}}" +
    "button,textarea,select{font:inherit;color:inherit}" +
    ".rond{position:relative;width:58px;height:58px;padding:0;border-radius:15px;border:0;background:transparent;cursor:pointer;box-shadow:0 10px 28px rgba(0,0,0,.28);transition:transform .25s var(--ease)}" +
    ".rond img{display:block;width:58px;height:58px;border-radius:15px}.rond:hover{transform:translateY(-2px) rotate(-4deg)}" +
    ".rond i{position:absolute;left:50%;bottom:-7px;transform:translateX(-50%);font:800 10.5px/1 var(--titre);font-style:normal;background:var(--ebay);color:#fff;border-radius:999px;padding:4px 6px;box-shadow:0 0 0 2px var(--carte)}" +
    ".p{width:380px;max-width:calc(100vw - 36px);max-height:calc(100vh - 36px);overflow:auto;background:var(--carte);border-radius:26px;box-shadow:0 18px 50px rgba(0,0,0,.3);padding:18px;display:flex;flex-direction:column;gap:12px;animation:monte .3s var(--ease)}" +
    "@keyframes monte{from{opacity:0;transform:translateY(10px) scale(.98)}}" +
    ".t{display:flex;align-items:center;justify-content:space-between;gap:8px}.t b{font:700 17px/1 var(--titre);letter-spacing:-.3px;display:flex;align-items:center;gap:8px}" +
    ".logo{background:var(--anis);color:var(--nuit);border-radius:8px;padding:4px 6px;font:800 13px/1 var(--titre)}.site{background:var(--ebay);color:#fff;border-radius:999px;padding:4px 9px;font:800 12px/1 var(--titre)}" +
    ".x{border:0;background:none;width:32px;height:32px;border-radius:50%;font-size:20px;line-height:1;cursor:pointer;color:var(--gris)}.x:hover{background:var(--papier);color:var(--encre)}" +
    ".art{display:flex;flex-direction:column;gap:4px}.art label{font:700 11px/1 var(--texte);letter-spacing:.07em;text-transform:uppercase;color:var(--gris)}" +
    ".art select{width:100%;border:1.5px solid var(--trait);background:var(--papier);border-radius:14px;padding:10px 12px;font-size:14px;font-weight:600;cursor:pointer}" +
    ".s{font-size:13px;color:var(--gris);background:var(--papier);border-radius:12px;padding:9px 11px}.s:empty{display:none}.s.ok{background:var(--anis-p);color:var(--encre)}.s.bad{background:#FDE8E4;color:#8A1F11}" +
    ".mini{border:1px solid var(--trait);background:var(--papier);border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:600;cursor:pointer}.mini:disabled{opacity:.55;cursor:default}" +
    ".ia{display:flex;flex-direction:column;gap:8px;background:var(--nuit);color:#fff;border-radius:18px;padding:12px;--papier:rgba(255,255,255,.06);--trait:rgba(255,255,255,.14);--gris:#B8B8B0;--encre:#fff}" +
    ".ia-t{display:flex;align-items:center;justify-content:space-between;gap:8px}.ia-t b{font:700 14px/1.2 var(--titre);display:flex;gap:6px;align-items:center}.etoile{color:var(--anis)}" +
    ".ia .mini{color:#fff}.ia .mini:hover:not(:disabled){background:var(--anis);border-color:var(--anis);color:var(--nuit)}" +
    ".ia-r{margin:0;font-size:12.5px;color:#B8B8B0}.rond-ia{display:inline-block;width:13px;height:13px;margin-right:7px;vertical-align:-2px;border:2px solid rgba(212,245,122,.3);border-top-color:var(--anis);border-radius:50%;animation:tourne .8s linear infinite}@keyframes tourne{to{transform:rotate(360deg)}}" +
    ".ia-offre{margin:0;font-size:12.5px;line-height:1.4;border-radius:10px;padding:7px 9px;background:rgba(255,255,255,.07);color:#E8E8E2}.ia-offre.basse{background:rgba(246,196,185,.14);color:#F6D3CB}.ia-offre.ok{background:rgba(191,232,200,.12);color:#CBEBD3}" +
    ".rep{display:flex;flex-direction:column;gap:4px;text-align:left;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);border-radius:16px;padding:11px 13px;cursor:pointer;color:#fff;transition:border-color .2s,background .2s}" +
    ".rep:hover{border-color:var(--anis);background:rgba(212,245,122,.1)}.rep b{font:600 13.5px/1.3 var(--titre)}.rep span{font-size:13.5px;line-height:1.5;color:#EDEDE7}" +
    ".ap{font:700 10.5px/1 var(--texte);font-style:normal;letter-spacing:.03em;text-transform:uppercase;border-radius:999px;padding:3px 7px;margin-right:7px;vertical-align:1px;background:rgba(255,255,255,.12)}.ap-contre_offre{background:var(--anis);color:var(--nuit)}.ap-accepter{background:#BFE8C8;color:#14401F}.ap-couper_court,.ap-ferme{background:#F3B9AE;color:#5A1A10}" +
    ".parler{display:flex;gap:8px;align-items:flex-end}.parler textarea{flex:1;min-width:0;resize:vertical;font:14px/1.4 var(--texte);color:#fff;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:10px 12px;outline:none}" +
    ".parler textarea::placeholder{color:#9A9A92}.parler textarea:focus{border-color:var(--anis)}.parler .mini{background:var(--anis);border-color:var(--anis);color:var(--nuit);font-weight:800;padding:9px 14px}" +
    ".vente{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12.5px;color:var(--gris)}" +
    ".bulle{position:fixed;right:18px;bottom:90px;max-width:320px;background:var(--nuit);color:#fff;border-radius:14px;padding:10px 14px;font-size:13px;box-shadow:0 12px 30px rgba(0,0,0,.3);animation:monte .3s var(--ease)}" +
    ".etapes{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}.etapes li{display:flex;align-items:center;gap:9px;font-size:13.5px;color:var(--gris)}.etapes li.ok{color:var(--encre);font-weight:600}" +
    ".puce{flex:none;width:22px;height:22px;border-radius:7px;display:grid;place-items:center;background:var(--papier);font:700 12px/1 var(--texte)}.etapes li.ok .puce{background:var(--anis);color:var(--nuit)}" +
    ".outils{display:flex;gap:8px;justify-content:space-between}.outils .mini{flex:1}.v{font:600 11px/1 var(--texte);color:var(--gris)}.lead{margin:-4px 0 0;font:700 15px/1.2 var(--titre);letter-spacing:-.2px}" +
    /* en-tête et sélecteur d'article : les mêmes que sur Le Bon Coin */
    ".marque{display:flex;color:var(--encre)}.marque svg{display:block;height:22px;width:auto}.t .g{display:flex;align-items:center;gap:8px}" +
    ".sel{position:relative}" +
    ".choix{width:100%;display:flex;align-items:center;gap:10px;text-align:left;border:1.5px solid var(--trait);background:var(--papier);border-radius:16px;padding:10px 12px;cursor:pointer;transition:border-color .2s}" +
    ".choix:hover,.choix[aria-expanded=true]{border-color:var(--nuit)}@media (prefers-color-scheme:dark){.choix:hover,.choix[aria-expanded=true]{border-color:var(--anis)}}" +
    ".q{flex:1;min-width:0}.nom{display:block;font:600 14px/1.3 var(--texte);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta{display:block;font-size:12px;color:var(--gris);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".px{flex:none;background:var(--anis);color:var(--nuit);border-radius:999px;padding:3px 9px;font:700 12.5px/1.2 var(--titre)}" +
    ".liste{margin-top:6px;background:var(--carte);border:1px solid var(--trait);border-radius:18px;box-shadow:0 18px 40px rgba(0,0,0,.22);padding:8px;display:flex;flex-direction:column;gap:6px;animation:monte .2s var(--ease)}.liste[hidden]{display:none}" +
    ".cherche{display:flex;align-items:center;gap:8px;border-radius:12px;background:var(--papier);padding:0 10px}" +
    ".cherche svg{flex:none;color:var(--gris)}.cherche input{flex:1;min-width:0;border:0;background:none;outline:none;padding:10px 0;font-size:14px;color:inherit}.cherche:focus-within{box-shadow:inset 0 0 0 1.5px #BFE54C}" +
    ".opts{max-height:260px;overflow:auto;display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}" +
    ".opt{display:flex;align-items:center;gap:10px;border-radius:12px;padding:8px 10px;cursor:pointer}" +
    ".opt.actif{background:var(--anis-p)}.opt[aria-selected=true] .nom::after{content:' ✓';color:#5E8A00}" +
    "mark{background:var(--anis);color:var(--nuit);border-radius:3px;padding:0 1px}" +
    ".vide{padding:14px 10px;color:var(--gris);font-size:13px;text-align:center}" +
    ".pub{font-size:11px;color:var(--gris);border:1px solid var(--trait);border-radius:999px;padding:1px 7px;margin-left:6px;vertical-align:1px}" +
    ".emo{flex:none;width:34px;height:34px;border-radius:11px;background:var(--carte);border:1px solid var(--trait);display:grid;place-items:center;font-size:19px;line-height:1}.emo.ph{background-size:cover;background-position:center}.opt.actif .emo{border-color:var(--anis)}" +
    "button:focus-visible,select:focus-visible{outline:2px solid var(--anis);outline-offset:2px}";
  function el(tag, attrs, enfants) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === "texte") e.textContent = attrs[k]; else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
    (enfants || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  // En-tête : logo RetroRevente, pastille eBay (et la version, utile pour vérifier une mise à jour).
  function entete(fermer, version) {
    var m = el("b", { class: "marque", role: "img", "aria-label": "RetroRevente" }); m.innerHTML = RR_LOGO;
    return el("div", { class: "t" }, [el("span", { class: "g" }, [m, el("span", { class: "site", texte: "eBay" }), version ? el("span", { class: "v", texte: "v" + RR.runtime.getManifest().version }) : null]),
      el("button", { class: "x", type: "button", "aria-label": "Réduire", title: "Réduire (Échap)", texte: "×", onclick: fermer })]);
  }
  /* ===== Sélecteur d'article (comme sur Le Bon Coin) : vignette, titre, état, prix ; recherche au clavier ===== */
  var ETAT_TXT = { neuf: "Neuf", tres_bon: "Très bon état", bon: "Bon état", correct: "État correct", pieces: "Pour pièces" };
  var prixTxt = function (a) { return a.prix != null ? a.prix + " €" : ""; };
  var metaTxt = function (a) { return [a.plateforme, ETAT_TXT[a.etat], a.urlEbay ? "déjà sur eBay" : ""].filter(Boolean).join(" · "); };
  var ALIAS = [[/nintendo 64/, "n64"], [/game ?boy advance/, "gba"], [/game ?boy color/, "gbc"], [/game ?boy/, "gb"], [/super nintendo|super nes/, "snes"], [/gamecube/, "gc ngc"], [/nintendo ds/, "nds ds"], [/nintendo 3ds/, "3ds"], [/switch/, "nsw"], [/playstation 2/, "ps2"], [/playstation 3/, "ps3"], [/playstation 4/, "ps4"], [/playstation 5/, "ps5"], [/playstation( 1)?$|playstation one|psone/, "ps1 psx"], [/mega ?drive/, "md"], [/master system/, "sms"], [/dreamcast/, "dc"]];
  function alias(t) { var n = norm(t); return ALIAS.filter(function (x) { return x[0].test(n); }).map(function (x) { return x[1]; }).join(" "); }
  function filtrer(l, q) {
    var m = norm(q).split(" ").filter(Boolean);
    return { mots: m, l: l.filter(function (a) { var h = norm([a.titre, a.nom, a.plateforme, alias(a.plateforme || a.titre), ETAT_TXT[a.etat], prixTxt(a)].join(" ")); return m.every(function (x) { return h.indexOf(x) >= 0; }); }) };
  }
  function surligne(texte, m) {
    var f = document.createDocumentFragment(), n = norm(texte), i = 0;
    if (!m.length || n.length !== texte.length) { f.appendChild(document.createTextNode(texte)); return f; }
    var zones = []; m.forEach(function (x) { var p = n.indexOf(x); if (p >= 0) zones.push([p, p + x.length]); });
    zones.sort(function (x, y) { return x[0] - y[0]; }).forEach(function (z) { if (z[0] < i) return; f.appendChild(document.createTextNode(texte.slice(i, z[0]))); f.appendChild(el("mark", { texte: texte.slice(z[0], z[1]) })); i = z[1]; });
    f.appendChild(document.createTextNode(texte.slice(i)));
    return f;
  }
  function loupe() {
    var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    [["width", "16"], ["height", "16"], ["viewBox", "0 0 24 24"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2.2"], ["stroke-linecap", "round"]].forEach(function (a) { svg.setAttribute(a[0], a[1]); });
    var c = document.createElementNS(ns, "circle"); c.setAttribute("cx", "11"); c.setAttribute("cy", "11"); c.setAttribute("r", "7");
    var p = document.createElementNS(ns, "path"); p.setAttribute("d", "m20 20-3.5-3.5");
    svg.appendChild(c); svg.appendChild(p); return svg;
  }
  var EMOJIS = [[/mario ?kart/, "🏎️"], [/yoshi/, "🦖"], [/mario|peach/, "🍄"], [/zelda|link/, "🗡️"], [/kirby/, "🌸"], [/pok[eé]mon|pikachu/, "⚡"], [/sonic/, "🦔"], [/donkey|diddy/, "🦍"], [/banjo/, "🐻"], [/goldeneye|007/, "🕵️"], [/metroid/, "🚀"], [/final fantasy/, "🔮"]];
  function emoji(a) {
    if (!a) return "🎮"; if (a.lot) return "📦";
    var k = EMOJIS.filter(function (x) { return x[0].test(norm(a.titre + " " + (a.nom || ""))); })[0]; if (k) return k[1];
    return a.categorie === "consoles" ? "🕹️" : a.categorie === "cartes" ? "🃏" : a.categorie === "films" ? "🎬" : "🎮";
  }
  // Vignette : la photo de l'article (chargée une fois), sinon un emoji.
  var vignettes = {};
  function vignette(a) {
    var v = el("span", { class: "emo", "aria-hidden": "true", texte: emoji(a) });
    if (a && a.photo && /^[a-f0-9]{16}$/.test(String(a.id || ""))) {
      (vignettes[a.id] = vignettes[a.id] || rrDemander({ type: "photo", id: a.id }).then(function (r) { return "data:" + (r.type || "image/jpeg") + ";base64," + r.base64; }))
        .then(function (u) { v.style.backgroundImage = "url(" + u + ")"; v.classList.add("ph"); v.textContent = ""; }, function () { delete vignettes[a.id]; });
    }
    return v;
  }
  // o : { choisie, vide (texte quand rien n'est choisi), aucun (libellé d'une option « aucun article »), choisir(a) }
  function selecteur(o) {
    var l = annonces || [], a = o.choisie;
    var choix = el("button", { class: "choix", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": a ? "Article : " + (a.titre || a.nom) + ". Changer" : o.vide, onclick: function () { liste.hidden ? ouvrir() : fermer(); } },
      a ? [vignette(a), el("span", { class: "q" }, [el("span", { class: "nom", texte: a.titre || a.nom }), el("span", { class: "meta", texte: metaTxt(a) || "Changer d'article" })]), a.prix != null ? el("span", { class: "px", texte: prixTxt(a) }) : null]
        : [el("span", { class: "emo", "aria-hidden": "true", texte: "👆" }), el("span", { class: "q" }, [el("span", { class: "nom", texte: o.vide }), el("span", { class: "meta", texte: l.length + " article" + (l.length > 1 ? "s" : "") + " en vente" })])]);
    var champ = el("input", { type: "text", placeholder: "Rechercher un jeu, une carte, une console…", "aria-label": "Rechercher un article", autocomplete: "off", spellcheck: "false", role: "combobox", "aria-controls": "rr-opts", "aria-expanded": "true" });
    var opts = el("ul", { class: "opts", id: "rr-opts", role: "listbox", "aria-label": "Articles en vente" });
    var liste = el("div", { class: "liste" }, [el("label", { class: "cherche" }, [loupe(), champ]), opts]);
    liste.hidden = true;
    var actif = 0, vus = [];
    function rendre() {
      var r = filtrer(l, champ.value); vus = (o.aucun && !champ.value.trim() ? [null] : []).concat(r.l); opts.textContent = "";
      if (actif >= vus.length) actif = Math.max(0, vus.length - 1);
      if (!vus.length) { opts.appendChild(el("li", { class: "vide", texte: "Aucun article ne correspond à « " + champ.value.trim() + " »." })); champ.removeAttribute("aria-activedescendant"); return; }
      vus.forEach(function (x, i) {
        var nom = el("span", { class: "nom" }, x ? [surligne(x.titre || x.nom, r.mots)] : [o.aucun]);
        if (x && x.urlEbay) nom.appendChild(el("span", { class: "pub", texte: "sur eBay" }));
        opts.appendChild(el("li", { class: "opt" + (i === actif ? " actif" : ""), id: "rr-o" + i, role: "option", "aria-selected": String(x ? !!(a && x.id === a.id) : !a),
          onmousedown: function (e) { e.preventDefault(); }, onmousemove: function () { if (actif !== i) { actif = i; marquer(); } }, onclick: function () { prendre(x); } },
          x ? [vignette(x), el("span", { class: "q" }, [nom, el("span", { class: "meta", texte: metaTxt(x) })]), x.prix != null ? el("span", { class: "px", texte: prixTxt(x) }) : null]
            : [el("span", { class: "emo", "aria-hidden": "true", texte: "💬" }), el("span", { class: "q" }, [nom])]));
      });
      marquer();
    }
    function marquer() {
      [].forEach.call(opts.children, function (li, i) { li.classList.toggle("actif", i === actif); });
      var li = opts.children[actif]; if (li && li.id) { champ.setAttribute("aria-activedescendant", li.id); li.scrollIntoView({ block: "nearest" }); }
    }
    function prendre(x) { fermer(); o.choisir(x); }
    function ouvrir() { liste.hidden = false; choix.setAttribute("aria-expanded", "true"); champ.value = ""; actif = a ? Math.max(0, l.indexOf(a)) + (o.aucun ? 1 : 0) : 0; rendre(); champ.focus(); }
    function fermer() { liste.hidden = true; choix.setAttribute("aria-expanded", "false"); }
    champ.addEventListener("input", function () { actif = 0; rendre(); });
    champ.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (vus.length) { actif = (actif + 1) % vus.length; marquer(); } }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (vus.length) { actif = (actif - 1 + vus.length) % vus.length; marquer(); } }
      else if (e.key === "Enter") { e.preventDefault(); if (actif < vus.length) prendre(vus[actif]); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fermer(); choix.focus(); }
    });
    liste.addEventListener("focusout", function (e) { if (!liste.contains(e.relatedTarget) && e.relatedTarget !== choix) setTimeout(fermer, 120); });
    var z = el("div", { class: "sel" }, [choix, liste]); z.ouvrir = ouvrir;
    return z;
  }
  var polices = false;
  function chargerPolices() {
    if (polices || !document.fonts || typeof FontFace === "undefined") return; polices = true;
    [["RR Rubik", "polices/rubik-latin.woff2"], ["RR Figtree", "polices/figtree-latin.woff2"]].forEach(function (p) {
      fetch(RR.runtime.getURL(p[1])).then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { return new FontFace(p[0], b, { weight: "300 900" }).load(); })
        .then(function (f) { document.fonts.add(f); }).catch(function () {});
    });
  }
  function construire() {
    hote = document.createElement("div");
    hote.id = "retrorevente-ebay";
    ombre = hote.attachShadow({ mode: "open" });
    var st = document.createElement("style"); st.textContent = CSS; ombre.appendChild(st);
    var b = el("div", { class: "b" }); ombre.appendChild(b);
    b.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Escape") { ouvert = false; dessiner(); } });
    document.documentElement.appendChild(hote);
    chargerPolices();
  }
  var minuterieBulle = null;
  function bulle(t) {
    if (!ombre) { construire(); hote.style.display = ""; }
    var b = ombre.querySelector(".b"), x = ombre.querySelector(".bulle"); if (x) x.remove();
    b.appendChild(el("div", { class: "bulle", role: "status", texte: t }));
    clearTimeout(minuterieBulle); minuterieBulle = setTimeout(function () { var y = ombre.querySelector(".bulle"); if (y) y.remove(); }, 5000);
  }
  function statut(t, k) { var s = ombre && ombre.querySelector(".s"); if (s) { s.textContent = t; s.className = "s " + (k || ""); } }

  function dessiner() {
    if (ombre && depotMode()) return dessinerDepot();
    if (!ombre || mode() !== "messages") return;
    var b = ombre.querySelector(".b"), garde = ombre.querySelector(".bulle");
    b.textContent = ""; if (garde) b.appendChild(garde);
    if (!ouvert) {
      var r = el("button", { class: "rond", type: "button", title: "RetroRevente : répondre à l'acheteur", "aria-label": "Ouvrir RetroRevente", onclick: function () { ouvert = true; dessiner(); proposer(false); } },
        [el("img", { src: RR.runtime.getURL("icones/icone-128.png"), alt: "" }), el("i", { texte: "eBay" })]);
      b.appendChild(r); return;
    }
    var p = el("div", { class: "p", role: "dialog", "aria-label": "RetroRevente sur eBay" });
    p.appendChild(entete(function () { ouvert = false; dessiner(); }));
    if (annonces === null) { p.appendChild(el("p", { class: "s", texte: "Chargement de tes articles…" })); b.appendChild(p); return; }
    // Choix de l'article (deviné tout seul, modifiable).
    p.appendChild(selecteur({ choisie: etat.choisie, vide: "Choisis l'article concerné", aucun: "Article non reconnu (réponse générale)",
      choisir: function (x) { etat.choisie = x; etat.manuel = true; proposer(true); } }));
    var z = el("div", { class: "ia" }); dessinerIA(z); p.appendChild(z);
    // Vente conclue : l'article passe en Vendu dans RetroRevente (au prix de l'offre lue, sinon au prix affiché).
    if (etat.choisie) {
      var px = offreLue() || etat.choisie.prix;
      p.appendChild(el("div", { class: "vente" }, [el("span", { texte: "Vendu sur eBay ?" }),
        el("button", { class: "mini", type: "button", texte: "Marquer vendu" + (px ? " à " + px + " €" : ""), onclick: function (e) {
          var bt = e.currentTarget; bt.disabled = true;
          rrDemander({ type: "vendu", ids: [etat.choisie.id], prix: px || null, remise: "envoi" }).then(function () {
            statut("« " + (etat.choisie.titre || etat.choisie.nom) + " » est passé en Vendu dans RetroRevente.", "ok");
          }, function (err) { bt.disabled = false; statut(err.message, "bad"); });
        } })]));
    }
    p.appendChild(el("p", { class: "s" }));
    b.appendChild(p);
  }
  var APPROCHES = { contre_offre: "Contre-offre", ferme: "Ferme", couper_court: "Couper court", accepter: "Accepter", au_revoir: "Au revoir" };
  function dessinerIA(z) {
    var i = etat.ia || {};
    z.appendChild(el("div", { class: "ia-t" }, [el("b", {}, [el("span", { class: "etoile", texte: "✦" }), "L'IA te propose"]),
      el("button", Object.assign({ class: "mini", type: "button", texte: "Autres idées", onclick: function () { proposer(true); } }, i.charge ? { disabled: "" } : {}))]));
    if (i.charge) { z.appendChild(el("p", { class: "ia-r" }, [el("span", { class: "rond-ia", "aria-hidden": "true" }), i.consigne ? "Je rédige ta réponse…" : "Je lis le dernier message de l'acheteur…"])); return; }
    if (i.erreur) {
      z.appendChild(el("p", { class: "ia-r", texte: i.erreur }));
      if (i.status === 401 || i.status === 402 || i.status === 403) z.appendChild(el("button", { class: "mini", type: "button", texte: i.status === 401 ? "Connecter l'extension" : "Ouvrir Mon compte", onclick: function () { window.open("https://retrorevente.fr/app/?compte", "_blank", "noopener"); } }));
    }
    if (i.offre && i.offre.ecart > 0) {
      var of = i.offre;
      z.appendChild(el("p", { class: "ia-offre " + (of.basse ? "basse" : "ok") }, [el("b", { texte: (of.basse ? "Offre trop basse : " : "Offre correcte : ") + of.offre + " €" }),
        " soit " + of.ecart + " % sous ton prix (" + of.prix + " €)" + (of.basse ? ". Contre-offre conseillée : " + of.contre + " €." : ".")]));
    }
    if (i.resume) z.appendChild(el("p", { class: "ia-r", texte: i.consigne ? "D'après ta consigne : « " + i.consigne + " »" : i.resume }));
    if (i.version && i.version.texte) z.appendChild(el("p", { class: "ia-r", texte: (i.version.verifie ? "✓ " : "⚠ ") + i.version.texte }));
    (i.reponses || []).forEach(function (r) {
      var ap = APPROCHES[r.approche];
      z.appendChild(el("button", { class: "rep", type: "button", "aria-label": "Placer dans la zone de message : " + r.texte, onclick: function () { inserer(r.texte); } },
        [el("b", {}, [ap ? el("i", { class: "ap ap-" + r.approche, texte: ap }) : null, r.titre || "Réponse"]), el("span", { texte: r.texte })]));
    });
    var champ = el("textarea", { rows: "2", placeholder: "Aucune ne convient ? Dis à l'IA quoi répondre…", "aria-label": "Ce que tu veux répondre" });
    champ.value = etat.brouillon;
    var envoyer = function () { var t = champ.value.trim(); if (t.length < 3) { champ.focus(); return; } etat.brouillon = t; proposer(true, t); };
    champ.addEventListener("input", function () { etat.brouillon = champ.value; });
    champ.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); envoyer(); } });
    z.appendChild(el("div", { class: "parler" }, [champ, el("button", { class: "mini", type: "button", texte: "Rédiger", onclick: envoyer })]));
  }

  // Demande à l'IA trois réponses pour cette conversation (une seule demande à la fois).
  function proposer(force, consigne) {
    if (mode() !== "messages" || !annonces || (etat.ia && etat.ia.charge)) return;
    var conv = zoneTexte(), cle = location.href + "|" + conv.length + "|" + conv.slice(-200) + "|" + (etat.choisie ? etat.choisie.id : "");
    if (!force && etat.cle === cle) return;
    etat.cle = cle;
    var a = etat.choisie, offre = offreLue();
    etat.ia = { charge: true, consigne: consigne || "" };
    dessiner();
    rrDemander({ type: "reponse", site: "ebay", annonce: a ? a.id : "", conversation: conv, offre: offre, consigne: consigne || "",
      precedentes: consigne && etat.precedentes ? etat.precedentes : [] }).then(function (r) {
      etat.ia = { resume: r.resume, reponses: r.reponses || [], offre: r.offre, consigne: consigne || "", version: r.version || null };
      etat.precedentes = (r.reponses || []).map(function (x) { return x.texte; });
      if (consigne) etat.brouillon = "";
    }, function (e) { etat.ia = { erreur: e.message, status: e.status }; }).then(dessiner);
  }

  // Zone de message d'eBay : la dernière zone de saisie visible (textarea ou éditeur).
  function visible(x) { var r = x.getBoundingClientRect(); return r.width > 40 && r.height > 15 && getComputedStyle(x).visibility !== "hidden"; }
  function zoneMessage() {
    var l = [].filter.call(document.querySelectorAll("textarea, [contenteditable=''], [contenteditable=true], [role=textbox]"), function (x) { return !(hote && hote.contains(x)) && visible(x) && !x.disabled; });
    return l[l.length - 1] || null;
  }
  function inserer(texte) {
    var z = zoneMessage();
    if (!z) { navigator.clipboard.writeText(texte).then(function () { statut("Pas de zone de message trouvée : réponse copiée, colle-la.", "ok"); }, function () { statut("Copie impossible ici.", "bad"); }); return; }
    if (z instanceof HTMLTextAreaElement) {
      var set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      z.focus(); set.call(z, z.value.trim() ? z.value.replace(/\s+$/, "") + "\n" + texte : texte);
      z.dispatchEvent(new Event("input", { bubbles: true })); z.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      z.focus(); var s = window.getSelection(); s.selectAllChildren(z); s.collapseToEnd();
      if (!document.execCommand("insertText", false, (z.textContent.trim() ? "\n" : "") + texte)) z.textContent += texte;
      z.dispatchEvent(new Event("input", { bubbles: true }));
    }
    z.focus();
    statut("Réponse placée dans la zone de message : relis, puis envoie.", "ok");
  }

  /* ===== Mise en vente eBay : « Commencer votre annonce », puis le formulaire ===== */
  function depotMode() { var m = mode(); return m === "prelist" || m === "formulaire"; }
  var depot = { a: null, choisi: false, faits: {}, lignes: {} }, dejaRempli = new WeakMap();
  function visibleEl(x) { if (!x || (hote && hote.contains(x))) return false; var r = x.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(x).visibility !== "hidden"; }
  // Texte qui décrit un champ : son libellé, aria-label, placeholder, name, id, et le texte du bloc juste au-dessus.
  function decrire(x, court) {
    var t = [x.getAttribute("aria-label"), x.getAttribute("placeholder"), x.getAttribute("name"), x.id, x.getAttribute("data-testid")];
    if (x.id) { var l = document.querySelector("label[for='" + window.CSS.escape(x.id) + "']"); if (l) t.push(l.textContent); }
    var lb = x.getAttribute("aria-labelledby"); if (lb) lb.split(/\s+/).forEach(function (i) { var e = document.getElementById(i); if (e) t.push(e.textContent); });
    var c = x.closest("label"); if (c) t.push(c.textContent);
    var p = court ? null : x.parentElement; for (var i = 0; i < 3 && p; i++, p = p.parentElement) { if ((p.innerText || "").length < 120) t.push(p.innerText); else break; }
    return norm(t.filter(Boolean).join(" | "));
  }
  // court : seulement le libellé du champ lui-même (pas le texte du bloc autour, qui peut parler d'autre chose).
  function champs(sel, re, exclure, court) {
    return [].filter.call(document.querySelectorAll(sel), function (x) { if (!visibleEl(x) || x.disabled || x.readOnly) return false; var d = decrire(x, court); return re.test(d) && !(exclure && exclure.test(d)); });
  }
  function ecrireValeur(el, v) {
    var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    el.focus(); Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // Un champ n'est rempli qu'une fois par article : une correction de la personne est gardée.
  function poser(el, v, nature) {
    var d = dejaRempli.get(el); if (d && d.id === depot.a.id) return false;
    dejaRempli.set(el, { id: depot.a.id });
    if (String(el.value || "").trim() === String(v)) return true;
    ecrireValeur(el, String(v)); el.blur(); return true;
  }
  function fait(cle, ok) { if (ok) depot.lignes[cle] = true; }

  // Saisie comme au clavier (insertText déclenche beforeinput/input, que React et Marko écoutent), sinon valeur posée.
  function taper(c, v) {
    c.focus(); try { c.select(); } catch (e) {}
    var ok = false; try { ok = document.execCommand("insertText", false, v); } catch (e) {}
    if (!ok || c.value !== v) ecrireValeur(c, v); else c.dispatchEvent(new Event("change", { bubbles: true }));
    c.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true }));
  }
  // Saisie lettre par lettre, comme au clavier : keydown, beforeinput/input (insertText), keyup pour chaque lettre.
  // Certains champs d'eBay ne prennent en compte que ce qui arrive ainsi (une valeur posée d'un coup est effacée).
  var pause = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  async function taperLettres(c, v) {
    c.focus(); c.click();
    try { c.select(); } catch (e) {}
    if (c.value) { var ok0 = false; try { ok0 = document.execCommand("delete"); } catch (e) {} if (!ok0 || c.value) ecrireValeur(c, ""); }
    for (var i = 0; i < v.length; i++) {
      var ch = v[i], o = { key: ch, bubbles: true, cancelable: true, composed: true };
      if (document.activeElement !== c) c.focus();
      var go = c.dispatchEvent(new KeyboardEvent("keydown", o));
      c.dispatchEvent(new KeyboardEvent("keypress", o));
      if (go) {
        var avant = c.value, ok = false;
        try { ok = document.execCommand("insertText", false, ch); } catch (e) {}
        if (!ok || c.value === avant) {
          c.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: ch, bubbles: true, cancelable: true }));
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(c, avant + ch);
          c.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: ch, bubbles: true }));
        }
      }
      c.dispatchEvent(new KeyboardEvent("keyup", o));
      if (i % 4 === 3) await pause(12);
    }
    c.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function entree(c) {
    ["keydown", "keypress", "keyup"].forEach(function (t) { c.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })); });
  }
  // Champ de « Commencer votre annonce » : par son texte, sinon le seul champ texte visible de la page.
  function champPrelist() {
    var c = champVente(); if (c) return c;
    var l = champs("input[type=text], input[type=search], input:not([type]), textarea", /vendez|vendre|sell|cherch|search|recherch|mots?-cles|keyword/);
    if (l.length) return l[0];
    var t = [].filter.call(document.querySelectorAll("input[type=text], input[type=search], input:not([type])"), function (x) { return visibleEl(x) && !x.disabled && !x.readOnly; });
    return t.length === 1 ? t[0] : null;
  }
  // La loupe : bouton du formulaire, sinon bouton le plus proche du champ (jamais « Mettre en vente »).
  // eBay : la loupe est button.keyword-suggestion__button [aria-label=Rechercher], hors du bloc du champ, qui contient
  // aussi « Effacer le texte » (le cliquer vide le champ). On vise donc la loupe et on écarte tout bouton « effacer ».
  var PAS_LOUPE = /effacer|clear|supprimer|reset|vider|fermer|close|mettre en vente|publier|list it/;
  function boutonRecherche(c) {
    var ok = function (x) { return x !== c && visibleEl(x) && !PAS_LOUPE.test(norm([x.getAttribute("aria-label"), x.title, x.textContent].join(" "))); };
    var vise = [].filter.call(document.querySelectorAll(".keyword-suggestion__button, button[aria-label='Rechercher'], button[aria-label='Search'], button[type=submit]"), ok);
    if (vise.length) {
      // La plus proche du champ.
      var r = c.getBoundingClientRect();
      vise.sort(function (x, y) { var a = x.getBoundingClientRect(), b = y.getBoundingClientRect(); return Math.abs(a.top - r.top) + Math.abs(a.left - r.right) - (Math.abs(b.top - r.top) + Math.abs(b.left - r.right)); });
      return vise[0];
    }
    var b = c.form && [].filter.call(c.form.querySelectorAll("button, [role=button]"), ok)[0];
    for (var z = c.parentElement, i = 0; !b && z && i < 5; i++, z = z.parentElement) b = [].filter.call(z.querySelectorAll("button, [role=button]"), ok)[0];
    return b || null;
  }

  var attentePrelist = null, enSaisie = false, journal = [], personneATape = false, gardien = null;
  try { journal = JSON.parse(sessionStorage.getItem("rrEbayJournal") || "[]"); if (journal.length) journal.push("— page (re)chargée : " + location.pathname + location.search.slice(0, 80)); } catch (e) { journal = []; }
  function noter(t, c) {
    journal.push(new Date().toTimeString().slice(0, 8) + " · " + t + (c ? " · valeur " + (c.value || "").length + " car." : "")); if (journal.length > 80) journal.shift();
    try { sessionStorage.setItem("rrEbayJournal", JSON.stringify(journal)); } catch (e) {}
  }
  document.addEventListener("input", function (e) { if (e.isTrusted && e instanceof InputEvent && e.target && e.target.tagName === "INPUT" && !(hote && hote.contains(e.target))) personneATape = true; }, true);
  // Le titre doit rester dans le champ : si la page le vide (rechargement du composant, nouveau champ…), on le retape,
  // jusqu'à 5 fois en 15 s, tant que la personne n'a rien tapé elle-même.
  function garder(a) {
    clearInterval(gardien); var debut = Date.now(), n = 0;
    gardien = setInterval(function () {
      var x = champPrelist();
      if (personneATape || mode() !== "prelist" || Date.now() - debut > 15000 || n >= 5) { clearInterval(gardien); return; }
      if (x && !String(x.value || "").trim() && !enSaisie) { n++; noter("champ vidé par la page : je retape", x); enSaisie = true; taperLettres(x, a.ebay.titre).then(function () { enSaisie = false; noter("retapé", x); }); }
    }, 500);
  }
  // Page « Commencer votre annonce » : le titre dans « Dites-nous ce que vous vendez », puis la loupe.
  // Le champ peut arriver tard : on l'attend jusqu'à 20 s.
  function remplirPrelist(a, force) {
    if (depot.faits.prelist === a.id) return;
    var c = champPrelist();
    if (!c) {
      if (attentePrelist) return;
      var debut = Date.now();
      attentePrelist = setInterval(function () {
        var x = champPrelist();
        if (!x && Date.now() - debut < 20000) return;
        clearInterval(attentePrelist); attentePrelist = null;
        if (x) remplirPrelist(a, force); else { depot.manque = "Champ « Dites-nous ce que vous vendez » introuvable : tape le titre, RetroRevente remplira la suite."; dessinerDepot(); }
      }, 300);
      return;
    }
    // Une seule recherche automatique par article et par onglet : sur la page suivante, eBay peut remontrer le champ
    // avec le titre, et il ne faut pas relancer la recherche en boucle. Le bouton « Remplir avec RetroRevente » force.
    if (!force) { var deja = ""; try { deja = sessionStorage.getItem("rrEbayCherche") || ""; } catch (e) {} if (deja === a.id) { depot.faits.prelist = a.id; return; } }
    depot.faits.prelist = a.id; depot.manque = ""; personneATape = false;
    try { sessionStorage.setItem("rrEbayCherche", a.id); } catch (e) {}
    noter("champ trouvé : " + (c.getAttribute("placeholder") || c.name || c.id || c.tagName), c);
    // Champ déjà prérempli par l'adresse (…/suggest?title=…) : rien à taper.
    (norm(c.value) === norm(a.ebay.titre) ? Promise.resolve() : taperLettres(c, a.ebay.titre)).then(function () {
      noter("titre tapé lettre par lettre", c); dessinerDepot();
      garder(a);
      lancerRecherche(c, a, 0);
    });
  }
  // On attend que la loupe soit active (elle est grisée tant que le champ est vide), et on retape si la page a effacé le titre.
  function lancerRecherche(c, a, n) {
    setTimeout(function () {
      if (!c.isConnected) { var x = champPrelist(); if (!x) return; c = x; }
      if (enSaisie && n < 20) return lancerRecherche(c, a, n + 1);
      if (norm(c.value) !== norm(a.ebay.titre) && n < 3) { enSaisie = true; return taperLettres(c, a.ebay.titre).then(function () { enSaisie = false; lancerRecherche(c, a, n + 1); }); }
      var b = boutonRecherche(c);
      noter("loupe " + (b ? (b.disabled || b.getAttribute("aria-disabled") === "true" ? "grisée" : "active") : "introuvable") + " (essai " + n + ")", c);
      if (b && (b.disabled || b.getAttribute("aria-disabled") === "true") && n < 10) return lancerRecherche(c, a, n + 1);
      if (!String(c.value || "").trim()) { noter("champ vide : recherche pas lancée", c); depot.manque = "eBay a vidé le champ : clique « Remplir avec RetroRevente », ou colle le titre (il est copié)."; copierTitre(a); dessinerDepot(); return; }
      var ici = location.href;
      setTimeout(function () {
        var x = champPrelist(), bouge = location.href !== ici || !x;
        noter("2,5 s après la recherche : " + (bouge ? "page changée" : "même page"), x);
        // Rien n'a bougé et le titre est toujours là : on tente la touche Entrée (eBay lance aussi la recherche ainsi).
        if (!bouge && x && String(x.value || "").trim()) { entree(x); noter("Entrée envoyée en secours", x); }
      }, 2500);
      if (b && !b.disabled) { b.click(); noter("loupe cliquée", c); } else if (c.form && c.form.requestSubmit) { c.form.requestSubmit(); noter("formulaire envoyé", c); } else { entree(c); noter("Entrée envoyée", c); }
      fait("titre", true); dessinerDepot();
      bulle("RetroRevente a cherché « " + a.ebay.titre + " » sur eBay : choisis l'objet correspondant ou continue sans.");
    }, n ? 300 : 700);
  }
  function copierTitre(a) { try { navigator.clipboard.writeText(a.ebay.titre).catch(function () {}); } catch (e) {} }
  // Diagnostic : structure de la page autour du champ (sans ce qui y est tapé) et journal du remplissage, à coller dans la discussion.
  function diagnostic() {
    var nettoie = function (x) { var c = x.cloneNode(false); c.removeAttribute && c.removeAttribute("value"); return c.outerHTML.slice(0, 400); };
    var l = ["RetroRevente " + RR.runtime.getManifest().version + " · " + location.hostname + location.pathname + " · mode " + mode(), navigator.userAgent, ""];
    var c = champPrelist();
    if (c) {
      l.push("Champ : " + nettoie(c) + " · visible " + visibleEl(c) + " · valeur " + (c.value || "").length + " car. · focus " + (document.activeElement === c));
      for (var z = c.parentElement, i = 0; z && i < 6; i++, z = z.parentElement) l.push("  parent " + i + " : <" + z.tagName.toLowerCase() + (z.id ? "#" + z.id : "") + (z.className && typeof z.className === "string" ? "." + z.className.trim().split(/\s+/).slice(0, 4).join(".") : "") + (z.getAttribute("role") ? " role=" + z.getAttribute("role") : "") + ">");
      var b = boutonRecherche(c); l.push("Loupe : " + (b ? nettoie(b) + " · disabled " + b.disabled : "introuvable"));
      l.push("Formulaire : " + (c.form ? nettoie(c.form) : "aucun"));
    } else l.push("Champ : introuvable");
    l.push("", "Champs texte visibles :");
    [].forEach.call(document.querySelectorAll("input, textarea, [contenteditable=true], [role=combobox]"), function (x) { if (visibleEl(x)) l.push("  " + nettoie(x)); });
    if (mode() === "formulaire") {
      l.push("", "Caractéristiques :");
      attributsPage().forEach(function (c) { var g = ligneAttribut(c.bouton); l.push("  " + c.nom + (c.obligatoire ? " (obligatoire)" : "") + (c.multiple ? " (multiple)" : "") + " · bouton " + nettoie(c.bouton).slice(0, 250) + " · ligne <" + g.tagName.toLowerCase() + "." + String(g.className || "").trim().split(/\s+/).slice(0, 3).join(".") + "> " + (g.innerText || "").replace(/\s+/g, " ").slice(0, 120)); });
      var z = zoneDescription(); l.push("Description : " + (z ? (z.ownerDocument !== document ? "iframe · " : "") + nettoie(z).slice(0, 250) : "introuvable"));
      [].forEach.call(document.querySelectorAll("iframe"), function (f) { if (visibleEl(f)) l.push("  iframe " + nettoie(f).slice(0, 200)); });
      [].forEach.call(document.querySelectorAll("[contenteditable]"), function (f) { if (visibleEl(f)) l.push("  éditable " + nettoie(f).slice(0, 200)); });
    }
    l.push("", "Journal :"); l = l.concat(journal.length ? journal : ["  (vide)"]);
    return l.join("\n");
  }
  function copierDiagnostic() {
    var t = diagnostic();
    var ok = function () { bulle("Diagnostic copié : colle-le dans la discussion RetroRevente."); };
    try { navigator.clipboard.writeText(t).then(ok, function () { secours2(t); }); } catch (e) { secours2(t); }
    function secours2(x) { var ta = document.createElement("textarea"); ta.value = x; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); ok(); } catch (e) {} ta.remove(); }
  }
  // Bouton de secours au-dessus du champ, à droite (les suggestions d'eBay s'ouvrent dessous) : « Remplir avec RetroRevente ».
  var secours = null;
  // Bouton rond fermé : s'il touche un élément fixe d'eBay (flèche « haut de page »…), il se décale à gauche de celui-ci.
  function eviterFixes() {
    var b = ombre && ombre.querySelector(".b"); if (!b) return;
    if (ouvert && ombre.querySelector(".p")) { b.style.right = ""; return; }
    b.style.right = "";
    var r = b.getBoundingClientRect(); if (!r.width) return;
    // Éléments sous le bouton (et 8 px autour), puis leur ancêtre fixe : peu coûteux, même sur une grosse page.
    var gene = [], pts = [[r.left - 8, r.top - 8], [r.right - 2, r.top - 8], [r.left + r.width / 2, r.top - 4], [r.left - 8, r.bottom - 2], [r.left + r.width / 2, r.top + r.height / 2], [r.right - 2, r.bottom - 2]];
    pts.forEach(function (pt) {
      document.elementsFromPoint(pt[0], pt[1]).forEach(function (x) {
        if (x === hote || (secours && x === secours.hote()) || x === document.body || x === document.documentElement) return;
        for (var z = x, i = 0; z && z !== document.body && i < 6; i++, z = z.parentElement) {
          var st = getComputedStyle(z);
          if (st.position === "fixed") { var q = z.getBoundingClientRect(); if (q.width < 200 && q.height < 200 && gene.indexOf(z) < 0) gene.push(z); break; }
        }
      });
    });
    if (!gene.length) return;
    var gauche = Math.min.apply(null, gene.map(function (x) { return x.getBoundingClientRect().left; }));
    b.style.right = Math.max(18, Math.round(innerWidth - gauche + 12)) + "px";
  }
  function placerSecours() {
    if (!secours) secours = rrBoutonRemplir(clicSecours, "retrorevente-ebay-remplir", function () { return ombre && ombre.querySelector(".p, .rond"); });
    secours.placer(mode() === "prelist" ? champPrelist() : null);
    secours.titre(depot.a ? "Taper « " + depot.a.ebay.titre + " » et lancer la recherche" : "Choisir l'article à mettre en vente");
  }
  function clicSecours() {
    ouvert = true; if (!hote) construire(); hote.style.display = "";
    charger().then(articleDepot).then(function (a) {
      if (a && a.ebay) { depot.faits.prelist = null; depot.lignes = {}; noter("bouton « Remplir avec RetroRevente »"); remplirPrelist(a, true); return; }
      dessinerDepot();
      var s = ombre.querySelector(".sel"); if (s && s.ouvrir) s.ouvrir();
    }, function (e) { depot.erreur = e.message || "RetroRevente ne répond pas."; dessinerDepot(); });
  }
  // État : bouton radio, option de liste ou bouton dont le texte est l'état eBay voulu (une valeur déjà choisie est gardée).
  function choisirEtat(a) {
    if (!a.ebay.etat || depot.faits.etat === a.id) return depot.lignes.etat;
    var cible = norm(a.ebay.etat), cibles = ETAT_SYN[cible] || [cible];
    var radios = [].filter.call(document.querySelectorAll("input[type=radio]"), function (r) { return !(hote && hote.contains(r)); });
    var r = radios.filter(function (x) { var l = x.closest("label") || (x.id && document.querySelector("label[for='" + window.CSS.escape(x.id) + "']")) || x.parentElement; var t = l && norm(l.textContent); return t && cibles.some(function (c) { return t.indexOf(c) === 0; }); })[0];
    if (r) { if (!r.checked) r.click(); depot.faits.etat = a.id; return true; }
    var sel = champs("select", /etat|condition/)[0];
    if (sel) { var o = [].filter.call(sel.options, function (x) { var t = norm(x.textContent); return cibles.some(function (c) { return t.indexOf(c) === 0; }); })[0]; if (o) { sel.value = o.value; sel.dispatchEvent(new Event("change", { bubbles: true })); depot.faits.etat = a.id; return true; } }
    return false;
  }
  // eBay change parfois le libellé : « État acceptable » s'appelle aussi « État correct ».
  var ETAT_SYN = { "etat acceptable": ["etat acceptable", "etat correct"], "etat correct": ["etat correct", "etat acceptable"], "pour pieces detachees ou ne fonctionne pas": ["pour pieces"] };
  var SYNONYMES = { "nom du jeu": ["nom du jeu", "titre du jeu", "game name"], plateforme: ["plateforme", "plate-forme", "platform"], region: ["code region", "region"],
    contenu: ["contenu", "inclus", "included"], modele: ["modele", "model"], personnage: ["personnage", "character"], extension: ["extension", "set"], numero: ["numero de carte", "numero", "card number"],
    rarete: ["rarete", "rarity"], langue: ["langue", "language"], gradation: ["note", "grade", "gradation"], "titre du film": ["titre du film", "film title", "titre du film/serie"], format: ["format"],
    edition: ["edition"], annee: ["annee de sortie", "annee", "year"], realisateur: ["realisateur", "director"], "langues et zone": ["langue", "code region", "region"] };
  function remplirCarac(a) {
    var n = 0;
    (a.ebay.caracteristiques || []).forEach(function (c) {
      var noms = SYNONYMES[norm(c.nom)] || [norm(c.nom)];
      var el = [].filter.call(document.querySelectorAll("input[type=text], input:not([type])"), function (x) {
        if (!visibleEl(x) || x.disabled || x.readOnly) return false;
        var d = norm([x.getAttribute("aria-label"), x.getAttribute("name"), x.id && (document.querySelector("label[for='" + window.CSS.escape(x.id) + "']") || {}).textContent].filter(Boolean).join(" "));
        return noms.some(function (m) { return d === m || d.indexOf(m) === 0; }) && !/titre de l.annonce|item title|prix|price/.test(d);
      })[0];
      if (el && poser(el, c.valeur)) n++;
    });
    return n > 0;
  }
  // Description : éditeur riche d'eBay (iframe ou zone éditable créée par la page), ou zone de texte en mode HTML.
  // eBay y met d'office le titre : on le remplace ; un texte plus long écrit par la personne est gardé.
  function zoneDescription() {
    var t = champs("textarea", /description/)[0]; if (t) return t;
    // eBay : iframe#se-rte-frame__summary (srcdoc, title « Description ») ; la zone éditable est son body ou un bloc dedans.
    var cadres = [].filter.call(document.querySelectorAll("iframe"), visibleEl), zones = [];
    for (var i = 0; i < cadres.length; i++) {
      var f = cadres[i], d = null; try { d = f.contentDocument; } catch (e) {}
      if (!d || !d.body) continue;
      var z = d.body.isContentEditable || d.designMode === "on" ? d.body : d.querySelector("[contenteditable]:not([contenteditable=false])");
      if (!z) continue;
      if (/description|rte/.test(norm([f.id, f.name, f.title, f.getAttribute("aria-label")].join(" ")))) return z;
      zones.push(z);
    }
    [].forEach.call(document.querySelectorAll("[contenteditable]:not([contenteditable=false])"), function (x) { if (visibleEl(x) && !(x.parentElement && x.parentElement.closest("[contenteditable]:not([contenteditable=false])"))) zones.push(x); });
    var parle = function (x) { var f = x.ownerDocument !== document ? x.ownerDocument.defaultView.frameElement : x; for (var z = f, i = 0; z && i < 7; i++, z = z.parentElement) { var tx = decrire(z, true) + " " + texteDe(z).slice(0, 300); if (/description/.test(tx)) return true; } return false; };
    return zones.filter(parle)[0] || (zones.length === 1 ? zones[0] : null);
  }
  // Repli : l'éditeur riche reste inaccessible (iframe fermée à l'extension) → mode « Afficher le code HTML », une zone de texte.
  function modeHtml() { return [].filter.call(document.querySelectorAll("input[name=descriptionEditorMode]"), function (x) { return !(hote && hote.contains(x)); })[0]; }
  function remplirDescription(a) {
    if (!a.ebay.description || depot.faits.desc === a.id) return depot.lignes.desc;
    var z = zoneDescription();
    if (!z) {
      var m = modeHtml();
      if (m && !m.checked && depot.faits.descHtml !== a.id) { depot.faits.descHtml = a.id; noter("description : passage en mode HTML"); cliquer(m.closest("label") || m); setTimeout(function () { if (mode() === "formulaire") remplirDepot(); }, 1200); }
      else noter("description : zone introuvable");
      return false;
    }
    depot.faits.desc = a.id;
    var texte = a.ebay.description, deja = z.tagName === "TEXTAREA" ? norm(z.value) : texteDe(z), premiere = norm(texte.split("\n")[0]).slice(0, 60);
    if (premiere && deja.indexOf(premiere) >= 0) return true;          // déjà remplie
    if (deja.length > 150) return true;                                // texte de la personne : on n'y touche pas
    if (z.tagName === "TEXTAREA") {
      var m2 = modeHtml(), enHtml = m2 && m2.checked;   // mode HTML : des paragraphes, sinon les retours à la ligne sont perdus
      ecrireValeur(z, enHtml ? texte.split("\n").map(function (l) { return l ? "<p>" + l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>" : "<p><br></p>"; }).join("\n") : texte); z.blur(); noter("description écrite (zone de texte" + (enHtml ? ", HTML" : "") + ")"); return true;
    }
    var d = z.ownerDocument, html = texte.split("\n").map(function (l) { var p = d.createElement("p"); p.textContent = l; return l ? p.outerHTML : "<p><br></p>"; }).join("");
    z.focus(); var ok = false;
    try { var sel = d.getSelection(), r = d.createRange(); r.selectNodeContents(z); sel.removeAllRanges(); sel.addRange(r); ok = d.execCommand("insertHTML", false, html); } catch (e) {}
    noter("description écrite (éditeur riche" + (z.ownerDocument !== document ? ", iframe" : "") + ")");
    if (!ok || texteDe(z).indexOf(premiere) < 0) { z.innerHTML = html; z.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" })); }
    z.dispatchEvent(new Event("change", { bubbles: true })); z.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    try { z.blur(); d.defaultView.frameElement && d.defaultView.frameElement.blur(); } catch (e) {}
    return true;
  }
  /* ===== Caractéristiques de « Terminer votre annonce » (Plateforme, Nom du jeu vidéo, Éditeur, Genre…) =====
     Chaque caractéristique est un bouton (name="attributes.<Libellé>") qui ouvre un menu : un champ « Recherchez/ajoutez
     des détails », des cases (choix multiple) ou des boutons (choix simple), et « Ajouter une valeur personnalisée ».
     Les valeurs « Fréquentes » sont aussi des boutons sous le champ. Les valeurs viennent de RetroRevente (fiche + IA). */
  var PAS_CLIC = /mettre en vente|publier|list it|soumettre|submit|acheter|payer|supprimer|delete|effacer|clear/;
  function texteDe(x) { return norm((x && (x.innerText || x.textContent)) || ""); }
  function cliquer(x) {
    if (!x || PAS_CLIC.test(norm([x.getAttribute("aria-label"), x.textContent].join(" ")))) return false;
    try { x.scrollIntoView({ block: "center" }); } catch (e) {}
    ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach(function (t) { x.dispatchEvent(new (t.indexOf("pointer") === 0 && window.PointerEvent ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, view: window })); });
    x.click(); return true;
  }
  // Modèle de la page (JSON dans les <script>) : libellé, obligatoire, choix multiple, valeurs fréquentes.
  function modeleAttributs() {
    var l = {}, re = /"name":"attributes\.([^"]{1,60})"([^]{0,4000}?)"attributeName"/g;
    [].forEach.call(document.querySelectorAll("script:not([src])"), function (s) {
      var t = s.textContent; if (t.indexOf("\"attributes.") < 0) return;
      var m; re.lastIndex = 0;
      while ((m = re.exec(t))) {
        var c = m[2], fr = /"frequentlySelectedOptions":\[([^\]]*)\]/.exec(t.slice(m.index, m.index + 60000));
        l[m[1]] = { nom: m[1], obligatoire: /"groups":\["REQUIRED"/.test(c), multiple: /"multiSelectEnabled":true/.test(c),
          suggestions: fr ? (fr[1].match(/"value":"([^"]{1,60})"/g) || []).map(function (v) { return v.slice(9, -1); }) : [] };
      }
    });
    return l;
  }
  // Le bouton d'une caractéristique, et sa ligne (libellé, bouton, valeurs fréquentes).
  function boutonAttribut(nom) {
    var x = [].filter.call(document.querySelectorAll("[name]"), function (e) { return e.getAttribute("name") === "attributes." + nom && visibleEl(e); })[0];
    if (x) return x.matches("input[type=hidden]") ? null : x;
    // Sinon : le libellé, puis le premier bouton à menu qui le suit dans sa ligne.
    var lib = [].filter.call(document.querySelectorAll("label, button, span, div, a"), function (e) { return e.children.length <= 1 && texteDe(e) === norm(nom) && visibleEl(e) && !(hote && hote.contains(e)); })[0];
    for (var z = lib && lib.parentElement, i = 0; z && i < 5; i++, z = z.parentElement) {
      var b = z.querySelector("[aria-haspopup], [aria-expanded], [role=combobox]"); if (b && b !== lib && visibleEl(b)) return b;
    }
    return null;
  }
  function ligneAttribut(b) {
    for (var z = b.parentElement, i = 0; z && i < 6; i++, z = z.parentElement) { if (z.querySelectorAll("[name^='attributes.']").length > 1 || texteDe(z).length > 400) break; if (/frequ/.test(texteDe(z)) || i >= 3) return z; }
    return b.parentElement;
  }
  function attributsPage() {
    var mod = modeleAttributs(), noms = Object.keys(mod);
    [].forEach.call(document.querySelectorAll("[name^='attributes.']"), function (e) { var n = e.getAttribute("name").slice(11); if (noms.indexOf(n) < 0) { noms.push(n); mod[n] = { nom: n, suggestions: [] }; } });
    return noms.map(function (n) { var b = boutonAttribut(n); return b ? Object.assign({}, mod[n], { bouton: b }) : null; }).filter(Boolean);
  }
  function valeurAttribut(c) {
    var t = texteDe(c.bouton).replace(new RegExp("^" + norm(c.nom).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "").trim();
    if (c.bouton.matches("input, select")) t = norm(c.bouton.value);
    return /^[-–—\s]*$/.test(t) ? "" : t;
  }
  async function attendre(f, ms) { for (var t = 0; t < (ms || 2000); t += 100) { var r = f(); if (r) return r; await pause(100); } return null; }
  function champMenu() {
    return [].filter.call(document.querySelectorAll("input[type=text], input[type=search], input:not([type])"), function (x) {
      return visibleEl(x) && /recherch|ajoute|search|add/.test(norm([x.placeholder, x.getAttribute("aria-label")].join(" "))) && !/dites-nous|vendez/.test(norm(x.placeholder));
    })[0];
  }
  function optionMenu(boite, v) {
    var n = norm(v), l = [].filter.call(boite.querySelectorAll("[role=option], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], label, button, li"), function (x) { return visibleEl(x) && !(hote && hote.contains(x)); });
    return l.filter(function (x) { return texteDe(x) === n; })[0] || l.filter(function (x) { var t = texteDe(x); return t.indexOf(n) === 0 && t.length - n.length <= 3; })[0];
  }
  async function choisirValeur(c, v) {
    // Champ texte libre (« Quantité unitaire ») : on tape la valeur.
    if (c.bouton.matches("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea")) { await taperLettres(c.bouton, v); c.bouton.dispatchEvent(new Event("change", { bubbles: true })); c.bouton.blur(); return true; }
    // 1. Une valeur « Fréquentes » qui correspond : un clic suffit.
    var ligne = ligneAttribut(c.bouton);
    var vite = [].filter.call(ligne.querySelectorAll("button, a, [role=button]"), function (x) { return x !== c.bouton && !c.bouton.contains(x) && visibleEl(x) && texteDe(x) === norm(v); })[0];
    if (vite) { cliquer(vite); await pause(400); return true; }
    // 2. Le menu : on cherche la valeur, on la coche, sinon on l'ajoute comme valeur personnalisée.
    cliquer(c.bouton);
    var champ = await attendre(champMenu, 2500);
    var boite = champ; for (var i = 0; boite && i < 6 && !(boite.querySelectorAll("button, label, [role=option], li").length > 2); i++) boite = boite.parentElement;
    boite = boite || document.body;
    var o = optionMenu(boite, v);
    if (!o && champ) { await taperLettres(champ, v); o = await attendre(function () { return optionMenu(boite, v); }, 1500); }
    var ok = false;
    if (o) { var cb = o.querySelector("input[type=checkbox], input[type=radio]"); if (!(cb && cb.checked)) cliquer(cb || o); ok = true; }
    else {
      var aj = [].filter.call(boite.querySelectorAll("button, [role=button], [role=option], li"), function (x) { return visibleEl(x) && /ajouter|add/.test(texteDe(x)); })[0];
      if (aj) { cliquer(aj); ok = true; } else if (champ) { entree(champ); ok = true; }
    }
    await pause(400);
    // Fermer le menu : « Terminé » / « Appliquer » s'il y en a, sinon Échap.
    var fin = [].filter.call(boite.querySelectorAll("button"), function (x) { return visibleEl(x) && /^(termine|appliquer|ok|valider|done|apply)$/.test(texteDe(x)); })[0];
    if (fin) cliquer(fin);
    else { var cible = champ || document.activeElement || document.body; ["keydown", "keyup"].forEach(function (t) { cible.dispatchEvent(new KeyboardEvent(t, { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })); }); }
    await pause(300);
    return ok;
  }
  var specCache = {};
  async function remplirSpecifiques(a) {
    if (depot.faits.carac === a.id) return depot.lignes.carac;
    var l = attributsPage();
    if (!l.length) return false;
    depot.faits.carac = a.id;
    var vides = l.filter(function (c) { return !valeurAttribut(c); });
    noter("caractéristiques : " + l.length + " (vides : " + vides.length + ")");
    if (!vides.length) return true;
    var r = specCache[a.id] || (specCache[a.id] = rrDemander({ type: "specifiques", annonce: a.id, champs: vides.map(function (c) { return { nom: c.nom, obligatoire: !!c.obligatoire, multiple: !!c.multiple, suggestions: c.suggestions || [] }; }) }));
    var vals = {}; try { vals = ((await r) || {}).valeurs || {}; } catch (e) { delete specCache[a.id]; noter("caractéristiques : " + e.message); depot.faits.carac = ""; return false; }
    var n = 0;
    for (var i = 0; i < vides.length; i++) {
      var c = vides[i], v = vals[c.nom]; if (v == null || v === "") continue;
      var b = boutonAttribut(c.nom); if (!b) continue; c.bouton = b;
      var liste = (Array.isArray(v) ? v : [v]).slice(0, c.multiple ? 30 : 1);
      for (var j = 0; j < liste.length; j++) { try { if (await choisirValeur(c, String(liste[j]))) n++; } catch (e) { noter("caractéristique « " + c.nom + " » : " + e.message); } }
      noter("caractéristique « " + c.nom + " » : " + liste.join(", "));
    }
    return n > 0 || vides.every(function (c) { return !c.obligatoire; });
  }
  // L'état sur « Terminer votre annonce » : déjà choisi à l'étape d'avant, il s'affiche en texte sous « État de l'objet ».
  function etatDejaChoisi(a) {
    var cible = norm(a.ebay.etat), cibles = ETAT_SYN[cible] || [cible];
    var t = norm((document.body && document.body.innerText) || ""), i = t.indexOf("etat de l'objet");
    return i >= 0 && cibles.some(function (c) { var k = t.indexOf(c, i); return k >= 0 && k - i < 80; });
  }
  async function remplirPhotos(a) {
    if (!a.photo || depot.faits.photos === a.id) return depot.lignes.photos;
    var f = [].filter.call(document.querySelectorAll("input[type=file]"), function (x) { return !(hote && hote.contains(x)) && /image|jpe?g|png|\*/.test(x.accept || "*"); })[0];
    if (!f) return false;
    depot.faits.photos = a.id;
    var ids = Array.isArray(a.photos) && a.photos.length ? a.photos : [""], dt = new DataTransfer();
    var nom = (a.nom || "photo").normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 50) || "photo";
    for (var j = 0; j < ids.length && j < (f.multiple ? 24 : 1); j++) {
      var r = await rrDemander({ type: "photo", id: a.id, photo: ids[j] }), bin = atob(r.base64), b = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      dt.items.add(new File([b], nom + "-" + (j + 1) + ".jpg", { type: r.type || "image/jpeg" }));
    }
    f.files = dt.files; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  var enCours = false;
  async function remplirFormulaire(a) {
    if (enCours) return; enCours = true;
    try {
      var titre = champs("input[type=text], input:not([type])", /titre|title/, /recherch|search|jeu|film|game|sous-titre|subtitle/, true)[0];
      if (titre) fait("titre", poser(titre, a.ebay.titre));
      if (a.ebay.prix != null) { var px = champs("input:not([type=checkbox]):not([type=radio]):not([type=hidden])", /prix|price|achat immediat|buy it now/, /livraison|shipping|envoi|minimum|refus|accept|offre|offer|reserve|depart|start/, true)[0]; if (px) fait("prix", poser(px, String(a.ebay.prix))); }
      if (a.ebay.plancher != null) { var pl = champs("input:not([type=checkbox]):not([type=radio]):not([type=hidden])", /refus|decline|minimum/, /livraison|shipping/, true)[0]; if (pl) fait("offres", poser(pl, String(a.ebay.plancher))); }
      fait("etat", choisirEtat(a) || etatDejaChoisi(a));
      fait("desc", remplirDescription(a));
      fait("photos", await remplirPhotos(a).catch(function () { return false; }));
      var rc = remplirCarac(a); dessinerDepot();
      fait("carac", await remplirSpecifiques(a).catch(function (e) { noter("caractéristiques : " + e.message); return false; }) || rc);
      if (["titre", "prix", "desc", "photos"].every(function (k) { return depot.lignes[k]; })) pretAPublier(a);
    } finally { enCours = false; dessinerDepot(); }
  }
  /* Tout est rempli : on ferme les bulles d'aide d'eBay (« Sélectionner un format de mise en vente »…), on descend
     jusqu'à « Mettre en vente » et on le signale. Jamais de clic dessus : la publication reste à la personne.
     Une seule fois par article et par onglet (eBay recharge la page en brouillon). */
  function fermerBulles() {
    var n = 0;
    [].forEach.call(document.querySelectorAll("button, [role=button]"), function (x) {
      if (!visibleEl(x) || !/^(fermer|close|ignorer|dismiss|j.ai compris|compris|ok)\b/.test(norm([x.getAttribute("aria-label"), x.textContent].join(" ")).trim())) return;
      var bulle = x.closest("[class*=tip], [class*=tour], [class*=bubble], [class*=coach], [class*=popover], [role=tooltip]");
      if (!bulle || bulle.closest("[role=dialog][aria-modal=true]") || (hote && hote.contains(x))) return;
      cliquer(x); n++;
    });
    return n;
  }
  function boutonPublier() {
    return [].filter.call(document.querySelectorAll("button, [role=button], input[type=submit]"), function (x) { return visibleEl(x) && /^mettre en vente|^publier|^list it/.test(texteDe(x) || norm(x.value)); })[0];
  }
  function pretAPublier(a) {
    depot.pret = true;
    var deja = ""; try { deja = sessionStorage.getItem("rrEbayPret") || ""; } catch (e) {}
    if (deja === a.id) return;
    try { sessionStorage.setItem("rrEbayPret", a.id); } catch (e) {}
    setTimeout(function () {
      var n = fermerBulles(); if (n) noter("bulles d'eBay fermées : " + n);
      var b = boutonPublier();
      if (b) {
        try { b.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) { b.scrollIntoView(); }
        b.style.outline = "4px solid #D4F57A"; b.style.outlineOffset = "4px";
        noter("prêt : « " + (b.innerText || "").trim() + " » en vue");
      }
      bulle("Prêt ! Relis l'annonce, puis clique toi-même « Mettre en vente ».");
      dessinerDepot();
    }, 1500);
  }
  async function articleDepot() {
    if (depot.choisi) return depot.a;
    var st = {}; try { st = (await RR.storage.local.get("aDeposerEbay")) || {}; } catch (e) {}
    var d = st.aDeposerEbay && Date.now() - st.aDeposerEbay.at < 3 * 3600e3 ? st.aDeposerEbay : null;
    var a = d && annonces.filter(function (x) { return x.id === d.id; })[0];
    if (a && (!depot.a || depot.a.id !== a.id)) { depot.a = a; depot.faits = {}; depot.lignes = {}; depot.pret = false; }
    depot.erreur = "";
    return depot.a;
  }
  async function remplirDepot() {
    var a = await articleDepot();
    if (!hote) construire();
    if (a && a.ebay) {
      if (mode() === "prelist") {
        remplirPrelist(a);
        // « Confirmer les informations » : l'état de l'objet, dans la fenêtre qui suit le choix de l'objet.
        if (/etat de l.objet|condition/.test(norm((document.body && document.body.innerText) || "").slice(0, 20000)) && choisirEtat(a)) {
          fait("etat", true); noter("état choisi : " + a.ebay.etat);
        }
        avancer(a);
      } else await remplirFormulaire(a);
    }
    dessinerDepot();
  }
  /* Étapes entre la recherche et le formulaire, cliquées toutes seules : « Continuer sans correspondance » (aucun
     produit du catalogue choisi : le titre reste le nôtre), puis « Continuer la mise en vente » une fois l'état coché.
     Jamais « Mettre en vente » : la publication reste à la personne. Une fois par article et par bouton. */
  var SUIVANT = [
    { cle: "suite", re: /^continuer la mise en vente$|^continuer$|^suivant$|^continue( to listing)?$|^next$/, pret: function (a) { return depot.lignes.etat || !a.ebay.etat || !document.querySelector("input[type=radio]"); } },
    { cle: "sans", re: /continuer sans (correspondance|selectionner|choisir|produit)|je ne trouve pas|aucune correspondance|ne figure pas|continue without/, pret: function () { return true; } }];
  var minuterieAvancer = null;
  function avancer(a) {
    if (minuterieAvancer) return;   // un essai déjà prévu
    minuterieAvancer = setTimeout(function () {
      minuterieAvancer = null;
      if (mode() !== "prelist" || personneATape) return;
      var cherche = ""; try { cherche = sessionStorage.getItem("rrEbayCherche") || ""; } catch (e) {}
      if (cherche !== a.id || /\/suggest/.test(location.pathname)) return;   // la recherche d'abord
      var deja = {}; try { deja = JSON.parse(sessionStorage.getItem("rrEbayClics") || "{}"); } catch (e) {}
      var boutons = [].filter.call(document.querySelectorAll("button, a[role=button], [role=button], input[type=submit]"), function (x) { return visibleEl(x) && !x.disabled && x.getAttribute("aria-disabled") !== "true"; });
      for (var i = 0; i < SUIVANT.length; i++) {
        var s = SUIVANT[i], k = a.id + ":" + s.cle + ":" + location.pathname;
        if (deja[k] || !s.pret(a)) continue;
        var b = boutons.filter(function (x) { var t = texteDe(x) || norm(x.value); return s.re.test(t) && !PAS_CLIC.test(t); })[0];
        if (!b) continue;
        deja[k] = 1; try { sessionStorage.setItem("rrEbayClics", JSON.stringify(deja)); } catch (e) {}
        noter("clic : « " + (b.innerText || b.value || "").trim() + " »"); cliquer(b);
        setTimeout(function () { if (mode() === "prelist") remplirDepot(); }, 1500);   // fenêtre ouverte par le clic
        return;
      }
    }, 1200);
  }
  var LIGNES = [["titre", "Titre"], ["etat", "État"], ["carac", "Caractéristiques"], ["prix", "Prix"], ["offres", "Refus des offres trop basses"], ["desc", "Description"], ["photos", "Photos"]];
  function dessinerDepot() {
    if (!ombre) return;
    var b = ombre.querySelector(".b"), garde = ombre.querySelector(".bulle");
    b.textContent = ""; if (garde) b.appendChild(garde);
    if (!ouvert) { b.appendChild(el("button", { class: "rond", type: "button", "aria-label": "Ouvrir RetroRevente", onclick: function () { ouvert = true; dessinerDepot(); } }, [el("img", { src: RR.runtime.getURL("icones/icone-128.png"), alt: "" }), el("i", { texte: "eBay" })])); return; }
    var p = el("div", { class: "p", role: "dialog", "aria-label": "RetroRevente : mise en vente eBay" });
    p.appendChild(entete(function () { ouvert = false; dessinerDepot(); }, true));
    p.appendChild(el("p", { class: "lead", texte: "Mise en vente" }));
    if (!annonces) { p.appendChild(el("p", { class: depot.erreur ? "s bad" : "s", texte: depot.erreur || "Chargement de tes articles…" })); b.appendChild(p); return; }
    var sel = selecteur({ choisie: depot.a, vide: "Choisis l'article à mettre en vente",
      choisir: function (x) { if (!x) return; depot.a = x; depot.choisi = true; depot.faits = {}; depot.lignes = {}; depot.pret = false; dejaRempli = new WeakMap(); remplirDepot(); } });
    p.appendChild(sel);
    if (depot.a) {
      var l = el("ul", { class: "etapes" });
      (mode() === "prelist" ? [["titre", "Titre tapé et recherche lancée"], ["etat", "État de l'objet"]] : LIGNES).forEach(function (x) {
        l.appendChild(el("li", { class: depot.lignes[x[0]] ? "ok" : "" }, [el("span", { class: "puce", texte: depot.lignes[x[0]] ? "✓" : "·" }), x[1]]));
      });
      p.appendChild(l);
      if (depot.manque) p.appendChild(el("p", { class: "s bad", texte: depot.manque }));
      p.appendChild(el("p", { class: "s ok", texte: mode() === "prelist" ? "RetroRevente lance la recherche, coche l'état et passe aux étapes suivantes tout seul." : (depot.pret ? "Prêt : tout est rempli. Relis, puis clique « Mettre en vente »." : "Relis chaque champ, complète ce qui manque, puis clique « Mettre en vente ».") }));

    } else p.appendChild(el("p", { class: "s", texte: "Choisis l'article : RetroRevente tape son titre, puis remplit le formulaire d'eBay." }));
    p.appendChild(el("div", { class: "outils" }, [
      el("button", { class: "mini", type: "button", title: "Copie la structure de la page (sans ce que tu as tapé) pour que je corrige l'extension", texte: "Copier un diagnostic", onclick: copierDiagnostic }),
      depot.a ? el("button", { class: "mini", type: "button", texte: "Remplir à nouveau", onclick: function () { depot.faits = {}; depot.lignes = {}; depot.pret = false; dejaRempli = new WeakMap(); remplirDepot(); } }) : null]));
    b.appendChild(p);
  }

  /* ===== Suivi des pages (eBay change de page sans recharger) ===== */
  var vu = "", minuterie = null;
  function suivre() {
    var m = mode();
    placerSecours();
    if (hote) hote.style.display = m ? "" : "none";
    if (!m) { vu = ""; return; }
    var ici = location.pathname + location.search;
    if (ici !== vu) {
      vu = ici; etat.manuel = false; etat.cle = ""; etat.ia = null;
      if (m === "messages") { if (!hote) construire(); dessiner(); }
      if (depotMode()) { if (!hote) construire(); ouvert = true; dessinerDepot(); }
    }
    charger().then(function () {
      associer(m === "messages");
      if (depotMode()) return remplirDepot();
      if (m !== "messages") return;
      if (!etat.manuel) { var d = deviner(); if (d !== etat.choisie) { etat.choisie = d; etat.cle = ""; } }
      if (ouvert && !(ombre.activeElement && ombre.activeElement.tagName === "TEXTAREA")) proposer(false);
      else dessiner();
    }, function (e) {
      if (depotMode()) { depot.erreur = (e && e.message) || "RetroRevente ne répond pas."; if (!hote) construire(); dessinerDepot(); }
      if (m === "messages" && ombre) { annonces = annonces || []; etat.ia = { erreur: e.message, status: e.status }; dessiner(); }
    });
  }
  suivre();
  new MutationObserver(function (l) {
    if (l.every(function (x) { return (hote && (x.target === hote || hote.contains(x.target))) || (secours && x.target === secours.hote()); })) return;
    clearTimeout(minuterie); minuterie = setTimeout(suivre, 1500);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(function () { if (location.pathname + location.search !== vu || (mode() === "prelist" && !vu)) suivre(); else placerSecours(); eviterFixes(); }, 1000);
})();
