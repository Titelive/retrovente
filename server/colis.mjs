// Suivi des colis envoyés : transporteurs courants sur Le Bon Coin, lien de suivi, état de livraison.
// L'état se lit tout seul pour La Poste (Colissimo, Lettre suivie, Chronopost) avec la clé gratuite LAPOSTE_API_KEY
// (developer.laposte.fr, API « Suivi v2 ») ; pour les autres, le lien ouvre la page du transporteur et on coche « Livré ».

const enc = encodeURIComponent;
/** [id, nom, lien de suivi, suivi automatique par l'API La Poste] */
export const TRANSPORTEURS = [
  ["colissimo", "Colissimo", (n) => `https://www.laposte.fr/outils/suivre-vos-envois?code=${enc(n)}`, true],
  ["mondial_relay", "Mondial Relay", (n) => `https://www.mondialrelay.fr/suivi-de-colis/?NumeroExpedition=${enc(n)}`, false],
  ["relais_colis", "Relais Colis", (n) => `https://www.relaiscolis.com/suivi-de-colis/?valeur=${enc(n)}`, false],
  ["chronopost", "Chronopost / Shop2Shop", (n) => `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${enc(n)}`, true],
  ["lettre_suivie", "Lettre suivie", (n) => `https://www.laposte.fr/outils/suivre-vos-envois?code=${enc(n)}`, true],
  ["dpd", "DPD", (n) => `https://trace.dpd.fr/fr/trace/${enc(n)}`, false],
  ["ups", "UPS", (n) => `https://www.ups.com/track?loc=fr_FR&tracknum=${enc(n)}`, false],
  ["gls", "GLS", (n) => `https://gls-group.com/FR/fr/suivi-colis?match=${enc(n)}`, false],
  ["autre", "Autre", null, false],
];
const PAR = new Map(TRANSPORTEURS.map((t) => [t[0], t]));
export const IDS_TRANSPORTEURS = TRANSPORTEURS.map((t) => t[0]);

/** Numéro de suivi nettoyé : lettres et chiffres en majuscules (les espaces et tirets recopiés sautent). */
export const numeroSuivi = (v) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);

/** Transporteur probable d'après la forme du numéro (vide si on ne sait pas). */
export function devinerTransporteur(n) {
  n = numeroSuivi(n);
  if (/^\d[A-Z]\d{11}$/.test(n)) return "colissimo";                 // 6A12345678901, 8R…, 5V…
  if (/^[A-Z]{2}\d{9}FR$/.test(n)) return "colissimo";            // format international, suivi aussi sur laposte.fr
  if (/^1Z[A-Z0-9]{16}$/.test(n)) return "ups";
  if (/^\d{8}$/.test(n)) return "mondial_relay";
  return "";
}

export const nomTransporteur = (id) => (PAR.get(id) || [, ""])[1];
export const lienSuivi = (id, n) => { const t = PAR.get(id); n = numeroSuivi(n); return t && t[2] && n ? t[2](n) : ""; };
export const suiviAuto = (id) => !!(PAR.get(id) || [])[3] && !!process.env.LAPOSTE_API_KEY;

/** État du colis chez La Poste : { libelle, date, livre, fini } ou null si l'API ne le connaît pas (encore). */
export async function etatLaPoste(n) {
  const cle = process.env.LAPOSTE_API_KEY; n = numeroSuivi(n);
  if (!cle || n.length < 8) return null;
  const r = await fetch(`https://api.laposte.fr/suivi/v2/idships/${enc(n)}?lang=fr_FR`, { headers: { "X-Okapi-Key": cle, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) throw new Error("La Poste " + r.status);
  const s = (await r.json()).shipment || {};
  const evs = (Array.isArray(s.event) ? s.event : []).filter((e) => e && e.label).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const der = evs[0];
  if (!der) return null;
  // DI1 : livré au destinataire (DI2 : renvoyé à l'expéditeur, ce n'est pas une livraison)
  const livre = evs.some((e) => e.code === "DI1");
  return { libelle: String(der.label).slice(0, 160), date: String(der.date || "").slice(0, 10), livre, fini: !!s.isFinal || livre };
}
