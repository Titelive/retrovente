#!/bin/bash
# Publie une version de RetroRevente pour Mac, depuis le Mac de Titelive (là où sont le certificat et la notarisation) :
#
#   bash mac/publier-mise-a-jour.sh
#
# 1. compile l'app (mac/construire.sh) avec un numéro de build qui augmente toujours (CFBundleVersion) ;
# 2. la signe « Developer ID Application » (runtime renforcé, horodatage, droits de mac/RetroRevente.entitlements) ;
# 3. la notarise (xcrun notarytool, profil du Trousseau « titelive-notary ») puis agrafe le ticket (stapler) ;
# 4. vérifie : codesign --verify --strict, spctl -a -vv, même Team ID que toutes les apps de Titelive ;
# 5. publie sur titelive.me : retrorevente/telecharger/RetroRevente-mac.zip et version.txt (lus par l'app pour ses mises
#    à jour automatiques), dans le dépôt du site (SITE=…), sur une branche + PR fusionnée automatiquement ;
# 6. met aussi le zip dans la release GitHub « mac » : les apps déjà installées (qui lisent encore GitHub) passent
#    à cette version, qui lit ensuite titelive.me.
#
# Le script refuse de publier si l'identité Developer ID ou le profil de notarisation manque, ou si une vérification échoue.
# Réglages facultatifs : IDENTITE=…, NOTARY_PROFILE=…, SITE=<dossier du dépôt titelive>, PUBLIER=0 (tout préparer sans publier).
set -euo pipefail
cd "$(dirname "$0")/.."

IDENTITE="${IDENTITE:-Developer ID Application: Julien Schouller (FGXU3MTVF3)}"
EQUIPE="FGXU3MTVF3"
NOTARY_PROFILE="${NOTARY_PROFILE:-titelive-notary}"
SITE="${SITE:-$HOME/Documents/GitHub/titelive}"
PUBLIER="${PUBLIER:-1}"
APP=mac/build/RetroRevente.app
ZIP=mac/build/RetroRevente-mac.zip
VERSION=$(tr -d ' \n' < mac/VERSION)

echo "▸ RetroRevente $VERSION"
security find-identity -v -p codesigning | grep -qF "\"$IDENTITE\"" || {
  echo "❌ Certificat « $IDENTITE » absent du Trousseau. Rien n'est publié." >&2
  echo "   Certificats disponibles :" >&2; security find-identity -v -p codesigning >&2; exit 1; }
xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 || {
  echo "❌ Profil de notarisation « $NOTARY_PROFILE » absent ou invalide. Rien n'est publié." >&2
  echo "   À créer une fois : xcrun notarytool store-credentials $NOTARY_PROFILE --apple-id … --team-id $EQUIPE --password …" >&2; exit 1; }

# CFBundleVersion : toujours plus grand que le précédent (date et heure), et plus grand que les numéros de GitHub.
BUILD=$(date +%y%m%d%H%M)
echo "▸ Compilation et signature (build $BUILD)…"
BUILD=$BUILD SIGNATURE="$IDENTITE" sh mac/construire.sh

echo "▸ Notarisation par Apple (quelques minutes)…"
RESULTAT=$(xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait --timeout 30m 2>&1 | tee /dev/stderr)
echo "$RESULTAT" | grep -q "status: Accepted" || { echo "❌ Notarisation refusée : voir « xcrun notarytool log <id> --keychain-profile $NOTARY_PROFILE ». Rien n'est publié." >&2; exit 1; }
xcrun stapler staple "$APP"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

echo "▸ Vérifications…"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl -a -vv --type execute "$APP" 2>&1 | tee /dev/stderr | grep -q "source=Notarized Developer ID" || { echo "❌ Gatekeeper n'accepte pas l'app. Rien n'est publié." >&2; exit 1; }
EQUIPE_APP=$(codesign -dv "$APP" 2>&1 | sed -n 's/^TeamIdentifier=//p')
[ "$EQUIPE_APP" = "$EQUIPE" ] || { echo "❌ Team ID $EQUIPE_APP au lieu de $EQUIPE : les autorisations ne suivraient pas. Rien n'est publié." >&2; exit 1; }
xcrun stapler validate "$APP"
printf '%s\n' "$VERSION" > mac/build/version.txt
echo "✓ RetroRevente $VERSION signée, notarisée et agrafée : $ZIP"

[ "$PUBLIER" = 1 ] || { echo "PUBLIER=0 : rien n'est publié."; exit 0; }

# --- titelive.me ---------------------------------------------------------------------------------------------
[ -d "$SITE/.git" ] || { echo "❌ Dépôt du site introuvable dans $SITE (SITE=… pour en donner un autre)." >&2; exit 1; }
BRANCHE="retrorevente-mac-$VERSION-$BUILD"
git -C "$SITE" fetch -q origin main
git -C "$SITE" switch -q -c "$BRANCHE" origin/main
mkdir -p "$SITE/retrorevente/telecharger"
cp "$ZIP" mac/build/version.txt "$SITE/retrorevente/telecharger/"
git -C "$SITE" add retrorevente/telecharger/RetroRevente-mac.zip retrorevente/telecharger/version.txt
git -C "$SITE" commit -q -m "RetroRevente pour Mac $VERSION : mise à jour signée et notarisée"
git -C "$SITE" push -q -u origin "$BRANCHE"
if command -v gh >/dev/null; then
  (cd "$SITE" && gh pr create --base main --head "$BRANCHE" --title "RetroRevente pour Mac $VERSION" \
    --body "Mise à jour de RetroRevente pour Mac (signée Developer ID, notarisée) : retrorevente/telecharger/. Fusion automatique.")
else
  echo "→ Ouvre la PR : https://github.com/Titelive/titelive/compare/main...$BRANCHE"
fi
git -C "$SITE" switch -q -

# --- GitHub Releases (apps installées avant le passage à titelive.me) ----------------------------------------
if command -v gh >/dev/null; then
  gh release view mac -R Titelive/retrovente >/dev/null 2>&1 || gh release create mac -R Titelive/retrovente --title "RetroRevente pour Mac" --notes "Installer : curl -fsSL https://raw.githubusercontent.com/Titelive/retrovente/main/mac/installer.sh | sh"
  gh release upload mac -R Titelive/retrovente "$ZIP" --clobber
  gh release upload mac -R Titelive/retrovente mac/build/version.txt --clobber
  echo "✓ Release GitHub « mac » mise à jour."
else
  echo "⚠︎ gh absent : la release GitHub « mac » n'est pas mise à jour (les apps déjà installées ne la verront pas)."
fi
echo "✓ Publié. Les apps installées la trouveront toutes seules (au lancement, puis toutes les 6 heures)."
