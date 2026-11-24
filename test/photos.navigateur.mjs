// Photos des cartes de « Mes articles » dans un vrai navigateur : jamais de vignette blanche ou coupée.
//   node test/photos.navigateur.mjs            (Chromium)
//   node test/photos.navigateur.mjs webkit     (WebKit, le moteur de Safari : npx playwright install webkit)
// Le serveur tourne pour de vrai (base et photos temporaires) ; les pannes réseau sont simulées sur /api/photo/.
// Hors de `npm test` : il faut Playwright et un navigateur.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) { pw = require(process.env.PLAYWRIGHT_MODULE || "/opt/node-tools/node_modules/playwright"); }
const moteur = process.argv[2] || "chromium";
const ici = path.dirname(new URL(import.meta.url).pathname);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "rr-photos-"));
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;

const serveur = spawn(process.execPath, ["--no-warnings", path.join(ici, "../server/server.mjs")], {
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR: DATA, IA_FAKE: "1", COOKIE_INSECURE: "1" }, stdio: ["ignore", "ignore", "inherit"],
});
const fin = (code) => { serveur.kill(); fs.rmSync(DATA, { recursive: true, force: true }); process.exit(code); };
for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + "/__health")).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 100)); }

let ok = 0, ko = 0;
async function etape(nom, f) {
  try { await f(); ok++; console.log("  ✔ " + nom); } catch (e) { ko++; console.log("  ✘ " + nom + "\n    " + (e && e.stack || e).split("\n").slice(0, 4).join("\n    ")); }
}

const nav = await pw[moteur].launch();
console.log(`Photos des cartes, ${moteur} ${nav.version()}`);
try {
  const ctx = await nav.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage();
  const erreursJs = [];
  page.on("pageerror", (e) => erreursJs.push(e.message));
  await page.goto(BASE + "/app/");

  // compte payant (articles et lots sans limite), adresse confirmée
  const email = "photos@test.fr";
  assert.equal(await page.evaluate((e) => fetch("/api/inscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, motdepasse: "motdepasse123", cgv: true, adresse: "54000 Nancy" }) }).then((r) => r.status), email), 200);
  const base = new DatabaseSync(path.join(DATA, "retrorevente.db"));
  base.prepare("UPDATE users SET email_ok = 1, plan = 'collectionneur', plan_status = 'active' WHERE email = ?").run(email);
  base.close();

  // Photos de test : des JPEG lourds (bruit coloré), d'une couleur par photo, sans aucun blanc.
  const ids = await page.evaluate(async () => {
    function photo(teinte) {
      const c = document.createElement("canvas"); c.width = c.height = 1400; const g = c.getContext("2d"), d = g.createImageData(1400, 1400);
      for (let i = 0; i < d.data.length; i += 4) { const n = Math.random() * 60; d.data[i] = teinte[0] + n; d.data[i + 1] = teinte[1] + n; d.data[i + 2] = teinte[2] + n; d.data[i + 3] = 255; }
      g.putImageData(d, 0, 0); return c.toDataURL("image/jpeg", 0.9);
    }
    const post = (u, b) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
    const a = (await post("/api/objets", { objet: { titre: "Donkey Kong 64", plateforme: "Nintendo 64", prixDemande: "35" }, photo: photo([150, 30, 20]) })).objet;
    await post(`/api/objets/${a.id}/photos`, { photo: photo([20, 30, 150]), legende: "Dos" });
    const b = (await post("/api/objets", { objet: { titre: "Banjo-Kazooie", plateforme: "Nintendo 64", prixDemande: "30" }, photo: photo([20, 140, 40]) })).objet;
    const c = (await post("/api/objets", { objet: { titre: "Conker", plateforme: "Nintendo 64", prixDemande: "80" }, photo: photo([140, 120, 20]) })).objet;
    const autres = [];
    for (let i = 0; i < 9; i++) autres.push((await post("/api/objets", { objet: { titre: "Jeu " + i, plateforme: "Nintendo 64", prixDemande: "10" }, photo: photo([40 + i * 15, 60, 120]) })).objet.id);
    const lot = (await post("/api/lots", { articles: [b.id, c.id], theme: { nom: "Rareware", type: "studio" }, photo: photo([100, 20, 120]) })).objet;
    return { a: a.id, b: b.id, c: c.id, lot: lot.id, autres };
  });

  // Une carte est « entière » si sa photo est affichée depuis une adresse blob:, décodée, et que son bas n'est pas blanc.
  const etatCartes = () => page.evaluate(() => [...document.querySelectorAll("#liste .jeu")].map((j) => {
    const i = j.querySelector(".im img"); if (!i) return { id: j.dataset.id, sans: true };
    let bas = null;
    if (i.complete && i.naturalWidth) {
      const c = document.createElement("canvas"); c.width = c.height = 40; const g = c.getContext("2d"); g.drawImage(i, 0, 0, 40, 40);
      const d = g.getImageData(0, 30, 40, 10).data; let blancs = 0; for (let k = 0; k < d.length; k += 4) if (d[k] > 245 && d[k + 1] > 245 && d[k + 2] > 245) blancs++;
      bas = blancs / (d.length / 4);
    }
    return { id: j.dataset.id, src: (i.getAttribute("src") || "").slice(0, 5), w: i.naturalWidth, bas, ko: i.getAttribute("data-ph-ko"), rang: +(i.dataset.phI || 0), url: (i.getAttribute("data-ph") || "").split(" ")[+(i.dataset.phI || 0)] };
  }));
  const toutesEntieres = async (ms = 20000) => {
    const t = Date.now(); let e;
    while (Date.now() - t < ms) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.evaluate(() => window.scrollTo(0, 0));
      e = await etatCartes();
      if (e.length && e.every((x) => x.sans || (x.src === "blob:" && x.w > 0 && x.bas === 0))) return e;
      await page.waitForTimeout(250);
    }
    throw new Error("cartes incomplètes : " + JSON.stringify(e.filter((x) => !(x.src === "blob:" && x.w > 0 && x.bas === 0))));
  };
  const filtre = (f) => page.click(`#filtres button[data-f="${f}"]`);
  const ouvrirListe = async () => { await page.goto(BASE + "/app/"); await page.waitForSelector("#liste .jeu"); };

  await etape("toutes les cartes s'affichent entières", async () => {
    await ouvrirListe(); const e = await toutesEntieres();
    assert.equal(e.filter((x) => !x.sans).length, 13);
  });

  await etape("photo coupée en route (réponse complète mais JPEG tronqué) : retéléchargée, affichée entière", async () => {
    const vus = {};
    await page.route("**/api/photo/**", async (r) => {
      const u = r.request().url().replace(/&r=\d+$/, ""), rep = await r.fetch(), corps = await rep.body();
      if (!vus[u]) { vus[u] = 1; return r.fulfill({ response: rep, body: corps.subarray(0, Math.floor(corps.length * 0.04)) }); }   // la fine bande
      return r.fulfill({ response: rep, body: corps });
    });
    await ouvrirListe(); await toutesEntieres();
    assert.ok(Object.keys(vus).length >= 13);
    await page.unroute("**/api/photo/**");
  });

  await etape("coupure réseau (téléchargement interrompu) : nouvel essai automatique", async () => {
    const vus = {};
    await page.route("**/api/photo/**", async (r) => { const u = r.request().url(); if (!vus[u]) { vus[u] = 1; return r.abort("connectionreset"); } return r.continue(); });
    await ouvrirListe(); await toutesEntieres();
    await page.unroute("**/api/photo/**");
  });

  await etape("redessins en rafale pendant les téléchargements (filtres, tri) : aucune carte blanche ensuite", async () => {
    await page.route("**/api/photo/**", async (r) => { await new Promise((ok) => setTimeout(ok, 150 + Math.random() * 600)); return r.continue(); });
    await ouvrirListe();
    for (let k = 0; k < 12; k++) {
      await filtre(["vendu", "tout", "en_vente", "tout"][k % 4]);
      await page.waitForTimeout(60 + (k % 3) * 70);
    }
    await filtre("tout");
    await toutesEntieres();
    await page.unroute("**/api/photo/**");
  });

  await etape("un redessin réutilise les photos déjà prêtes (aucun nouveau téléchargement)", async () => {
    await ouvrirListe(); await toutesEntieres();
    let n = 0; await page.route("**/api/photo/**", (r) => { n++; return r.continue(); });
    await filtre("vendu"); await filtre("tout");
    const e = await etatCartes();
    assert.ok(e.every((x) => x.sans || x.src === "blob:"), "photo affichée tout de suite au redessin");
    await toutesEntieres(); assert.equal(n, 0);
    await page.unroute("**/api/photo/**");
  });

  await etape("première photo d'un article abîmée sur le serveur : la suivante la remplace", async () => {
    const urlA = (await etatCartes()).find((x) => x.id === ids.a).url;
    await page.route("**/api/photo/**", async (r) => {
      const rep = await r.fetch(), corps = await rep.body();
      if (r.request().url().replace(/&r=\d+$/, "").endsWith(urlA)) return r.fulfill({ response: rep, body: corps.subarray(0, 20000) });
      return r.fulfill({ response: rep, body: corps });
    });
    await ouvrirListe(); const e = await toutesEntieres();
    const a = e.find((x) => x.id === ids.a); assert.equal(a.rang, 1, "deuxième photo"); assert.notEqual(a.url, urlA);
    await page.unroute("**/api/photo/**");
  });

  await etape("mosaïque d'un lot abîmée sur le serveur : refaite toute seule, puis affichée entière", async () => {
    await ouvrirListe(); await toutesEntieres();
    const avant = (await etatCartes()).find((x) => x.id === ids.lot).url;
    await page.route("**/api/photo/**", async (r) => {
      const rep = await r.fetch(), corps = await rep.body();
      if (r.request().url().replace(/&r=\d+$/, "").endsWith(avant)) return r.fulfill({ response: rep, body: corps.subarray(0, 15000) });
      return r.fulfill({ response: rep, body: corps });
    });
    await page.evaluate(() => { location.reload(); });
    await page.waitForSelector("#liste .jeu");
    await page.waitForFunction((id, avant) => { const i = document.querySelector('#liste .jeu[data-id="' + id + '"] .im img'); return i && i.getAttribute("data-ph").split(" ")[0] !== avant; }, ids.lot, avant, { timeout: 20000 });
    const e = await toutesEntieres(); const l = e.find((x) => x.id === ids.lot);
    assert.notEqual(l.url, avant); assert.equal(l.rang, 0, "la nouvelle mosaïque, pas une photo de secours");
    await page.unroute("**/api/photo/**");
  });

  await etape("photo introuvable partout : « Photo indisponible » plutôt qu'un carré blanc", async () => {
    await page.route("**/api/photo/**", async (r) => r.request().url().includes(ids.c) ? r.fulfill({ status: 404, body: "{}" }) : r.continue());
    await ouvrirListe(); await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction((id) => { const i = document.querySelector('#liste .jeu[data-id="' + id + '"] .im img'); return i && i.getAttribute("data-ph-ko"); }, ids.c, { timeout: 15000 });
    const txt = await page.evaluate((id) => getComputedStyle(document.querySelector('#liste .jeu[data-id="' + id + '"] .im'), "::after").content, ids.c);
    assert.match(txt, /Photo indisponible/);
    await page.unroute("**/api/photo/**");
  });

  // Ailleurs que sur les cartes : toute photo du serveur passe par la même vérification (blob:, entière).
  const etatImgs = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((i) => {
    let bas = null;
    if (i.complete && i.naturalWidth) {
      const c = document.createElement("canvas"); c.width = c.height = 40; const g = c.getContext("2d"); g.drawImage(i, 0, 0, 40, 40);
      const d = g.getImageData(0, 30, 40, 10).data; let blancs = 0; for (let k = 0; k < d.length; k += 4) if (d[k] > 245 && d[k + 1] > 245 && d[k + 2] > 245) blancs++;
      bas = blancs / (d.length / 4);
    }
    return { src: (i.getAttribute("src") || "").slice(0, 5), w: i.naturalWidth, bas };
  }), sel);
  const entieres = async (sel, n, ms = 20000) => {
    const t = Date.now(); let e;
    while (Date.now() - t < ms) {
      e = await etatImgs(sel);
      if (e.length === n && e.every((x) => x.src === "blob:" && x.w > 0 && x.bas === 0)) return e;
      await page.waitForTimeout(250);
    }
    throw new Error(sel + " incomplètes : " + JSON.stringify(e));
  };
  const coupeLaPremiereFois = async () => {
    const vus = {};
    await page.route("**/api/photo/**", async (r) => {
      const u = r.request().url(), rep = await r.fetch(), corps = await rep.body();
      if (!vus[u]) { vus[u] = 1; return r.fulfill({ response: rep, body: corps.subarray(0, Math.floor(corps.length * 0.04)) }); }
      return r.fulfill({ response: rep, body: corps });
    });
    return vus;
  };
  const ouvrir = async (id) => { await page.click(`#liste .jeu[data-id="${id}"] .jeu-ouvrir`); await page.waitForSelector("#fiche:not([hidden])"); };

  await etape("fiche d'un lot : vignettes des articles entières, même coupées en route (la vignette blanche de Jet Force Gemini)", async () => {
    await ouvrirListe(); await toutesEntieres();
    const vus = await coupeLaPremiereFois();
    await ouvrirListe(); await ouvrir(ids.lot);
    await entieres("#fLotBloc .lb-liste .vg img", 2);
    assert.ok(Object.keys(vus).length >= 2);
    assert.equal(await page.locator('#fLotBloc .lb-liste .vg[style*="url("]').count(), 0, "plus aucune photo en image de fond");
    await page.unroute("**/api/photo/**");
  });

  await etape("fiche d'un article : grande photo et galerie entières, même coupées en route", async () => {
    await coupeLaPremiereFois();
    await ouvrirListe(); await ouvrir(ids.a);
    await entieres("#fPhoto > img", 1);
    await entieres("#fGal li img", 2);
    await page.unroute("**/api/photo/**");
  });

  await etape("rotation dans la fiche : la photo tournée (celle qui sera enregistrée) est entière, sans bande ni blanc", async () => {
    await coupeLaPremiereFois();
    await ouvrirListe(); await ouvrir(ids.b);
    await page.click("#fPivot");
    await page.waitForFunction(() => { const i = document.querySelector("#fPhoto > img"); return i && /^data:/.test(i.getAttribute("src") || "") && i.complete && i.naturalWidth; }, null, { timeout: 20000 });
    const vides = await page.evaluate(() => {
      const i = document.querySelector("#fPhoto > img"), c = document.createElement("canvas"); c.width = c.height = 40; const g = c.getContext("2d"); g.drawImage(i, 0, 0, 40, 40);
      const d = g.getImageData(0, 0, 40, 40).data; let n = 0;
      for (let k = 0; k < d.length; k += 4) if (d[k + 3] < 255 || (d[k] > 245 && d[k + 1] > 245 && d[k + 2] > 245) || d[k] + d[k + 1] + d[k + 2] < 10) n++;
      return n;
    });
    assert.equal(vides, 0);
    await page.unroute("**/api/photo/**");
  });

  await etape("le serveur refuse un JPEG incomplet", async () => {
    const r = await page.evaluate(async (id) => {
      const c = document.createElement("canvas"); c.width = c.height = 300; c.getContext("2d").fillRect(0, 0, 300, 300);
      const d = c.toDataURL("image/jpeg"), b = atob(d.split(",")[1]), coupe = "data:image/jpeg;base64," + btoa(b.slice(0, b.length >> 1));
      return fetch(`/api/objets/${id}/photos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photo: coupe }) }).then((r) => r.status);
    }, ids.b);
    assert.equal(r, 400);
  });

  await etape("aucune erreur JavaScript", async () => { assert.deepEqual(erreursJs, []); });
} finally { await nav.close(); }
console.log(`${ok} réussis, ${ko} en échec`);
fin(ko ? 1 : 0);
