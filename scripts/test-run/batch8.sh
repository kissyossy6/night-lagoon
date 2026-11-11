#!/bin/sh
# sc13 は書き出したファイルを置く一時フォルダを受け取る
SCR="${TMPDIR:-/tmp}/water-show-test"; mkdir -p "$SCR"
for n in 13 10; do echo "=== sc$n"; node scripts/test-run/sc$n.mjs "$SCR"; done
echo ALLDONE
