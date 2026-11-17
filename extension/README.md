# Extension RetroRevente pour Le Bon Coin

Sur `leboncoin.fr/deposer-une-annonce`, un bouton **RR** apparaît en bas à droite. Il ouvre un panneau qui affiche les jeux « En vente » de ton compte RetroRevente. À chaque écran du dépôt, **Remplir cette étape** remplit les champs visibles : titre, catégorie proposée (Jeux vidéo, Consoles), description, état, prix et photo. Tu vérifies, tu cliques toi-même sur « Continuer », puis sur « Publier ».

Chaque ligne a aussi un bouton **Copier** (et **Enregistrer** pour la photo) au cas où un champ n'est pas reconnu.

Une seule base de code WebExtensions (Manifest V3) pour Safari, Chrome, Edge et Firefox.

## Ce que l'extension fait, et ne fait pas

- Elle ne remplit que quand tu cliques, dans ton propre onglet, comme si tu tapais.
- Elle ne clique jamais sur « Continuer » ni sur « Publier », ne lit pas les autres annonces de Le Bon Coin et n'envoie rien à Le Bon Coin elle-même.
- Elle ne parle qu'à retrorevente.fr, avec une clé en **lecture seule** (`/api/extension/annonces` et la photo). La clé ne permet ni de modifier ni de supprimer quoi que ce soit, et « Déconnecter l'extension » dans Mon compte la révoque partout.
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

### Safari (Mac)

Safari n'accepte une extension que dans une app. Il faut Xcode (gratuit, App Store).

1. Dans le Terminal :
   ```sh
   xcrun safari-web-extension-converter extension/ --project-location ~/RetroRevente-Safari --app-name "RetroRevente" --bundle-identifier fr.retrorevente.extension --macos-only --copy-resources
   ```
2. Xcode s'ouvre : choisis la cible macOS, puis **Product → Run** (⌘R). Une petite app RetroRevente se lance : tu peux la fermer.
3. Safari → **Réglages → Avancées** → coche « Afficher les fonctionnalités pour les développeurs web ». Puis menu **Développement → Autoriser les extensions non signées** (à refaire à chaque redémarrage de Safari).
4. Safari → **Réglages → Extensions** → coche **RetroRevente pour Le Bon Coin**, puis **Modifier les sites web…** → « Autoriser » pour leboncoin.fr et retrorevente.fr.

Sans compte développeur payant, Xcode signe l'app pour ta machine seulement : c'est parfait pour essayer, pas pour distribuer.

### Essayer avec le serveur local

`npm run dev`, puis connecte l'extension depuis http://127.0.0.1:8082/app/ (Mon compte). L'extension retient l'adresse du serveur qui lui a donné la clé.

## Publier dans les boutiques

| Boutique | Ce qu'il faut | Délai de relecture |
|---|---|---|
| **Safari** (Mac App Store) | Compte Apple Developer (99 $/an), Xcode, le projet généré par `safari-web-extension-converter`, un identifiant d'app, une icône d'app, des captures, une politique de confidentialité (`/confidentialite/`). On envoie depuis Xcode (Product → Archive) vers App Store Connect. Peut aussi couvrir iPhone et iPad (enlever `--macos-only`). | 1 à 3 jours |
| **Chrome Web Store** (aussi Edge, Brave, Arc) | Compte développeur (5 $ une fois), le zip du dossier `extension/`, captures 1280×800, justification de chaque permission (`storage`, accès à leboncoin.fr et retrorevente.fr), formulaire « pratiques de confidentialité ». | quelques jours |
| **Firefox** (addons.mozilla.org) | Compte gratuit, le zip, éventuellement le code source (inutile ici : rien n'est compilé). L'identifiant `extension@retrorevente.fr` est déjà dans le manifeste. | quelques heures à quelques jours |
| **Edge Add-ons** | Compte Partner Center gratuit, le même zip que Chrome. | quelques jours |

Les relecteurs regardent surtout l'accès à leboncoin.fr : explique que l'extension ne s'active que sur la page de dépôt, au clic, et n'envoie rien.

Pour fabriquer le zip :
```sh
cd extension && zip -r ../retrorevente-extension.zip . -x README.md
```

Avant chaque envoi, augmente `version` dans `manifest.json`.

## Si un champ n'est plus rempli

Le formulaire de Le Bon Coin change de temps en temps. Les champs sont reconnus par leur libellé, leur nom ou leur texte d'aide (fonctions `champ` et `choisir` de `lbc.js`), et les libellés d'état et de catégorie sont en haut de ce fichier : c'est là qu'il faut ajuster.
