#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Sauvegarde logique complète d'une base Supabase (sans Docker).
#
#   scripts/db/backup.sh production [dossier]   # défaut : ~/MetalFlowPro-backups
#
# Contenu (un dossier horodaté) :
#   roles.sql            rôles du cluster
#   schema.sql           schéma applicatif (public…)
#   platform_schema.sql  structure des schémas gérés par Supabase (auth, storage)
#                        — sert uniquement à rejouer la restauration en local
#   data.sql             toutes les données, comptes (auth.users) compris
#   manifest.tsv         nombre de lignes par table au moment de l'export
#   SHA256SUMS
# Si BACKUP_PASSPHRASE est défini, chaque fichier est compressé et chiffré
# (AES-256, PBKDF2) en .gz.enc et les clairs sont supprimés. En CI, la phrase
# est OBLIGATOIRE (voir .github/workflows/db-backup.yml).
#
# Identifiants : rôle de connexion temporaire généré par la CLI Supabase
# (supabase db dump --dry-run) — aucun mot de passe de base à manipuler.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=environments.sh
source "$HERE/environments.sh"

ENV="${1:-production}"
REF="$(mfp_project_ref "$ENV")"
ROOT="${2:-$HOME/MetalFlowPro-backups}"
PGBIN="$(mfp_pg_bin)"
export PATH="$PGBIN:$PATH"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$ROOT/$ENV-$STAMP"
# MFP_DB_VIA_POOLER=1 (CI) : connexion via le pooler IPv4.
POOLER=""
[ "${MFP_DB_VIA_POOLER:-0}" = 1 ] && POOLER="$(mfp_pooler_host "$REF")"
umask 077
mkdir -p "$OUT"

run_dump() { # $1 = fichier de sortie, puis options de `supabase db dump`
  local out="$1"; shift
  supabase db dump --project-ref "$REF" --dry-run "$@" 2>/dev/null > "$OUT/.dump.sh"
  [ -n "$POOLER" ] && mfp_rewrite_for_pooler "$OUT/.dump.sh" "$REF" "$POOLER"
  bash "$OUT/.dump.sh" > "$out"
  rm -f "$OUT/.dump.sh"
}

echo "▶ $ENV ($REF) → $OUT"
run_dump "$OUT/roles.sql" --role-only
run_dump "$OUT/schema.sql"
run_dump "$OUT/data.sql" --data-only --use-copy

# Manifeste : mêmes identifiants temporaires que la CLI. ⚠️ Chaque appel
# `supabase` régénère ce mot de passe : aucun appel CLI avant la fin des psql.
supabase db dump --project-ref "$REF" --dry-run --data-only 2>/dev/null | grep -E '^export PG' > "$OUT/.env.sh"
[ -n "$POOLER" ] && mfp_rewrite_for_pooler "$OUT/.env.sh" "$REF" "$POOLER"
# shellcheck disable=SC1091
source "$OUT/.env.sh"; rm -f "$OUT/.env.sh"

# Comptes EXACTS (count(*)) des tables applicatives, sous le rôle postgres
# (comme pg_dump --role postgres : le rôle de connexion seul n'a pas tous les droits).
# SET ROLE dans la requête : le pooler ignore les options de connexion (PGOPTIONS).
psql -X -q -t -A -F $'\t' -c "SET ROLE postgres;" -c "
  SELECT format('SET ROLE postgres; SELECT %L, count(*) FROM %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND n.nspname = 'public'
  ORDER BY 1" | while read -r q; do psql -X -q -t -A -F $'\t' -c "$q"; done > "$OUT/manifest.tsv"
unset PGPASSWORD

# Comptes utilisateurs : le schéma auth n'est lisible que via l'API de gestion.
supabase db query --linked --project-ref "$REF" \
  "SELECT (SELECT count(*) FROM auth.users) AS users, (SELECT count(*) FROM auth.identities) AS identities" 2>/dev/null \
  | python3 -c 'import json,sys; r=json.load(sys.stdin)["rows"][0]; print("auth.identities", r["identities"], sep="\t"); print("auth.users", r["users"], sep="\t")' >> "$OUT/manifest.tsv"

# Structure des tables auth/storage reconstruite depuis le catalogue
# via l'API de gestion (le rôle pg_dump n'a plus accès au schéma auth). Sert
# uniquement à rejouer la restauration hors Supabase (verify-restore.sh).
supabase db query --linked --project-ref "$REF" "
  SELECT c.table_schema, c.table_name, c.column_name, c.ordinal_position,
         format_type(a.atttypid, a.atttypmod) AS type,
         (SELECT bool_or(i.indisprimary) FROM pg_index i
            WHERE i.indrelid = a.attrelid AND a.attnum = ANY(i.indkey)) AS pk
  FROM information_schema.columns c
  JOIN pg_namespace n ON n.nspname = c.table_schema
  JOIN pg_class r ON r.relnamespace = n.oid AND r.relname = c.table_name
  JOIN pg_attribute a ON a.attrelid = r.oid AND a.attname = c.column_name
  WHERE c.table_schema IN ('auth', 'storage')
  ORDER BY 1, 2, 4" 2>/dev/null > "$OUT/.platform.json" || true
python3 - "$OUT/.platform.json" > "$OUT/platform_schema.sql" <<'PY'
import json, sys, collections
try:
    rows = json.load(open(sys.argv[1]))["rows"]
except Exception:
    rows = []
tables = collections.OrderedDict()
for r in rows:
    tables.setdefault((r["table_schema"], r["table_name"]), []).append(r)
print("-- Structure auth/storage reconstruite depuis le catalogue (vérification de restauration).")
for (sch, tbl), cols in tables.items():
    # Types propres à la plateforme (enums auth.*, storage.*) → text : seule la
    # restauration des valeurs est vérifiée, pas leurs contraintes de domaine.
    def typ(t):
        base = t[:-2] if t.endswith("[]") else t
        if base.startswith(("auth.", "storage.", '"auth"', '"storage"')):
            return "text[]" if t.endswith("[]") else "text"
        return t
    defs = [f'"{c["column_name"]}" {typ(c["type"])}' for c in cols]
    pk = [f'"{c["column_name"]}"' for c in cols if c.get("pk")]
    if pk:
        defs.append("PRIMARY KEY (" + ", ".join(pk) + ")")
    print(f'CREATE SCHEMA IF NOT EXISTS "{sch}";')
    print(f'DROP TABLE IF EXISTS "{sch}"."{tbl}" CASCADE;')
    print(f'CREATE TABLE "{sch}"."{tbl}" (' + ", ".join(defs) + ");")
PY
rm -f "$OUT/.platform.json"


( cd "$OUT" && shasum -a 256 roles.sql schema.sql platform_schema.sql data.sql manifest.tsv > SHA256SUMS )

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  for f in roles.sql schema.sql platform_schema.sql data.sql; do
    gzip -9 "$OUT/$f"
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$OUT/$f.gz" -out "$OUT/$f.gz.enc"
    rm -f "$OUT/$f.gz"
  done
  echo "✓ Chiffré (AES-256)."
elif [ -n "${CI:-}" ]; then
  echo "⛔ BACKUP_PASSPHRASE manquant en CI : sauvegarde en clair refusée." >&2; rm -rf "$OUT"; exit 1
fi

TABLES=$(wc -l < "$OUT/manifest.tsv" | tr -d ' ')
ROWS=$(awk -F'\t' '{s+=$2} END {print s+0}' "$OUT/manifest.tsv")
echo "✓ Sauvegarde : $TABLES tables, $ROWS lignes → $OUT"
echo "$OUT" > "$ROOT/.latest-$ENV"
