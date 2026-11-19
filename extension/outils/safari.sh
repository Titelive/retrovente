#!/bin/sh
# Crée l'app Safari (Mac, iPhone et iPad) qui emballe l'extension, puis l'ouvre dans Xcode.
# À lancer sur un Mac avec Xcode installé (App Store, gratuit) :   sh extension/outils/safari.sh
# Le projet Xcode pointe vers le dossier extension/ (pas de copie) : une modification de l'extension
# est reprise au prochain ⌘R dans Xcode. Le projet généré (safari/) n'est pas versionné.
set -e
cd "$(dirname "$0")/../.."
command -v xcrun >/dev/null || { echo "Xcode n'est pas installé : installe-le depuis l'App Store, ouvre-le une fois, puis relance."; exit 1; }
xcrun --find safari-web-extension-converter >/dev/null 2>&1 || { echo "Outil Safari introuvable : lance « sudo xcode-select -s /Applications/Xcode.app » puis relance."; exit 1; }
# Gestionnaire natif versionné (son d'alerte joué par l'app) : remplace celui généré par Xcode.
natif() { find safari/RetroRevente -name SafariWebExtensionHandler.swift -exec cp safari-natif/SafariWebExtensionHandler.swift {} \; ; }
# Signature avec ton équipe Apple (compte gratuit possible) : l'extension reste active quand Safari redémarre.
# Équipe prise dans RR_TEAM, sinon dans ton certificat « Apple Development » (Xcode > Réglages > Comptes).
equipe() {
  t="${RR_TEAM:-$(security find-certificate -c "Apple Development" -p 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' | head -1)}"
  p=safari/RetroRevente/RetroRevente.xcodeproj/project.pbxproj
  if [ -z "$t" ] || [ ! -f "$p" ]; then echo "Pas d'équipe Apple trouvée : app non signée (Développement > « Autoriser les extensions non signées » dans Safari)."; return 0; fi
  perl -0pi -e 's/^\s*DEVELOPMENT_TEAM = [^;]*;\n//mg; s/CODE_SIGN_IDENTITY = "-";/CODE_SIGN_IDENTITY = "Apple Development";/g; s/CODE_SIGN_STYLE = Manual;/CODE_SIGN_STYLE = Automatic;/g; s/^(\s*)(PRODUCT_BUNDLE_IDENTIFIER = [^;]+;)/$1$2\n$1DEVELOPMENT_TEAM = '"$t"';/mg' "$p"
  echo "App signée avec ton équipe Apple ($t)."
}
if [ -d safari/RetroRevente ]; then natif; equipe; echo "Le projet existe déjà : open safari/RetroRevente/RetroRevente.xcodeproj"; open safari/RetroRevente/RetroRevente.xcodeproj; exit 0; fi
xcrun safari-web-extension-converter extension \
  --project-location safari \
  --app-name "RetroRevente" \
  --bundle-identifier fr.retrorevente.app \
  --swift --force --no-prompt --no-open
natif
equipe
cat <<'TXT'

Projet créé dans safari/RetroRevente. Dans Xcode :
  1. En haut, choisis le schéma « RetroRevente (macOS) » et « My Mac », puis ⌘R.
  2. Safari > Réglages > Avancées : coche « Afficher les fonctionnalités pour les développeurs web ».
  3. Seulement si l'app n'est pas signée (pas de compte Apple dans Xcode) : menu Développement >
     « Autoriser les extensions non signées » (à refaire après chaque redémarrage de Safari).
  4. Safari > Réglages > Extensions : coche RetroRevente, puis « Modifier les sites web » > Autoriser
     pour leboncoin.fr et retrorevente.fr.
Pour l'iPhone : schéma « RetroRevente (iOS) », ton iPhone branché, ⌘R, puis Réglages > Apps > Safari > Extensions.
TXT
open safari/RetroRevente/RetroRevente.xcodeproj
