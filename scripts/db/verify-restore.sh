#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Vérification de restauration : rejoue une sauvegarde de backup.sh dans un
# cluster PostgreSQL 17 JETABLE (aucune base Supabase touchée), puis compare
# le nombre de lignes de chaque table au manifeste pris au moment de l'export.
#
#   scripts/db/verify-restore.sh [dossier_de_sauvegarde]   # défaut : la dernière
#   (BACKUP_PASSPHRASE requis si la sauvegarde est chiffrée)
#
# Code de sortie 0 = sauvegarde exploitable (toutes les tables, tous les comptes).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=environments.sh
source "$HERE/environments.sh"
PGBIN="$(mfp_pg_bin)"
export PATH="$PGBIN:$PATH"
# PostgreSQL 17 refuse de démarrer sans locale valide (« postmaster became multithreaded »).
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

SRC="${1:-$(cat "$HOME/MetalFlowPro-backups/.latest-production" 2>/dev/null || true)}"
[ -d "$SRC" ] || { echo "Sauvegarde introuvable : ${SRC:-<aucune>}" >&2; exit 2; }

WORK="$(mktemp -d)"; DATA="$WORK/pg"; SOCK="$(mktemp -d /tmp/mfp_rs.XXXXXX)"; PORT=54331  # socket court (limite unix)
cleanup() { pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK" "$SOCK"; }
trap cleanup EXIT

# Fichiers clairs (déchiffrement si nécessaire).
for f in roles.sql schema.sql platform_schema.sql data.sql; do
  if [ -f "$SRC/$f" ]; then cp "$SRC/$f" "$WORK/$f"
  elif [ -f "$SRC/$f.gz.enc" ]; then
    [ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "BACKUP_PASSPHRASE requis (sauvegarde chiffrée)." >&2; exit 2; }
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$SRC/$f.gz.enc" | gunzip > "$WORK/$f"
  else echo "Fichier manquant : $f" >&2; exit 2; fi
done
( cd "$WORK" && shasum -a 256 -c "$SRC/SHA256SUMS" --ignore-missing >/dev/null 2>&1 ) \
  && echo "✓ Empreintes SHA-256 conformes" || { cp "$SRC/manifest.tsv" "$WORK/"; ( cd "$WORK" && shasum -a 256 -c "$SRC/SHA256SUMS" ) || { echo "⛔ Empreintes non conformes" >&2; exit 1; }; }
cp "$SRC/manifest.tsv" "$WORK/manifest.tsv"

initdb -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
pg_ctl -D "$DATA" -o "-k $SOCK -p $PORT -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null || { tail -5 "$WORK/pg.log" >&2; exit 1; }
PSQL=(psql -X -q -h "$SOCK" -p "$PORT" -U postgres -d postgres)

# Socle minimal Supabase (rôles, auth.uid…) du banc SQL, puis rôles du cluster.
"${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$REPO/supabase/tests/harness/bootstrap.sql" >/dev/null
for r in supabase_admin supabase_auth_admin supabase_storage_admin authenticator dashboard_user pgbouncer supabase_replication_admin supabase_read_only_user supabase_realtime_admin supabase_functions_admin; do
  "${PSQL[@]}" -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$r') THEN CREATE ROLE $r NOLOGIN; END IF; END \$\$;" >/dev/null
done
"${PSQL[@]}" -f "$WORK/roles.sql" >/dev/null 2>&1 || true
"${PSQL[@]}" -c "CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\" WITH SCHEMA extensions;" >/dev/null 2>&1 || true

# Structure auth/storage puis schéma applicatif. Les erreurs résiduelles
# (droits vers des rôles/extensions propres à la plateforme) sont comptées et
# affichées, mais c'est le test de données qui fait foi.
"${PSQL[@]}" -f "$WORK/platform_schema.sql" > "$WORK/platform.log" 2>&1 || true
# Séquences internes auth/storage remises à niveau par l'export (setval).
grep -oE "setval\('\"(auth|storage)\"\.\"[^\"]+\"'" "$WORK/data.sql" | sed -E "s/^setval\('//; s/'$//" | sort -u \
  | while read -r seq; do "${PSQL[@]}" -c "CREATE SEQUENCE IF NOT EXISTS $seq" >/dev/null 2>&1 || true; done
"${PSQL[@]}" -f "$WORK/schema.sql" > "$WORK/schema.log" 2>&1 || true
SCHEMA_ERRORS=$(grep -c "ERROR" "$WORK/schema.log" || true)
[ "$SCHEMA_ERRORS" -gt 0 ] && grep "ERROR" "$WORK/schema.log" | sed "s/^/    · /" | head -5

# Données : déclencheurs désactivés (session_replication_role = replica, posé par l'export).
"${PSQL[@]}" -f "$WORK/data.sql" > "$WORK/data.log" 2>&1 || true
DATA_ERRORS=$(grep -c "ERROR" "$WORK/data.log" || true)

# Comparaison au manifeste.
FAIL=0; CHECKED=0
while IFS=$'\t' read -r tbl expected; do
  [ -n "$tbl" ] || continue
  CHECKED=$((CHECKED + 1))
  sch="${tbl%%.*}"; name="${tbl#*.}"
  got=$("${PSQL[@]}" -t -A -c "SELECT count(*) FROM \"$sch\".\"$name\"" 2>/dev/null || echo "ABSENTE")
  if [ "$got" != "$expected" ]; then
    echo "  ✗ $tbl : attendu $expected, restauré $got"; FAIL=$((FAIL + 1))
  fi
done < "$WORK/manifest.tsv"

echo "Erreurs de schéma (droits/extensions plateforme) : $SCHEMA_ERRORS · erreurs de données : $DATA_ERRORS"
if [ "$FAIL" -eq 0 ] && [ "$DATA_ERRORS" -eq 0 ]; then
  echo "✓ RESTAURATION VÉRIFIÉE : $CHECKED tables, nombres de lignes identiques au manifeste ($SRC)"
else
  echo "⛔ RESTAURATION INCOMPLÈTE : $FAIL table(s) en écart, $DATA_ERRORS erreur(s) de données" >&2
  grep "ERROR" "$WORK/data.log" | sort | uniq -c | sort -rn | head -10 >&2
  exit 1
fi
