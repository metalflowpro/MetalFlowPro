#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# run-migrations.sh — banc de validation local (Phase 0/1).
#
# Crée un cluster Postgres jetable, applique bootstrap.sql puis TOUTES les
# migrations supabase/migrations/*.sql dans l'ordre, puis les tests SQL passés
# en argument (défaut : s1_rls.sql s2_audit.sql s3_lifecycle.sql).
#
# Les tests tournent en conditions PostgREST (set local role authenticated).
# Sortie non nulle si une migration ou une assertion échoue.
#
# Usage :
#   supabase/tests/harness/run-migrations.sh [test1.sql test2.sql ...]
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

# macOS : sans locale valide, le postmaster « became multithreaded during startup ».
export LC_ALL="${LC_ALL:-C}"
export LANG="${LANG:-C}"

# Détection du répertoire des binaires Postgres (macOS Homebrew ou Linux/CI).
if [ -z "${PGBIN:-}" ]; then
  if command -v pg_config >/dev/null 2>&1; then
    PGBIN="$(pg_config --bindir)"
  elif [ -d /opt/homebrew/opt/postgresql@16/bin ]; then
    PGBIN="/opt/homebrew/opt/postgresql@16/bin"
  elif ls -d /usr/lib/postgresql/*/bin >/dev/null 2>&1; then
    PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
  else
    echo "Postgres introuvable — définissez PGBIN=/chemin/vers/bin" >&2; exit 2
  fi
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
MIG="$REPO/supabase/migrations"
TESTS="$REPO/supabase/tests"

DEFAULT_TESTS=(s1_rls.sql s2_audit.sql s3_lifecycle.sql projects_soft_delete.sql p80_ingestion_secret.sql)
if [ "$#" -gt 0 ]; then TEST_FILES=("$@"); else TEST_FILES=("${DEFAULT_TESTS[@]}"); fi

DATA="$(mktemp -d "${TMPDIR:-/tmp}/mfp_pgdata.XXXXXX")"
SOCK="$(mktemp -d /tmp/mfp_sock.XXXXXX)"   # court : contrainte de longueur du socket unix
LOG="$DATA/server.log"
PORT="${PORT:-54329}"
DB="mfp_test"

PSQLBASE="$PGBIN/psql -v ON_ERROR_STOP=1 -X -q -h $SOCK -p $PORT -U postgres"

cleanup() {
  "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" 2>/dev/null || true
}
trap cleanup EXIT

echo "▶ initdb ($DATA)"
"$PGBIN/initdb" -D "$DATA" -U postgres --encoding=UTF8 --locale=C >/dev/null

echo "▶ démarrage (socket $SOCK, port $PORT)"
"$PGBIN/pg_ctl" -D "$DATA" -l "$LOG" \
  -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null

# Reconstruit une base neuve (bootstrap + toutes les migrations dans l'ordre).
# Chaque test tourne sur SA base : les fixtures (mêmes UUID de projet) ne se
# contaminent pas d'un fichier de test à l'autre.
build_db() {
  local db="$1"
  "$PGBIN/createdb" -h "$SOCK" -p "$PORT" -U postgres "$db"
  $PSQLBASE -d "$db" -f "$HERE/bootstrap.sql" >/dev/null
  local f
  for f in $(ls "$MIG"/*.sql | sort); do
    if ! $PSQLBASE -d "$db" -f "$f" >/dev/null 2>"$DATA/err.log"; then
      echo "  ✗ ÉCHEC migration : $(basename "$f")"
      sed 's/^/      /' "$DATA/err.log"
      return 1
    fi
  done
  return 0
}

echo "▶ migrations (base de référence)"
build_db "$DB"
n=$(ls "$MIG"/*.sql | wc -l | tr -d ' ')
echo "  ✓ $n migrations appliquées, 0 échec"

echo "▶ diagnostics (base de référence)"
$PSQLBASE -d "$DB" -tA -c "SELECT '  tables project_id : '||count(*) FROM information_schema.columns WHERE column_name='project_id' AND table_schema='public';"
$PSQLBASE -d "$DB" -tA -c "SELECT '  gaps RLS          : '||count(*) FROM public.mfp_rls_coverage_gaps;"
$PSQLBASE -d "$DB" -tA -c "SELECT '  politiques _s1_   : '||count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE '%\_s1\_%';"
$PSQLBASE -d "$DB" -tA -c "SELECT '  tables sans RLS   : '||count(*) FROM pg_tables t WHERE schemaname='public' AND NOT rowsecurity;"

echo "▶ tests (base neuve par fichier)"
fail=0
i=0
for t in "${TEST_FILES[@]}"; do
  path="$TESTS/$t"
  if [ ! -f "$path" ]; then echo "  ⚠ test introuvable : $t"; continue; fi
  i=$((i+1))
  tdb="mfp_test_$i"
  build_db "$tdb" >/dev/null 2>&1 || { echo "  ✗ $t — build base échoué"; fail=1; continue; }
  # Les assertions RAISE NOTICE 'PASS' ; un échec RAISE EXCEPTION → exit≠0.
  if $PSQLBASE -d "$tdb" -f "$path" >"$DATA/test.out" 2>&1; then
    pass=$(grep -c 'PASS —' "$DATA/test.out" || true)
    echo "  ✓ $t — $pass assertions PASS"
  else
    echo "  ✗ $t — ÉCHEC :"
    grep -E 'PASS —|ÉCHEC|ERROR|EXCEPTION' "$DATA/test.out" | sed 's/^/      /' | tail -20
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then echo "✗ BANC : au moins un test a échoué"; exit 1; fi
echo "✓ BANC : migrations + tests verts"
