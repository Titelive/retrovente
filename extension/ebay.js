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
    if (/^\/sl\/prelist(\/|$)/i.test(p)) return "prelist";
    if (/^\/(lstng|sl\/(list|sell))(\/|$)/i.test(p)) return "formulaire";
    if (/^\/(sh|mys|sl)(\/|$)/i.test(p) || /^\/myb\/(Selling|ActiveListings|Summary)/i.test(p)) return "vendeur";
    return "";
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
    ".rond i{position:absolute;right:-6px;top:-6px;font:800 10.5px/1 var(--titre);font-style:normal;background:var(--ebay);color:#fff;border-radius:999px;padding:4px 6px;box-shadow:0 0 0 2px var(--carte)}" +
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
    "button:focus-visible,select:focus-visible{outline:2px solid var(--anis);outline-offset:2px}";
  function el(tag, attrs, enfants) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === "texte") e.textContent = attrs[k]; else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
    (enfants || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
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
    p.appendChild(el("div", { class: "t" }, [el("b", {}, [el("span", { class: "logo", texte: "RR" }), "RetroRevente", el("span", { class: "site", texte: "eBay" })]),
      el("button", { class: "x", type: "button", "aria-label": "Réduire", texte: "×", onclick: function () { ouvert = false; dessiner(); } })]));
    if (annonces === null) { p.appendChild(el("p", { class: "s", texte: "Chargement de tes articles…" })); b.appendChild(p); return; }
    // Choix de l'article (deviné tout seul, modifiable).
    var sel = el("select", { "aria-label": "Article concerné", onchange: function () { etat.choisie = annonces.filter(function (a) { return a.id === sel.value; })[0] || null; etat.manuel = true; proposer(true); } });
    sel.appendChild(el("option", { value: "", texte: "Article non reconnu (réponse générale)" }));
    annonces.forEach(function (a) {
      var o = el("option", { value: a.id, texte: (a.titre || a.nom) + (a.prix != null ? " · " + a.prix + " €" : "") + (a.urlEbay ? " · sur eBay" : "") });
      if (etat.choisie && etat.choisie.id === a.id) o.selected = true;
      sel.appendChild(o);
    });
    p.appendChild(el("div", { class: "art" }, [el("label", { texte: "Article" }), sel]));
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
      etat.ia = { resume: r.resume, reponses: r.reponses || [], offre: r.offre, consigne: consigne || "" };
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

  // Page « Commencer votre annonce » : le titre dans « Dites-nous ce que vous vendez », puis la loupe.
  function remplirPrelist(a) {
    if (depot.faits.prelist === a.id) return;
    var l = champs("input[type=text], input[type=search], input:not([type])", /vendez|vendre|sell|cherch|search|recherch|mots?-cles|keyword/);
    var c = l[0]; if (!c) return;
    depot.faits.prelist = a.id;
    ecrireValeur(c, a.ebay.titre); fait("titre", true);
    setTimeout(function () {
      var f = c.form, b = f && f.querySelector("button[type=submit], button:not([type])");
      if (!b) { var z = c.parentElement; for (var i = 0; i < 4 && z && !b; i++, z = z.parentElement) b = [].filter.call(z.querySelectorAll("button"), visibleEl)[0]; }
      if (b && !/mettre en vente|publier|list it/i.test(b.textContent || "")) b.click();
      else if (f && f.requestSubmit) f.requestSubmit();
      else c.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
      bulle("RetroRevente a cherché « " + a.ebay.titre + " » sur eBay : choisis l'objet correspondant ou continue sans.");
    }, 400);
  }
  // État : bouton radio, option de liste ou bouton dont le texte est l'état eBay voulu (une valeur déjà choisie est gardée).
  function choisirEtat(a) {
    if (!a.ebay.etat || depot.faits.etat === a.id) return depot.lignes.etat;
    var cible = norm(a.ebay.etat);
    var radios = [].filter.call(document.querySelectorAll("input[type=radio]"), function (r) { return !(hote && hote.contains(r)); });
    var r = radios.filter(function (x) { var l = x.closest("label") || (x.id && document.querySelector("label[for='" + window.CSS.escape(x.id) + "']")) || x.parentElement; return l && norm(l.textContent).indexOf(cible) === 0; })[0];
    if (r) { if (!r.checked) r.click(); depot.faits.etat = a.id; return true; }
    var sel = champs("select", /etat|condition/)[0];
    if (sel) { var o = [].filter.call(sel.options, function (x) { return norm(x.textContent).indexOf(cible) === 0; })[0]; if (o) { sel.value = o.value; sel.dispatchEvent(new Event("change", { bubbles: true })); depot.faits.etat = a.id; return true; } }
    return false;
  }
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
  function remplirDescription(a) {
    if (!a.ebay.description || depot.faits.desc === a.id) return depot.lignes.desc;
    var t = champs("textarea", /description/)[0];
    if (t) { poser(t, a.ebay.description); depot.faits.desc = a.id; return true; }
    var zones = [].slice.call(document.querySelectorAll("[contenteditable=''], [contenteditable=true]"));
    [].forEach.call(document.querySelectorAll("iframe"), function (f) { try { var d = f.contentDocument; if (d && (d.body.isContentEditable || d.designMode === "on")) zones.push(d.body); } catch (e) {} });
    var z = zones.filter(function (x) { return x.ownerDocument !== document || (visibleEl(x) && /description/.test(decrire(x) + " " + norm((x.closest("section, fieldset, [role=group]") || {}).innerText || "").slice(0, 200))); })[0];
    if (!z) return false;
    depot.faits.desc = a.id;
    if ((z.innerText || "").trim().length > 10) return true;   // texte déjà écrit : on n'y touche pas
    z.innerHTML = a.ebay.description.split("\n").map(function (l) { var p = document.createElement("p"); p.textContent = l; return p.outerHTML; }).join("");
    z.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
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
      fait("etat", choisirEtat(a));
      fait("carac", remplirCarac(a));
      fait("desc", remplirDescription(a));
      fait("photos", await remplirPhotos(a).catch(function () { return false; }));
    } finally { enCours = false; dessinerDepot(); }
  }
  async function articleDepot() {
    if (depot.choisi) return depot.a;
    var st = {}; try { st = (await RR.storage.local.get("aDeposerEbay")) || {}; } catch (e) {}
    var d = st.aDeposerEbay && Date.now() - st.aDeposerEbay.at < 3 * 3600e3 ? st.aDeposerEbay : null;
    var a = d && annonces.filter(function (x) { return x.id === d.id; })[0];
    if (a && (!depot.a || depot.a.id !== a.id)) { depot.a = a; depot.faits = {}; depot.lignes = {}; }
    return depot.a;
  }
  async function remplirDepot() {
    var a = await articleDepot();
    if (!hote) construire();
    if (a && a.ebay) { if (mode() === "prelist") remplirPrelist(a); else await remplirFormulaire(a); }
    dessinerDepot();
  }
  var LIGNES = [["titre", "Titre"], ["etat", "État"], ["carac", "Caractéristiques"], ["prix", "Prix"], ["offres", "Refus des offres trop basses"], ["desc", "Description"], ["photos", "Photos"]];
  function dessinerDepot() {
    if (!ombre) return;
    var b = ombre.querySelector(".b"), garde = ombre.querySelector(".bulle");
    b.textContent = ""; if (garde) b.appendChild(garde);
    if (!ouvert) { b.appendChild(el("button", { class: "rond", type: "button", "aria-label": "Ouvrir RetroRevente", onclick: function () { ouvert = true; dessinerDepot(); } }, [el("img", { src: RR.runtime.getURL("icones/icone-128.png"), alt: "" }), el("i", { texte: "eBay" })])); return; }
    var p = el("div", { class: "p", role: "dialog", "aria-label": "RetroRevente : mise en vente eBay" });
    p.appendChild(el("div", { class: "t" }, [el("b", {}, [el("span", { class: "logo", texte: "RR" }), "Mise en vente", el("span", { class: "site", texte: "eBay" })]),
      el("button", { class: "x", type: "button", "aria-label": "Réduire", texte: "×", onclick: function () { ouvert = false; dessinerDepot(); } })]));
    if (!annonces) { p.appendChild(el("p", { class: "s", texte: "Chargement de tes articles…" })); b.appendChild(p); return; }
    var sel = el("select", { "aria-label": "Article à mettre en vente", onchange: function () {
      depot.a = annonces.filter(function (x) { return x.id === sel.value; })[0] || null; depot.choisi = true; depot.faits = {}; depot.lignes = {}; dejaRempli = new WeakMap(); remplirDepot();
    } });
    sel.appendChild(el("option", { value: "", texte: "Choisis l'article à mettre en vente" }));
    annonces.forEach(function (a) { var o = el("option", { value: a.id, texte: (a.titre || a.nom) + (a.prix != null ? " · " + a.prix + " €" : "") + (a.urlEbay ? " · déjà sur eBay" : "") }); if (depot.a && depot.a.id === a.id) o.selected = true; sel.appendChild(o); });
    p.appendChild(el("div", { class: "art" }, [el("label", { texte: "Article" }), sel]));
    if (depot.a) {
      var l = el("ul", { class: "etapes" });
      (mode() === "prelist" ? [["titre", "Titre tapé et recherche lancée"]] : LIGNES).forEach(function (x) {
        l.appendChild(el("li", { class: depot.lignes[x[0]] ? "ok" : "" }, [el("span", { class: "puce", texte: depot.lignes[x[0]] ? "✓" : "·" }), x[1]]));
      });
      p.appendChild(l);
      p.appendChild(el("p", { class: "s ok", texte: mode() === "prelist" ? "Choisis l'objet qui correspond (ou continue sans), puis l'état : RetroRevente remplira le formulaire." : "Relis chaque champ, ajoute ce qui manque, puis clique toi-même « Mettre en vente »." }));
      p.appendChild(el("button", { class: "mini", type: "button", texte: "Remplir à nouveau", onclick: function () { depot.faits = {}; depot.lignes = {}; dejaRempli = new WeakMap(); remplirDepot(); } }));
    } else p.appendChild(el("p", { class: "s", texte: "Choisis l'article : RetroRevente tape son titre, puis remplit le formulaire d'eBay." }));
    b.appendChild(p);
  }

  /* ===== Suivi des pages (eBay change de page sans recharger) ===== */
  var vu = "", minuterie = null;
  function suivre() {
    var m = mode();
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
      if (m === "messages" && ombre) { annonces = annonces || []; etat.ia = { erreur: e.message, status: e.status }; dessiner(); }
    });
  }
  suivre();
  new MutationObserver(function (l) {
    if (l.every(function (x) { return hote && (x.target === hote || hote.contains(x.target)); })) return;
    clearTimeout(minuterie); minuterie = setTimeout(suivre, 1500);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(function () { if (location.pathname + location.search !== vu) suivre(); }, 1000);
})();
