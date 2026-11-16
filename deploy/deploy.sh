#!/usr/bin/env bash
# Mise en ligne de retrorevente.fr sur le VPS IONOS (lancé en root par GitHub Actions, ou à la main) :
#   bash deploy/deploy.sh <dossier contenant le dépôt>
# Le serveur de base (Node 22, Caddy, utilisateur titelive, pare-feu) est installé par le dépôt titelive.
# HTTPS : le bloc retrorevente.fr est dans server/deploy/Caddyfile du dépôt titelive.
set -euo pipefail
SRC="$(cd "${1:?dossier source}" && pwd)"
PORT=8082
command -v node >/dev/null && node -e 'process.exit(+process.versions.node.split(".")[0]>=22?0:1)' || { echo "Node 22 requis (installé par le dépôt titelive)."; exit 1; }
id titelive >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash titelive

BASE=/srv/retrorevente
REL="$BASE/releases/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BASE/releases" /var/lib/retrorevente /var/backups/retrorevente
cp -a "$SRC" "$REL"; rm -rf "$REL/.git"
chown -R titelive:titelive "$REL" /var/lib/retrorevente
[ -f /etc/retrorevente.env ] || install -m 600 /dev/null /etc/retrorevente.env

# Sauvegarde quotidienne de la base et des photos (30 jours gardés)
cat > /usr/local/bin/retrorevente-backup <<'B'
#!/bin/sh
set -e
sqlite_bak=/var/lib/retrorevente/retrorevente.bak.db
node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync("/var/lib/retrorevente/retrorevente.db");d.exec("VACUUM INTO \"'"$sqlite_bak"'\"")' 2>/dev/null || true
tar czf /var/backups/retrorevente/rr-$(date +%F).tgz -C /var/lib/retrorevente --exclude=retrorevente.db --exclude='retrorevente.db-*' .
rm -f "$sqlite_bak"
find /var/backups/retrorevente -name 'rr-*.tgz' -mtime +30 -delete
B
chmod +x /usr/local/bin/retrorevente-backup
echo '45 3 * * * root /usr/local/bin/retrorevente-backup' > /etc/cron.d/retrorevente-backup

PREV="$(readlink -f "$BASE/current" 2>/dev/null || true)"
ln -sfn "$REL" "$BASE/current"
install -m 644 "$SRC/deploy/retrorevente.service" /etc/systemd/system/retrorevente.service
systemctl daemon-reload && systemctl enable retrorevente >/dev/null 2>&1
systemctl restart retrorevente

ok=""
for _ in $(seq 1 15); do sleep 1; curl -fsS "http://127.0.0.1:$PORT/__health" >/dev/null 2>&1 && { ok=1; break; }; done
if [ -z "$ok" ]; then
  echo "✘ retrorevente ne répond pas. Journal :"; journalctl -u retrorevente -n 30 --no-pager || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then ln -sfn "$PREV" "$BASE/current"; systemctl restart retrorevente; echo "↩ retour à $PREV"; fi
  exit 1
fi
echo "✔ retrorevente en ligne : $REL"
# On garde les 5 dernières versions.
ls -1dt "$BASE"/releases/* | tail -n +6 | xargs -r rm -rf
