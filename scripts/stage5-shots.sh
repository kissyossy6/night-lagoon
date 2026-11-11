#!/bin/sh
# Stage-5 "the 3D did not change" capture: the three versions at the times of
# shots/stage4/same.  sh scripts/stage5-shots.sh shots/stage5/same-after
set -e
OUT=$1
# optional URL extras for every shot, e.g. gfx=off (stage 7: the old look)
EXTRA=${2:-}
T=10,45,63,67.9,92,106.6,130,163,175.5,178.6,206
node scripts/show-shot.mjs --t=$T --out=$OUT/lagoon --extra="$EXTRA"
node scripts/show-shot.mjs --t=$T --out=$OUT/fantasia --extra="show=fantasia&$EXTRA"
node scripts/hanabi-shots.mjs --shows=hanabi --t=161.8,162.9,167.3,169.9,171.2,172.9,174,175.2,177.6,179,182.6,183.9,202,203.2,204.4,206.4,207.4 --out=$OUT/hanabi --extra="$EXTRA"
