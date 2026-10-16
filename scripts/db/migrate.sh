#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Migrations Supabase — STAGING D'ABORD.
#
#   scripts/db/migrate.sh staging              # liste les migrations en attente
#   scripts/db/migrate.sh staging --apply      # les applique sur staging
#   scripts/db/migrate.sh production --apply   # refusé tant que staging n'a pas
#                                              # TOUTES les migrations locales
#
# Le script travaille dans un dossier temporaire lié au bon projet : le lien CLI
# du dépôt n'est jamais modifié, impossible de viser la mauvaise base par erreur.
# Avant la production, une sauvegarde est faite (backup.sh) sauf --no-backup.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=environments.sh
source "$HERE/environments.sh"

ENV="${1:-}"; shift || true
APPLY=0; BACKUP=1
for a in "$@"; do
  case "$a" in --apply) APPLY=1 ;; --no-backup) BACKUP=0 ;; *) echo "Option inconnue : $a" >&2; exit 2 ;; esac
done
REF="$(mfp_project_ref "$ENV")"

# Migrations locales absentes de l'historique distant. Toute erreur (lien,
# réseau, sortie illisible) est FATALE : un échec silencieux reviendrait à
# conclure « rien en attente » et à laisser passer une migration non testée.
pending_for() {
  local ref="$1" work out
  work="$(mktemp -d)"
  mkdir -p "$work/supabase" && cp -R "$REPO/supabase/migrations" "$work/supabase/"
  if ! out="$(cd "$work" && supabase link --project-ref "$ref" >/dev/null 2>&1 && supabase migration list --linked 2>/dev/null)"; then
    rm -rf "$work"; echo "⛔ Impossible de lire l'historique des migrations de $ref." >&2; return 1
  fi
  rm -rf "$work"
  printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("\n".join(m["local"] for m in d["migrations"] if m.get("local") and not m.get("remote")))'
}

if [ "$ENV" = "production" ]; then
  STAGING_PENDING="$(pending_for "$(mfp_project_ref staging)")" || exit 1
  if [ -n "$STAGING_PENDING" ]; then
    echo "⛔ Refus : ces migrations n'ont pas encore été appliquées sur STAGING :" >&2
    echo "$STAGING_PENDING" >&2
    echo "→ scripts/db/migrate.sh staging --apply, vérifiez la recette, puis relancez." >&2
    exit 1
  fi
fi

PENDING="$(pending_for "$REF")" || exit 1
if [ -z "$PENDING" ]; then echo "✓ $ENV ($REF) : aucune migration en attente."; exit 0; fi
echo "Migrations en attente sur $ENV ($REF) :"; echo "$PENDING" | sed 's/^/  • /'
[ "$APPLY" = 1 ] || { echo "(liste seulement — ajoutez --apply pour appliquer)"; exit 0; }

if [ "$ENV" = "production" ] && [ "$BACKUP" = 1 ]; then
  echo "▶ Sauvegarde préalable de la production…"
  bash "$HERE/backup.sh" production
fi

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/supabase" && cp -R "$REPO/supabase/migrations" "$WORK/supabase/"
cd "$WORK"
supabase link --project-ref "$REF" >/dev/null
[ "$(cat supabase/.temp/project-ref)" = "$REF" ] || { echo "Lien inattendu, abandon." >&2; exit 1; }
supabase db push --linked --yes
echo "✓ $ENV ($REF) : migrations appliquées."
