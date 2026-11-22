// Garde-fou : dans l'appli, aucune photo du serveur n'échappe à la vérification de PH (téléchargée en entier, vérifiée, blob:).
// Une adresse /api/photo/ mise directement dans un src, un url() ou un new Image() laisse Safari montrer, ou dessiner dans un
// canvas puis enregistrer, une photo coupée en route : une fine bande d'image, puis du blanc.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../site/app/index.html", import.meta.url), "utf8");
const code = html.replace(/\/\*[\s\S]*?\*\//g, "");   // sans les commentaires

test("une seule fabrique d'adresse de photo : urlPhoto()", () => {
  const lignes = code.split("\n").filter((l) => l.includes("/api/photo/"));
  assert.equal(lignes.length, 1, "adresse de photo écrite à la main :\n" + lignes.map((l) => l.trim().slice(0, 160)).join("\n"));
  assert.match(lignes[0], /^function urlPhoto\(/);
});

test("aucune photo du serveur en image de fond CSS", () => {
  assert.doesNotMatch(code, /url\(\s*['"]?\/api\/photo/);
  assert.doesNotMatch(code, /background-image:url\('\s*\+/, "image de fond construite à partir d'une adresse");
});

test("les canvas partent d'une photo vérifiée", () => {
  const f = /function chargerImg\(src\)\{[^\n]*\n[^\n]*/.exec(code);
  assert.ok(f, "chargerImg introuvable");
  assert.match(f[0], /estUrlPhoto\(src\)\?PH\.obtenir\(/);
});
