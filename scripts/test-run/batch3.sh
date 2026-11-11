#!/bin/sh
SCR=$1
for n in 1b 7 9 10 11 12 14 15; do echo "=== sc$n"; node scripts/test-run/sc$n.mjs $SCR; done
echo "=== sc13"; node scripts/test-run/sc13.mjs $SCR
echo ALLDONE
