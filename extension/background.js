// Arrière-plan : seul endroit qui parle à retrorevente.fr, avec la clé de l'extension (lecture seule des annonces).
// Ne contacte jamais Le Bon Coin.
var RR = globalThis.browser || globalThis.chrome;
var SERVEUR = "https://retrorevente.fr";
var SERVEURS_OK = /^(https:\/\/retrorevente\.fr|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/;

function lire() { return RR.storage.local.get(["cle", "serveur", "email"]); }

async function appel(chemin, opts) {
  var s = await lire();
  if (!s.cle) { var e0 = new Error("Extension pas encore connectée à ton compte RetroRevente."); e0.status = 401; throw e0; }
  var r = await fetch((s.serveur || SERVEUR) + chemin, Object.assign({ cache: "no-store", credentials: "omit", headers: { Authorization: "Bearer " + s.cle } }, opts || {}));
  if (r.status === 401) { await RR.storage.local.remove(["cle", "email"]); }
  if (!r.ok) {
    var j = await r.json().catch(function () { return {}; });
    var e = new Error(j.error || "RetroRevente ne répond pas (erreur " + r.status + ")."); e.status = r.status; throw e;
  }
  return r;
}

async function entetes() { var s = await lire(); return { Authorization: "Bearer " + s.cle, "Content-Type": "application/json" }; }

function base64(buf) {
  var b = new Uint8Array(buf), s = "";
  for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

var ACTIONS = {
  // Notification système quand la personne doit agir (Chrome, Firefox). Safari n'a pas cette API : la page prend le relais.
  alerte: async function (m) {
    if (!RR.notifications || !RR.notifications.create) return { ok: false };
    await RR.notifications.create("rr-" + Date.now(), { type: "basic", iconUrl: RR.runtime.getURL("icones/icone-128.png"), title: String(m.titre || "RetroRevente").slice(0, 80), message: String(m.texte || "").slice(0, 200), priority: 2 });
    return { ok: true };
  },
  // Son « à toi » joué par l'app Mac (Safari) : le gestionnaire natif lance NSSound. Ailleurs, pas de message natif.
  son: async function () {
    if (!RR.runtime.sendNativeMessage || !/Apple/.test(navigator.vendor || "")) return { ok: false, erreur: "pas d'app native" };
    var r = await RR.runtime.sendNativeMessage("fr.retrorevente.app", { type: "son" });
    return r && r.ok ? { ok: true, via: r.via || "natif" } : { ok: false, erreur: (r && r.erreur) || "réponse vide" };
  },
  etat: async function () { var s = await lire(); return { connecte: !!s.cle, email: s.email || "", serveur: s.serveur || SERVEUR }; },
  cle: async function (m) {
    if (!/^rre_[A-Za-z0-9_-]{20,80}$/.test(String(m.cle || "").trim())) throw new Error("Clé invalide : elle commence par « rre_ ».");
    var serveur = SERVEURS_OK.test(m.serveur || "") ? m.serveur : SERVEUR;
    await RR.storage.local.set({ cle: m.cle.trim(), serveur: serveur });
    var j = await (await appel("/api/extension/annonces")).json();
    await RR.storage.local.set({ email: j.email });
    return { ok: true, email: j.email, n: j.annonces.length };
  },
  deconnecter: async function () { await RR.storage.local.remove(["cle", "email"]); return { ok: true }; },
  annonces: async function () { return (await appel("/api/extension/annonces")).json(); },
  photo: async function (m) {
    if (!/^[a-f0-9]{16}$/.test(m.id || "")) throw new Error("Photo inconnue.");
    var r = await appel("/api/extension/photo/" + m.id + (/^(p0|[a-f0-9]{8})$/.test(m.photo || "") ? "/" + m.photo : ""));
    return { type: r.headers.get("content-type") || "image/jpeg", base64: base64(await r.arrayBuffer()) };
  },
  reponse: async function (m) {
    var r = await appel("/api/extension/reponse", { method: "POST", headers: await entetes(), body: JSON.stringify({ annonce: m.annonce || "", conversation: String(m.conversation || "").slice(-5000), lot: m.lot || null, offre: m.offre || null, acheteur: String(m.acheteur || "").slice(0, 40), consigne: String(m.consigne || "").slice(0, 400), precedentes: Array.isArray(m.precedentes) ? m.precedentes.slice(0, 3).map(function (x) { return String(x || "").slice(0, 500); }) : [], mesMessages: Array.isArray(m.mesMessages) ? m.mesMessages.slice(-4).map(function (x) { return String(x || "").slice(0, 600); }) : [] }) });
    return r.json();
  },
  lien: async function (m) {
    var r = await appel("/api/extension/lien", { method: "POST", headers: await entetes(), body: JSON.stringify({ annonce: m.annonce, url: m.url }) });
    return r.json();
  },
  rempli: async function () { await appel("/api/extension/rempli", { method: "POST" }); return { ok: true }; },
};

RR.runtime.onMessage.addListener(function (m, expediteur, repondre) {
  if (expediteur.id && expediteur.id !== RR.runtime.id) return false;
  var f = m && ACTIONS[m.type];
  if (!f) return false;
  var p = f(m).catch(function (e) { return { error: e.message || String(e), status: e.status || 0 }; });
  // Safari et Firefox attendent une promesse renvoyée (Safari laisse sinon l'appel sans réponse) ; Chrome, le rappel.
  if (globalThis.browser && globalThis.browser.runtime) return p;
  p.then(repondre);
  return true;   // réponse asynchrone
});

// Raccourci global (⌥⇧R par défaut) : sur la page de dépôt, ouvre le panneau et la recherche ; ailleurs, ouvre la page de dépôt.
var DEPOT_URL = "https://www.leboncoin.fr/deposer-une-annonce";
if (RR.commands && RR.commands.onCommand) RR.commands.onCommand.addListener(function (cmd) {
  if (cmd !== "ouvrir-recherche") return;
  RR.tabs.query({ active: true, currentWindow: true }).then(function (t) {
    var tab = t && t[0];
    if (tab && /^https:\/\/www\.leboncoin\.fr\/deposer-une-annonce/.test(tab.url || "")) return RR.tabs.sendMessage(tab.id, { type: "ouvrir-recherche" });
    return RR.tabs.create({ url: DEPOT_URL });
  }).catch(function () {});
});
