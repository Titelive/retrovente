# Extension RetroRevente pour Le Bon Coin

Sur `leboncoin.fr/deposer-une-annonce`, le panneau RetroRevente s'ouvre tout seul avec l'article le plus récent pas encore publié (jeu, console, carte Pokémon…), et **chaque écran du dépôt se remplit automatiquement** dès qu'il apparaît : titre, catégorie proposée (Jeux vidéo, Consoles), description, état (y compris la liste déroulante « Choisissez »), prix et **toutes les photos** de la fiche, dans l'ordre. Un texte pré-rempli par l'IA de Le Bon Coin est remplacé par le tien ; ce que tu tapes toi-même n'est jamais réécrit. Puis l'extension clique « Continuer » toute seule, écran après écran, et s'arrête sur le dernier : tu relis et tu cliques « Publier » toi-même. L'interrupteur « Continuer tout seul » coupe ce passage automatique.

Un champ n'est rempli qu'une fois par article : si tu le corriges, ta correction est gardée. Un état déjà choisi n'est pas changé. L'interrupteur « Remplissage automatique » met en pause, « Remplir à nouveau » réécrit l'écran avec le jeu choisi.

Dans la **messagerie** Le Bon Coin, le panneau s'ouvre tout seul et **l'IA lit la conversation** : elle repère l'article ou le lot concerné (« Lot de 2 articles · 203 € »), l'offre officielle Le Bon Coin (« Voici l'offre de Garnier : 150 € ») et le prénom de l'acheteur, résume ce qu'il veut et propose trois réponses sympas et diplomates, toujours avec un smiley 🙂. Pour un lot, ouvre une fois la fenêtre « Lot de 2 articles » : l'extension lit les jeux inclus, les retrouve dans tes annonces (prix, état, loose ou en boîte) et l'IA argumente avec ces jeux précis. Pour une négociation, les trois réponses sont trois stratégies : **contre-offre**, **prix ferme** ou **couper court** poliment. Prix toujours ronds (multiples de 5, de 10 à partir de 100 €), jamais sous 85 % du prix. Nouvelles propositions à chaque nouveau message, ou avec « Autres idées ». Si aucune ne convient, dis à l'IA ce que tu veux répondre (« je peux venir samedi pour 10 € de plus ») : elle le rédige dans le même ton. Les réponses types sont rangées dans un accordéon replié. Le texte de la conversation est envoyé à RetroRevente puis à Anthropic, sans être conservé. En dessous, 28 réponses types (disponibilité, offre trop basse, offre groupée bien trop basse, nouvelle contre-offre, couper court, lot, échange, photos, envoi, paiement hors plateforme, remerciements…), avec une icône chacune et les mots importants en gras, complétées avec le prénom, le jeu et la dernière offre : « Bonjour Garnier, … vos 150 € … geste à 180 € 🙂 ». Un clic place la réponse dans la zone de message, tu relis et tu envoies.

Chaque article a son **émoji** dans la liste (🍄 Mario, 🗡️ Zelda, 🌸 Kirby, 🐿️ Conker, ⚡ Pokémon, 📦 pour un lot…), différent des autres articles, pour le repérer d'un coup d'œil.

**Lien de l'annonce** : après le dépôt, ou en passant sur la page d'une annonce ou sur « Mes annonces », l'extension reconnaît tes articles et enregistre leur adresse `leboncoin.fr/ad/…` dans RetroRevente, qui les marque publiés.

Le sélecteur en haut du panneau a une recherche : **⌘K** (Ctrl K sur Windows) l'ouvre directement depuis la page de dépôt. Elle ignore accents et majuscules et comprend les abréviations des consoles (`n64`, `ps2`, `gba`, `snes`…). Flèches pour naviguer, Entrée pour choisir, Échap pour fermer.

Raccourci global **⌥⇧R** (Alt+Maj+R) : sur la page de dépôt, il ouvre le panneau et la recherche ; ailleurs, il ouvre la page de dépôt. Il se change dans le navigateur (Chrome : `chrome://extensions/shortcuts`, Firefox : Gérer les extensions → roue dentée → Gérer les raccourcis ; Safari ne gère pas encore bien les raccourcis d'extension, ⌘K marche partout).

Le panneau reprend la charte du site (vert anis, Rubik et Figtree embarquées dans `polices/`, thème sombre automatique).

Chaque ligne a aussi un bouton **Copier** (et **Enregistrer** pour la photo) au cas où un champ n'est pas reconnu.

Une seule base de code WebExtensions (Manifest V3) pour Safari, Chrome, Edge et Firefox.

## Ce que l'extension fait, et ne fait pas

- Elle remplit les champs dans ton propre onglet, comme si tu tapais, une fois l'article choisi (choix modifiable, interrupteur pour mettre en pause).
- Elle clique « Continuer » une fois l'écran rempli (interrupteur « Continuer tout seul »), sauf s'il reste un champ obligatoire vide, si Le Bon Coin affiche une erreur ou si tu es en train d'agir sur la page. Elle ne clique jamais sur « Publier » ni « Envoyer », ne lit pas les autres annonces de Le Bon Coin et n'envoie rien à Le Bon Coin elle-même.
- Elle ne parle qu'à retrorevente.fr. La clé lit tes annonces et leur photo, demande les réponses IA et enregistre le lien Le Bon Coin d'une annonce (rien d'autre : elle ne permet ni de modifier le reste ni de supprimer quoi que ce soit), et « Déconnecter l'extension » dans Mon compte la révoque partout.
- Le Bon Coin n'a pas d'API publique et ses conditions d'utilisation encadrent les outils automatisés. L'extension reste du côté de l'aide à la saisie (pas de publication automatique, pas de collecte), mais Le Bon Coin pourrait changer son formulaire ou s'opposer à ce type d'outil : le copier-coller de l'appli reste toujours disponible.

## Connecter l'extension à ton compte

1. Installe l'extension (voir plus bas).
2. Sur retrorevente.fr, va dans **Mon compte** → **Extension Le Bon Coin** → **Connecter l'extension**. La page transmet la clé à l'extension toute seule.
3. Si l'extension n'est pas détectée (par exemple installée dans un autre navigateur), la clé s'affiche : copie-la, clique sur l'icône RetroRevente de la barre d'outils, « J'ai une clé à coller ».

## Installer en local (pour essayer)

### Chrome, Edge, Brave, Arc

1. `chrome://extensions` → active **Mode développeur** (en haut à droite).
2. **Charger l'extension non empaquetée** → choisis le dossier `extension/` de ce dépôt.

Chrome affiche un avertissement sur `background.scripts` : c'est normal, cette clé sert à Firefox.

### Firefox

1. `about:debugging#/runtime/this-firefox` → **Charger un module complémentaire temporaire** → choisis `extension/manifest.json`.
2. Firefox demande parfois l'accès aux sites : clique sur l'icône Extensions puis autorise RetroRevente sur leboncoin.fr et retrorevente.fr.

Le module temporaire disparaît au redémarrage de Firefox.

### Safari (Mac, iPhone, iPad)

Safari n'accepte une extension que dans une app. Il faut Xcode (gratuit, App Store), ouvert une fois pour finir son installation.

1. Dans le Terminal, à la racine du dépôt : `npm run extension:safari` (ou `sh extension/outils/safari.sh`). Le script crée le projet Xcode dans `safari/` (non versionné) et l'ouvre. Le projet pointe vers `extension/` : une modification de l'extension est reprise au prochain lancement.
2. Dans Xcode, choisis le schéma **RetroRevente (macOS)** et **My Mac**, puis **⌘R**. Une petite app RetroRevente se lance : tu peux la fermer.
3. Safari → **Réglages → Avancées** → coche « Afficher les fonctionnalités pour les développeurs web ». Puis menu **Développement → Autoriser les extensions non signées** (à refaire à chaque redémarrage de Safari).
4. Safari → **Réglages → Extensions** → coche **RetroRevente pour Le Bon Coin**, puis **Modifier les sites web…** → « Autoriser » pour leboncoin.fr et retrorevente.fr.

**Sur iPhone ou iPad** : branche l'appareil, choisis le schéma **RetroRevente (iOS)** et ton appareil, **⌘R** (Xcode demande de te connecter avec ton identifiant Apple ; un compte gratuit suffit, l'app expire alors au bout de 7 jours). Puis Réglages → Apps → Safari → Extensions → RetroRevente → activer, et autoriser leboncoin.fr et retrorevente.fr. Le bouton **RR** apparaît pendant le dépôt d'annonce dans Safari, comme sur Mac.

Sans compte développeur payant, l'app est signée pour tes appareils seulement : parfait pour essayer, pas pour distribuer.

### Essayer avec le serveur local

`npm run dev`, puis connecte l'extension depuis http://127.0.0.1:8082/app/ (Mon compte). L'extension retient l'adresse du serveur qui lui a donné la clé.

## Publier dans les boutiques

| Boutique | Ce qu'il faut | Délai de relecture |
|---|---|---|
| **Safari** (Mac App Store) | Compte Apple Developer (99 $/an), Xcode, le projet généré par `safari-web-extension-converter`, un identifiant d'app, une icône d'app, des captures, une politique de confidentialité (`/confidentialite/`). On envoie depuis Xcode (Product → Archive) vers App Store Connect, une fois pour Mac et une fois pour iPhone/iPad (le même projet contient les deux). Il faut aussi une fiche App Store (nom, description, captures Mac et iPhone, catégorie Productivité) et le formulaire de confidentialité (« aucune donnée collectée » côté app). | 1 à 3 jours |
| **Chrome Web Store** (aussi Edge, Brave, Arc) | Compte développeur (5 $ une fois), le zip du dossier `extension/`, captures 1280×800, justification de chaque permission (`storage`, accès à leboncoin.fr et retrorevente.fr), formulaire « pratiques de confidentialité ». | quelques jours |
| **Firefox** (addons.mozilla.org) | Compte gratuit, le zip, éventuellement le code source (inutile ici : rien n'est compilé). L'identifiant `extension@retrorevente.fr` est déjà dans le manifeste. | quelques heures à quelques jours |
| **Edge Add-ons** | Compte Partner Center gratuit, le même zip que Chrome. | quelques jours |

Les relecteurs regardent surtout l'accès à leboncoin.fr : explique que l'extension ne s'active que sur la page de dépôt, au clic, et n'envoie rien.

Pour fabriquer le zip : `npm run extension:zip` (il arrive dans `dist/`).

Avant chaque envoi, augmente `version` dans `manifest.json`.

## Si un champ n'est plus rempli

Le formulaire de Le Bon Coin change de temps en temps. Les champs sont reconnus par leur libellé, leur nom ou leur texte d'aide (fonctions `champ` et `choisir` de `lbc.js`), et les libellés d'état et de catégorie sont en haut de ce fichier : c'est là qu'il faut ajuster.
