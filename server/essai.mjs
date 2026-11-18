// Essai gratuit de l'IA : réservé aux formules payantes, sauf un essai unique, pour un seul jeu, en formule Découverte.
// Garde-fous contre les comptes créés en série : e-mail confirmé obligatoire, adresses jetables refusées,
// un seul essai par adresse « normalisée » (points et +alias Gmail), par appareil, et au plus 2 par connexion en 30 jours.
import { db, now } from "./db.mjs";

db.exec(`CREATE TABLE IF NOT EXISTS essais_ia (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_norm TEXT NOT NULL,
  ip         TEXT NOT NULL DEFAULT '',
  appareil   TEXT NOT NULL DEFAULT '',
  at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS essais_mail ON essais_ia(email_norm);
CREATE INDEX IF NOT EXISTS essais_app ON essais_ia(appareil);
CREATE INDEX IF NOT EXISTS essais_ip ON essais_ia(ip, at);`);

// Ce que couvre l'essai : de quoi faire une annonce complète pour un jeu.
export const ESSAI = { identifier: 1, cote: 1, legender: 1, nettoyer: 6, cadrer: 6, dialogue: 5, reponse: 3 };

const JETABLES = new Set(`yopmail.com yopmail.fr yopmail.net cool.fr.nf jetable.fr.nf nospam.ze.tc nomail.xl.cx mega.zik.dj speed.1s.fr courriel.fr.nf moncourrier.fr.nf monemail.fr.nf monmail.fr.nf
mailinator.com mailinator.net mailinator2.com guerrillamail.com guerrillamail.net guerrillamail.org guerrillamail.biz guerrillamail.de guerrillamailblock.com sharklasers.com grr.la pokemail.net spam4.me
10minutemail.com 10minutemail.net 10minutemail.co.uk 10minemail.com 20minutemail.com temp-mail.org temp-mail.io tempmail.com tempmail.net tempmail.dev tempmailo.com tempr.email tempail.com tmpmail.org tmpmail.net tmails.net
throwawaymail.com trashmail.com trashmail.de trashmail.net trashmail.io trash-mail.com wegwerfmail.de wegwerfmail.net einrot.com dispostable.com maildrop.cc mailnesia.com mailcatch.com mintemail.com mohmal.com
getnada.com nada.email getairmail.com fakeinbox.com fakemail.net emailondeck.com spamgourmet.com mytemp.email mailpoof.com burnermail.io inboxkitten.com harakirimail.com discard.email discardmail.com
33mail.com anonaddy.me jetable.org jetable.com jetable.net mail-temporaire.fr mail-temporaire.com ephemail.net link2mail.net filzmail.com mailexpire.com spambox.us spamfree24.org mailtemp.info
tempinbox.com emailtemp.org luxusmail.org minuteinbox.com 1secmail.com 1secmail.net 1secmail.org esiix.com wwjmp.com xojxe.com yoggm.com kzccv.com qiott.com vjuum.com laafd.com txcct.com rteet.com dpptd.com
emltmp.com tmpbox.net mailto.plus fexpost.com fexbox.org mailbox.in.ua rover.info chitthi.in byom.de zetmail.com crazymailing.com tempmailaddress.com fakemailgenerator.com armyspy.com cuvox.de dayrep.com
einrot.de fleckens.hu gustr.com jourrapide.com rhyta.com superrito.com teleworm.us`.split(/\s+/).filter(Boolean));

/** Adresse sans ce qui permet d'en fabriquer des variantes : +alias partout, points et googlemail pour Gmail. */
export function emailNorme(e) {
  let [l = "", d = ""] = String(e || "").toLowerCase().trim().split("@");
  l = l.replace(/\+.*$/, "");
  if (d === "googlemail.com") d = "gmail.com";
  if (d === "gmail.com") l = l.replace(/\./g, "");
  return l + "@" + d;
}
export function jetable(e) {
  const d = String(e || "").toLowerCase().split("@")[1] || "";
  if (JETABLES.has(d)) return true;
  for (const x of JETABLES) if (d.endsWith("." + x)) return true;
  return false;
}
export const appareilDe = (req) => { const a = String((req.headers && req.headers["x-rr-app"]) || ""); return /^[a-z0-9]{16,40}$/.test(a) ? a : ""; };

/** Essai de l'utilisateur gratuit : null s'il est encore possible, sinon un message de refus. Ouvre l'essai au premier usage. */
export function ouvrirEssai(u, req) {
  if (db.prepare("SELECT 1 FROM essais_ia WHERE user_id = ?").get(u.id)) return null;
  const norm = emailNorme(u.email), app = appareilDe(req), ip = String(req.ip || "");
  const deja = db.prepare("SELECT 1 FROM essais_ia WHERE email_norm = ?").get(norm) || (app && db.prepare("SELECT 1 FROM essais_ia WHERE appareil = ?").get(app));
  const parIp = ip ? db.prepare("SELECT COUNT(*) AS n FROM essais_ia WHERE ip = ? AND at > ?").get(ip, new Date(Date.now() - 30 * 864e5).toISOString()).n : 0;
  if (deja || parIp >= 2) return "L'annonce offerte par l'IA a déjà été utilisée depuis cet appareil ou cette connexion. L'IA t'attend dans toutes les formules payantes, sur tous tes jeux.";
  db.prepare("INSERT INTO essais_ia(user_id, email_norm, ip, appareil, at) VALUES (?, ?, ?, ?, ?)").run(u.id, norm, ip, app, now());
  return null;
}
export const essaiOuvert = (uid) => !!db.prepare("SELECT 1 FROM essais_ia WHERE user_id = ?").get(uid);
