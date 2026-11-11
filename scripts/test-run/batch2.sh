#!/bin/sh
# sc9 は書き出したファイルを置く一時フォルダを受け取る
SCR="${TMPDIR:-/tmp}/water-show-test"; mkdir -p "$SCR"
for n in 3 5 1b 7 8; do echo "=== sc$n"; node scripts/test-run/sc$n.mjs; done
echo "=== sc9"; node scripts/test-run/sc9.mjs "$SCR"
echo "=== sc10"; node scripts/test-run/sc10.mjs
echo ALLDONE
