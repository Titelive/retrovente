# RetroRevente

L'assistant du revendeur rétro, en complément de Le Bon Coin : une photo, et RetroRevente donne la vraie cote (état, boîte, notice, région), prépare la fiche et la photo, suit le stock et les ventes jusqu'au seuil fiscal, et aide à répondre aux acheteurs grâce à l'extension.

- `site/` : pages publiques (accueil, guides, pages légales) et l'appli (`site/app/`).
- `server/` : serveur Node 22 sans dépendance (pages + API `/api/…`), base SQLite intégrée à Node.
- `deploy/` : mise en ligne sur le VPS IONOS (service `retrorevente`, port 8082).
- `extension/` : extension navigateur (Safari, Chrome, Firefox) qui remplit le dépôt d'annonce Le Bon Coin, voir `extension/README.md`.
- `test/` : tests de l'API (`npm test`).

En local : `npm run dev` puis http://127.0.0.1:8082 (IA simulée, pas besoin de clé).

## Mise en ligne (une seule fois)

### 1. GitHub (ce dépôt) : Settings > Secrets and variables > Actions

Les mêmes valeurs que dans le dépôt titelive :
- Secret `IONOS_SSH_KEY` (clé privée `~/.ssh/ionos_deploy`)
- Secret `IONOS_HOST` : `87.106.204.104`
- (le secret `IONOS_DEPLOY` éventuel n'est pas utilisé)

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
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Jaquette, captures d'écran et notes des jeux (base IGDB, gratuite, voir « Fiche du jeu » plus bas) |
| `TMDB_API_KEY` | Affiche, images, synopsis, casting et note des spectateurs des films (base TMDB, clé gratuite, voir « Films » plus bas) |

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

## Cartes Pokémon

Catégorie « Carte Pokémon » dans la même appli : la photo d'une carte donne son nom, son extension, son numéro, sa rareté, sa langue, son édition, sa note de gradation (PSA, PCA, CGC…) et son état collectionneur (Mint à Poor, traduit en état Le Bon Coin). La cote part de la **cote Cardmarket du jour**, lue dans la base libre [TCGdex](https://tcgdex.dev) (sans clé ni coût, `server/cartes.mjs`), puis l'IA la recoupe avec les ventes conclues eBay et les annonces Le Bon Coin. Une carte qui vaut moins de 5 € est signalée comme « à mettre en lot ». Le bouton « Plusieurs cartes Pokémon » analyse une photo de classeur ou de cartes étalées : chaque carte est repérée et cotée, celles de 5 € ou plus ont leur propre fiche (photo recadrée sur la carte), les autres forment une fiche « Lot de N cartes » avec son titre, sa description et son prix (80 % des cotes cumulées, 5 € au moins). L'extension propose des réponses propres aux cartes (bords, authenticité, envoi sous toploader). `TCGDEX_URL` (facultatif) change l'adresse de l'API TCGdex.

## Films (Blu-Ray, Blu-Ray 4K UHD, DVD)

Catégorie « Film » dans la même appli : la photo d'une jaquette donne le titre, le **format** (Blu-Ray 4K UHD, 4K UHD + Blu-Ray, Blu-Ray, Blu-Ray 3D, DVD, HD DVD, VHS, lu sur le bandeau de la jaquette), l'**édition** (Steelbook, Édition collector, Édition limitée, Coffret, Mediabook, Digibook, à cocher d'un geste dans la fiche), l'année, le réalisateur, les langues et la zone. La **cote** vient des ventes conclues eBay, des annonces Le Bon Coin et Rakuten pour le même format et la même édition, avec le prix de rachat Momox comme plancher ; un film qui vaut moins de 5 € est signalé « à mettre en lot ». L'annonce Le Bon Coin part dans **Loisirs › DVD - Films**, et l'extension (1.8.0) propose des réponses propres aux films (état des disques, langues et zone, steelbook, envoi protégé). Dans Mes articles, « Grouper par support » range les films par format (4K UHD, Blu-Ray, DVD…).

**Fiche du film** (onglet « Le film ») : l'**affiche**, des **images du film**, la durée, les genres, le réalisateur et le casting, le **synopsis en français**, la **note de la presse** (Metacritic, lue dans Wikidata) et **celle des spectateurs** (TMDB, sur 5), et **ma note** en étoiles. « Pas le bon film ? » propose les films du même nom.

- Images, synopsis et note des spectateurs : [TMDB](https://www.themoviedb.org). Crée un compte, puis Paramètres > API : copie la **clé API** (ou le jeton de lecture) dans `TMDB_API_KEY`. La clé est gratuite pour un usage non commercial ; pour un site payant, TMDB demande une licence commerciale (formulaire sur leur site). Sans clé, la fiche montre le synopsis Wikipédia (CC BY-SA 4.0) et les infos Wikidata (année, réalisateur, genres, durée, presse), sans affiche.
- Chaque film n'est cherché qu'une fois : la réponse est gardée 30 jours en base (table `jeux_infos`). Code : `server/films.mjs`. `TMDB_URL` et `WIKIDATA_URL` (facultatifs) changent les adresses des API.

## Retouche des photos (vrai fond gardé)

Les photos sont retouchées par un petit service Python installé sur le serveur (`tools/detourage.py`, route `/retoucher`, modèle libre rembg / IS-Net + OpenCV), sans service payant : **aucun coût par photo**. Le jeu est repéré pour **redresser et recadrer** la photo, les **objets posés à côté et les poussières du fond sont effacés**, les **reflets atténués**. **Pas de détourage ni de fond remplacé** : une vraie photo rassure les acheteurs. `deploy/deploy.sh` l'installe tout seul (dans `/opt/retrorevente-py`, service `retrorevente-detourage`, port 7001 en local, 2,5 Go de mémoire au plus). La photo d'origine reste disponible dans la fiche.

Chaque jeu a une **galerie de 12 photos au plus**, réorganisable ; l'IA décrit chaque photo, la description de l'annonce reprend « Photos : 1. … », et les photos exportées portent leur numéro.

## Mode test des formules (propriétaire seulement)

Ajoute `ADMIN_EMAILS=ton@adresse` dans `/etc/retrorevente.env` puis `systemctl restart retrorevente`. Ce compte (et lui seul, vérifié côté serveur) voit dans Mon compte un bloc « Mode test » pour passer d'une formule à l'autre sans payer.

Vérifier : `systemctl status retrorevente-detourage` et `curl -s http://127.0.0.1:7001/sante`.

## Fiche du jeu (jaquette, captures, descriptif, notes)

Dans l'onglet « Le jeu » d'un jeu vidéo : la **jaquette**, des **captures d'écran** (agrandies d'un clic), l'année, le genre, le studio, la **note de la presse** (sur 100) et **celle des joueurs** (sur 5), un **descriptif en français**, et **ma note** en étoiles (enregistrée avec la fiche). Si la recherche se trompe de jeu, « Pas le bon jeu ? » propose les jeux proches.

- Images et notes : [IGDB](https://www.igdb.com) (Twitch), gratuit. Crée une appli sur [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) (nom libre, URL de redirection `http://localhost`, catégorie « Website Integration »), puis copie son Client ID et un Client Secret dans `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET`. Sans ces clés, seule « ma note » s'affiche.
- Descriptif : l'introduction de l'article Wikipédia en français (licence CC BY-SA 4.0, source citée sous le bloc), sinon le résumé IGDB traduit par l'IA.
- Chaque jeu n'est cherché qu'une fois : la réponse est gardée 30 jours en base (table `jeux_infos`). Code : `server/jeux.mjs`.

## Profil de vendeur

Juste après l'inscription (puis dans Mon compte), le vendeur dit comment il vend : patient ou pressé, main propre ou envoi, ouvert aux échanges ou non, souple ou attaché à ses prix, et le ton de ses messages (très diplomate, chaleureux, direct, avec humour), plus une note libre. Le profil est gardé dans `users.vendeur` (JSON, `server/profil.mjs`). L'IA des réponses aux acheteurs s'en sert : ton imposé, prix plancher des offres (85 % par défaut, 90 % pour un vendeur patient, 80 % pour un vendeur pressé, aucune contre-offre pour « Prix ferme »), remise et échanges proposés. L'extension coche d'office « Pas de négociation possible » pour un vendeur à prix ferme et adapte ses réponses types.
