#!/usr/bin/env python3
"""Incrémente la version du dépôt (package.json).

Convention du projet ATC's Extensions :
  - ajout d'une source        ->  ./deploy.sh --bump minor
  - modification d'une source ->  ./deploy.sh --bump patch
  - refonte / rupture         ->  ./deploy.sh --bump major

Usage : python3 tools/bump_version.py <major|minor|patch>
"""
import json
import pathlib
import sys

PKG = pathlib.Path(__file__).resolve().parent.parent / "package.json"


def bump(version: str, kind: str) -> str:
    parts = (version.split(".") + ["0", "0", "0"])[:3]
    try:
        major, minor, patch = (int(p) for p in parts)
    except ValueError:
        raise SystemExit(f"version illisible dans package.json : {version!r}")

    if kind == "major":
        major, minor, patch = major + 1, 0, 0
    elif kind == "minor":
        minor, patch = minor + 1, 0
    elif kind == "patch":
        patch += 1
    else:
        raise SystemExit(f"type d'incrément inconnu : {kind!r} (major|minor|patch)")
    return f"{major}.{minor}.{patch}"


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    kind = sys.argv[1]

    data = json.loads(PKG.read_text(encoding="utf-8"))
    old = str(data.get("version", "0.0.0"))
    new = bump(old, kind)
    data["version"] = new
    PKG.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"version du dépôt : {old} -> {new} ({kind})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
