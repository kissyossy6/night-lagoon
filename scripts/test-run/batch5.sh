#!/bin/sh
SCR=$1
for n in 9 13 16b 17; do echo "=== sc$n"; node scripts/test-run/sc$n.mjs $SCR; done
echo ALLDONE
