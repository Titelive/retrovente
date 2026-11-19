#!/bin/sh
# Fabrique les zips à envoyer aux boutiques (Chrome, Edge, Firefox, et App Store Connect pour Safari).
set -e
cd "$(dirname "$0")/../.."
node extension/outils/paquets.mjs
