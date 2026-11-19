// Serveur de retrorevente.fr : pages statiques (site/) et API de l'appli (/api/…). Derrière Caddy (HTTPS).
//   PORT=8082 DATA_DIR=/var/lib/retrorevente node server/server.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi, HttpError } from "./api.mjs";
import { IaError } from "./ia.mjs";
import { indiceConnexion } from "./auth.mjs";
import { rappelsAnnuels } from "./stripe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.resolve(process.env.SITE_DIR || path.join(ROOT, "site"));
const PORT = +process.env.PORT || 8082, HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY = 4 * 1024 * 1024;

const MIME = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", ico: "image/x-icon", txt: "text/plain; charset=utf-8", xml: "application/xml; charset=utf-8", webmanifest: "application/manifest+json", woff2: "font/woff2" };
const SECU = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
};

function resolveFile(pathname) {
  let p; try { p = decodeURIComponent(pathname); } catch (e) { return null; }
  if (p.includes("\0") || p.split("/").some((s) => s.startsWith("."))) return null;
  const abs = path.join(SITE, p);
  if (!abs.startsWith(SITE)) return null;
  for (const f of p.endsWith("/") ? [abs + "index.html"] : [abs, abs + ".html", path.join(abs, "index.html")]) {
    try { if (fs.statSync(f).isFile()) return f; } catch (e) {}
  }
  return null;
}

function sendFile(req, res, file, status = 200) {
  const st = fs.statSync(file), ext = path.extname(file).slice(1).toLowerCase();
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const h = { ...SECU, "Content-Type": MIME[ext] || "application/octet-stream", ETag: etag, "Cache-Control": ext === "html" || path.basename(file) === "sw.js" || ext === "webmanifest" ? "public, max-age=0, must-revalidate" : "public, max-age=86400" };
  if (ext === "html") { const c = indiceConnexion(req, process.env.COOKIE_INSECURE !== "1"); if (c) { h["Set-Cookie"] = c; h["Cache-Control"] = "private, no-cache"; } }
  if (status === 200 && req.headers["if-none-match"] === etag) { res.writeHead(304, h); return res.end(); }
  h["Content-Length"] = st.size;
  res.writeHead(status, h);
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

async function readBody(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) throw new HttpError(413, "Envoi trop volumineux."); chunks.push(c); }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
  try {
    if (url.pathname === "/__health") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }
    if (url.pathname.startsWith("/api/")) {
      let out;
      try {
        const body = ["GET", "HEAD"].includes(req.method) ? Buffer.alloc(0) : await readBody(req);
        out = await handleApi({ method: req.method, path: url.pathname, query: url.searchParams, headers: req.headers, ip, body });
      } catch (e) {
        if (e instanceof HttpError) out = { status: e.status, json: { error: e.message, ...(e.extra || {}) } };
        else if (e instanceof IaError) out = { status: 422, json: { error: e.message, ...(e.trace ? { trace: e.trace } : {}) } };
        else if (e && e.name === "TimeoutError") out = { status: 504, json: { error: "Le service a mis trop de temps à répondre, réessaie." } };
        else { console.error(e && e.stack || e); out = { status: 500, json: { error: e && e.message && /paiement/i.test(e.message) ? e.message : "Erreur du serveur." } }; }
      }
      const h = { ...SECU, "Cache-Control": "no-store", ...(out.headers || {}) };
      if (out.flux) {   // flux d'événements (text/event-stream : le proxy le transmet sans attendre la fin)
        res.writeHead(200, { ...h, "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" });
        const vie = setInterval(() => res.write(": attente\n\n"), 10000);
        try { await out.flux((x) => res.write("data: " + JSON.stringify(x) + "\n\n")); } finally { clearInterval(vie); }
        return res.end();
      }
      if (out.json !== undefined) { h["Content-Type"] = "application/json; charset=utf-8"; res.writeHead(out.status, h); return res.end(JSON.stringify(out.json)); }
      res.writeHead(out.status, h); return res.end(out.body);
    }
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405, { Allow: "GET, HEAD" }); return res.end(); }
    const f = resolveFile(url.pathname);
    if (f) {
      // /guides → /guides/ (adresses canoniques avec barre finale pour les dossiers)
      if (!url.pathname.endsWith("/") && path.basename(f) === "index.html" && !url.pathname.endsWith(".html")) {
        res.writeHead(301, { Location: url.pathname + "/" + url.search }); return res.end();
      }
      return sendFile(req, res, f);
    }
    const nf = path.join(SITE, "404.html");
    if (fs.existsSync(nf)) return sendFile(req, res, nf, 404);
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Page introuvable");
  } catch (e) {
    console.error(e && e.stack || e);
    if (!res.headersSent) { res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }); } res.end("Erreur du serveur");
  }
});
// Rappel avant renouvellement des abonnements annuels (loi Chatel) : vérifié toutes les 6 heures.
const rappels = () => rappelsAnnuels().catch((e) => console.error("rappels", e.message));
setTimeout(rappels, 60_000).unref(); setInterval(rappels, 6 * 3600_000).unref();

server.listen(PORT, HOST, () => console.log(`RetroRevente : http://${HOST}:${PORT} (site : ${SITE})`));
process.on("unhandledRejection", (e) => console.error("promesse non gérée :", e && e.stack || e));
