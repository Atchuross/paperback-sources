#!/usr/bin/env bash
# Regénère les sources et publie le dossier `docs/` (servi par GitHub Pages).
#
# Usage : ./deploy.sh ["message de commit"]
#
# - reconstruit `bundles/` via la toolchain Paperback
# - recopie `bundles/` -> `docs/` (c'est `docs/` que GitHub Pages publie)
# - commit + push sur `main`
set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-Mise a jour des sources Paperback}"

# Adresse du depot (pour le bouton « Add to Paperback » de la page d'accueil).
if [ -z "${GITHUB_REPOSITORY:-}" ]; then
  GITHUB_REPOSITORY="$(git remote get-url origin 2>/dev/null \
    | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
fi

echo "→ Construction des sources…"
if [ -n "${GITHUB_REPOSITORY:-}" ]; then
  GITHUB_REPOSITORY="$GITHUB_REPOSITORY" ./node_modules/.bin/paperback bundle
else
  ./node_modules/.bin/paperback bundle
fi

echo "→ Copie vers docs/…"
rm -rf docs
cp -R bundles docs

echo "→ Commit + push…"
git add -A
if git diff --cached --quiet; then
  echo "Aucun changement à publier."
else
  git commit -m "$MSG"
fi
git push

echo
echo "Publié. URL du depot pour Paperback :"
echo "  https://<ton-pseudo>.github.io/<nom-du-depot>   (sans slash final)"
