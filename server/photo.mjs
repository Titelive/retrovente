// Retouche des photos : service tools/detourage.py installé sur le même serveur, donc sans coût par photo.
// Retouche légère, vrai fond gardé : redressement, recadrage, couleurs un peu plus chaudes, objets à côté effacés ; le jeu n'est jamais retouché.
// Pas de détourage : une photo trop « parfaite » inquiète les acheteurs.
import { IaError, checkPhoto, zoomDetail } from "./ia.mjs";

const BASE = () => (process.env.DETOURAGE_URL || "http://127.0.0.1:7001/detourer").replace(/\/detourer$/, "");

// filigrane : formule gratuite, la pastille RetroRevente est posée par le service lui-même.
export async function retoucher(photo, rotation = 0, filigrane = false) {
  checkPhoto(photo);
  if (process.env.IA_FAKE === "1" && !process.env.DETOURAGE_URL) return photo;
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(photo);
  if (!m) throw new IaError("Photo illisible.");
  const rot = [0, 90, 180, 270].includes(Number(rotation)) ? Number(rotation) : 0;
  const appel = async (extra = "") => {
    try {
      return await fetch(BASE() + "/retoucher?rot=" + rot + (filigrane ? "&filigrane=1" : "") + extra, { method: "POST", body: Buffer.from(m[2], "base64"), headers: { "Content-Type": "image/" + m[1] }, signal: AbortSignal.timeout(90000) });
    } catch (e) {
      throw new IaError("La retouche des photos redémarre, réessaie dans une minute.");
    }
  };
  let r = await appel();
  if (!r.ok) throw new IaError("La retouche de cette photo n'a pas marché. Réessaie avec une photo plus nette.");
  // Objet coupé ou tenu en main : c'est sans doute un gros plan (coin, tranche, défaut). L'IA repère le détail
  // et on zoome dessus ; sinon (ou si elle hésite), la photo entière retouchée est gardée.
  if (r.headers.get("x-fiable") === "0") {
    const c = await zoomDetail(photo).catch(() => null);
    if (c) {
      const z = await appel("&cadre=" + [c.x, c.y, c.w, c.h].map((v) => v.toFixed(4)).join(",")).catch(() => null);
      if (z && z.ok) r = z;
    }
  }
  return "data:image/jpeg;base64," + Buffer.from(await r.arrayBuffer()).toString("base64");
}
