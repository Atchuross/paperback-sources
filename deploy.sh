#!/usr/bin/env bash
# Prépare les sources Paperback et gère la publication.
#
#   ./deploy.sh "message"                        -> reconstruit + commit LOCAL (préprod).
#   ./deploy.sh --prod "message"                 -> idem + git push (PROD GitHub Pages).
#   ./deploy.sh --bump minor  "message"          -> ajout d'une source (0.1.0 -> 0.2.0)
#   ./deploy.sh --bump patch  "message"          -> modification d'une source (0.1.0 -> 0.1.1)
#   ./deploy.sh --bump major  "message"          -> refonte (0.1.0 -> 1.0.0)
#   ./deploy.sh --prod --bump minor "message"    -> incrémente PUIS publie
#
# RÈGLE DU PROJET : toute modification de `src/` exige un incrément de version du
# dépôt. Le script REFUSE de continuer si des sources ont changé sans `--bump`
# (sauf `--no-bump` explicite).
#
# ⚠️  --prod ne doit être utilisé qu'APRÈS validation par l'utilisateur sur son
#     iPhone, en local. Aucun push sans sa demande explicite.
set -euo pipefail
cd "$(dirname "$0")"

PUSH=0
BUMP=""
NO_BUMP=0
while [ $# -gt 0 ]; do
  case "${1:-}" in
    --prod)    PUSH=1; shift ;;
    --bump)    BUMP="${2:-}"; [ -n "$BUMP" ] || { echo "--bump exige major|minor|patch" >&2; exit 1; }; shift 2 ;;
    --no-bump) NO_BUMP=1; shift ;;
    --)        shift; break ;;
    -*)        echo "option inconnue : $1" >&2; exit 1 ;;
    *)         break ;;
  esac
done
MSG="${1:-Mise a jour des sources Paperback}"

# --- Règle A : toute modification de src/ => bump MINOR automatique ----------
if [ -z "$BUMP" ] && [ "$NO_BUMP" -eq 0 ] && [ -n "$(git status --porcelain -- src 2>/dev/null)" ]; then
  echo "→ Sources modifiées détectées : incrément de version automatique (minor)."
  BUMP="minor"
fi

if [ -n "$BUMP" ]; then
  echo "→ Incrément de version ($BUMP)…"
  python3 tools/bump_version.py "$BUMP"
fi

# Adresse du dépôt (pour le bouton « Add to Paperback » de la page d'accueil).
if [ -z "${GITHUB_REPOSITORY:-}" ]; then
  GITHUB_REPOSITORY="$(git remote get-url origin 2>/dev/null \
    | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
fi

echo "→ Synchronisation du nom du dépôt avec la version…"
python3 tools/sync_repo_name.py

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
  echo "     ./deploy.sh --prod --bump patch \"$MSG\""
fi
