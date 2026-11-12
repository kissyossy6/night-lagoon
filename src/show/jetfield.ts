import * as THREE from 'three';
import { HASH, LIGHT, PHYSICS } from '../core/glsl';
import { TYPE_ID } from '../core/nozzles';
import { STREAK_FS, coverageBlend } from '../techniques/particles';
import { STRAND_FS } from '../techniques/strands';
import { Haze } from './haze';
import { HISTORY_GLSL, RATE, type ParamHistory } from './history';
import { drawScale, type Layout } from './layout';
import { Impact, type ImpactOptions } from '../techniques/impact';
import type { NozzleSpec } from '../core/nozzles';

/**
 * All fountains of the show, drawn with method E (docs/lab-analysis.md):
 * a thin glassy column ribbon per sub-jet, streak particles for spray and
 * aerated water, and cloud sprites for mist.
 *
 * Every frame two GPU passes evaluate the water into float textures (one
 * texel per particle, one texel per ribbon sample): position, colour and
 * coverage. The draw passes only read those textures, so the water-surface
 * reflection reuses the evaluation instead of repeating it.
 */

export const PW = 1024; // particle eval texture width
/** Rows of the fixture table (FIX_GLSL). */
const ROWS = 8;

/**
 * How hard a fixture's water comes down, and the ripples it makes (row 7).
 * Strength follows the flow, Q = area × √(2gh) × jets, against what a jet of
 * its size would carry (Froude scaling, Q ∝ L^2.5), so a desk jet and a
 * lagoon jet foam alike for their size. Ripples: about 0.7 m across at the
 * lagoon, down to the 1.7 cm of capillary ripples.
 */
function impactShape(s: NozzleSpec, size: number): [number, number, number, number] {
  const q = Math.PI * 0.25 * s.bore * s.bore * Math.sqrt(2 * 9.81 * s.height) * s.jets;
  // small water churns less white: a desk jet's foam is a few bubbles
  const strength = Math.min(3, Math.max(0.3, Math.pow(q / Math.pow(size, 2.5) / 0.05, 0.35))) * (0.25 + 0.75 * size);
  return [strength, Math.max(0.017, 0.7 * size), 0, 0];
}
const SEG = 64; // ribbon segments
export const SHUTTER = 1 / 30;
/** How fast a change of the ring's light climbs the water column (m/s), and its longest delay (s). */
const LIGHT_CLIMB_MS = 45;
const LIGHT_CLIMB_MAX_S = 1.0;

export const FIX_GLSL = /* glsl */ `
uniform highp sampler2D uFix;
// drawn sizes of small fixtures (row 6). Compiled in only when the venue has
// fixtures under 10 m, so the lagoon's shaders stay exactly as they were
#ifdef SIZED
#define SIZE(v, s) ((v) * (s))
#else
#define SIZE(v, s) (v)
#endif
uniform float uTime;
uniform vec3  uCam;
uniform int   uLightModel;

// Rows of the fixture table, one column per fixture:
//   0 origin.xyz, type   1 height, bore, aeration, break-up
//   2 spread, jets, turb, kDrop   3 type params
//   4 beam half-angle, candela, life, slot span   5 kCol, kMist, beam length
//   6 drawn size, drop size (layout.ts drawScale: 1 for every lagoon fixture)
//   7 impact strength, ripple wavelength (techniques/impact.ts), head turns (1/0)
Fix loadFix(int f, out float life, out float span) {
  vec4 a = texelFetch(uFix, ivec2(f, 0), 0);
  vec4 b = texelFetch(uFix, ivec2(f, 1), 0);
  vec4 c = texelFetch(uFix, ivec2(f, 2), 0);
  vec4 p = texelFetch(uFix, ivec2(f, 3), 0);
  vec4 e = texelFetch(uFix, ivec2(f, 4), 0);
  vec4 g = texelFetch(uFix, ivec2(f, 5), 0);
  Fix fx;
  fx.origin = a.xyz;
  fx.type = int(a.w);
  fx.height = b.x;
  fx.bore = b.y;
  fx.aer = b.z;
  fx.brk = b.w;
  fx.spread = c.x;
  fx.jets = c.y;
  fx.turb = c.z;
  fx.kDrop = c.w;
  fx.p = p;
  fx.beam = e.x;
  fx.candela = e.y;
  fx.kCol = g.x;
  fx.kMist = g.y;
  fx.beamLen = g.z;
  fx.fadeLen = g.w;
  vec4 h6 = texelFetch(uFix, ivec2(f, 6), 0);
  fx.fallFade = h6.z;
  fx.guide = h6.w;
  life = e.z;
  span = e.w;
  return fx;
}

// Nozzle state of fixture f at time tt, for sub-jet 'jet'. Returns pressure.
// Only a head that turns leans with pan / tilt (row 7 z, Fixture.turns from
// the fixture table: the whips and the lagoon's fans). A grid jet, a geyser,
// a chaser, a mist line and the garden's small fixed fan stand upright, so
// pan / tilt cues do not lean them (a fixed pump on the desk cannot lean its
// water, 2026-11-12). Rings stay upright and use the tilt channel to open
// outward (bloom).
float nozzleAt(Fix fx, int f, float tt, float jet, out vec3 base, out vec3 dir) {
  vec4 s = histAt(uHistA, f, tt);
  bool ring = fx.type == 4;
  bool turns = texelFetch(uFix, ivec2(f, 7), 0).z > 0.5;
  vec3 head = turns ? headDir(s.y, s.z) : vec3(0.0, 1.0, 0.0);
  subJet(fx, head, ring ? s.z : 0.0, jet, base, dir);
  return s.x;
}

vec3 lightAt(int f, float tt) {
  vec4 b = histAt(uHistB, f, tt);
  return b.rgb * b.a;
}

// Radiance of drop d under fixture f's LED ring as it is now.
vec3 shade(Drop d, Fix fx, int f) {
  vec3 ringPos, ringAxis;
  // a fan has one ring around the whole nozzle: its axis is the centre line
  nozzleAt(fx, f, uTime, fx.type == 3 ? (fx.jets - 1.0) * 0.5 : d.jet, ringPos, ringAxis);
  // The ring lights the water from below, through the column: a change of
  // colour or brightness climbs from the nozzle along the water's path to
  // the tip (~0.7 s up a 30 m whip, the hanging end last) instead of
  // lighting it end to end at once, which read as a switch, not as a lamp
  // (the user, 2026-10-27; 90 m/s was still too quick for the tall arcs)
  float climb = min(pathFrom(d) / ${LIGHT_CLIMB_MS.toFixed(1)}, ${LIGHT_CLIMB_MAX_S.toFixed(2)});
  return shadeDrop(d, fx, ringPos, ringAxis, lightAt(f, uTime - climb), uLightModel, uCam);
}

// How far a sample of water d (sent up at tb) is from the head of rising
// water: 1 in a running stream, 0 at the head. Water sent up later, and
// faster, catches up with the water ahead of it, so at the head the older
// water lies beside or behind it, or there is none yet (the valve was
// shut); along a running stream, also one that sweeps or opens, it lies as
// far ahead as the stream moves. Looked 1, 2.5 and 5 m ahead (scaled by the
// fixture's drawn size L), so the head fades over the top few metres, not
// in a cut; jit (0..1) moves each sample's edge so it frays. Only water
// still going up has a head: falling water whose streams cross (a flower
// opening, a whip turning) is real water all the way down. Shared by the
// ribbons and the drops, so both end in the same place (2026-11-08)
float headOf(Fix fx, int f, float tb, float jet, vec4 r, vec3 kick, Drop d, float L, float jit, float coreBias) {
  float head = 1.0;
  // a low column, just starting to rise, has only a short head: the
  // distances shrink with how far the water has come (full past 10 m), so
  // a column a metre or two high stays a soft lump of water instead of
  // fading out whole (2026-11-08)
  float reach = clamp(pathFrom(d) / (10.0 * L), 0.1, 1.0);
  for (int k = 0; k < 3; k++) {
    float dA = L * reach * (k == 0 ? 1.0 : k == 1 ? 2.5 : 5.0) * (0.85 + 0.3 * jit) / max(length(d.v), 2.0);
    vec3 base2, dir2;
    float press2 = nozzleAt(fx, f, tb - dA, jet, base2, dir2);
    Drop dn = dropFrom(fx, base2, dir2, press2, jet, r, kick, d.age + dA, coreBias);
    vec3 ahead = dn.p - d.p;
    float flow = press2 < 0.02 || dn.alive < 0.5 ? 0.0 : dot(ahead, d.v) / max(dot(d.v, d.v) * dA, 1e-4);
    float hk = smoothstep(0.15, 0.6, flow);
    head *= k == 0 ? hk : k == 1 ? mix(0.35, 1.0, hk) : mix(0.7, 1.0, hk);
  }
  return mix(1.0, head, smoothstep(-0.5, 1.0, d.v.y));
}
`;

export const EVAL_VS = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// ------------------------------------------------------------ particles
const PARTICLE_EVAL_FS = /* glsl */ `
precision highp float;
precision highp int;
${HASH}
${PHYSICS}
${LIGHT}
${HISTORY_GLSL}
${FIX_GLSL}
uniform highp sampler2D uSlots; // fixture, slot, slots of this fixture, kind (0 spray, 1 mist)
layout(location = 0) out vec4 oHead; // position, coverage (0 = dead)
layout(location = 1) out vec4 oTail; // position one shutter earlier, world size
layout(location = 2) out vec4 oCol;  // radiance, kind + seed / 2

void main() {
  oHead = vec4(0.0);
  oTail = vec4(0.0);
  oCol = vec4(0.0);
  vec4 sl = texelFetch(uSlots, ivec2(gl_FragCoord.xy), 0);
  if (sl.z < 0.5) return;
  int f = int(sl.x);
  float k = sl.y;
  bool mist = sl.w > 0.5;
  float life, span;
  Fix fx = loadFix(f, life, span);
  vec4 sz = texelFetch(uFix, ivec2(f, 6), 0);
  bool continuous = span >= life * 0.99;
  if (mist) {
    life *= 1.3;
    if (continuous) span = life;
  }
  // slots are evenly spaced in emitted water M, not in time
  float mNow = histAt(uHistA, f, uTime).w;
  float phi = (k + 0.5) / sl.z;
  float n = floor(mNow / span - phi);
  float mb = (n + phi) * span;
  if (mb <= 0.0) return;
  float tb = birthTime(f, mb);
  float age = uTime - tb;
  if (age < 0.0 || age > life) return;

  uint seed = uint(f) * 7919u + uint(k) * 104729u + uint(int(n) + 4096) * 6271u;
  vec4 r = rnd4(seed);
  vec3 kick = kickDir(seed);
  float jet = min(floor(r.x * fx.jets), fx.jets - 1.0);
  vec3 base, dir;
  float press = nozzleAt(fx, f, tb, jet, base, dir);
  Drop d = dropFrom(fx, base, dir, press, jet, r, kick, age, mist ? 1.6 : 0.6);
  if (d.alive < 0.5) return;

  vec3 tail = d.p;
  float cov, size;
  if (mist) {
    cov = 0.05 * smoothstep(0.0, 1.2, age) * (1.0 - smoothstep(life * 0.45, life, age));
    // capped: the geyser's wide bore would otherwise blow its mist up into
    // screen-filling sprites (fill rate, not looks, is the limit there)
    size = 0.8 * min(sqrt(fx.bore / 0.06), 2.45) * (0.5 + age * 0.6);
    size = SIZE(size, sz.x);
  } else {
    // aerated drops ride along the column and give it body
    cov = 0.55 * (d.coh > 0.5 ? 0.25 + 0.5 * fx.aer : 1.0);
    size = SIZE(0.035 * mix(0.5, 1.4, d.core), sz.y);
    tail = dropFrom(fx, base, dir, press, jet, r, kick, max(age - ${SHUTTER.toFixed(5)}, 0.0), 0.6).p;
    // At the head of rising water (headOf) the drops of the core, all on
    // its axis, stood as a thin line where the ribbons had faded (the user,
    // 2026-11-08): there they scatter into a loose puff, with no motion
    // streak (a dashed line is still a line)
    {
      float head = headOf(fx, f, tb, jet, r, kick, d, sz.x, r.w, 0.6);
      vec3 off = kick * (1.0 - head) * SIZE(0.8 + 1.4 * fx.aer, sz.x) * (0.3 + 0.7 * r.z);
      tail = mix(d.p, tail, head) + off;
      d.p += off;
      cov *= mix(0.3, 1.0, head);
    }
  }
  oHead = vec4(d.p, cov);
  oTail = vec4(tail, size);
  oCol = vec4(shade(d, fx, f), (mist ? 1.0 : 0.0) + 0.5 * rnd(seed + 5u));
}
`;

export const PARTICLE_DRAW_VS = /* glsl */ `
attribute vec2 corner; // x: 0 tail .. 1 head, y: -1 .. 1 across
attribute vec2 aTexel;
uniform highp sampler2D uHead;
uniform highp sampler2D uTail;
uniform highp sampler2D uCol;
uniform float uPx;
uniform vec2 uViewport;
varying vec3 vCol;
varying float vA;
varying vec2 vUv;
varying float vSeed;
varying float vMist;
void main() {
  ivec2 tx = ivec2(aTexel);
  vec4 h = texelFetch(uHead, tx, 0);
  if (h.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 tl = texelFetch(uTail, tx, 0);
  vec4 c = texelFetch(uCol, tx, 0);
  bool mist = c.w >= 1.0;
  vec4 c1 = projectionMatrix * viewMatrix * vec4(h.xyz, 1.0);
  vec4 c0 = mist ? c1 : projectionMatrix * viewMatrix * vec4(tl.xyz, 1.0);
  vec2 s1 = c1.xy / c1.w * 0.5 * uViewport;
  vec2 s0 = c0.xy / c0.w * 0.5 * uViewport;
  vec2 dir = s1 - s0;
  float len = length(dir);
  dir = len > 1e-3 ? dir / len : vec2(0.0, 1.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float wPx = tl.w * uPx / max(c1.w, 0.1);
  float wDraw = max(wPx, 1.2);
  // energy-conserving coverage: sub-pixel drops get fainter, not bigger,
  // and motion blur spreads one drop over its streak
  vA = h.w * min(wPx / 1.2, 1.0) * wDraw / (len + wDraw);
  vec2 sp = mix(s0, s1, corner.x) + dir * (corner.x * 2.0 - 1.0) * wDraw * 0.5 + nrm * corner.y * wDraw * 0.5;
  vec4 cc = mix(c0, c1, corner.x);
  gl_Position = c1.w < 0.1 ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(sp / (0.5 * uViewport) * cc.w, cc.z, cc.w);
  vCol = c.rgb;
  vUv = vec2(corner.x * 2.0 - 1.0, corner.y);
  vSeed = fract(c.w) * 19946.0;
  vMist = mist ? 1.0 : 0.0;
}
`;

// -------------------------------------------------------------- ribbons
const STRAND_EVAL_FS = /* glsl */ `
precision highp float;
precision highp int;
${HASH}
${PHYSICS}
${LIGHT}
${HISTORY_GLSL}
${FIX_GLSL}
uniform highp sampler2D uStrands; // fixture, sub-jet, id
layout(location = 0) out vec4 oPos;  // position, coverage
layout(location = 1) out vec4 oCol;  // radiance, world width
layout(location = 2) out vec4 oInfo; // birth time, coherent, aeration

void main() {
  oPos = vec4(0.0);
  oCol = vec4(0.0);
  oInfo = vec4(0.0);
  int seg = int(gl_FragCoord.x);
  vec4 st = texelFetch(uStrands, ivec2(0, int(gl_FragCoord.y)), 0);
  if (st.w < 0.5) return;
  int f = int(st.x);
  float jet = st.y;
  float id = st.z;
  float life, span;
  Fix fx = loadFix(f, life, span);
  float L = texelFetch(uFix, ivec2(f, 6), 0).x;
  float x = float(seg) / ${SEG.toFixed(1)};
  float age = life * (x * x * 0.85 + x * 0.15); // denser near the nozzle
  float tb = uTime - age;
  // fixed randoms per ribbon that drift smoothly along the stream
  vec4 fixedR = rnd4(uint(id) * 31u + 7u);
  vec4 sm = smooth4(id, tb * 0.8);
  vec4 r = vec4(0.0,
    clamp(fixedR.y + (sm.y - 0.5) * 0.12, 0.0, 1.0),
    clamp(fixedR.z + (sm.z - 0.5) * 0.3, 0.0, 1.0),
    fixedR.w + (sm.w - 0.5) * 0.25);
  vec3 kick = normalize(smooth4(id + 5000.0, tb * 1.36).xyz - 0.5 + 1e-4);
  vec3 base, dir;
  float press = nozzleAt(fx, f, tb, jet, base, dir);
  Drop d = dropFrom(fx, base, dir, press, jet, r, kick, age, 0.3);
  float after = max(age - d.tBreak, 0.0);
  // aerated water bulks up as it entrains air, so the column thickens with
  // height instead of staying a glass rod (docs/video-review.md R3)
  float bulk = SIZE(fx.aer * min(age, 2.5) * 0.15, L);
#ifdef SIZED
  float w = 0.11 * fx.bore / 0.06 * (0.6 + 0.4 * press) + bulk + fx.turb * length(d.v) * after * 0.5 + after * 0.15 * L;
#else
  float w = 0.11 * fx.bore / 0.06 * (0.6 + 0.4 * press) + bulk + fx.turb * length(d.v) * after * 0.5 + after * 0.15;
#endif
  if (fx.type == 0) {
    // grid foam jets leave the nozzle already wide and white, and taper as
    // they slow: a flame, not a rod (show footage, docs/video-review.md).
    // Width is set at the nozzle by the air drawn in, not by flight time,
    // so low jets are as thick as tall ones
    float U0 = exitSpeed(max(press, 0.02) * fx.height, fx.kCol);
    float vf = clamp(d.v.y / U0, 0.0, 1.0);
    w = max(w, SIZE(1.05 * fx.aer * mix(0.3, 1.0, vf) * (0.6 + 0.4 * press), L));
  }
  // the column dissolves over a short distance after break-up
  // a column dissolves soon after break-up, but a flower's froth stays a
  // visible stream all the way down its arc, so its time of flight shows:
  // the front runs out when it opens and the tail runs out when it closes
  float dissolve = fx.type == 4 ? 1.6 : 0.25;
  float alive = d.alive * step(0.0, d.p.y + 0.05) * (1.0 - smoothstep(0.0, dissolve, after)) * smoothstep(0.0, 0.05, age);
  // a vertical column collapses at its top: what falls back is spray and
  // mist, not a second rod folded beside the first (R6)
  if (fx.type <= 1) {
    alive *= 1.0 - smoothstep(-2.0, 2.0, -d.v.y);
    // the head of a shot is torn foam, not the flat end of a rod: water from
    // the first quarter second of a burst carries little of the body
    float lead = histAt(uHistA, f, tb - 0.25).x;
    alive *= mix(0.2, 1.0, smoothstep(0.05, 0.5, lead));
  }
  // Common to every kind of water: water full of air is a soft white body,
  // not a glass rod, and the second and later ribbons of a jet are its coat
  // of spray, wider and with no edge. Drawn as thin glassy tubes, each
  // ribbon showed its own bright rims and the ribbons of a jet, on their
  // own slightly different paths, read as a stack of offset outlines (the
  // flower under the moon, the user, 2026-11-08). The whips and the fans
  // below only size their coat; clear water keeps its glassy tube
  bool coatRibbon = st.w > 1.5;
  float aerated = smoothstep(0.2, 0.45, fx.aer);
  float soft = aerated * (coatRibbon ? 1.0 : 0.5);
  if (coatRibbon && fx.type != 2 && fx.type != 3) {
    w *= mix(1.0, 2.0, aerated);
    alive *= mix(1.0, 0.6, aerated);
  }
  if (fx.type == 2) {
    // a whip is a rod only near its nozzle. Aerated, it swells and frays
    // into spray on the way up; by the top of its arc there is no line
    // left, only drops and mist, and what hangs down from it is spray. Kept
    // as one rope to the end, a sweeping whip moved like a ribbon in a
    // dancer's hand (the user and the World of Color footage, 2026-11-06)
    float U0 = exitSpeed(max(press, 0.02) * fx.height, fx.kCol);
    float apexT = U0 / 9.81;
    // the column is a body of foam a good half metre across, not a rod;
    // the other ribbons are its soft coat of spray, metres wide, which
    // swells as it rises (World of Color footage, the user, 2026-11-06)
    bool coat = st.w > 1.5;
    w += SIZE(coat ? 1.4 + fx.aer * age * 2.2 : 0.4 + fx.aer * age * 0.6, L);
    alive *= coat ? 0.9 : 1.0;
    // the coat, wide, fades before the arc turns over: a wide ribbon that
    // turns with the arc folds into a flag at its tip
    alive *= coat ? 1.0 - smoothstep(0.2 * apexT, 0.75 * apexT, age) : 1.0 - smoothstep(0.35 * apexT, 1.0 * apexT, age);
  } else if (fx.type == 3) {
    // a fan is a sheet of the same aerated jets as a whip, smaller: each
    // blade is a soft body with a coat near the nozzle, frays on the way up
    // and is spray by its top. Unlike a whip, a little of a blade's way down
    // stays a line: the outer blades fly far and fall as a visible arc of
    // spray (World of Color footage, the user, 2026-11-06)
    // how much of the blade's climb is left: 1 at the nozzle, 0 at its top,
    // below 0 on the way down
    float climb = d.v.y / max(length(d.v), 0.1) / max(dir.y, 0.2);
    bool coat = st.w > 1.5;
    w += SIZE(coat ? 0.7 + fx.aer * age * 1.2 : 0.2 + fx.aer * age * 0.35, L);
    alive *= coat ? 0.7 : 1.0;
    alive *= coat ? smoothstep(0.3, 0.75, climb) : smoothstep(-0.35, 0.2, climb);
  }
  // the head of rising water (headOf): the ribbon fades there as a whole,
  // its width kept, and the head is left to its drops and mist. A ribbon
  // ending in a cut read as the flat end of a band, a noodle, and one
  // thinning to a point as a spike (the user, 2026-11-08)
  {
    float head = headOf(fx, f, tb, jet, r, kick, d, L, fixedR.x, 0.3);
    alive *= head * head;
  }
  vec3 p = d.p;
  p.y = max(p.y, 0.0);
  oPos = vec4(p, 0.45 * alive);
  oCol = vec4(shade(d, fx, f), w);
  oInfo = vec4(tb, d.coh, fx.aer, soft);
}
`;

const STRAND_DRAW_VS = /* glsl */ `
attribute float aSeg;
attribute float aSide;
attribute float aRow;
uniform highp sampler2D uPos;
uniform highp sampler2D uSCol;
uniform highp sampler2D uInfo;
uniform float uPx;
uniform vec2 uViewport;
varying vec3 vCol;
varying float vA;
varying float vSide;
varying float vTb;
varying float vCoh;
varying float vAer;
varying float vSoft;
void main() {
  int seg = int(aSeg);
  int row = int(aRow);
  vec4 p = texelFetch(uPos, ivec2(seg, row), 0);
  int nb = seg < ${SEG} ? seg + 1 : seg - 1;
  vec4 pn = texelFetch(uPos, ivec2(nb, row), 0);
  vec4 col = texelFetch(uSCol, ivec2(seg, row), 0);
  vec4 info = texelFetch(uInfo, ivec2(seg, row), 0);
  vec4 c = projectionMatrix * viewMatrix * vec4(p.xyz, 1.0);
  vec4 cn = projectionMatrix * viewMatrix * vec4(pn.xyz, 1.0);
  vec2 sp = c.xy / c.w * 0.5 * uViewport;
  vec2 tng = (cn.xy / cn.w * 0.5 * uViewport - sp) * (seg < ${SEG} ? 1.0 : -1.0);
  tng = length(tng) > 1e-4 ? normalize(tng) : vec2(0.0, 1.0);
  vec2 nrm = vec2(-tng.y, tng.x);
  float wPx = col.w * uPx / max(c.w, 0.1);
  float wDraw = max(wPx, 1.3);
  sp += nrm * aSide * wDraw * 0.5;
  gl_Position = c.w < 0.1 ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(sp / (0.5 * uViewport) * c.w, c.z, c.w);
  vCol = col.rgb;
  vA = p.w * min(wPx / 1.3, 1.0);
  vSide = aSide;
  vTb = info.x;
  vCoh = info.y;
  vAer = info.z;
  vSoft = info.w;
}
`;

// The column ribbons' look (techniques/strands.ts) plus a soft profile: 0 is
// the glassy tube, 1 a coat of spray that fades from its middle out with no
// edge (a whip's foam body and its coat, 2026-11-06)
const COLUMN_FS = STRAND_FS.replace('varying float vCoh;', 'varying float vCoh;\nvarying float vSoft;').replace(
  '  a *= vA;',
  `  float fog = (1.0 - u * u) * (1.0 - u * u);
  a = mix(a, fog * mix(0.6, 1.0, vAer), vSoft);
  a *= vA;`,
);

// ------------------------------------------------------------ glow pools
const POOL_VS = /* glsl */ `
${HISTORY_GLSL}
attribute float aFix;
uniform float uTime;
varying vec3 vCol;
varying vec2 vUv;
void main() {
  int f = int(aFix);
  vec4 a = histAt(uHistA, f, uTime);
  vec4 b = histAt(uHistB, f, uTime);
  // running water at the nozzle foot scatters the ring light into a pool
  // white water lit by the ring: its brightness with a little of the
  // colour (the user: less colour where the water meets the surface, 2026-11-08)
  vec3 lit = b.rgb * b.a;
  lit = mix(vec3(dot(lit, vec3(0.2126, 0.7152, 0.0722))), lit, 0.45);
  vCol = lit * (0.15 + 0.85 * smoothstep(0.0, 0.2, a.x)) * 0.4;
  vUv = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const POOL_FS = /* glsl */ `
varying vec3 vCol;
varying vec2 vUv;
void main() {
  float r2 = dot(vUv, vUv) * 4.0;
  gl_FragColor = vec4(vCol * (exp(-r2 * 8.0) + exp(-r2 * 2.5) * 0.08) * (1.0 - smoothstep(0.7, 1.0, r2)), 1.0);
}`;

export function floatTex(data: Float32Array, w: number, h: number) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export function evalTarget(w: number, h: number) {
  return new THREE.WebGLRenderTarget(w, h, {
    count: 3,
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
  });
}

export class JetField {
  readonly object = new THREE.Group();
  readonly lightModel = { value: 4 };
  readonly particleCount: number;
  readonly strandCount: number;
  readonly haze: Haze;
  private evalScene = new THREE.Scene();
  private evalCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private particleRT: THREE.WebGLRenderTarget;
  private strandRT: THREE.WebGLRenderTarget;
  private particleEval: THREE.ShaderMaterial;
  private strandEval: THREE.ShaderMaterial;
  private drawMats: THREE.ShaderMaterial[] = [];
  private shared: Record<string, THREE.IUniform>;

  /** Water hitting the water (stage 7 H2), when the graphics setting has it. */
  readonly impact?: Impact;

  constructor(
    layout: Layout,
    private history: ParamHistory,
    opts: { impact?: ImpactOptions } = {},
  ) {
    const F = layout.fixtures.length;

    // fixture table
    const fix = new Float32Array(F * ROWS * 4);
    const put = (row: number, f: number, v: number[]) => fix.set(v, (row * F + f) * 4);
    for (const fx of layout.fixtures) {
      const s = fx.spec;
      put(0, fx.index, [...fx.position, TYPE_ID[fx.type]]);
      put(1, fx.index, [s.height, s.bore, s.aeration, s.breakup]);
      put(2, fx.index, [s.spread, s.jets, s.turb, s.kDrop]);
      put(3, fx.index, s.p);
      put(4, fx.index, [THREE.MathUtils.degToRad(s.beam / 2), s.candela, fx.life, fx.slotSpan]);
      put(5, fx.index, [s.kCol, s.kMist, 30, s.fadeLen ?? 0]);
      const d = drawScale(s.height);
      put(6, fx.index, [d.size, d.drop, s.fallFade ?? 0, s.guide ?? 1]);
      // row 7: impact strength and ripple (techniques/impact.ts), then whether the head turns
      const im = impactShape(s, d.size);
      put(7, fx.index, [im[0], im[1], fx.turns ? 1 : 0, 0]);
    }

    // particle slots: spray then mist for each fixture
    const slots: number[] = [];
    for (const fx of layout.fixtures) {
      for (let k = 0; k < fx.spray; k++) slots.push(fx.index, k, fx.spray, 0);
      for (let k = 0; k < fx.mist; k++) slots.push(fx.index, k, fx.mist, 1);
    }
    this.particleCount = slots.length / 4;
    const PH = Math.ceil(this.particleCount / PW);
    const slotData = new Float32Array(PW * PH * 4);
    slotData.set(slots);

    // ribbons: a few per sub-jet
    const strands: number[] = [];
    let id = 0;
    for (const fx of layout.fixtures) {
      for (let j = 0; j < fx.spec.jets; j++) {
        // w: 1 + the ribbon's number within its sub-jet (0 is the core)
        for (let i = 0; i < fx.strands; i++) strands.push(fx.index, j, id++, 1 + i);
      }
    }
    this.strandCount = strands.length / 4;

    this.particleRT = evalTarget(PW, PH);
    this.strandRT = evalTarget(SEG + 1, this.strandCount);

    // small fixtures: their drawn sizes are compiled in (FIX_GLSL SIZED)
    const defines: Record<string, string> = layout.fixtures.some((fx) => drawScale(fx.spec.height).size < 1) ? { SIZED: '' } : {};
    this.shared = {
      uFix: { value: floatTex(fix, F, ROWS) },
      uHistA: { value: history.texA },
      uHistB: { value: history.texB },
      uHistRate: { value: RATE },
      uKNow: { value: 0 },
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uLightModel: this.lightModel,
      uWind: { value: new THREE.Vector3(0.6, 0, 0) },
      uWindC: { value: 0.15 },
    };

    this.particleEval = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...this.shared, uSlots: { value: floatTex(slotData, PW, PH) } },
      defines: { ...defines },
      vertexShader: EVAL_VS,
      fragmentShader: PARTICLE_EVAL_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.strandEval = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...this.shared, uStrands: { value: floatTex(new Float32Array(strands), 1, this.strandCount) } },
      defines: { ...defines },
      vertexShader: EVAL_VS,
      fragmentShader: STRAND_EVAL_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.particleEval);
    this.quad.frustumCulled = false;
    this.evalScene.add(this.quad);

    this.haze = new Haze(layout, history, this.shared.uTime, this.shared.uKNow);
    this.object.add(this.haze.object, this.buildParticles(), this.buildRibbons(), this.buildPools(layout));
    if (opts.impact) {
      this.impact = new Impact(layout, this.shared, defines, opts.impact);
      this.object.add(this.impact.object);
    }
  }

  private buildParticles() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    const tex = new Float32Array(this.particleCount * 2);
    for (let i = 0; i < this.particleCount; i++) {
      tex[i * 2] = i % PW;
      tex[i * 2 + 1] = Math.floor(i / PW);
    }
    g.setAttribute('aTexel', new THREE.InstancedBufferAttribute(tex, 2));
    g.instanceCount = this.particleCount;
    const t = this.particleRT.textures;
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uHead: { value: t[0] },
        uTail: { value: t[1] },
        uCol: { value: t[2] },
        uPx: { value: 1000 },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uTime: this.shared.uTime,
        uCloudy: { value: 1 },
        uSparkle: { value: 3 },
        uOcclude: { value: 0.35 },
      },
      vertexShader: PARTICLE_DRAW_VS,
      fragmentShader: STREAK_FS,
    });
    coverageBlend(m);
    this.drawMats.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return mesh;
  }

  private buildRibbons() {
    const S = SEG;
    const seg = new Float32Array((S + 1) * 2);
    const side = new Float32Array((S + 1) * 2);
    for (let i = 0; i <= S; i++) {
      seg.set([i, i], i * 2);
      side.set([-1, 1], i * 2);
    }
    const index: number[] = [];
    for (let i = 0; i < S; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((S + 1) * 2 * 3), 3));
    g.setAttribute('aSeg', new THREE.BufferAttribute(seg, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setIndex(index);
    g.setAttribute('aRow', new THREE.InstancedBufferAttribute(new Float32Array(this.strandCount).map((_, i) => i), 1));
    g.instanceCount = this.strandCount;
    const t = this.strandRT.textures;
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uPos: { value: t[0] },
        uSCol: { value: t[1] },
        uInfo: { value: t[2] },
        uPx: { value: 1000 },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uColumn: { value: 1 },
      },
      vertexShader: STRAND_DRAW_VS,
      fragmentShader: COLUMN_FS,
      side: THREE.DoubleSide,
    });
    coverageBlend(m);
    this.drawMats.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    return mesh;
  }

  private buildPools(layout: Layout) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uHistA: this.shared.uHistA,
        uHistB: this.shared.uHistB,
        uHistRate: this.shared.uHistRate,
        uKNow: this.shared.uKNow,
        uTime: this.shared.uTime,
      },
      vertexShader: POOL_VS,
      fragmentShader: POOL_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const n = layout.fixtures.length;
    const mesh = new THREE.InstancedMesh(g, m, n);
    const fixAttr = new Float32Array(n);
    const mat = new THREE.Matrix4();
    for (const fx of layout.fixtures) {
      // small pools: each nozzle foot reads as its own bright point; wide
      // ones overlapped into a neon strip along the waterline (R4)
      const r = (fx.type === 'ring' ? 2 * fx.spec.p[0] + 2 : fx.type === 'shooter' && fx.spec.height > 40 ? 5 : fx.type === 'fan' ? 3 : 1.6) * drawScale(fx.spec.height).size;
      mat.makeScale(r, 1, r).setPosition(fx.position[0], 0.03, fx.position[2]);
      mesh.setMatrixAt(fx.index, mat);
      fixAttr[fx.index] = fx.index;
    }
    g.setAttribute('aFix', new THREE.InstancedBufferAttribute(fixAttr, 1));
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return mesh;
  }

  /** Evaluate all water for time t. Call once per frame before rendering. */
  update(renderer: THREE.WebGLRenderer, t: number, camera: THREE.PerspectiveCamera, pxPerMetre: number, viewport: THREE.Vector2) {
    this.shared.uTime.value = t;
    this.shared.uKNow.value = this.history.kNow;
    (this.shared.uCam.value as THREE.Vector3).copy(camera.position);
    for (const m of this.drawMats) {
      m.uniforms.uPx.value = pxPerMetre;
      m.uniforms.uViewport.value.copy(viewport);
    }
    const prev = renderer.getRenderTarget();
    this.quad.material = this.particleEval;
    renderer.setRenderTarget(this.particleRT);
    renderer.render(this.evalScene, this.evalCam);
    this.quad.material = this.strandEval;
    renderer.setRenderTarget(this.strandRT);
    renderer.render(this.evalScene, this.evalCam);
    renderer.setRenderTarget(prev);
    this.impact?.update(renderer, pxPerMetre, viewport);
  }

  dispose() {
    this.particleRT.dispose();
    this.strandRT.dispose();
    this.particleEval.dispose();
    this.strandEval.dispose();
    for (const m of this.drawMats) m.dispose();
    this.haze.dispose();
    this.impact?.dispose();
  }
}
