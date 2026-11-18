#!/bin/sh
# Fabrique le zip à envoyer aux boutiques (Chrome, Edge, Firefox, et App Store Connect pour Safari).
set -e
cd "$(dirname "$0")/.."
v=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
mkdir -p ../dist
rm -f "../dist/retrorevente-extension-$v.zip"
zip -qr "../dist/retrorevente-extension-$v.zip" manifest.json *.js popup.html icones
echo "dist/retrorevente-extension-$v.zip"
