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
# Comptes propriétaires (secret GitHub ADMIN_EMAILS) : remplace la ligne du fichier d'environnement s'il est fourni
if [ -n "${ADMIN_EMAILS:-}" ]; then
  sed -i '/^ADMIN_EMAILS=/d' /etc/retrorevente.env
  printf 'ADMIN_EMAILS=%s\n' "$ADMIN_EMAILS" >> /etc/retrorevente.env
fi

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

# Détourage des photos : petit service Python local (rembg). Non bloquant : le site marche sans.
(
  set +e
  PY=/opt/retrorevente-py
  if ! "$PY/bin/python" -c "import rembg, scipy, onnxruntime, cv2" >/dev/null 2>&1; then
    echo "… installation du détourage des photos (une seule fois, quelques minutes)"
    python3 -m venv "$PY" >/dev/null 2>&1 || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-venv >/dev/null && python3 -m venv "$PY"; }
    "$PY/bin/pip" install -q --disable-pip-version-check "rembg[cpu]" scipy opencv-python-headless >/tmp/rr-pip.log 2>&1 || { tail -20 /tmp/rr-pip.log; exit 1; }
  fi
  mkdir -p /var/lib/retrorevente-modeles && chown titelive:titelive /var/lib/retrorevente-modeles
  install -m 644 "$SRC/deploy/retrorevente-detourage.service" /etc/systemd/system/retrorevente-detourage.service
  systemctl daemon-reload && systemctl enable retrorevente-detourage >/dev/null 2>&1
  systemctl restart retrorevente-detourage
  for _ in $(seq 1 120); do sleep 2; curl -fsS http://127.0.0.1:7001/sante >/dev/null 2>&1 && { echo "✔ détourage des photos prêt"; exit 0; }; done
  echo "⚠ le détourage démarre encore (premier téléchargement du modèle)"; journalctl -u retrorevente-detourage -n 15 --no-pager
) || echo "⚠ détourage des photos non installé (le reste du site fonctionne)"
# On garde les 5 dernières versions.
ls -1dt "$BASE"/releases/* | tail -n +6 | xargs -r rm -rf
