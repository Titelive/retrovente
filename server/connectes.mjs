// Objets connectés (écouteurs, casques, montres, enceintes, téléphones, tablettes…) et autres objets du quotidien.
// Champs d'une fiche « connectes » : titre = modèle (« AirPods Pro 2 (USB-C) »), marque, plateforme = type d'appareil,
// region = couleur, annee = année d'achat, edition = ce qui est fourni (boîte, câble, étui…), batterie, reinit
// (« oui » : réinitialisé et retiré du compte du vendeur, Localiser désactivé).
// Fiche « autres » : titre, marque, plateforme = type d'objet (livre, figurine, lampe…).

const sansAccent = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export const TYPES_CONNECTE = ["Écouteurs sans fil", "Casque audio", "Enceinte connectée", "Montre connectée", "Bracelet connecté", "Téléphone", "Tablette", "Liseuse", "Maison connectée", "Drone ou caméra", "Autre objet connecté"];
export const FOURNI_CONNECTE = ["Boîte d'origine", "Câble de charge", "Chargeur", "Étui", "Embouts de rechange", "Bracelet de rechange", "Facture", "Garantie en cours"];

// « airpods » → « Écouteurs sans fil », « casque » → « Casque audio », « apple watch » → « Montre connectée »…
export function typeConnecte(t, modele = "") {
  const s = sansAccent(t), m = sansAccent(modele);
  const exact = TYPES_CONNECTE.find((x) => sansAccent(x) === s);
  if (exact) return exact;
  const q = s + " " + m;
  if (/casque|headphone|airpods max|\bwh-\d|bose (qc|quietcomfort) ?(35|45|ultra)/.test(q)) return "Casque audio";
  if (/ecouteur|earbud|airpods|buds|intra|true wireless|\btws\b/.test(q)) return "Écouteurs sans fil";
  if (/enceinte|speaker|homepod|sonos|\becho\b|jbl (flip|charge|go)/.test(q)) return "Enceinte connectée";
  if (/montre|watch/.test(q)) return "Montre connectée";
  if (/bracelet|band|fitbit|tracker/.test(q)) return "Bracelet connecté";
  if (/liseuse|kindle|kobo|vivlio/.test(q)) return "Liseuse";
  if (/tablette|ipad|galaxy tab|tab s/.test(q)) return "Tablette";
  if (/telephone|smartphone|iphone|galaxy s|pixel|redmi|oneplus/.test(q)) return "Téléphone";
  if (/drone|dji|gopro|camera/.test(q)) return "Drone ou caméra";
  if (/maison|domotique|ampoule|thermostat|nest|hue|prise connectee|sonnette|aspirateur robot/.test(q)) return "Maison connectée";
  return String(t || "").trim().slice(0, 60);
}

// Catégorie Le Bon Coin selon le type (Électronique › …), la plus probable en premier.
export function categorieLbcConnecte(type) {
  const t = sansAccent(type);
  if (/ecouteur|casque|enceinte|camera|drone/.test(t)) return ["Photo, audio & vidéo", "Accessoires téléphone & Objets connectés"];
  if (/tablette|liseuse/.test(t)) return ["Tablettes & Liseuses"];
  if (/telephone/.test(t)) return ["Téléphones & Objets connectés"];
  return ["Téléphones & Objets connectés", "Accessoires téléphone & Objets connectés"];
}
// Catégorie eBay (pour l'affichage sur la fiche : la personne la choisit dans la liste d'eBay).
export function categorieEbayConnecte(type) {
  const t = sansAccent(type);
  if (/ecouteur|casque/.test(t)) return "Son, image › Casques, écouteurs";
  if (/enceinte/.test(t)) return "Son, image › Enceintes";
  if (/montre|bracelet/.test(t)) return "Téléphonie, mobilité › Montres connectées";
  if (/telephone/.test(t)) return "Téléphonie, mobilité › Téléphones mobiles";
  if (/tablette|liseuse/.test(t)) return "Informatique, réseaux › Tablettes et liseuses";
  if (/drone|camera/.test(t)) return "Photo, caméscopes › Drones";
  return "Maison › Domotique";
}

// « 92 % », « 92% », « 92 » → « 92 % » ; un texte libre (« bonne autonomie ») reste tel quel.
export function batterieTexte(b) {
  const s = String(b || "").trim().slice(0, 40);
  const m = /^(\d{2,3})\s*%?$/.exec(s);
  if (m && Number(m[1]) <= 100) return m[1] + " %";
  return s;
}
// « Boîte d'origine, Câble de charge » → « boîte d'origine, câble de charge »
export const fourniTexte = (e) => String(e || "").split(/\s*,\s*/).filter(Boolean).map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join(", ");

// Première ligne de la description de secours d'un objet connecté.
export function phraseConnecte(v) {
  const nom = [v.marque && !sansAccent(v.titre).includes(sansAccent(v.marque)) ? v.marque : "", v.titre].filter(Boolean).join(" ");
  return [nom + (v.region ? ", coloris " + v.region.toLowerCase() : "") + (v.annee ? `, acheté en ${v.annee}` : "") + ".",
    v.edition ? "Fourni avec : " + fourniTexte(v.edition) + "." : "",
    v.batterie ? `Batterie : ${batterieTexte(v.batterie)}${/%/.test(batterieTexte(v.batterie)) ? " de capacité" : ""}.` : "",
    v.reinit === "oui" ? "Réinitialisé et retiré de mon compte, prêt à être associé au vôtre." : ""].filter(Boolean);
}
