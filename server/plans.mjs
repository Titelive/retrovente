// Formules et droits. Les prix affichés sont dans site/index.html ; les prix facturés sont ceux de Stripe (variables STRIPE_PRICE_*).
export const PLANS = {
  gratuit:        { nom: "Découverte",        quota: 5,        fiscal: false, export: false },
  vendeur:        { nom: "Vendeur",           quota: 30,       fiscal: false, export: false },
  collectionneur: { nom: "Collectionneur",    quota: Infinity, fiscal: true,  export: true },
  pass:           { nom: "Pass Grand ménage", quota: Infinity, fiscal: true,  export: true },
};
const ACTIFS = ["active", "trialing", "past_due"];   // past_due : Stripe réessaie le paiement, on laisse l'accès pendant ce temps

/** Formule en vigueur pour un utilisateur (le pass l'emporte tant qu'il court). */
export function effectivePlan(u, at = new Date()) {
  if (u.pass_until && new Date(u.pass_until) > at) return "pass";
  if ((u.plan === "vendeur" || u.plan === "collectionneur") && ACTIFS.includes(u.plan_status)) return u.plan;
  return "gratuit";
}
export const rights = (u) => ({ id: effectivePlan(u), ...PLANS[effectivePlan(u)] });

// Seuils de déclaration des plateformes aux impôts (directive DAC7) : 30 ventes ou 2 000 € sur l'année civile.
export const SEUIL_VENTES = 30, SEUIL_MONTANT = 2000;
