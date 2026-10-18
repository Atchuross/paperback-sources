#!/usr/bin/env bash
# Prépare les sources Paperback et gère la publication.
#
#   ./deploy.sh "message"          -> reconstruit + copie vers docs/ + commit LOCAL.
#                                     NE POUSSE PAS. (mode par défaut = PRÉPROD)
#   ./deploy.sh --prod "message"   -> idem + git push (mise en PROD sur GitHub Pages).
#
# ⚠️  --prod ne doit être utilisé qu'APRÈS validation par l'utilisateur sur son
#     iPhone, en local. Aucun push sans sa demande explicite.
set -euo pipefail
cd "$(dirname "$0")"

PUSH=0
if [ "${1:-}" = "--prod" ]; then PUSH=1; shift; fi
MSG="${1:-Mise a jour des sources Paperback}"

# Adresse du dépôt (pour le bouton « Add to Paperback » de la page d'accueil).
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

echo "→ Copie vers docs/ (dossier publié par GitHub Pages)…"
rm -rf docs
cp -R bundles docs

echo "→ Commit local…"
git add -A
if git diff --cached --quiet; then
  echo "   (aucun changement)"
else
  git commit -m "$MSG"
fi

if [ "$PUSH" -eq 1 ]; then
  echo "→ PUSH vers GitHub (PROD)…"
  git push
  echo
  echo "✅ Publié en PROD — GitHub Pages se met à jour en ~1 minute."
  echo "   URL Paperback : https://atchuross.github.io/paperback-sources"
else
  echo
  echo "⏸️  NON PUBLIÉ (mode PRÉPROD, c'est voulu)."
  echo "   Tester d'abord en local sur l'iPhone :"
  echo "     cd bundles && python3 -m http.server 8080 --bind 0.0.0.0"
  echo "   Puis, après validation seulement :"
  echo "     ./deploy.sh --prod \"$MSG\""
fi
