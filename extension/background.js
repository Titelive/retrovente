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
    var r = await appel("/api/extension/photo/" + m.id);
    return { type: r.headers.get("content-type") || "image/jpeg", base64: base64(await r.arrayBuffer()) };
  },
  reponse: async function (m) {
    var r = await appel("/api/extension/reponse", { method: "POST", headers: await entetes(), body: JSON.stringify({ annonce: m.annonce || "", conversation: String(m.conversation || "").slice(-5000), lot: m.lot || null, offre: m.offre || null, acheteur: String(m.acheteur || "").slice(0, 40) }) });
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
  f(m).then(repondre, function (e) { repondre({ error: e.message || String(e), status: e.status || 0 }); });
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
