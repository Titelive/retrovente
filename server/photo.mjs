// Détourage des photos : service tools/detourage.py (rembg + BiRefNet) installé sur le même serveur, donc sans coût par photo.
// Le reste du nettoyage (redressement, reflets, lumière, fond blanc) se fait dans la page, sur le résultat.
import { IaError, checkPhoto } from "./ia.mjs";

const URL_DETOURAGE = () => process.env.DETOURAGE_URL || "http://127.0.0.1:7001/detourer";

export async function detourer(photo) {
  checkPhoto(photo);
  if (process.env.IA_FAKE === "1" && !process.env.DETOURAGE_URL) return photo;
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(photo);
  if (!m) throw new IaError("Photo illisible.");
  let r;
  try {
    r = await fetch(URL_DETOURAGE(), { method: "POST", body: Buffer.from(m[2], "base64"), headers: { "Content-Type": "image/" + m[1] }, signal: AbortSignal.timeout(90000) });
  } catch (e) {
    throw new IaError("Le nettoyage des photos redémarre, réessaie dans une minute.");
  }
  if (!r.ok) throw new IaError("Le nettoyage de cette photo n'a pas marché. Réessaie avec une photo plus nette.");
  const buf = Buffer.from(await r.arrayBuffer());
  return "data:image/png;base64," + buf.toString("base64");
}
