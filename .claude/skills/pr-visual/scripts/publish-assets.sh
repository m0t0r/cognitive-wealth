#!/usr/bin/env bash
# Publishes a PR's rendered charts and diagrams (*.light.svg, *.dark.svg, *.mmd) to the orphan
# `pr-assets` branch under pr-<n>/, through a temporary worktree, and prints the raw base URL to
# link them by commit (a commit URL never changes under a PR body that's already published).
#
#   publish-assets.sh <pr-number> <dir>
#
# Screenshots and recordings don't go here: they go through the before-and-after skill
# (`gh pr edit --attach`), which uploads them to GitHub's own attachment storage.
set -euo pipefail

pr=${1:?usage: publish-assets.sh <pr-number> <dir>}
src=$(cd "${2:?usage: publish-assets.sh <pr-number> <dir>}" && pwd)
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
tree=$(mktemp -d)
trap 'git -C "$main" worktree remove --force "$tree" >/dev/null 2>&1 || true' EXIT

git -C "$main" fetch --quiet origin pr-assets 2>/dev/null || true
if git -C "$main" rev-parse --verify --quiet origin/pr-assets >/dev/null; then
  git -C "$main" worktree add --quiet --detach "$tree" origin/pr-assets
else
  git -C "$main" worktree add --quiet --detach "$tree"
  git -C "$tree" checkout --quiet --orphan pr-assets-new
  git -C "$tree" rm -rf --quiet . >/dev/null
fi

mkdir -p "$tree/pr-$pr"
shopt -s nullglob
files=("$src"/*.light.svg "$src"/*.dark.svg "$src"/*.mmd)
[ ${#files[@]} -gt 0 ] || { echo "Nothing to publish in $src" >&2; exit 1; }
cp "${files[@]}" "$tree/pr-$pr/"

git -C "$tree" add "pr-$pr"
if git -C "$tree" diff --cached --quiet; then
  sha=$(git -C "$tree" rev-parse HEAD)
else
  git -C "$tree" commit --quiet -m "pr-$pr: charts and diagrams"
  sha=$(git -C "$tree" rev-parse HEAD)
  git -C "$tree" push --quiet origin "HEAD:refs/heads/pr-assets"
fi

echo "https://raw.githubusercontent.com/$repo/$sha/pr-$pr"
