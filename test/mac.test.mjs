// App Mac : elle embarque les scripts de l'extension et remplace background.js par Swift (mac/Sources/Actions.swift).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lire = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("chaque action de background.js est reprise par l'app Mac", () => {
  const fond = lire("extension/background.js");
  const bloc = fond.slice(fond.indexOf("var ACTIONS = {"), fond.indexOf("RR.runtime.onMessage.addListener"));
  const actions = [...bloc.matchAll(/^  (\w+): async function/gm)].map((m) => m[1]);
  assert.ok(actions.length >= 10, "actions trouvées : " + actions.join(", "));
  const swift = lire("mac/Sources/Actions.swift");
  for (const a of actions) assert.match(swift, new RegExp(`case "${a}"`), `action « ${a} » absente de l'app Mac`);
});

test("les scripts injectés par l'app Mac restent valides (pont + extension dans un bloc)", () => {
  const e = (p) => lire("extension/" + p);
  assert.doesNotThrow(() => new Function(lire("mac/pont.js").replace("__RR_CONFIG__", "{}")));
  assert.doesNotThrow(() => new Function("if (true) {\n" + e("commun.js") + "\n" + e("lbc.js") + "\n}"));
  assert.doesNotThrow(() => new Function("if (true) {\n" + e("commun.js") + "\n" + e("appli.js") + "\n}"));
});

test("le pont fournit les API d'extension utilisées par les scripts", () => {
  const pont = lire("mac/pont.js");
  const utilisees = new Set();
  for (const f of ["commun.js", "lbc.js", "appli.js", "popup.js"])
    for (const m of lire("extension/" + f).matchAll(/RR\.(storage\.local|runtime)\.(\w+)/g)) utilisees.add(m[2]);
  for (const nom of utilisees) assert.match(pont, new RegExp(`\\b${nom}:`), `browser.*.${nom} manque dans mac/pont.js`);
});

test("vues et favoris : l'app embarque stats.js et stats-page.js, valides seuls (vue cachée, sans pont)", () => {
  const e = (p) => lire("extension/" + p);
  assert.doesNotThrow(() => new Function(e("stats.js")));
  assert.doesNotThrow(() => new Function(e("stats-page.js")));
  const c = lire("mac/construire.sh");
  for (const f of ["stats.js", "stats-page.js"]) assert.match(c, new RegExp("extension/" + f.replace(".", "\\.")), f + " absent de construire.sh");
  assert.match(lire("mac/Sources/Stats.swift"), /Extension\.texte\("stats\.js"\)/);
});
