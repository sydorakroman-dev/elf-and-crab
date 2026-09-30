#!/usr/bin/env bash
# Builds the game and publishes dist/ to the gh-pages branch (served by GitHub Pages).
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE=$(git remote get-url origin)
npm run build
cd dist
touch .nojekyll
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -qm "Deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -qf "$REMOTE" gh-pages
rm -rf .git
echo "Deployed to gh-pages."
