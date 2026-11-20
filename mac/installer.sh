#!/bin/sh
# Installe (ou met à jour) RetroRevente pour Mac dans le dossier Applications, puis l'ouvre.
#   curl -fsSL https://raw.githubusercontent.com/Titelive/retrovente/main/mac/installer.sh | sh
# Version d'essai (celle d'une PR en cours) : … | RR_CANAL=mac-essai sh
set -eu
CANAL=${RR_CANAL:-mac}
URL="https://github.com/Titelive/retrovente/releases/download/$CANAL/RetroRevente-mac.zip"
TMP=$(mktemp -d)
echo "Téléchargement de RetroRevente pour Mac…"
curl -fL --progress-bar "$URL" -o "$TMP/RetroRevente.zip"
ditto -x -k "$TMP/RetroRevente.zip" "$TMP"
osascript -e 'tell application "RetroRevente" to quit' >/dev/null 2>&1 || true
DEST=/Applications
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"
rm -rf "$DEST/RetroRevente.app"
mv "$TMP/RetroRevente.app" "$DEST/"
xattr -dr com.apple.quarantine "$DEST/RetroRevente.app" 2>/dev/null || true
rm -rf "$TMP"
echo "RetroRevente est installée dans $DEST. Ouverture…"
open "$DEST/RetroRevente.app"
