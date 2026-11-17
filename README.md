# RetroRevente

Revendre ses jeux vidéo sur Le Bon Coin en 2 minutes : une photo, et l'annonce est prête (titre, description, état, prix conseillé, photo recadrée), avec le suivi des ventes.

- `site/` : pages publiques (accueil, guides, pages légales) et l'appli (`site/app/`).
- `server/` : serveur Node 22 sans dépendance (pages + API `/api/…`), base SQLite intégrée à Node.
- `deploy/` : mise en ligne sur le VPS IONOS (service `retrorevente`, port 8082).
- `test/` : tests de l'API (`npm test`).

En local : `npm run dev` puis http://127.0.0.1:8082 (IA simulée, pas besoin de clé).

## Mise en ligne (une seule fois)

### 1. GitHub (ce dépôt) : Settings > Secrets and variables > Actions

Les mêmes valeurs que dans le dépôt titelive :
- Secret `IONOS_SSH_KEY` (clé privée `~/.ssh/ionos_deploy`)
- Secret `IONOS_HOST` : `87.106.204.104`
- Variable `IONOS_DEPLOY` : `on`

Ensuite chaque push sur `main` lance les tests puis met le site en ligne.

### 2. HTTPS

Le bloc `retrorevente.fr` est dans `server/deploy/Caddyfile` du dépôt titelive : il est appliqué à la prochaine mise en ligne de titelive.

### 3. Les secrets, sur le serveur

```sh
ssh root@87.106.204.104
nano /etc/retrorevente.env
systemctl restart retrorevente
```

Une ligne par variable :

| Variable | À quoi ça sert |
|---|---|
| `ANTHROPIC_API_KEY` | Reconnaissance des jeux et estimation des prix (la même clé que titelive convient) |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe (`sk_live_…`, ou `sk_test_…` pour essayer) |
| `STRIPE_WEBHOOK_SECRET` | Secret du webhook (`whsec_…`, voir plus bas) |
| `STRIPE_PRICE_VENDEUR_MOIS` / `_AN` | Identifiants `price_…` des prix Vendeur |
| `STRIPE_PRICE_COLLECTIONNEUR_MOIS` / `_AN` | Identifiants `price_…` des prix Collectionneur |
| `STRIPE_PRICE_PASS` | Identifiant `price_…` du Pass Grand ménage (paiement unique) |
| `RESEND_API_KEY` | Envoi de l'e-mail « mot de passe oublié » (resend.com, domaine retrorevente.fr vérifié) |
| `MAIL_FROM` | Facultatif, par défaut `RetroRevente <bonjour@retrorevente.fr>` |
| `CLAUDE_MODEL` | Facultatif, par défaut `claude-haiku-5-5` |

Sans clé Stripe, l'appli marche en gratuit et affiche « Le paiement arrive très bientôt ».

### 4. Stripe

1. Produits > Ajouter : **Vendeur** (deux prix récurrents : 4,99 €/mois et 39 €/an), **Collectionneur** (9,99 €/mois et 79 €/an), **Pass Grand ménage** (9,90 €, paiement unique). Copie chaque `price_…` dans `/etc/retrorevente.env`.
2. Développeurs > Webhooks > Ajouter un endpoint : `https://retrorevente.fr/api/stripe/webhook`, événements `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copie le secret de signature dans `STRIPE_WEBHOOK_SECRET`.
3. Paramètres > Billing > Portail client : active-le (résiliation, changement de carte, factures, et changement de formule entre Vendeur et Collectionneur).

### 5. Pages légales

1. Remplace chaque champ surligné en jaune `[…]` dans `site/mentions-legales/`, `site/cgv/` et `site/confidentialite/` (`grep -rn a-remplir site`) : identité, adresse, SIRET, TVA, téléphone, directeur de la publication, médiateur de la consommation.
2. Vérifie sur ta facture IONOS l'entité avec qui tu as contracté (IONOS SARL à Sarreguemines pour un compte français, sinon IONOS SE à Montabaur) et corrige l'hébergeur si besoin.
3. Stripe > Paramètres > Informations publiques : renseigne l'adresse des conditions générales `https://retrorevente.fr/cgv/` (obligatoire : la page de paiement affiche une case à cocher qui y renvoie).
4. Facultatif : `CONTACT_EMAIL` dans `/etc/retrorevente.env` reçoit les rétractations à rembourser (par défaut `bonjour@retrorevente.fr`).
5. À chaque modification des conditions générales, change la date en haut de `/cgv/` et `CGV_VERSION` dans `server/plans.mjs`.

Ce que fait le code pour le droit de la consommation :
- case Stripe obligatoire : acceptation des CG et demande d'exécution immédiate (art. L221-25) ;
- e-mail de confirmation de commande (art. L221-13), de résiliation (art. L215-1-1) et accusé de réception de rétractation (art. D221-5) ;
- bouton « Résilier votre contrat » avec récapitulatif puis « Notification de la résiliation » (art. D215-1 à D215-3) ;
- bouton « Renoncer au contrat ici » pendant le délai de rétractation, puis « Confirmer la rétractation » (art. L221-21 et D221-5, depuis le 19 juin 2026). Le remboursement se fait à la main dans Stripe : un e-mail te donne le montant ;
- rappel par e-mail avant chaque échéance annuelle, avec la date limite de non-reconduction encadrée (art. L215-1) ;
- trace des acceptations, résiliations et rétractations (table `demandes`, 5 ans).
