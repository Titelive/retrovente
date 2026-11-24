// Profil de vendeur : sa façon de vendre (rythme, remise, échanges, prix, ton). Rempli à l'inscription, modifiable dans
// Mon compte ; l'IA s'en sert pour les réponses aux acheteurs (extension) et pour le prix plancher des offres.
export const CHOIX = {
  rythme: ["patient", "equilibre", "rapide"],
  remise: ["main_propre", "les_deux", "envoi"],
  echanges: ["oui", "non"],
  prix: ["souple", "raisonnable", "ferme"],
  ton: ["diplomate", "chaleureux", "direct", "humour"],
};

/** Garde seulement les valeurs connues (un champ inconnu ou vide est simplement absent). */
export function normaliserProfil(v) {
  const o = {}, src = v && typeof v === "object" ? v : {};
  for (const [k, l] of Object.entries(CHOIX)) if (l.includes(src[k])) o[k] = src[k];
  const note = String(src.note == null ? "" : src.note).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  if (note) o.note = note;
  return o;
}
export function lireProfil(s) {
  if (!s) return {};
  try { return normaliserProfil(JSON.parse(s)); } catch { return {}; }
}

/** Part du prix affiché sous laquelle on ne descend pas : 85 % par défaut, plus haut pour un vendeur patient ou attaché à ses prix. */
export function partPlancher(p = {}) {
  if (p.prix === "ferme") return 0.95;
  let k = 0.85;
  if (p.rythme === "patient") k += 0.05;
  if (p.rythme === "rapide") k -= 0.05;
  if (p.prix === "souple") k -= 0.05;
  return Math.round(Math.min(0.9, Math.max(0.75, k)) * 100) / 100;
}

const TONS = {
  diplomate: "très diplomate et affable : formules de politesse soignées, toujours aimable et posé, même face à une offre vexante ; jamais familier",
  chaleureux: "chaleureux et passionné, comme un fan de retro qui parle à un autre",
  direct: "direct et efficace : phrases très courtes, polies mais sans détour ni bavardage",
  humour: "détendu et plein d'humour : une petite blague ou un clin d'œil retro quand ça colle, jamais moqueur",
};

/** Consignes pour l'IA tirées du profil (texte vide si le vendeur n'a rien renseigné). */
export function consignesProfil(p = {}) {
  const l = [];
  if (p.ton) l.push(`Ton voulu : ${TONS[p.ton]}. Ce ton passe avant les indications de ton plus bas.`);
  if (p.prix === "ferme") l.push("Il tient à ses prix et ne veut pas de marchandage : jamais de contre-offre ni de « geste » ; face à une offre, les réponses restent fermes au prix affiché (approches « ferme » et « couper_court » seulement), gentiment, sans se justifier longuement.");
  else if (p.prix === "souple") l.push("Il négocie volontiers : une contre-offre bienveillante est toujours bienvenue (jamais sous le plancher).");
  if (p.rythme === "rapide") l.push("Il a besoin de vendre vite : face à une offre correcte (au-dessus du plancher), une réponse l'accepte ; il préfère conclure qu'attendre.");
  else if (p.rythme === "patient") l.push("Il n'est pas pressé : il attend le bon acheteur et ne brade pas ; pas besoin de conclure à tout prix.");
  if (p.remise === "main_propre") l.push("Il privilégie la remise en main propre : quand le sujet vient, propose d'abord un rendez-vous en main propre ; l'envoi reste possible si l'acheteur est loin.");
  else if (p.remise === "envoi") l.push("Il privilégie l'envoi (colis avec le paiement sécurisé Le Bon Coin) : quand le sujet vient, propose d'abord l'envoi ; la main propre seulement si l'acheteur insiste.");
  if (p.echanges === "non") l.push("Il ne fait pas d'échange : si l'acheteur en propose un, décline gentiment et propose la vente.");
  else if (p.echanges === "oui") l.push("Il est ouvert aux échanges : si l'acheteur en propose un, montre de l'intérêt et demande ce qu'il propose (titre, état, photos).");
  if (p.note) l.push(`Ce qu'il a précisé lui-même : « ${p.note.replace(/"""/g, "")} ».`);
  return l.length ? `Profil du vendeur (sa façon de vendre, à respecter dans toutes les réponses) :\n${l.map((x) => "- " + x).join("\n")}` : "";
}
