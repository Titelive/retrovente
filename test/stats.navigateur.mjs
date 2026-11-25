// Vues et favoris lus dans un vrai navigateur, sur des pages qui imitent « Mes annonces » (Le Bon Coin) et Seller Hub (eBay).
//   node test/stats.navigateur.mjs        (hors de `npm test` : il faut Playwright et Chromium)
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) { pw = require(process.env.PLAYWRIGHT_MODULE || "/opt/node-tools/node_modules/playwright"); }
const ici = path.dirname(new URL(import.meta.url).pathname);
const page0 = fs.readFileSync(path.join(ici, "../extension/stats-page.js"), "utf8"), stats = fs.readFileSync(path.join(ici, "../extension/stats.js"), "utf8");

// Le Bon Coin : trois façons d'afficher les compteurs (texte, icône + nombre, aria-label), et une réponse JSON.
const LBC = `<!doctype html><meta charset=utf-8><body><main>
<article><a href="/ad/jeux_video/2874512345"><h2>Super Mario 64</h2></a><p>45 €</p><div><span>128 vues</span> · <span>7 favoris</span></div></article>
<article><a href="/ad/jeux_video/2874512346"><h2>Zelda Ocarina of Time</h2></a><p>39 €</p><ul><li><svg data-icon="EyeOutline"><use href="#eye"/></svg><span>1 204</span></li><li><svg><title>Favoris</title></svg><span>12</span></li></ul></article>
<article><a href="/ad/consoles/2874512347"><h2>Game Boy Color</h2></a><p>70 €</p><span aria-label="56 vues"></span><span title="Mise en favori par 3 personnes">♥ 3</span></article>
<article><a href="/ad/jeux_video/2874512348"><h2>Kirby 64</h2></a><p>55 €</p><p>Il y a 3 jours</p></article>
</main><script>setTimeout(function(){fetch("/api/dashboard").then(function(r){return r.json()})},50)</script></body>`;
const JSON_LBC = { ads: [{ list_id: 2874512348, subject: "Kirby 64", counters: [{ name: "views", value: 33 }, { name: "favorites", value: 2 }] }] };
// eBay Seller Hub : tableau avec colonnes « Vues » et « Observateurs ».
const EBAY = `<!doctype html><meta charset=utf-8><body><table><thead><tr><th>Titre</th><th>Prix</th><th>Observateurs</th><th>Vues</th></tr></thead><tbody>
<tr><td><a href="https://www.ebay.fr/itm/123456789012">Super Mario 64</a></td><td>45,00 EUR</td><td>4</td><td>87</td></tr>
<tr><td><a href="https://www.ebay.fr/itm/zelda/123456789013?x=1">Zelda</a></td><td>39,00 EUR</td><td>0</td><td>1.250</td></tr>
</tbody></table></body>`;

const nav = await pw.chromium.launch();
try {
  const ctx = await nav.newContext();
  await ctx.route("https://www.leboncoin.fr/**", (r) => /api\/dashboard/.test(r.request().url())
    ? r.fulfill({ contentType: "application/json", body: JSON.stringify(JSON_LBC) })
    : r.fulfill({ contentType: "text/html", body: LBC }));
  await ctx.route("https://www.ebay.fr/**", (r) => r.fulfill({ contentType: "text/html", body: EBAY }));
  await ctx.addInitScript(page0);
  const p = await ctx.newPage();
  await p.goto("https://www.leboncoin.fr/compte/part/mes-annonces");
  await p.addScriptTag({ content: stats });
  await p.waitForFunction(() => RR_STATS.tout().annonces.length === 4, null, { timeout: 5000 }).catch(() => {});
  const l = await p.evaluate(() => RR_STATS.tout());
  const par = Object.fromEntries(l.annonces.map((x) => [x.id, x]));
  assert.equal(l.site, "lbc");
  assert.deepEqual(par["2874512345"], { id: "2874512345", vues: 128, favoris: 7 });
  assert.deepEqual(par["2874512346"], { id: "2874512346", vues: 1204, favoris: 12 });
  assert.deepEqual(par["2874512347"], { id: "2874512347", vues: 56, favoris: 3 });
  assert.deepEqual(par["2874512348"], { id: "2874512348", vues: 33, favoris: 2 });
  console.log("Le Bon Coin :", JSON.stringify(l.annonces));

  await p.goto("https://www.ebay.fr/sh/lst/active");
  await p.addScriptTag({ content: stats });
  const e = await p.evaluate(() => RR_STATS.tout());
  assert.equal(e.site, "ebay");
  assert.deepEqual(e.annonces.find((x) => x.id === "123456789012"), { id: "123456789012", vues: 87, favoris: 4 });
  assert.deepEqual(e.annonces.find((x) => x.id === "123456789013"), { id: "123456789013", vues: 1250, favoris: 0 });
  console.log("eBay :", JSON.stringify(e.annonces));
  // une autre page du site n'est pas lue
  await p.goto("https://www.leboncoin.fr/recherche?text=mario");
  await p.addScriptTag({ content: stats });
  assert.equal(await p.evaluate(() => RR_STATS.tout().site), "");
  console.log("ok");
} finally { await nav.close(); }
