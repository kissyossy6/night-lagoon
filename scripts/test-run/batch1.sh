#!/bin/sh
for n in 1b 2 4 5 3; do echo "=== sc$n"; node scripts/test-run/sc$n.mjs; done
