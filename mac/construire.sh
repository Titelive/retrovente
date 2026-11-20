#!/bin/sh
# Fabrique RetroRevente.app (Mac Apple Silicon et Intel, macOS 12 ou plus) sans projet Xcode :
# il suffit des outils en ligne de commande d'Apple (xcode-select --install). GitHub le fait tout seul (.github/workflows/mac.yml).
#   sh mac/construire.sh            → mac/build/RetroRevente.app et mac/build/RetroRevente-mac.zip
# L'extension est embarquée telle quelle (commun.js, lbc.js, appli.js, popup) : une modification de l'extension
# est reprise au prochain build de l'app.
set -eu
cd "$(dirname "$0")/.."
SORTIE=mac/build
APP="$SORTIE/RetroRevente.app"
VERSION=$(tr -d ' \n' < mac/VERSION)
BUILD=${BUILD:-1}
rm -rf "$SORTIE"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/extension"

echo "Compilation (Apple Silicon et Intel)…"
for a in arm64 x86_64; do
  xcrun swiftc -O -target "$a-apple-macos12.0" -module-name RetroRevente \
    -o "$SORTIE/RetroRevente-$a" mac/Sources/*.swift \
    -framework AppKit -framework WebKit -framework UserNotifications
done
lipo -create -output "$APP/Contents/MacOS/RetroRevente" "$SORTIE/RetroRevente-arm64" "$SORTIE/RetroRevente-x86_64"
rm "$SORTIE/RetroRevente-arm64" "$SORTIE/RetroRevente-x86_64"

sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" mac/Info.plist > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist" >/dev/null

# Extension embarquée (mêmes fichiers que pour Safari, Chrome, Firefox) et pont vers l'app.
cp extension/manifest.json extension/commun.js extension/lbc.js extension/appli.js extension/popup.html extension/popup.js "$APP/Contents/Resources/extension/"
cp -R extension/img extension/icones extension/polices "$APP/Contents/Resources/extension/"
cp mac/pont.js "$APP/Contents/Resources/"

# Icône de l'app (celle du site).
SET="$SORTIE/AppIcon.iconset"; mkdir -p "$SET"
for t in 16 32 128 256 512; do
  sips -z $t $t site/img/icone-512.png --out "$SET/icon_${t}x${t}.png" >/dev/null
  d=$((t * 2)); [ $d -le 512 ] && sips -z $d $d site/img/icone-512.png --out "$SET/icon_${t}x${t}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$SET"

# Signature « ad hoc » (sans compte Apple) : obligatoire pour lancer l'app sur Apple Silicon.
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

ditto -c -k --keepParent "$APP" "$SORTIE/RetroRevente-mac.zip"
echo "Prêt : $APP (version $VERSION, build $BUILD) et $SORTIE/RetroRevente-mac.zip"
