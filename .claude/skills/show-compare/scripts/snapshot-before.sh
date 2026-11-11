#!/bin/sh
# Copy the code as it is NOW, so "今" can be shot from the real before-state
# while you change the renderer / engine. Served on port 5299 by the launch
# config "water-show-v2-before" (preview_start), next to the normal 5199.
#
#   sh .claude/skills/show-compare/scripts/snapshot-before.sh [<topic>]
#
# Writes backups/_before/ (replaced each time; public/ and node_modules are
# links, so it is small) and, with <topic>, also a dated keep-copy of src/ in
# backups/<date>-<topic>/src (the project's backup rule: it is not a git repo).
set -e
cd "$(dirname "$0")/../../../.."
[ -f package.json ] && [ -d src ] || { echo "run inside water-show_v2" >&2; exit 1; }
B=backups/_before
rm -rf "$B"
mkdir -p "$B"
cp -R src scripts "$B"/
cp ./*.html vite.config.ts tsconfig.json package.json "$B"/
ln -s ../../public "$B/public"
ln -s ../../node_modules "$B/node_modules"
echo "snapshot: $B ($(du -sh "$B" | cut -f1)) — serve with preview_start \"water-show-v2-before\" → http://localhost:5299"
if [ -n "$1" ]; then
  K="backups/$(date +%Y-%m-%d)-$1"
  mkdir -p "$K"
  cp -R src "$K"/
  echo "keep-copy: $K/src"
fi
