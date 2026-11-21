// Fabrique un zip par navigateur dans dist/ : Chrome, Edge, Firefox et Safari (App Store Connect).
// Même code partout ; seul le manifest change :
//  - Chrome et Edge : arrière-plan en service worker, pas de message natif (réservé à l'app Safari) ;
//  - Firefox : arrière-plan en script (Firefox n'a pas de service worker d'extension), identifiant gecko ;
//  - Safari : manifest complet (message natif pour le son joué par l'app Mac).
// Usage : node extension/outils/paquets.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const ext = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dist = path.resolve(ext, "../dist");
const base = JSON.parse(fs.readFileSync(path.join(ext, "manifest.json"), "utf8"));
const v = base.version;
const FICHIERS = ["commun.js", "lbc.js", "ebay.js", "appli.js", "background.js", "popup.html", "popup.js", "icones", "img", "polices"];

const sans = (l, x) => (l || []).filter((p) => p !== x);
const chrome = () => {
  const m = structuredClone(base);
  m.background = { service_worker: "background.js" };
  m.permissions = sans(m.permissions, "nativeMessaging");
  delete m.browser_specific_settings;
  return m;
};
const NAVIGATEURS = {
  chrome,
  edge: chrome,
  firefox: () => {
    const m = structuredClone(base);
    m.background = { scripts: ["background.js"] };
    m.permissions = sans(m.permissions, "nativeMessaging");
    m.browser_specific_settings.gecko.strict_min_version = "128.0";   // permissions de site accordées à l'installation
    return m;
  },
  safari: () => structuredClone(base),
};

fs.mkdirSync(dist, { recursive: true });
for (const [nom, faire] of Object.entries(NAVIGATEURS)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rr-" + nom + "-"));
  for (const f of FICHIERS) fs.cpSync(path.join(ext, f), path.join(tmp, f), { recursive: true });
  fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify(faire(), null, 2) + "\n");
  const zip = path.join(dist, `retrorevente-${nom}-${v}.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync("zip", ["-qrX", zip, "."], { cwd: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(path.relative(process.cwd(), zip));
}
