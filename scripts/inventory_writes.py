#!/usr/bin/env python3
"""Inventaire P1.0 + garde P1.1 — écritures directes hors couche de données S7.

Scanne src/ à la recherche d'appels d'écriture supabase-js
(insert/update/upsert/delete/rpc) qui ne passent PAS par la couche de données
(src/lib/data/*) ni le routeur (src/lib/app/commandRouter.ts) ni l'infrastructure
d'audit (src/lib/audit/auditLog.ts, exception socle autorisée).

Catégorise par module (sous-répertoire de src/lib ou src/...).
Filtre les Set.delete / Map.delete (faux positifs JS) par analyse de contexte.

Modes :
  (défaut)            imprime le rapport lisible.
  --json             écrit scripts/p1_inventory.json (détails complets).
  --check            garde P1.1 : échoue (exit 1) si le nombre d'écritures
                     directes dépasse le baseline (scripts/writes-baseline.json).
  --update-baseline  réécrit le baseline depuis le scan courant (à faire APRÈS
                     avoir migré des écritures — la dette ne doit que diminuer).
"""
import re
import sys
import json
from pathlib import Path
from collections import defaultdict

# ROOT relatif au dépôt : ce script vit dans <repo>/scripts/.
REPO = Path(__file__).resolve().parent.parent
ROOT = REPO / "src"
BASELINE = REPO / "scripts" / "writes-baseline.json"

# Fichiers autorisés à faire des écritures supabase directes.
#   - la couche de données S7 (src/lib/data/*)
#   - le routeur (src/lib/app/commandRouter.ts)
#   - l'infrastructure d'audit (exception socle documentée en P1.1)
ALLOWED = {
    Path("lib/app/commandRouter.ts"),
    Path("lib/audit/auditLog.ts"),
}

RE_WRITE = re.compile(r"\.(insert|update|upsert|delete|rpc)\s*\(")


def module_of(rel: Path) -> str:
    parts = rel.parts
    if len(parts) >= 2 and parts[0] == "lib":
        return parts[1]  # ex: lib/drilling/foo.ts -> drilling
    if len(parts) >= 2 and parts[0] == "components":
        return "components/" + parts[1]
    if len(parts) >= 1:
        return parts[0] if parts[0] != "lib" else "(lib-root)"
    return "(root)"


def is_allowed(rel: Path) -> bool:
    rel_posix = rel.as_posix()
    if rel in ALLOWED:
        return True
    if rel_posix.endswith(".test.ts") or rel_posix.endswith(".test.tsx"):
        return True
    # Toute la couche de données S7 est autorisée.
    if rel_posix.startswith("lib/data/"):
        return True
    if "mock" in rel_posix.lower() or ".mock." in rel_posix.lower():
        return True
    return False


def is_js_false_positive(line: str, op: str, prev_lines: list) -> bool:
    CHAIN = (".from(", ".eq(", ".in(", ".match(", ".select(", ".rpc(")
    context = " ".join(prev_lines + [line])
    has_chain = any(c in context for c in CHAIN)
    if op == "delete":
        if re.search(r"\b(set|Set|Map|map|weakset|WeakSet)\.delete\s*\(", line):
            return True
        if "new Set" in line or "new Map" in line:
            return True
        if not has_chain and re.search(r"[a-zA-Z_]\.delete\s*\(", line):
            return True
    if op == "update":
        if re.search(r"\b(setState|forceUpdate|useUpdate)\b", line):
            return True
        if not has_chain and re.search(r"[a-zA-Z_]\.update\s*\(", line):
            return True
    if op == "rpc":
        # .rpc( est presque toujours supabase ; on ne filtre pas.
        return False
    return False


def scan():
    results = []
    total_files = 0
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix not in (".ts", ".tsx"):
            continue
        rel = path.relative_to(ROOT)
        if is_allowed(rel):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        total_files += 1
        lines = text.splitlines()
        for i, line in enumerate(lines, 1):
            prev = lines[max(0, i - 3):i - 1] if i > 1 else []
            for m in RE_WRITE.finditer(line):
                op = m.group(1)
                if is_js_false_positive(line, op, prev):
                    continue
                stripped = line.strip()
                if stripped.startswith("type ") or stripped.startswith("interface "):
                    continue
                results.append({
                    "module": module_of(rel),
                    "file": rel.as_posix(),
                    "line": i,
                    "op": op,
                    "snippet": stripped[:100],
                })
    return results, total_files


def summarize(results):
    by_module = defaultdict(lambda: defaultdict(int))
    by_op = defaultdict(int)
    by_file = defaultdict(int)
    for r in results:
        by_module[r["module"]][r["op"]] += 1
        by_op[r["op"]] += 1
        by_file[r["file"]] += 1
    return by_module, by_op, by_file


def print_report(results, total_files):
    by_module, by_op, by_file = summarize(results)
    print(f"Fichiers scannés (hors couche S7/tests) : {total_files}")
    print(f"Total écritures directes détectées : {len(results)}")
    print(f"  insert={by_op['insert']} update={by_op['update']} upsert={by_op['upsert']} "
          f"delete={by_op['delete']} rpc={by_op['rpc']}")
    print()
    print("=== Par module (écritures directes) ===")
    for mod in sorted(by_module, key=lambda m: -sum(by_module[m].values())):
        ops = by_module[mod]
        total = sum(ops.values())
        ops_str = ", ".join(f"{o}={ops[o]}" for o in ["insert", "update", "upsert", "delete", "rpc"] if ops[o])
        print(f"  {mod:26} {total:3}  ({ops_str})")
    print()
    print("=== Top 15 fichiers ===")
    for f, n in sorted(by_file.items(), key=lambda x: -x[1])[:15]:
        print(f"  {n:3}  {f}")


def write_json(results, total_files):
    by_module, by_op, by_file = summarize(results)
    out = REPO / "scripts" / "p1_inventory.json"
    out.write_text(json.dumps({
        "total_files_scanned": total_files,
        "total_direct_writes": len(results),
        "by_op": dict(by_op),
        "by_module": {m: dict(o) for m, o in by_module.items()},
        "rows": results,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Détails : {out}")


def baseline_payload(results, total_files):
    _, by_op, by_file = summarize(results)
    return {
        "_comment": "Garde P1.1 : baseline des écritures directes hors couche S7. "
                    "La dette ne peut que DIMINUER — mettez à jour avec "
                    "`python3 scripts/inventory_writes.py --update-baseline` "
                    "uniquement après avoir migré des écritures.",
        "total_direct_writes": len(results),
        "by_op": dict(by_op),
        "by_file": dict(sorted(by_file.items())),
    }


def cmd_update_baseline(results, total_files):
    BASELINE.write_text(
        json.dumps(baseline_payload(results, total_files), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Baseline mis à jour : {BASELINE} (total={len(results)})")


def cmd_check(results, total_files):
    if not BASELINE.exists():
        print(f"❌ Baseline absent ({BASELINE}). Créez-le avec --update-baseline.")
        return 1
    base = json.loads(BASELINE.read_text(encoding="utf-8"))
    base_total = base.get("total_direct_writes", 0)
    base_by_file = base.get("by_file", {})
    _, _, by_file = summarize(results)
    cur_total = len(results)

    print(f"Écritures directes — baseline={base_total}, courant={cur_total}")
    if cur_total > base_total:
        print(f"❌ GARDE P1.1 : la dette a AUGMENTÉ (+{cur_total - base_total}).")
        # Détail des fichiers responsables.
        for f in sorted(by_file):
            delta = by_file[f] - base_by_file.get(f, 0)
            if delta > 0:
                print(f"   +{delta}  {f}")
        for f in sorted(set(by_file) - set(base_by_file)):
            print(f"   NOUVEAU FICHIER  {f}  ({by_file[f]})")
        print("\nToute écriture doit passer par la couche de données S7 "
              "(src/lib/data/*) ou le routeur.")
        return 1
    if cur_total < base_total:
        print(f"✅ La dette a DIMINUÉ (-{base_total - cur_total}). "
              f"Pensez à `--update-baseline` pour figer le nouveau plancher.")
    else:
        print("✅ GARDE P1.1 : la dette n'augmente pas.")
    return 0


def main():
    args = set(sys.argv[1:])
    results, total_files = scan()

    if "--update-baseline" in args:
        cmd_update_baseline(results, total_files)
        return 0
    if "--check" in args:
        return cmd_check(results, total_files)

    print_report(results, total_files)
    if "--json" in args:
        write_json(results, total_files)
    return 0


if __name__ == "__main__":
    sys.exit(main())
