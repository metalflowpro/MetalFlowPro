#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Livraison en PRODUCTION — le seul chemin documenté.
#
#   scripts/release.sh            # contrôles + migrations prod + déploiement prod
#   scripts/release.sh --dry-run  # contrôles et liste des migrations, sans rien appliquer
#
# Étapes, chacune bloquante :
#   1. arbre git propre et poussé (ce qui part en prod existe sur GitHub) ;
#   2. npm run build:quality (exactement ce que Railway exécute) + banc SQL ;
#   3. migrations : refusées tant que STAGING ne les a pas toutes reçues,
#      sauvegarde de la prod juste avant (scripts/db/migrate.sh) ;
#   4. railway up sur l'environnement production, nommé explicitement (le lien
#      local de la CLI Railway peut pointer sur staging) ;
#   5. contrôle : HTTP 200 + en-têtes de sécurité présents.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

echo "▶ 1/5 Git"
[ -z "$(git status --porcelain)" ] || { echo "⛔ Modifications non commitées." >&2; exit 1; }
git fetch -q origin
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo none)" ] \
  || { echo "⛔ La branche $BRANCH n'est pas poussée telle quelle sur origin." >&2; exit 1; }

echo "▶ 2/5 Qualité (typecheck + tests + build) et banc SQL"
npm run build:quality
npm run test:sql

echo "▶ 3/5 Migrations"
if [ "$DRY" = 1 ]; then bash scripts/db/migrate.sh production; echo "(dry-run : arrêt avant application)"; exit 0; fi
bash scripts/db/migrate.sh production --apply

echo "▶ 4/5 Déploiement Railway (production)"
railway up --detach --service metalflowpro --environment production

echo "▶ 5/5 Contrôle (attendre la fin du build Railway, ~2–3 min)"
for _ in $(seq 1 40); do
  sleep 15
  if curl -fsI https://metalflowpro.com | grep -qi '^strict-transport-security'; then
    echo "✓ Production en ligne, en-têtes de sécurité présents."; exit 0
  fi
done
echo "⚠️ Contrôle non concluant : vérifier « railway deployment list --environment production »." >&2
exit 1
