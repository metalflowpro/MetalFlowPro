#!/usr/bin/env bash
# Environnements Supabase de MetalFlow Pro (références de projet : NON secrètes).
#   production : base servie par https://metalflowpro.com
#   staging    : base de recette servie par https://metalflowpro-staging.up.railway.app
# Toute migration passe d'abord par staging (voir migrate.sh).

mfp_project_ref() {
  case "${1:-}" in
    production) echo "qbcvrwyapvzugekbhrfy" ;;
    staging)    echo "pjddrdvshzwjeyqlgfbp" ;;
    *) echo "Environnement inconnu « ${1:-} » (attendu : production | staging)" >&2; return 1 ;;
  esac
}

# Binaires PostgreSQL 17 (version des serveurs Supabase) : Homebrew en local,
# paquet apt postgresql-client-17 en CI.
mfp_pg_bin() {
  for d in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do
    [ -x "$d/pg_dump" ] && { echo "$d"; return 0; }
  done
  command -v pg_dump >/dev/null && dirname "$(command -v pg_dump)" && return 0
  echo "pg_dump 17 introuvable (brew install postgresql@17)" >&2; return 1
}

# Hôte du pooler Supabase (IPv4) — les runners GitHub n'ont pas d'IPv6, or
# l'hôte direct db.<ref>.supabase.co n'est joignable qu'en IPv6.
mfp_pooler_host() {
  local work host
  work="$(mktemp -d)"; mkdir -p "$work/supabase"
  (cd "$work" && supabase link --project-ref "$1" >/dev/null 2>&1)
  host="$(sed -E 's#^.*@([^:/]+).*$#\1#' "$work/supabase/.temp/pooler-url" 2>/dev/null || true)"
  rm -rf "$work"
  [ -n "$host" ] && echo "$host" || { echo "Pooler introuvable pour $1" >&2; return 1; }
}

# Réécrit les variables PG d'un script `supabase db dump --dry-run` pour passer
# par le pooler (mode session, port 5432, utilisateur suffixé par la référence).
mfp_rewrite_for_pooler() { # $1 = fichier, $2 = ref, $3 = hôte pooler
  sed -i.bak -E "s#^export PGHOST=.*#export PGHOST=\"$3\"#; s#^export PGPORT=.*#export PGPORT=\"5432\"#; s#^export PGUSER=\"([^\".]+)\"#export PGUSER=\"\\1.$2\"#" "$1"
  rm -f "$1.bak"
}
