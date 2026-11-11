import * as THREE from 'three';
import { HASH } from '../core/glsl';
import { COMET, RISER, SHELLS, SKY_GLOW } from '../pyro/shells';
import { afterglow, type Burst } from '../pyro/schedule';
import type { Vec3 } from '../venues';

/**
 * Fireworks (docs/detailed-design.md 3.4).
 *
 * The picture at time t depends on t alone: every star's position is solved
 * on the GPU from the burst's data and the star's number, with linear air
 * drag k, so the show can be scrubbed or exported frame by frame:
 *
 *   v(τ) = (v0 − v∞)·e^(−kτ) + v∞,   v∞ = g/k + wind   (τ = t − tBurst)
 *   p(τ) = centre + (v0 − v∞)·(1 − e^(−kτ))/k + v∞·τ
 *
 * Without gravity a star stops at |v0|/k; |v0| = k × radius / (1 − e^(−0.8·k·burn))
 * opens the shell to the table's diameter (src/pyro/shells.ts) by 80 % of
 * the burn, when it is at its widest.
 *
 * Each frame the CPU picks the bursts in the air (at most MAX_ACTIVE) and
 * writes them to a small float texture; instanced quads read it: one head
 * glow per star and one ribbon behind it (its tail, the same formula a few
 * moments earlier). Star 0 of a burst is its riser before it opens and its
 * flash after.
 */

export const MAX_ACTIVE = 48;
/** Stars per burst at most (10号 × 60). */
export const MAX_STARS = 600;
/** Points of the longest tail. */
const TMAX = 10;
/** Texels per burst. */
const ROW = 10;
/** Sparks a star (or a riser) sheds at once at most (pyro lab, idea 5). */
const SPARKS = 6;

/**
 * How the fireworks look, from the reference-page report
 * (docs/reports/hanabi-reference.html, compared in pyrolab.html). All off is
 * the picture from before, to the pixel (the stars' shaders then compile
 * from exactly the old text). The show turns on PYRO_LOOK through the
 * graphics switch 'pyro' (show/graphics.ts); the lab page turns them on and
 * off one at a time.
 *   life    each star burns ±12 % of the shell's time, and sputters at its end (idea 1)
 *   glow    the sky around a burst lit in its colour for a moment, at each
 *           burst's own strength (Fire.glow, default SKY_GLOW) (idea 2)
 *   flash   lab only: idea 2 as first tried, a small short flash ball
 *   halo    a soft glow around every star (idea 4)
 *   sparks  risers and willow stars shed small flickering sparks (idea 5)
 *   glowGain lab only: multiplies every burst's glow (1 / SKY_GLOW = the lab's idea 2 in full)
 */
export interface PyroLab {
  life: boolean;
  glow: boolean;
  flash: boolean;
  halo: boolean;
  sparks: boolean;
  glowGain?: number;
}
export const PYRO_LAB_OFF: PyroLab = { life: false, glow: false, flash: false, halo: false, sparks: false };
/** The show's fireworks look (chosen 2026-11-08: ideas 1, 4, 5 and 2 at a tenth). */
export const PYRO_LOOK: PyroLab = { life: true, glow: true, flash: false, halo: true, sparks: true };

/** A burst with an inner ring of stars (芯, pyro lab idea 3): the share of the stars, their radius against the shell's, their colour. */
export type CoredBurst = Burst & { core?: { frac: number; ratio: number; color: [number, number, number] } };

/** A light a firework throws on its surroundings (water, haze, smoke). */
export interface PyroLight {
  pos: THREE.Vector3;
  /** Linear colour times strength; 1 is about the flash of a 5号. */
  col: THREE.Vector3;
}
export const MAX_PYRO_LIGHTS = 8;

/**
 * How white a star's core burns (0 its own colour .. 1 white), and how gold
 * a long tail is against its star's colour (the charcoal sparks a 菊 sheds).
 * Chosen 2026-11-03 against photos ('D', shots/stage2/looks/decide-color.jpg):
 * real stars read deeper in colour than white-cored ones.
 */
export const CORE_WHITE = 0;
export const TAIL_GOLD = 0.15;

/** Brightness of the stars per lighting mode: real against the white water columns, ideal a little brighter. */
export const PYRO_GAIN = { real: 1, ideal: 1.3 };

const COMMON = /* glsl */ `
${HASH}
uniform highp sampler2D uBursts;
uniform float uTime;
uniform float uPx;
uniform vec2 uViewport;
uniform vec3 uWind;
uniform float uGain;
uniform float uCore;
uniform float uTailGold;
#ifdef LAB
uniform float uLife;
uniform float uFlashLab;
uniform float uHalo;
#endif

struct B {
  vec3 c; float tB;
  vec3 o; float tL;
  float radius; float k; float burn; float stars;
  vec3 col0; float type;
  vec3 col1; float seed;
  vec3 col2; float ncol;
  float trail; float trailDt; float starSize; float bright;
  float riser; float size; float child; float flash;
#ifdef LAB
  float coreFrac; float coreRatio; float glowK;
  vec3 coreCol;
#endif
};

B burst(int slot) {
  B b;
  vec4 r0 = texelFetch(uBursts, ivec2(0, slot), 0);
  vec4 r1 = texelFetch(uBursts, ivec2(1, slot), 0);
  vec4 r2 = texelFetch(uBursts, ivec2(2, slot), 0);
  vec4 r3 = texelFetch(uBursts, ivec2(3, slot), 0);
  vec4 r4 = texelFetch(uBursts, ivec2(4, slot), 0);
  vec4 r5 = texelFetch(uBursts, ivec2(5, slot), 0);
  vec4 r6 = texelFetch(uBursts, ivec2(6, slot), 0);
  vec4 r7 = texelFetch(uBursts, ivec2(7, slot), 0);
#ifdef LAB
  vec4 r8 = texelFetch(uBursts, ivec2(8, slot), 0);
  vec4 r9 = texelFetch(uBursts, ivec2(9, slot), 0);
  b.coreFrac = r8.x; b.coreRatio = r8.y; b.glowK = r8.z;
  b.coreCol = r9.rgb;
#endif
  b.c = r0.xyz; b.tB = r0.w;
  b.o = r1.xyz; b.tL = r1.w;
  b.radius = r2.x; b.k = r2.y; b.burn = r2.z; b.stars = r2.w;
  b.col0 = r3.rgb; b.type = r3.w;
  b.col1 = r4.rgb; b.seed = r4.w;
  b.col2 = r5.rgb; b.ncol = r5.w;
  b.trail = r6.x; b.trailDt = r6.y; b.starSize = r6.z; b.bright = r6.w;
  b.riser = r7.x; b.size = r7.y; b.child = r7.z; b.flash = r7.w;
  return b;
}

// kinds (shells.ts SHELLS[].id)
const float RING = 4.0;
const float STROBE = 6.0;

// direction of star i of n: a jittered Fibonacci sphere (an even shell of
// stars, as they are packed), or a circle for a ring shell
vec3 starDir(B b, float i, float n) {
  uint s = uint(b.seed) * 7919u + uint(i) * 2654435761u;
  vec4 r = rnd4(s);
  if (b.type == RING) {
    vec4 q = rnd4(uint(b.seed) * 31u + 5u);
    // the ring's plane leans at random, as the shell tumbles in flight
    vec3 nrm = normalize(vec3(q.x - 0.5, (q.y - 0.5) * 0.8, 1.0));
    vec3 u = normalize(cross(nrm, vec3(0.0, 1.0, 0.0)));
    vec3 v = cross(nrm, u);
    float a = (i + (r.x - 0.5) * 0.3) / n * 2.0 * PI;
    return normalize(u * cos(a) + v * sin(a) + nrm * (r.y - 0.5) * 0.04);
  }
  float y = 1.0 - 2.0 * (i + 0.5) / n;
  float rr = sqrt(max(0.0, 1.0 - y * y));
  float phi = i * 2.39996323 + rnd(uint(b.seed)) * 6.2832;
  vec3 d = vec3(rr * cos(phi), y, rr * sin(phi));
  return normalize(d + (r.xyz - 0.5) * (2.4 / sqrt(n)));
}

// fast enough to reach the table's radius by 80 % of the burn, when the
// shell is at its widest (with drag a star only nears |v0|/k)
#ifdef LAB
// pyro lab (LAB is defined only on the lab page: without it the shader text
// is exactly the show's). A cored shell: its last stars are the core, an
// even sphere of their own.
float coreCount(B b) { return floor(b.stars * b.coreFrac + 0.5); }
bool inCore(B b, float i) { return i > b.stars - coreCount(b); } // i 1-based
vec3 starDirOf(B b, float i) {
  float nc = coreCount(b);
  if (nc > 0.5 && i > b.stars - nc) {
    B c = b;
    c.seed = b.seed + 17.0;
    return starDir(c, i - 1.0 - (b.stars - nc), nc);
  }
  return starDir(b, i - 1.0, b.stars - nc);
}
// how long star i burns: ±12 % star by star with the life switch, a core three quarters
float starBurn(B b, float i) {
  float t = b.burn * (1.0 + uLife * 0.24 * (rnd(uint(b.seed) * 41u + uint(i) * 733u) - 0.5));
  if (b.coreFrac > 0.0 && inCore(b, i)) t *= 0.75;
  return t;
}
float starSpeed(B b, float i) {
  float reach = 1.0 - exp(-b.k * b.burn * 0.8);
  float r = b.radius;
  if (b.coreFrac > 0.0 && inCore(b, i)) r *= b.coreRatio;
  return b.k * r / reach * (0.95 + 0.1 * rnd(uint(b.seed) * 13u + uint(i) * 977u));
}
#else
float starSpeed(B b, float i) {
  float reach = 1.0 - exp(-b.k * b.burn * 0.8);
  return b.k * b.radius / reach * (0.95 + 0.1 * rnd(uint(b.seed) * 13u + uint(i) * 977u));
}
#endif

vec3 vInf(B b) { return vec3(0.0, -G / b.k, 0.0) + uWind; }

vec3 starPos(B b, vec3 v0, float tau) {
  vec3 vi = vInf(b);
  return b.c + (v0 - vi) * (1.0 - exp(-b.k * tau)) / b.k + vi * tau;
}

vec3 starVel(B b, vec3 v0, float tau) {
  vec3 vi = vInf(b);
  return (v0 - vi) * exp(-b.k * tau) + vi;
}

// the rising shell: decelerating to the burst point, as a shell slows to its top
vec3 riserPos(B b, float t) {
  float u = clamp((t - b.tL) / max(b.tB - b.tL, 1e-3), 0.0, 1.0);
  float h = 1.0 - (1.0 - u) * (1.0 - u);
  return mix(b.o, b.c, h);
}

// brightness of a star at tau after the burst
float starLight(B b, float tau, float i) {
  if (tau < 0.0) return 0.0;
#ifdef LAB
  float u = tau / starBurn(b, i);
#else
  float u = tau / b.burn;
#endif
  if (u >= 1.0) return 0.0;
  float l = smoothstep(0.0, 0.05, tau) * (1.0 - 0.3 * u) * (1.0 - smoothstep(0.8, 1.0, u));
  // a slight shimmer, star by star
  uint s = uint(b.seed) * 17u + uint(i) * 131u;
  l *= 0.85 + 0.15 * sin(uTime * (25.0 + 20.0 * rnd(s)) + rnd(s + 1u) * 6.2832);
#ifdef LAB
  // a dying star sputters, 30 times a second
  if (uLife > 0.5) l *= 1.0 - 0.65 * smoothstep(0.8, 0.97, u) * rnd(s + 7u + uint(floor(uTime * 30.0)) * 2654435761u);
#endif
  if (b.type == STROBE) {
    float f = 8.0 + 6.0 * rnd(s + 2u);
    l *= step(0.5, fract(uTime * f + rnd(s + 3u))) * step(0.12, u) + (1.0 - step(0.12, u));
  }
  return l * b.bright;
}

// colour as the star burns: the 2nd and 3rd colours take over in turn
#ifdef LAB
vec3 starColor(B b, float tau, float i) {
  if (b.coreFrac > 0.0 && inCore(b, i)) return b.coreCol;
#else
vec3 starColor(B b, float tau) {
#endif
  float u = clamp(tau / b.burn, 0.0, 1.0) * b.ncol;
  vec3 c = b.col0;
  if (b.ncol > 1.5) c = mix(c, b.col1, smoothstep(0.92, 1.08, u));
  if (b.ncol > 2.5) c = mix(c, b.col2, smoothstep(1.92, 2.08, u));
  return c;
}

const vec3 GOLD = vec3(1.0, 0.45, 0.12);

// on-screen point of a world position
vec2 screen(vec4 c) { return c.xy / c.w * 0.5 * uViewport; }
vec4 clipOf(vec3 p) { return projectionMatrix * viewMatrix * vec4(p, 1.0); }
`;

const HEAD_VS = /* glsl */ `
${COMMON}
attribute vec2 aStar; // slot, star (0 = riser / flash)
varying vec3 vCol;
varying vec2 vUv;
#ifdef LAB
varying float vHalo;
#endif
void main() {
  int slot = int(aStar.x);
  float i = aStar.y;
  B b = burst(slot);
  vec3 p;
  float light;
  float rW;
  vec3 col;
#ifdef LAB
  // room for a halo around a star
  float halo = 1.0;
#endif
  float tau = uTime - b.tB;
  if (i < 0.5) {
    if (tau < 0.0) {
      // the rising shell: a comet's star, or the dim gold of a lift charge's tail
      p = riserPos(b, uTime);
      bool comet = b.riser > 1.5;
      light = b.riser < 0.5 ? 0.0 : comet ? 3.0 : 0.35 * smoothstep(b.tL, b.tL + 0.1, uTime);
      col = comet ? b.col0 : GOLD;
      rW = comet ? 1.4 : 0.5;
    } else {
      // the burst's flash; a comet just dies away at the top
      p = b.c;
      bool comet = b.riser > 1.5;
      light = comet ? 3.0 * exp(-tau / 0.15) : b.flash * exp(-tau / 0.08);
      col = comet ? b.col0 : mix(b.col0, vec3(1.0), 0.6);
      rW = comet ? 1.4 : b.radius * 0.12;
#ifdef LAB
      // a small, short flash; the sky around it is lit by GLOW_VS
      if (uFlashLab > 0.5 && !comet) {
        light = b.flash * 0.5 * exp(-tau / 0.05);
        rW = b.radius * 0.05;
      }
#endif
    }
  } else {
    float n = b.stars;
#ifdef LAB
    if (i > n || tau < 0.0 || tau > starBurn(b, i)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 v0 = starDirOf(b, i) * starSpeed(b, i);
    p = starPos(b, v0, tau);
    light = starLight(b, tau, i);
    col = starColor(b, tau, i);
    halo = 1.0 + uHalo * 2.5;
#else
    if (i > n || tau < 0.0 || tau > b.burn) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 v0 = starDir(b, i - 1.0, n) * starSpeed(b, i);
    p = starPos(b, v0, tau);
    light = starLight(b, tau, i);
    col = starColor(b, tau);
#endif
    rW = 0.6 * b.starSize * (0.7 + 0.06 * b.size);
  }
  vec4 c = clipOf(p);
  if (light <= 0.0 || c.w < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // at least a pixel and a half across; a star smaller than that on screen
  // keeps its energy, spread over the pixels it covers
  float rPx = rW * uPx / c.w;
  float rDraw = max(rPx, 1.5);
  light *= min(1.0, (rPx * rPx) / (rDraw * rDraw) * 4.0 + 0.25);
#ifdef LAB
  vec2 sp = screen(c) + position.xy * rDraw * 2.0 * halo;
#else
  vec2 sp = screen(c) + position.xy * rDraw * 2.0;
#endif
  gl_Position = vec4(sp / (0.5 * uViewport) * c.w, c.z, c.w);
  // the core burns white, the colour is in the glow (the camera's response)
  vCol = mix(col, vec3(1.0), uCore) * light * uGain;
#ifdef LAB
  vUv = position.xy * 2.0 * halo;
  vHalo = halo;
#else
  vUv = position.xy * 2.0;
#endif
}
`;

const HEAD_FS = /* glsl */ `
varying vec3 vCol;
varying vec2 vUv;
#ifdef LAB
varying float vHalo;
uniform float uHalo;
void main() {
  float r2 = dot(vUv, vUv);
  float h = uHalo > 0.5 ? vHalo : 1.0;
  if (r2 > h * h) discard;
  float a = exp(-r2 * 4.0) + 0.12 * exp(-r2 * 1.2);
  // a soft halo out to the quad's edge, fading to nothing there
  if (h > 1.01) a += 0.14 * exp(-r2 * 0.45) * (1.0 - r2 / (h * h));
  gl_FragColor = vec4(vCol * a, 1.0);
}
#else
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 4.0) + 0.12 * exp(-r2 * 1.2);
  gl_FragColor = vec4(vCol * a, 1.0);
}
#endif
`;

const TAIL_VS = /* glsl */ `
${COMMON}
attribute vec2 aStar;
varying vec3 vCol;
varying float vSide;
void main() {
  int slot = int(aStar.x);
  float i = aStar.y;
  float n = position.x; // point along the tail, 0 = at the star
  float side = position.y;
  B b = burst(slot);
  float tau = uTime - b.tB;
  vec3 p;
  vec3 dirW;
  float light;
  float wW;
  vec3 col;
  float N;
  if (i < 0.5) {
    // the riser's tail
    bool comet = b.riser > 1.5;
    N = comet ? ${COMET.trail.toFixed(1)} : ${RISER.trail.toFixed(1)};
    float dt = comet ? ${COMET.trailDt} : ${RISER.trailDt};
    if (b.riser < 0.5 || tau > (comet ? 0.4 : 0.0) || n > N) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float tt = max(b.tL, min(uTime, b.tB) - n * dt);
    p = riserPos(b, tt);
    dirW = riserPos(b, tt + 0.02) - p;
    light = (comet ? 1.6 * exp(-max(tau, 0.0) / 0.15) : 0.25) * smoothstep(b.tL, b.tL + 0.15, uTime);
    col = comet ? mix(b.col0, GOLD, 0.3) : GOLD;
    wW = comet ? 0.9 : 0.3;
  } else {
    N = b.trail;
#ifdef LAB
    if (i > b.stars || n > N || tau < 0.0 || tau > starBurn(b, i) || N < 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 v0 = starDirOf(b, i) * starSpeed(b, i);
#else
    if (i > b.stars || n > N || tau < 0.0 || tau > b.burn || N < 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 v0 = starDir(b, i - 1.0, b.stars) * starSpeed(b, i);
#endif
    float tt = max(0.0, tau - n * b.trailDt);
    p = starPos(b, v0, tt);
    dirW = starVel(b, v0, tt);
    light = starLight(b, tau, i);
    // long tails are the gold sparks a star sheds; short ones its own blur
#ifdef LAB
    col = mix(starColor(b, tau, i), GOLD, N > 3.0 ? uTailGold : 0.0);
#else
    col = mix(starColor(b, tau), GOLD, N > 3.0 ? uTailGold : 0.0);
#endif
    wW = 0.35 * b.starSize * (0.7 + 0.06 * b.size);
  }
  float fall = 1.0 - n / (N + 1.0);
  light *= fall * fall;
  vec4 c = clipOf(p);
  vec4 c2 = clipOf(p + normalize(dirW + vec3(0.0, 1e-4, 0.0)) * 0.5);
  if (light <= 0.0 || c.w < 0.5 || c2.w < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 d = screen(c2) - screen(c);
  d = length(d) > 1e-4 ? normalize(d) : vec2(0.0, 1.0);
  float wPx = wW * uPx / c.w;
  float wDraw = max(wPx, 1.0) * mix(1.0, 0.4, n / max(N, 1.0));
  light *= min(1.0, wPx / 1.0 + 0.3);
  vec2 sp = screen(c) + vec2(-d.y, d.x) * side * wDraw;
  gl_Position = vec4(sp / (0.5 * uViewport) * c.w, c.z, c.w);
  vCol = col * light * uGain * 0.6;
  vSide = side;
}
`;

const TAIL_FS = /* glsl */ `
varying vec3 vCol;
varying float vSide;
void main() {
  float a = 1.0 - vSide * vSide;
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

const HIDE = '{ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }';

// idea 2: the sky around a burst lit in its colour for a moment, a wide soft
// disc 2.5 times the shell's radius, at the burst's own strength
const GLOW_VS = /* glsl */ `
${COMMON}
uniform float uGlow;
attribute float aSlot;
varying vec3 vCol;
varying vec2 vUv;
void main() {
  B b = burst(int(aSlot));
  float tau = uTime - b.tB;
  if (tau < 0.0 || tau > 1.5 || b.riser > 1.5 || b.flash <= 0.0 || b.glowK <= 0.0) ${HIDE}
  vec4 c = clipOf(b.c);
  if (c.w < 0.5) ${HIDE}
  float rPx = b.radius * 2.5 * uPx / c.w;
  vec2 sp = screen(c) + position.xy * rPx * 2.0;
  gl_Position = vec4(sp / (0.5 * uViewport) * c.w, c.z, c.w);
  vCol = b.col0 * b.flash * b.glowK * uGlow * exp(-tau / 0.25) * uGain;
  vUv = position.xy * 2.0;
}
`;

const GLOW_FS = /* glsl */ `
varying vec3 vCol;
varying vec2 vUv;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * exp(-r2 * 3.0) * (1.0 - r2), 1.0);
}
`;

// lab (idea 5): sparks. Spark j of a star is born again every P seconds at
// where the star is then, drifts with its own drag and gravity and flickers
// out; every birth time and kick comes from the star's number and the
// birth's, so the picture still depends on the time alone
const SPARK_VS = /* glsl */ `
${COMMON}
attribute vec3 aSpark; // slot, star (0 = the riser), spark
varying vec3 vCol;
varying vec2 vUv;
void main() {
  B b = burst(int(aSpark.x));
  float i = aSpark.y;
  float j = aSpark.z;
  // while the shell rises its stars are not lit yet: the riser borrows the
  // spark slots of its first four, for a denser trail
  bool riser = uTime < b.tB;
  if (riser ? (b.riser < 0.75 || i > 3.5) : (b.type != 2.0 || i < 0.5 || i > b.stars)) ${HIDE}
  float P = riser ? 0.5 : 0.6;
  float slots = riser ? ${(4 * SPARKS).toFixed(1)} : ${SPARKS.toFixed(1)};
  float k = riser ? i * ${SPARKS.toFixed(1)} + j : j;
  uint sid = uint(b.seed) * 7u + uint(i) * 131u + uint(j) * 977u;
  float t0 = (riser ? b.tL : b.tB) + (k + rnd(sid)) / slots * P;
  float since = uTime - t0;
  if (since < 0.0) ${HIDE}
  float g = floor(since / P);
  float tb = t0 + g * P;
  float a = uTime - tb;
  uint gs = sid + uint(g) * 2654435761u;
  vec4 r = rnd4(gs);
  float L = P * (0.5 + 0.5 * r.w);
  if (a > L) ${HIDE}
  vec3 p0;
  vec3 v0s;
  if (riser) {
    if (tb > b.tB) ${HIDE}
    p0 = riserPos(b, tb);
    v0s = (riserPos(b, tb + 0.02) - p0) / 0.02 * 0.1 + (r.xyz - 0.5) * vec3(18.0, 10.0, 18.0) - vec3(0.0, 8.0, 0.0);
  } else {
    float ts = tb - b.tB;
    if (ts > starBurn(b, i) * 0.92) ${HIDE}
    vec3 v0 = starDirOf(b, i) * starSpeed(b, i);
    p0 = starPos(b, v0, ts);
    v0s = starVel(b, v0, ts) * 0.15 + (r.xyz - 0.5) * 0.16 * b.radius;
  }
  const float ks = 2.6;
  vec3 vi = vec3(0.0, -G * 0.4 / ks, 0.0) + uWind;
  vec3 p = p0 + (v0s - vi) * (1.0 - exp(-ks * a)) / ks + vi * a;
  float fl = 0.55 + 0.45 * rnd(gs + 3u + uint(floor(uTime * 30.0)) * 747796405u);
  float light = (1.0 - a / L) * fl * smoothstep(0.0, 0.03, a) * (riser ? 2.0 : 1.6 * b.bright);
  vec4 c = clipOf(p);
  if (c.w < 0.5) ${HIDE}
  float rPx = 0.18 * (0.7 + 0.06 * b.size) * uPx / c.w;
  float rDraw = max(rPx, 1.0);
  light *= min(1.0, (rPx * rPx) / (rDraw * rDraw) * 4.0 + 0.25);
  vec2 sp = screen(c) + position.xy * rDraw * 2.0;
  gl_Position = vec4(sp / (0.5 * uViewport) * c.w, c.z, c.w);
  vCol = vec3(1.0, 0.55, 0.18) * light * uGain;
  vUv = position.xy * 2.0;
}
`;

const SPARK_FS = /* glsl */ `
varying vec3 vCol;
varying vec2 vUv;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * exp(-r2 * 4.0), 1.0);
}
`;

/** The sky glow of idea 2 at a burst glow of 1 (the lab's ② in full); a burst's Fire.glow scales it. */
export const LAB_GLOW = 0.02;

const tmpC = new THREE.Vector3();

export class Fireworks {
  readonly object = new THREE.Group();
  /** The strongest firework lights at the last advance(), for water, haze and smoke. */
  readonly lights: PyroLight[] = [];
  private bursts: Burst[] = [];
  /** Longest a burst stays visible after it opens, and longest rise: bounds the search. */
  private maxAfter = 0;
  private maxRise = 0;
  private data = new Float32Array(ROW * MAX_ACTIVE * 4);
  private tex: THREE.DataTexture;
  private uniforms: Record<string, THREE.IUniform>;
  private heads: THREE.Mesh;
  private tails: THREE.Mesh;
  private headGeo: THREE.InstancedBufferGeometry;
  private tailGeo: THREE.InstancedBufferGeometry;
  /** Star budget (quality tier, 0..1). */
  private scale = 1;
  /** Bursts written to the texture last frame (ids), to skip rewriting. */
  private written = '';
  /** Pyro lab switches; all off unless the lab page sets them. */
  private lab: PyroLab = { ...PYRO_LAB_OFF };
  /** The lab's sky glows and sparks, built the first time they are switched on. */
  private glows: THREE.Mesh | null = null;
  private sparks: THREE.Mesh | null = null;
  private mat!: (vs: string, fs: string) => THREE.ShaderMaterial;
  private active_ = 0;

  constructor(wind: Vec3 = [1.5, 0, 0]) {
    this.tex = new THREE.DataTexture(this.data, ROW, MAX_ACTIVE, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    this.uniforms = {
      uBursts: { value: this.tex },
      uTime: { value: 0 },
      uPx: { value: 1000 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uWind: { value: new THREE.Vector3(...wind) },
      uGain: { value: PYRO_GAIN.real },
      uCore: { value: CORE_WHITE },
      uTailGold: { value: TAIL_GOLD },
      uLife: { value: 0 },
      uFlashLab: { value: 0 },
      uHalo: { value: 0 },
      uGlow: { value: LAB_GLOW },
    };
    // one instance per star of every slot: slot-major, star 0 the riser
    const stars = new Float32Array(MAX_ACTIVE * (MAX_STARS + 1) * 2);
    for (let s = 0, k = 0; s < MAX_ACTIVE; s++) for (let i = 0; i <= MAX_STARS; i++, k += 2) stars.set([s, i], k);

    this.headGeo = new THREE.InstancedBufferGeometry();
    this.headGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3));
    this.headGeo.setIndex([0, 1, 2, 2, 1, 3]);
    this.headGeo.setAttribute('aStar', new THREE.InstancedBufferAttribute(stars, 2));
    this.headGeo.instanceCount = 0;

    this.tailGeo = new THREE.InstancedBufferGeometry();
    const pos: number[] = [];
    const idx: number[] = [];
    for (let n = 0; n <= TMAX; n++) pos.push(n, -1, 0, n, 1, 0);
    for (let n = 0; n < TMAX; n++) idx.push(2 * n, 2 * n + 1, 2 * n + 2, 2 * n + 2, 2 * n + 1, 2 * n + 3);
    this.tailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    this.tailGeo.setIndex(idx);
    this.tailGeo.setAttribute('aStar', new THREE.InstancedBufferAttribute(stars, 2));
    this.tailGeo.instanceCount = 0;

    const mat = (this.mat = (vs: string, fs: string) =>
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: vs,
        fragmentShader: fs,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
    this.tails = new THREE.Mesh(this.tailGeo, mat(TAIL_VS, TAIL_FS));
    this.heads = new THREE.Mesh(this.headGeo, mat(HEAD_VS, HEAD_FS));
    for (const m of [this.tails, this.heads]) {
      m.frustumCulled = false;
      m.renderOrder = 5;
      this.object.add(m);
    }
    this.object.visible = false;
  }

  /** The show's bursts (compiled, by burst time) and the star budget of the quality tier. */
  setBursts(bursts: Burst[], scale = 1) {
    this.bursts = bursts;
    this.scale = scale;
    this.maxAfter = Math.max(0, ...bursts.map(afterglow));
    this.maxRise = Math.max(0, ...bursts.map((b) => b.tBurst - b.tLaunch));
    this.written = '';
    this.object.visible = false;
    this.lights.length = 0;
    this.useLabShader();
  }

  setGain(g: number) {
    this.uniforms.uGain.value = g;
  }

  /** How white the star cores burn (for comparing looks). */
  setCore(w: number, tailGold = TAIL_GOLD) {
    this.uniforms.uCore.value = w;
    this.uniforms.uTailGold.value = tailGold;
  }

  /** Pyro lab: switch the ideas of docs/reports/hanabi-reference.html on and off (all off: the picture as always). */
  setLab(lab: Partial<PyroLab>) {
    this.lab = { ...this.lab, ...lab };
    const u = this.uniforms;
    u.uLife.value = this.lab.life ? 1 : 0;
    u.uFlashLab.value = this.lab.flash ? 1 : 0;
    u.uHalo.value = this.lab.halo ? 1 : 0;
    u.uGlow.value = LAB_GLOW * (this.lab.glowGain ?? 1);
    const glowing = this.lab.glow || this.lab.flash;
    if (glowing && !this.glows) {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3));
      g.setIndex([0, 1, 2, 2, 1, 3]);
      g.setAttribute('aSlot', new THREE.InstancedBufferAttribute(new Float32Array(MAX_ACTIVE).map((_, s) => s), 1));
      this.glows = new THREE.Mesh(g, this.labMat(GLOW_VS, GLOW_FS));
      this.glows.frustumCulled = false;
      this.glows.renderOrder = 4;
      this.object.add(this.glows);
    }
    if (this.lab.sparks && !this.sparks) {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3));
      g.setIndex([0, 1, 2, 2, 1, 3]);
      const a = new Float32Array(MAX_ACTIVE * (MAX_STARS + 1) * SPARKS * 3);
      for (let s = 0, k = 0; s < MAX_ACTIVE; s++) for (let i = 0; i <= MAX_STARS; i++) for (let j = 0; j < SPARKS; j++, k += 3) a.set([s, i, j], k);
      g.setAttribute('aSpark', new THREE.InstancedBufferAttribute(a, 3));
      this.sparks = new THREE.Mesh(g, this.labMat(SPARK_VS, SPARK_FS));
      this.sparks.frustumCulled = false;
      this.sparks.renderOrder = 5;
      this.object.add(this.sparks);
    }
    if (this.glows) this.glows.visible = glowing;
    if (this.sparks) this.sparks.visible = this.lab.sparks;
    this.counts();
    this.useLabShader();
  }

  private labMat(vs: string, fs: string) {
    const m = this.mat(vs, fs);
    m.defines = { LAB: '' };
    return m;
  }

  /**
   * The stars' shaders with the lab's code (#define LAB) only while a switch
   * is on or a burst has a core: without it they compile from exactly the
   * show's text, so the show's picture cannot move by a rounding.
   */
  private useLabShader() {
    const on = this.lab.life || this.lab.glow || this.lab.flash || this.lab.halo || this.lab.sparks || this.bursts.some((b) => (b as CoredBurst).core);
    for (const m of [this.heads, this.tails]) {
      const mat = m.material as THREE.ShaderMaterial;
      if (on === 'LAB' in mat.defines) continue;
      mat.defines = on ? { LAB: '' } : {};
      mat.needsUpdate = true;
    }
  }

  get labState(): PyroLab {
    return { ...this.lab };
  }

  private counts() {
    const n = this.active_;
    if (this.glows) (this.glows.geometry as THREE.InstancedBufferGeometry).instanceCount = this.lab.glow || this.lab.flash ? n : 0;
    if (this.sparks) (this.sparks.geometry as THREE.InstancedBufferGeometry).instanceCount = this.lab.sparks ? n * (MAX_STARS + 1) * SPARKS : 0;
  }

  get hasBursts() {
    return this.bursts.length > 0;
  }

  /** The bursts in the air at t, in id order, at most MAX_ACTIVE. */
  active(t: number): Burst[] {
    const bs = this.bursts;
    if (!bs.length) return [];
    // first burst that may still be visible: tBurst >= t - maxAfter
    let lo = 0;
    let hi = bs.length;
    const from = t - this.maxAfter;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bs[mid].tBurst < from) lo = mid + 1;
      else hi = mid;
    }
    const out: Burst[] = [];
    for (let i = lo; i < bs.length && out.length < MAX_ACTIVE; i++) {
      const b = bs[i];
      if (b.tBurst - this.maxRise > t) break;
      if (b.tLaunch <= t && t <= b.tBurst + afterglow(b)) out.push(b);
    }
    return out;
  }

  /** Everything at show time t that does not depend on the camera. */
  advance(t: number) {
    this.uniforms.uTime.value = t;
    const act = this.active(t);
    this.object.visible = act.length > 0;
    this.headGeo.instanceCount = this.tailGeo.instanceCount = act.length * (MAX_STARS + 1);
    this.active_ = act.length;
    if (this.glows || this.sparks) this.counts();
    const key = act.map((b) => b.id).join(',');
    if (key !== this.written) {
      this.written = key;
      act.forEach((b, slot) => this.write(b, slot));
      this.tex.needsUpdate = true;
    }
    this.light(act, t);
  }

  /** Per camera: pixel scale and viewport of the frame being drawn. */
  aim(pxPerMetre: number, viewport: THREE.Vector2) {
    this.uniforms.uPx.value = pxPerMetre;
    (this.uniforms.uViewport.value as THREE.Vector2).copy(viewport);
  }

  private write(b: Burst, slot: number) {
    const kind = SHELLS[b.shell];
    const d = this.data;
    const o = slot * ROW * 4;
    const c = b.colors;
    const col = (k: number) => c[Math.min(k, c.length - 1)];
    const stars = b.stars > 0 ? Math.max(1, Math.min(MAX_STARS, Math.round(b.stars * this.scale))) : 0;
    // fewer stars at lower tiers each burn a little brighter
    const bright = kind.bright * Math.sqrt(Math.max(1, b.stars) / Math.max(1, stars));
    const riser = b.parent !== undefined ? 0.5 : b.shell === 'comet' ? 2 : 1;
    d.set([...b.center, b.tBurst], o);
    d.set([...b.origin, b.tLaunch], o + 4);
    d.set([b.radius, b.k, b.burn, stars], o + 8);
    d.set([...col(0), kind.id], o + 12);
    d.set([...col(1), b.seed % 65521], o + 16);
    d.set([...col(2), c.length], o + 20);
    d.set([b.parent !== undefined ? 2 : kind.trail, kind.trailDt, b.parent !== undefined ? 0.8 : kind.starSize, bright], o + 24);
    d.set([riser, b.size, b.parent !== undefined ? 1 : 0, this.flashOf(b)], o + 28);
    const core = (b as CoredBurst).core;
    const glow = b.glow ?? SKY_GLOW;
    d.set(core ? [core.frac, core.ratio, glow, 0, ...core.color, 0] : [0, 0, glow, 0, 0, 0, 0, 0], o + 32);
  }

  /** Brightness of a burst's flash (0.08 s) at the centre. */
  private flashOf(b: Burst) {
    if (b.shell === 'comet') return 0;
    return 3 * Math.sqrt(b.size / 5) * (b.parent !== undefined ? 0.3 : 1);
  }

  /** The strongest lights of the bursts in the air, for the surroundings. */
  private light(act: Burst[], t: number) {
    const L: { b: Burst; w: number; col: [number, number, number] }[] = [];
    for (const b of act) {
      const tau = t - b.tBurst;
      if (tau < 0) continue;
      const u = tau / b.burn;
      // lab life switch: the last stars burn to 1.12 of the time, the group fades from 0.7
      const end = this.lab.life ? 1.12 : 1;
      const glow = u < end ? (1 - 0.3 * u) * (1 - smooth(this.lab.life ? 0.7 : 0.8, end, u)) * Math.min(1, tau / 0.05) : 0;
      const kind = SHELLS[b.shell];
      // strength against a 5号's flash: flash, then the stars' glow
      const w = (this.flashOf(b) / 3) * Math.exp(-tau / 0.08) * 2 + glow * (b.stars * kind.bright) / 300;
      if (w < 0.01) continue;
      const k = Math.min(b.colors.length - 1, Math.floor(Math.min(0.999, Math.max(0, u)) * b.colors.length));
      L.push({ b, w, col: b.colors[k] });
    }
    L.sort((x, y) => y.w - x.w || x.b.id - y.b.id);
    this.lights.length = 0;
    for (const { b, w, col } of L.slice(0, MAX_PYRO_LIGHTS)) {
      // stars drift down as they burn; the light comes from where they are
      const fall = Math.max(0, t - b.tBurst) * 3;
      tmpC.set(col[0] * w, col[1] * w, col[2] * w);
      this.lights.push({ pos: new THREE.Vector3(b.center[0], b.center[1] - fall, b.center[2]), col: tmpC.clone() });
    }
  }

  dispose() {
    this.headGeo.dispose();
    this.tailGeo.dispose();
    (this.heads.material as THREE.Material).dispose();
    (this.tails.material as THREE.Material).dispose();
    for (const m of [this.glows, this.sparks]) {
      if (!m) continue;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.tex.dispose();
  }
}

function smooth(a: number, b: number, x: number) {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
}
