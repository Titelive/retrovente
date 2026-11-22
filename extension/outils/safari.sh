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
  d=safari/RetroRevente/RetroRevente.xcodeproj
  if [ -z "$t" ]; then echo "Pas d'équipe Apple trouvée : app non signée (Développement > « Autoriser les extensions non signées » dans Safari)."; return 0; fi
  if [ -f "$d/project.pbxproj" ]; then
    perl -0pi -e 's/^\s*DEVELOPMENT_TEAM = [^;]*;\n//mg; s/CODE_SIGN_IDENTITY = "-";/CODE_SIGN_IDENTITY = "Apple Development";/g; s/CODE_SIGN_STYLE = Manual;/CODE_SIGN_STYLE = Automatic;/g; s/^(\s*)(PRODUCT_BUNDLE_IDENTIFIER = [^;]+;)/$1$2\n$1DEVELOPMENT_TEAM = '"$t"';/mg' "$d/project.pbxproj"
  elif [ -f "$d/project.xcproj" ]; then
    # Xcode récent : projet au format JSON. L'équipe va à côté de chaque « CODE_SIGN_STYLE ».
    f="$d/project.xcproj"; cp "$f" "$f.avant"
    if grep -q '"DEVELOPMENT_TEAM"' "$f"; then perl -pi -e 's/("DEVELOPMENT_TEAM"\s*:\s*)"[^"]*"/$1"'"$t"'"/g' "$f"
    else perl -pi -e 's/^(\s*)("CODE_SIGN_STYLE"\s*:)/$1"DEVELOPMENT_TEAM" : "'"$t"'",\n$1$2/' "$f"; fi
    perl -pi -e 's/("CODE_SIGN_IDENTITY"\s*:\s*)"-"/$1"Apple Development"/g; s/("CODE_SIGN_STYLE"\s*:\s*)"Manual"/$1"Automatic"/g' "$f"
    if plutil -convert json -o /dev/null "$f" 2>/dev/null && grep -q '"DEVELOPMENT_TEAM"' "$f"; then rm -f "$f.avant"
    else mv "$f.avant" "$f"; echo "Je n'ai pas su écrire l'équipe dans le projet : choisis-la dans Xcode (Signing & Capabilities > Team)."; return 0; fi
  else echo "Projet Xcode introuvable : choisis l'équipe dans Xcode (Signing & Capabilities > Team)."; return 0; fi
  echo "App signée avec ton équipe Apple ($t)."
}
# Le projet liste les fichiers de l'extension un par un : un fichier ajouté depuis (ebay.js en 1.10, par exemple)
# n'y est pas, et Safari charge une extension incomplète. Dans ce cas, on recrée le projet.
if [ -d safari/RetroRevente ]; then
  projet=$(ls safari/RetroRevente/RetroRevente.xcodeproj/project.pbxproj safari/RetroRevente/RetroRevente.xcodeproj/project.xcproj 2>/dev/null | head -1)
  manque=""
  for f in extension/*.js extension/*.html extension/manifest.json; do
    n=$(basename "$f"); [ -n "$projet" ] && grep -q "$n" "$projet" || manque="$manque $n"
  done
  if [ -z "$manque" ]; then natif; equipe; echo "Le projet est à jour : ⌘R dans Xcode."; open safari/RetroRevente/RetroRevente.xcodeproj; exit 0; fi
  echo "Fichiers absents du projet Xcode :$manque. Je le recrée (l'ancien est gardé dans safari-ancien/)."
  rm -rf safari-ancien; mv safari safari-ancien
fi
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
     pour leboncoin.fr, ebay.fr et retrorevente.fr.
Pour l'iPhone : schéma « RetroRevente (iOS) », ton iPhone branché, ⌘R, puis Réglages > Apps > Safari > Extensions.
TXT
open safari/RetroRevente/RetroRevente.xcodeproj
