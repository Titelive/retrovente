// Paiement Stripe, sans dépendance : appels HTTP directs à l'API.
// Variables : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_VENDEUR_MOIS, STRIPE_PRICE_VENDEUR_AN,
// STRIPE_PRICE_COLLECTIONNEUR_MOIS, STRIPE_PRICE_COLLECTIONNEUR_AN, STRIPE_PRICE_PASS (paiement unique).
import crypto from "node:crypto";
import { db, now, tx } from "./db.mjs";

const SITE = () => (process.env.SITE_URL || "https://retrorevente.fr").replace(/\/$/, "");
export const stripeReady = () => !!process.env.STRIPE_SECRET_KEY;

/** Offres vendues → prix Stripe. */
export function priceFor(offre, periode) {
  const env = process.env;
  if (offre === "pass") return env.STRIPE_PRICE_PASS || "";
  if (offre === "vendeur") return (periode === "an" ? env.STRIPE_PRICE_VENDEUR_AN : env.STRIPE_PRICE_VENDEUR_MOIS) || "";
  if (offre === "collectionneur") return (periode === "an" ? env.STRIPE_PRICE_COLLECTIONNEUR_AN : env.STRIPE_PRICE_COLLECTIONNEUR_MOIS) || "";
  return "";
}
function planOfPrice(priceId) {
  const env = process.env;
  const map = {
    [env.STRIPE_PRICE_VENDEUR_MOIS]: ["vendeur", "mois"], [env.STRIPE_PRICE_VENDEUR_AN]: ["vendeur", "an"],
    [env.STRIPE_PRICE_COLLECTIONNEUR_MOIS]: ["collectionneur", "mois"], [env.STRIPE_PRICE_COLLECTIONNEUR_AN]: ["collectionneur", "an"],
  };
  delete map.undefined; delete map[""];
  return map[priceId] || null;
}

function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out); else out.append(key, String(v));
  }
  return out;
}
async function api(method, p, body) {
  const r = await fetch("https://api.stripe.com/v1/" + p, {
    method, signal: AbortSignal.timeout(20000),
    headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: body ? form(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("Stripe", p, r.status, j.error && j.error.message); throw new Error("Le paiement est momentanément indisponible."); }
  return j;
}

async function customerFor(u) {
  if (u.stripe_customer) return u.stripe_customer;
  const c = await api("POST", "customers", { email: u.email, metadata: { user_id: u.id } });
  db.prepare("UPDATE users SET stripe_customer = ? WHERE id = ?").run(c.id, u.id);
  return c.id;
}

/** Page de paiement Stripe pour une offre ; renvoie son adresse. */
export async function checkout(u, offre, periode) {
  const price = priceFor(offre, periode);
  if (!price) throw new Error("Cette offre n'est pas encore disponible.");
  const customer = await customerFor(u);
  const pass = offre === "pass";
  const s = await api("POST", "checkout/sessions", {
    mode: pass ? "payment" : "subscription",
    customer, client_reference_id: u.id,
    line_items: { 0: { price, quantity: 1 } },
    allow_promotion_codes: "true",
    locale: "fr",
    success_url: SITE() + "/app/?paye=1",
    cancel_url: SITE() + "/app/?compte",
    metadata: { user_id: u.id, offre },
    ...(pass ? { invoice_creation: { enabled: "true" } } : { subscription_data: { metadata: { user_id: u.id } } }),
  });
  return s.url;
}

/** Espace client Stripe (changer de formule, carte, factures, résiliation). */
export async function portal(u) {
  if (!u.stripe_customer) throw new Error("Aucun paiement enregistré pour ce compte.");
  const s = await api("POST", "billing_portal/sessions", { customer: u.stripe_customer, return_url: SITE() + "/app/?compte" });
  return s.url;
}

/** Vérifie la signature d'un webhook (en-tête Stripe-Signature). */
export function verify(raw, header, secret = process.env.STRIPE_WEBHOOK_SECRET, tolerance = 300) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(",").map((p) => p.split("=")).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const v1s = String(header).split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = +parts.t;
  if (!t || !v1s.length || Math.abs(Date.now() / 1000 - t) > tolerance) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return v1s.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

function userFor(obj) {
  const id = +(obj.metadata && obj.metadata.user_id) || +obj.client_reference_id || 0;
  return (id && db.prepare("SELECT * FROM users WHERE id = ?").get(id)) ||
    (obj.customer && db.prepare("SELECT * FROM users WHERE stripe_customer = ?").get(obj.customer)) || null;
}

function applySubscription(sub) {
  const u = userFor(sub); if (!u) { console.error("Stripe : abonnement sans utilisateur", sub.id); return; }
  const item = sub.items && sub.items.data && sub.items.data[0];
  const pp = planOfPrice(item && item.price && item.price.id);
  const end = (item && item.current_period_end) || sub.current_period_end;
  const ended = ["canceled", "incomplete_expired", "unpaid"].includes(sub.status);
  if (u.stripe_sub && u.stripe_sub !== sub.id && ended) return;   // ancien abonnement remplacé : on ne touche pas au nouveau
  db.prepare(`UPDATE users SET plan = ?, plan_period = ?, plan_status = ?, plan_end = ?, stripe_sub = ?, stripe_customer = COALESCE(NULLIF(stripe_customer, ''), ?) WHERE id = ?`)
    .run(ended || !pp ? "gratuit" : pp[0], pp ? pp[1] : "", sub.status, end ? new Date(end * 1000).toISOString() : "", sub.id, sub.customer || "", u.id);
}

/** Traite un événement Stripe déjà vérifié. Idempotent. */
export async function handleEvent(ev) {
  const fresh = tx(() => {
    if (db.prepare("SELECT 1 FROM stripe_events WHERE id = ?").get(ev.id)) return false;
    db.prepare("INSERT INTO stripe_events(id, at) VALUES (?, ?)").run(ev.id, now());
    return true;
  });
  if (!fresh) return "doublon";
  const o = ev.data && ev.data.object || {};
  try {
    if (ev.type === "checkout.session.completed") {
      const u = userFor(o); if (!u) return "inconnu";
      if (o.customer && !u.stripe_customer) db.prepare("UPDATE users SET stripe_customer = ? WHERE id = ?").run(o.customer, u.id);
      if (o.mode === "payment" && o.metadata && o.metadata.offre === "pass" && o.payment_status === "paid") {
        const base = Math.max(Date.now(), u.pass_until ? Date.parse(u.pass_until) : 0);
        db.prepare("UPDATE users SET pass_until = ? WHERE id = ?").run(new Date(base + 30 * 864e5).toISOString(), u.id);
      }
      if (o.mode === "subscription" && o.subscription && stripeReady()) applySubscription(await api("GET", "subscriptions/" + o.subscription));
    } else if (/^customer\.subscription\.(created|updated|deleted)$/.test(ev.type)) {
      applySubscription(o);
    }
  } catch (e) {
    db.prepare("DELETE FROM stripe_events WHERE id = ?").run(ev.id);   // Stripe renverra l'événement
    throw e;
  }
  return "ok";
}
