#!/usr/bin/env python3
"""Synchronise `repositoryName` de package.json avec la version du dépôt.

Le nom affiché par Paperback est le `repositoryName` du projet (recopié dans le
titre de `bundles/index.html`). On le dérive de `version` pour éviter toute
désynchronisation :  version "0.1.0"  ->  "ATC's Extensions (0.1)".

Usage : python3 tools/sync_repo_name.py
"""
import json
import pathlib
import sys

PREFIX = "ATC's Extensions"
PKG = pathlib.Path(__file__).resolve().parent.parent / "package.json"


def main() -> int:
    data = json.loads(PKG.read_text(encoding="utf-8"))
    version = str(data.get("version", "")).strip()
    if not version:
        print("package.json : champ 'version' absent", file=sys.stderr)
        return 1

    short = ".".join(version.split(".")[:2]) or version
    name = f"{PREFIX} ({short})"

    if data.get("repositoryName") != name:
        data["repositoryName"] = name
        PKG.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"repositoryName -> {name}")
    else:
        print(f"repositoryName déjà à jour : {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
