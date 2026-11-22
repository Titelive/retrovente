// Formules et droits. Les prix affichés sont dans site/index.html ; les prix facturés sont ceux de Stripe (variables STRIPE_PRICE_*).
export const PLANS = {
  gratuit:        { nom: "Découverte",        quota: 5,        fiscal: false, export: false },
  vendeur:        { nom: "Vendeur",           quota: 30,       fiscal: false, export: false },
  collectionneur: { nom: "Collectionneur",    quota: Infinity, fiscal: true,  export: true },
  pass:           { nom: "Pass Grand ménage", quota: Infinity, fiscal: true,  export: true },
};
const ACTIFS = ["active", "trialing", "past_due"];   // past_due : Stripe réessaie le paiement, on laisse l'accès pendant ce temps

/** Formule en vigueur pour un utilisateur (le pass l'emporte tant qu'il court). */
// Comptes autorisés à essayer toutes les formules sans payer : variable ADMIN_EMAILS du serveur (adresses séparées par des virgules).
export const isAdmin = (u) => !!u && !!u.email && String(process.env.ADMIN_EMAILS || "").toLowerCase().split(/[\s,;]+/).filter(Boolean).includes(String(u.email).toLowerCase());
export function effectivePlan(u, at = new Date()) {
  // Le propriétaire (ADMIN_EMAILS) a la formule la plus complète, sauf s'il en essaie une autre en mode test.
  if (isAdmin(u)) return u.test_plan && PLANS[u.test_plan] ? u.test_plan : "collectionneur";
  if (u.pass_until && new Date(u.pass_until) > at) return "pass";
  if ((u.plan === "vendeur" || u.plan === "collectionneur") && ACTIFS.includes(u.plan_status)) return u.plan;
  return "gratuit";
}
export const rights = (u) => ({ id: effectivePlan(u), ...PLANS[effectivePlan(u)] });

// Couleurs du site (une par formule). Un Collectionneur choisit la sienne dans Mon compte ; les autres formules gardent
// la couleur de leur formule. « or » (Collectionneur) est la couleur par défaut, enregistrée comme une valeur vide.
export const TEINTES = ["or", "anis", "menthe", "lilas"];
export const teinteDe = (u) => (effectivePlan(u) === "collectionneur" && TEINTES.includes(u.teinte) && u.teinte !== "or" ? u.teinte : "");

// Seuils de déclaration des plateformes aux impôts (directive DAC7) : 30 ventes ou 2 000 € sur l'année civile.
export const SEUIL_VENTES = 30, SEUIL_MONTANT = 2000;

// Version des conditions générales en vigueur (date de mise à jour affichée sur /cgv/). À changer à chaque modification.
export const CGV_VERSION = "2026-11-18";
