// Retouche des photos : service tools/detourage.py installé sur le même serveur, donc sans coût par photo.
// Retouche légère, vrai fond gardé : redressement, recadrage, objets à côté et poussières effacés, reflets atténués.
// Pas de détourage : une photo trop « parfaite » inquiète les acheteurs.
import { IaError, checkPhoto } from "./ia.mjs";

const BASE = () => (process.env.DETOURAGE_URL || "http://127.0.0.1:7001/detourer").replace(/\/detourer$/, "");

// filigrane : formule gratuite, la pastille RetroRevente est posée par le service lui-même.
export async function retoucher(photo, rotation = 0, filigrane = false) {
  checkPhoto(photo);
  if (process.env.IA_FAKE === "1" && !process.env.DETOURAGE_URL) return photo;
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(photo);
  if (!m) throw new IaError("Photo illisible.");
  const rot = [0, 90, 180, 270].includes(Number(rotation)) ? Number(rotation) : 0;
  let r;
  try {
    r = await fetch(BASE() + "/retoucher?rot=" + rot + (filigrane ? "&filigrane=1" : ""), { method: "POST", body: Buffer.from(m[2], "base64"), headers: { "Content-Type": "image/" + m[1] }, signal: AbortSignal.timeout(90000) });
  } catch (e) {
    throw new IaError("La retouche des photos redémarre, réessaie dans une minute.");
  }
  if (!r.ok) throw new IaError("La retouche de cette photo n'a pas marché. Réessaie avec une photo plus nette.");
  return "data:image/jpeg;base64," + Buffer.from(await r.arrayBuffer()).toString("base64");
}
