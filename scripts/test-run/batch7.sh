#!/bin/sh
SCR=$1
for n in 13 6; do echo "=== sc$n"; node scripts/test-run/sc$n.mjs $SCR; done
echo ALLDONE
