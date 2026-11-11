#!/bin/sh
# Stage-1 "nothing changed" capture: both show versions at fixed times + editor + player.
#   sh scripts/stage1-shots.sh shots/stage1/before-1
set -e
OUT=$1
T=10,45,63,67.9,92,106.6,130,163,175.5,178.6,206
node scripts/show-shot.mjs --t=$T --out=$OUT/lagoon
node scripts/show-shot.mjs --t=$T --out=$OUT/fantasia --extra="show=fantasia"
node scripts/look-capture.mjs --out=$OUT/look --autosave=shots/stage1/autosave.json
