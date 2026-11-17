// Paiement Stripe, sans dépendance : appels HTTP directs à l'API.
// Variables : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_VENDEUR_MOIS, STRIPE_PRICE_VENDEUR_AN,
// STRIPE_PRICE_COLLECTIONNEUR_MOIS, STRIPE_PRICE_COLLECTIONNEUR_AN, STRIPE_PRICE_PASS (paiement unique).
import crypto from "node:crypto";
import { db, now, tx } from "./db.mjs";
import { sendMail } from "./auth.mjs";
import { CGV_VERSION } from "./plans.mjs";

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
    // Case obligatoire sur la page de paiement : acceptation des CG + demande expresse d'exécution immédiate
    // (art. L221-25 du Code de la consommation). Exige l'adresse des CG dans Stripe > Paramètres > Informations publiques.
    consent_collection: { terms_of_service: "required" },
    custom_text: { terms_of_service_acceptance: { message: CONSENTEMENT } },
    success_url: SITE() + "/app/?paye=1",
    cancel_url: SITE() + "/app/?compte",
    metadata: { user_id: u.id, offre, cgv: CGV_VERSION },
    ...(pass ? { invoice_creation: { enabled: "true" } } : { subscription_data: { metadata: { user_id: u.id } } }),
  });
  return s.url;
}

/** Espace client Stripe (changer de formule, carte, factures). */
export async function portal(u) {
  if (!u.stripe_customer) throw new Error("Aucun paiement enregistré pour ce compte.");
  const s = await api("POST", "billing_portal/sessions", { customer: u.stripe_customer, return_url: SITE() + "/app/?compte" });
  return s.url;
}

/** Résiliation à la fin de la période payée. Sans clé Stripe (tests, local), seule la base est mise à jour. */
export async function resilier(u) {
  if (stripeReady()) await api("POST", "subscriptions/" + u.stripe_sub, { cancel_at_period_end: "true" });
  db.prepare("UPDATE users SET plan_cancel = ? WHERE id = ?").run(u.plan_end, u.id);
}

/** Rétractation : arrêt immédiat de l'abonnement ou du pass (le remboursement est fait à la main, voir l'e-mail reçu). */
export async function arreter(u) {
  if (u.stripe_sub && ["active", "trialing", "past_due"].includes(u.plan_status) && u.achat_ref && !u.achat_ref.startsWith("pass")) {
    if (stripeReady()) await api("DELETE", "subscriptions/" + u.stripe_sub);
    db.prepare("UPDATE users SET plan = 'gratuit', plan_status = 'canceled', plan_cancel = '' WHERE id = ?").run(u.id);
  }
  if (u.achat_ref.startsWith("pass")) db.prepare("UPDATE users SET pass_until = ? WHERE id = ?").run(now(), u.id);
  db.prepare("UPDATE users SET retract_at = ? WHERE id = ?").run(now(), u.id);
}

export const CONSENTEMENT = "J'accepte les [conditions générales](https://retrorevente.fr/cgv/). Je demande que le service commence dès le paiement, sans attendre la fin du délai de rétractation de 14 jours : si je me rétracte, je paierai seulement la part du service déjà fournie.";

const dateFr = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
const OFFRES = { vendeur: "Vendeur", collectionneur: "Collectionneur", pass: "Pass Grand ménage" };
const PIED = "\n\nConditions générales : https://retrorevente.fr/cgv/\nRetroRevente · bonjour@retrorevente.fr";
// Un e-mail qui ne part pas ne doit pas faire échouer le traitement du paiement.
const mail = (u, sujet, texte) => sendMail(u.email, sujet, texte + PIED).catch((e) => console.error("e-mail", e.message));

/** Confirmation du contrat sur support durable (art. L221-13) : offre, prix, demande d'exécution immédiate, rétractation. */
function confirmerAchat(u, offre, periode) {
  const nom = OFFRES[offre] || "RetroRevente";
  const prix = offre === "pass" ? "9,90 € TTC, paiement unique, sans renouvellement"
    : offre === "vendeur" ? (periode === "an" ? "39 € TTC par an" : "4,99 € TTC par mois") : (periode === "an" ? "79 € TTC par an" : "9,99 € TTC par mois");
  return mail(u, `Ta formule ${nom} est active`, `Bonjour,

Merci ! Ta formule ${nom} est active (${prix}).
${offre === "pass" ? "Elle dure 30 jours et s'arrête toute seule." : "L'abonnement se renouvelle automatiquement à chaque échéance. Tu peux le résilier à tout moment depuis « Mon compte » > « Résilier mon abonnement » ; l'accès reste ouvert jusqu'à la fin de la période payée."}

Tu as demandé que le service commence tout de suite. Tu gardes ton droit de rétractation pendant 14 jours à compter d'aujourd'hui : écris à bonjour@retrorevente.fr (le formulaire type est dans les conditions générales). Tu seras alors remboursé, déduction faite de la part du service déjà fournie, calculée au prorata des jours écoulés.

Conditions générales acceptées : version du ${dateFr(CGV_VERSION)}.
Ta facture est disponible dans « Mon compte » > « Gérer mon abonnement et mes factures ».`);
}

/** Confirmation de la résiliation (art. L215-1-1) : date de fin. */
function confirmerResiliation(u, fin) {
  return mail(u, "Ta résiliation est enregistrée", `Bonjour,

Nous avons bien reçu ta résiliation le ${dateFr(now())}.
${fin ? `Ton abonnement s'arrête le ${dateFr(fin)} : d'ici là, tu gardes tous les avantages de ta formule. Aucun autre paiement ne sera prélevé.` : "Ton abonnement est arrêté. Aucun autre paiement ne sera prélevé."}
Ton compte et tes fiches restent disponibles en formule Découverte (gratuite).`);
}

/** Rappel avant le renouvellement d'un abonnement annuel (art. L215-1, loi Chatel), entre 1 et 3 mois avant l'échéance. */
export async function rappelsAnnuels(at = Date.now()) {
  const debut = new Date(at + 31 * 864e5).toISOString(), finFenetre = new Date(at + 80 * 864e5).toISOString();
  const users = db.prepare(`SELECT * FROM users WHERE plan_period = 'an' AND plan_status = 'active' AND plan_cancel = ''
    AND plan_end > ? AND plan_end <= ? AND rappel <> plan_end`).all(debut, finFenetre);
  for (const u of users) {
    const echeance = dateFr(u.plan_end), prix = u.plan === "vendeur" ? "39" : "79", nom = OFFRES[u.plan] || "";
    const texte = `Bonjour,

Ton abonnement annuel RetroRevente ${nom} arrive à échéance le ${echeance}. Sans action de ta part, il sera reconduit automatiquement pour un an, au prix de ${prix} € TTC.

==============================================
DATE LIMITE POUR NE PAS RECONDUIRE : ${echeance}
==============================================

Tu peux choisir de ne pas reconduire ton contrat : il suffit de le résilier avant cette date depuis https://retrorevente.fr/app/?compte, bouton « Résilier votre contrat ». Tu gardes ta formule jusqu'au ${echeance}, puis plus rien n'est prélevé.

Ce message t'est envoyé en application de l'article L215-1 du Code de la consommation.`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:560px">
<p>Bonjour,</p>
<p>Ton abonnement annuel RetroRevente ${nom} arrive à échéance le <strong>${echeance}</strong>. Sans action de ta part, il sera reconduit automatiquement pour un an, au prix de ${prix}&nbsp;€ TTC.</p>
<div style="border:3px solid #1a1a1a;border-radius:10px;padding:16px 20px;margin:20px 0;font-size:17px"><strong>Date limite pour ne pas reconduire ton contrat : ${echeance}</strong></div>
<p>Tu peux choisir de ne pas reconduire ton contrat : il suffit de le résilier avant cette date depuis <a href="https://retrorevente.fr/app/?compte">Mon compte</a>, bouton « Résilier votre contrat ». Tu gardes ta formule jusqu'au ${echeance}, puis plus rien n'est prélevé.</p>
<p style="color:#666;font-size:13px">Ce message t'est envoyé en application de l'article L215-1 du Code de la consommation. RetroRevente · bonjour@retrorevente.fr</p></div>`;
    const ok = await sendMail(u.email, `Ton abonnement RetroRevente : date limite de non-reconduction le ${echeance}`, texte + PIED, html).catch(() => false);
    if (ok || !process.env.RESEND_API_KEY) db.prepare("UPDATE users SET rappel = ? WHERE id = ?").run(u.plan_end, u.id);   // sans clé : écrit au journal, une fois
  }
  return users.length;
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
  // Résiliation programmée (fin de période) : Stripe la signale par cancel_at_period_end ou cancel_at.
  const cancelAt = ended ? "" : sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : sub.cancel_at_period_end && end ? new Date(end * 1000).toISOString() : "";
  db.prepare("UPDATE users SET plan_cancel = ? WHERE id = ?").run(cancelAt, u.id);
  if (cancelAt && !u.plan_cancel) confirmerResiliation(u, cancelAt);
  else if (ended && u.stripe_sub === sub.id && !u.plan_cancel && ["active", "trialing"].includes(u.plan_status)) confirmerResiliation(u, "");
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
      if (o.payment_status === "paid" || o.mode === "subscription")
        db.prepare("UPDATE users SET achat_at = ?, achat_ref = ?, achat_montant = ?, retract_at = '' WHERE id = ?")
          .run(now(), `${(o.metadata && o.metadata.offre) || ""}:${o.mode === "payment" ? "pass" : ""}`, +o.amount_total || 0, u.id);
      if (o.mode === "payment" && o.metadata && o.metadata.offre === "pass" && o.payment_status === "paid") {
        const base = Math.max(Date.now(), u.pass_until ? Date.parse(u.pass_until) : 0);
        db.prepare("UPDATE users SET pass_until = ? WHERE id = ?").run(new Date(base + 30 * 864e5).toISOString(), u.id);
        confirmerAchat(u, "pass");
      }
      if (o.mode === "subscription" && o.subscription && stripeReady()) {
        const sub = await api("GET", "subscriptions/" + o.subscription);
        applySubscription(sub);
        const pp = planOfPrice(sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id);
        if (pp) { db.prepare("UPDATE users SET achat_ref = ? WHERE id = ?").run(pp.join(":"), u.id); confirmerAchat(u, pp[0], pp[1]); }
      }
    } else if (/^customer\.subscription\.(created|updated|deleted)$/.test(ev.type)) {
      applySubscription(o);
    }
  } catch (e) {
    db.prepare("DELETE FROM stripe_events WHERE id = ?").run(ev.id);   // Stripe renverra l'événement
    throw e;
  }
  return "ok";
}
