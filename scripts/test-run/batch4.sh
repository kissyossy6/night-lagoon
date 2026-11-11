#!/bin/sh
SCR=$1
for n in 7 9 12 13 14; do echo "=== sc$n"; node scripts/test-run/sc$n.mjs $SCR; done
for n in 16 17; do echo "=== sc$n"; node scripts/test-run/sc$n.mjs $SCR; done
echo "=== sc18"; node scripts/test-run/sc18.mjs
echo ALLDONE
