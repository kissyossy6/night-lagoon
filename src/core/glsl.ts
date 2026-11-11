/**
 * Shared GLSL: hashing, closed-form ballistics and the water lighting model.
 *
 * PHYSICS and LIGHT are generic: they take a `Fix` (the physical description
 * of one fixture) plus the nozzle state at the moment a water element left
 * it. The lab feeds them from uniforms and analytic motion (LAB_*); the show
 * feeds them from the fixture table and the parameter-history textures.
 *
 * Particles are evaluated analytically from (seed, age) instead of being
 * integrated step by step. With linear drag the design doc's update rule has a
 * closed-form solution, so the result is the same trajectory but any time can
 * be rendered directly (seek needs no pre-roll).
 */

export const HASH = /* glsl */ `
#define PI 3.14159265359
const float G = 9.81;
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(uint s) { return float(pcg(s)) / 4294967295.0; }
vec4 rnd4(uint s) {
  uint a = pcg(s);
  uint b = pcg(a);
  uint c = pcg(b);
  uint d = pcg(c);
  return vec4(float(a), float(b), float(c), float(d)) / 4294967295.0;
}
// Smooth 1D value noise per channel: used by strands so their random
// parameters drift continuously along the stream instead of jumping.
vec4 smooth4(float id, float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  uint base = uint(id) * 7919u;
  vec4 a = rnd4(base + uint(int(i) + 100000));
  vec4 b = rnd4(base + uint(int(i) + 100001));
  return mix(a, b, f);
}
// Random unit vector for particles (independent per element).
vec3 kickDir(uint s) {
  vec4 k = rnd4(s * 2654435761u + 99u);
  float z = k.x * 2.0 - 1.0;
  float a = 2.0 * PI * k.y;
  return vec3(sqrt(1.0 - z * z) * cos(a), z, sqrt(1.0 - z * z) * sin(a));
}
vec3 rotZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
`;

export const PHYSICS = /* glsl */ `
uniform vec3  uWind;
uniform float uWindC;

// Physical description of one fixture (constant over the show).
struct Fix {
  int   type;     // 0 vertical, 1 shooter, 2 oscillating, 3 fan, 4 ring
  vec3  origin;
  float height;   // apex at pressure 1 (m)
  float jets;     // sub-jets (fan blades, ring jets)
  vec4  p;        // type params: fan x opening; ring x radius, y base tilt
  float spread;   // cone half-angle of the coherent core (rad)
  float bore;     // nozzle diameter (m)
  float aer;      // aeration 0 (glassy) .. 1 (white water)
  float brk;      // nominal break-up time (s)
  float kCol;     // drag of the coherent column (1/s)
  float kDrop;    // drag of the largest drops (1/s)
  float kMist;    // drag of mist droplets (1/s)
  float turb;     // turbulent lateral velocity after break-up (fraction of speed)
  float beam;     // LED ring half-angle at half intensity (rad)
  float candela;  // ring on-axis intensity relative to a 20,000 cd ring
  float beamLen;  // beam extinction length in foam (m)
  float fadeLen;  // real lighting: 1/e fade along the path after compression (m), 0 = none
  float fallFade; // real lighting: 1/e fade per metre fallen after the apex (m), 0 = none
  float guide;    // real lighting: share of the light carried inside the column (0..1)
};

// Head direction from pan (toward +x) and tilt (toward the audience, +z).
vec3 headDir(float pan, float tilt) {
  return rotX(rotZ(vec3(0.0, 1.0, 0.0), -pan), tilt);
}

// Geometry of sub-jet 'jet' for a head pointing along 'head'. 'extraTilt'
// opens a ring outward (bloom).
void subJet(Fix f, vec3 head, float extraTilt, float jet, out vec3 p0, out vec3 dir) {
  p0 = f.origin;
  dir = head;
  if (f.type == 3) {
    float u = f.jets > 1.0 ? jet / (f.jets - 1.0) - 0.5 : 0.0;
    // blades spread in the head's left-right plane
    vec3 side = normalize(cross(head, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
    float a = u * f.p.x;
    dir = normalize(head * cos(a) - side * sin(a));
  } else if (f.type == 4) {
    float a = 2.0 * PI * jet / f.jets;
    vec3 radial = vec3(cos(a), 0.0, sin(a));
    p0 += radial * f.p.x;
    float t = f.p.y + extraTilt;
    dir = normalize(head * cos(t) + radial * sin(t));
  }
}

// Exit speed that reaches apex height h under linear drag k (Newton on the
// closed-form apex height).
float exitSpeed(float h, float k) {
  float U = sqrt(2.0 * G * max(h, 0.01));
  for (int i = 0; i < 4; i++) {
    float f = U / k - G / (k * k) * log(1.0 + k * U / G) - h;
    float df = (U / G) / (1.0 + k * U / G);
    U -= f / df;
  }
  return U;
}

// v' = -k v + g + c (w - v), solved exactly over t.
void ballistic(inout vec3 p, inout vec3 v, float k, float t) {
  float kk = k + uWindC;
  vec3 vT = (vec3(0.0, -G, 0.0) + uWindC * uWind) / kk;
  float e = exp(-kk * t);
  p += vT * t + (v - vT) * (1.0 - e) / kk;
  v = vT + (v - vT) * e;
}

struct Drop {
  vec3 p;       // position
  vec3 v;       // velocity
  vec3 base;    // nozzle position
  float age;
  float press;  // pressure at birth
  float coh;    // 1 while still part of the coherent column
  float core;   // 0 = stripped surface (mist) .. 1 = jet core (big drops)
  float tBreak; // break-up time of this element
  float alive;
  float jet;    // sub-jet index
};

// One element of water that left sub-jet 'jet' at (base, dir) with pressure
// 'press', 'age' seconds ago.
//   r: r.y core-ness, r.z cone radius / speed, r.w cone angle
//   kick: unit direction of the turbulent kick at break-up
Drop dropFrom(Fix f, vec3 base, vec3 dir, float press, float jet, vec4 r, vec3 kick, float age, float coreBias) {
  Drop d;
  d.jet = jet;
  d.base = base;
  d.press = press;
  d.age = age;
  d.core = pow(r.y, coreBias);
  // cone jitter, tighter for the core; aerated water bulks up as it entrains
  // air, so its cone does not tighten with the core
  float th = f.spread * mix(1.15 - d.core, 1.0, f.aer * 0.8) * sqrt(r.z);
  float ph = 2.0 * PI * r.w;
  vec3 t1 = normalize(abs(dir.y) < 0.99 ? cross(dir, vec3(0, 1, 0)) : cross(dir, vec3(1, 0, 0)));
  vec3 t2 = cross(dir, t1);
  dir = normalize(dir + tan(th) * (cos(ph) * t1 + sin(ph) * t2));
  d.base += (cos(ph) * t1 + sin(ph) * t2) * f.bore * 0.5 * sqrt(r.z);
  // the column leaves as one body; speed scatter belongs to the stripped water
  float U = exitSpeed(press * f.height, f.kCol) * (1.0 + 0.05 * (r.z - 0.5) * (1.0 - d.core));
  d.tBreak = f.brk * sqrt(max(press, 0.05)) * d.core / (1.04 - d.core);
  // an aerated whip (or a fan's blade) has no glassy core that holds to the
  // end: all of it has frayed into drops by about the top of its arc (World of Color footage,
  // the user, 2026-11-06)
  if (f.type == 2 || f.type == 3) d.tBreak = min(d.tBreak, f.brk * 1.8 * sqrt(max(press, 0.05)) * (0.6 + 0.4 * d.core));
  d.p = d.base;
  d.v = dir * U;
  float kd = mix(f.kMist, f.kDrop, d.core);
  if (age < d.tBreak) {
    ballistic(d.p, d.v, f.kCol, age);
    d.coh = 1.0;
  } else {
    ballistic(d.p, d.v, f.kCol, d.tBreak);
    d.v += kick * f.turb * length(d.v) * (1.2 - d.core);
    ballistic(d.p, d.v, kd, age - d.tBreak);
    d.coh = 0.0;
  }
  d.alive = step(0.0, d.p.y) * step(0.02, press);
  return d;
}
`;

export const LIGHT = /* glsl */ `
// Length of the path the water has followed from the nozzle: up to the top
// of its arc, then down what it has fallen since (ballistic, drag ignored).
// The water that hangs down from an arc has come a long way, though it may
// be close to the nozzle again.
float pathFrom(Drop d) {
  float fall = d.v.y < 0.0 ? d.v.y * d.v.y / 19.62 : 0.0;
  float top = d.p.y + fall - d.base.y;
  return length(vec2(length(d.p.xz - d.base.xz), top)) + fall;
}

float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

// Scattered radiance of one water element lit by its nozzle's LED ring.
//   ringPos / ringAxis: the ring and the direction it points *now* (light
//   is instantaneous; the ring sits on the moving head)
//   model 0 design doc: C * I / (1 + (d/d0)^2) * HG(g = 0.7)
//   model 1 ideal: colour carried evenly up the column (guided light),
//           two-lobe phase plus isotropic scatter for aerated water
//   model 2 real, uncompressed: coaxial ring beam, inverse square
//   model 3 light inside a laminar nozzle (total internal reflection)
//   model 4 real: model 2 plus light guided along the unbroken column, with
//           the falloff compressed for the eye
vec3 shadeDrop(Drop d, Fix f, vec3 ringPos, vec3 ringAxis, vec3 light, int model, vec3 camPos) {
  vec3 L = d.base - vec3(0.0, 0.35, 0.0);
  vec3 toP = d.p - L;
  float dist = length(toP);
  vec3 toCam = normalize(camPos - d.p);
  float c = dot(toP / max(dist, 1e-3), toCam);
  float atten = 1.0 / (1.0 + pow(dist / 7.0, 2.0));
  if (model == 0) {
    return light * atten * hg(c, 0.7) * 4.0 * PI * 0.35;
  }
  float iso = 1.0 / (4.0 * PI);
  // path length the water has travelled from the nozzle
  float travelled = max(pathFrom(d), d.age * 4.0);
  if (model == 1) {
    float phase = mix(hg(c, 0.75), hg(c, -0.3), 0.3);
    phase = mix(phase, iso, 0.35 + 0.5 * f.aer) * 4.0 * PI;
    float guide = exp(-travelled / mix(10.0, 22.0, d.core));
    float leak = d.coh > 0.5 ? mix(0.15, 0.9, f.aer) : 1.0 - smoothstep(0.0, 0.7, d.age - d.tBreak);
    return light * (atten * phase * 0.45 + guide * leak * 0.9);
  }
  if (model == 2 || model == 4) {
    // One RGB LED ring per nozzle, coaxial and mounted on the moving head
    // (Disney US7886992). Water that left during an earlier stroke has
    // curved out of the cone and goes dark.
    vec3 Lr = ringPos - vec3(0.0, 0.05, 0.0);
    vec3 rp = d.p - Lr;
    float dr = length(rp);
    vec3 rd = rp / max(dr, 1e-3);
    float th = acos(clamp(dot(rd, ringAxis), -1.0, 1.0));
    float beam = exp(-0.693 * pow(th / f.beam, 2.0));
    // inverse square from the ring, normalised to 1 at 6 m for a 20,000 cd ring
    float E = f.candela * beam * 36.0 / (dr * dr + 0.3);
    // foam near the base uses the beam up (Beer-Lambert along the axis)
    E *= exp(-max(dot(rp, ringAxis), 0.0) * f.aer / f.beamLen);
    if (model == 4) {
      // the unbroken column is a light guide for its own ring: light that
      // entered at the nozzle follows the column round the curve and leaks
      // out through the bubbles, so a tilted whip stays lit end to end
      // (World of Color footage, docs/video-review.md R1). Broken-up water
      // is cut off from the guide.
      float guideLen = mix(22.0, 10.0, f.aer);
      // froth stays in optical contact longer than clear water breaking up
      float link = d.coh > 0.5 ? 1.0 : 1.0 - smoothstep(0.0, mix(0.35, 1.5, f.aer * f.aer), d.age - d.tBreak);
      E += f.candela * 0.45 * exp(-travelled / guideLen) * link * f.guide;
      // the eye (and a show camera) reads a 100x falloff as "dimmer", not
      // "black": 1 at 6 m stays 1
      E = sqrt(E);
      // ...and the water just above the ring, 5-8x brighter than at 6 m,
      // reads as a bright foot, not as white: past the knee the excess
      // rolls off, so the tone curve keeps its colour. A short grid jet
      // lives entirely in this zone and went white end to end (the user,
      // 2026-10-27)
      const float KNEE = 1.5;
      if (E > KNEE) E = KNEE + (E - KNEE) / (1.0 + (E - KNEE) / KNEE);
      // ...but the eye does see a tall arc thin toward its tip, and the
      // water hanging down from it most (the user, 2026-10-27)
      if (f.fadeLen > 0.0) E *= exp(-travelled / f.fadeLen);
      // ...and the water hanging down from the arc darker still: the beam
      // misses it and little light is left inside it (the user, 2026-11-06)
      if (f.fallFade > 0.0) {
        float fallen = d.v.y < 0.0 ? d.v.y * d.v.y / 19.62 : 0.0;
        E *= exp(-fallen / f.fallFade);
      }
    }
    // foam scatters nearly isotropically, broken-up drops strongly forward,
    // clear coherent water hardly at all
    float c2 = dot(rd, toCam);
    float pFoam = hg(c2, 0.3);
    float pDrop = hg(c2, 0.8);
    float p = d.coh > 0.5 ? mix(0.1 * pDrop, pFoam, f.aer) : mix(pDrop, pFoam, f.aer * 0.5);
    // secondary light (neighbouring jets, glow pool, mist) keeps beam-less
    // water from going fully black
    float fill = 0.012;
    return light * (E * p * 4.0 * PI * 0.5 + fill);
  }
  // model 3: the clear rod is nearly invisible (light stays trapped) except at
  // surface flaws; it escapes where the stream breaks
  float trapped = exp(-travelled / 40.0);
  if (d.coh > 0.5) {
    return light * trapped * mix(0.12, 0.5, f.aer);
  }
  float escape = exp(-(d.age - d.tBreak) / 0.35);
  return light * trapped * (escape * 1.6 + 0.04);
}
`;

// ------------------------------------------------------------------ lab

/** Lab adapter: one fixture described by uniforms, motion as analytic functions. */
export const NOZZLE_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform int   uType;      // 0 vertical, 1 shooter, 2 oscillating, 3 fan, 4 ring, 5 mist
uniform vec3  uOrigin;
uniform float uHeight;    // apex height at pressure 1 (m)
uniform float uPressure;  // 0..1
uniform float uJets;      // sub-jets (fan blades, ring jets, oscillating line)
uniform vec4  uP;         // type params, see emitter()
uniform vec4  uP2;
uniform float uSpread;
uniform float uBore;
uniform float uAer;
uniform float uBreak;
uniform float uKCol;
uniform float uKDrop;
uniform float uKMist;
uniform float uTurb;
uniform vec3  uLightColor;
uniform float uLightI;
uniform int   uLightModel;
uniform float uBeam;
uniform float uGuideLen;
uniform float uCandela;
`;

export const LAB_ADAPTER = /* glsl */ `
Fix labFix() {
  Fix f;
  f.type = uType;
  f.origin = uOrigin;
  f.height = uHeight;
  f.jets = uJets;
  f.p = uP;
  f.spread = uSpread;
  f.bore = uBore;
  f.aer = uAer;
  f.brk = uBreak;
  f.kCol = uKCol;
  f.kDrop = uKDrop;
  f.kMist = uKMist;
  f.turb = uTurb;
  f.beam = uBeam;
  f.candela = uCandela;
  f.beamLen = uGuideLen;
  f.fadeLen = 0.0;
  f.fallFade = 0.0;
  f.guide = 1.0;
  return f;
}

// Nozzle state at time tb for sub-jet 'jet', with the lab's analytic motion.
// Returns pressure 0..1.
float emitter(float tb, float jet, out vec3 p0, out vec3 dir) {
  p0 = uOrigin;
  dir = vec3(0.0, 1.0, 0.0);
  float press = uPressure;
  float lane = jet - (uJets - 1.0) * 0.5;
  if (uType == 0) {                       // vertical jet line: uP.x spacing
    p0.x += lane * uP.x;
  } else if (uType == 1) {                // shooter: uP.x period, uP.y shot length, uP.z phase, uP.w spacing
    float ph = mod(tb - uP.z, uP.x);
    press *= smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(uP.y * 0.7, uP.y, ph));
    p0.x += lane * uP.w;
  } else if (uType == 2) {                // oscillating: uP.x pan amp, uP.y period, uP.z tilt amp, uP.w spacing; uP2.x phase step
    float ph = 2.0 * PI * tb / uP.y + jet * uP2.x;
    dir = rotZ(dir, uP.x * sin(ph));
    dir = rotX(dir, uP.z * sin(2.0 * ph));
    p0.x += lane * uP.w;
  } else if (uType == 3) {                // fan: uP.x opening, uP.y sway amp, uP.z sway period
    float f = uJets > 1.0 ? jet / (uJets - 1.0) - 0.5 : 0.0;
    dir = rotZ(dir, f * uP.x + uP.y * sin(2.0 * PI * tb / uP.z));
  } else if (uType == 4) {                // ring: uP.x radius, uP.y tilt (+out), uP.z tilt swing, uP.w period
    float a = 2.0 * PI * jet / uJets;
    vec3 radial = vec3(cos(a), 0.0, sin(a));
    p0 += radial * uP.x;
    float tilt = uP.y + uP.z * sin(2.0 * PI * tb / uP.w);
    dir = normalize(vec3(0.0, cos(tilt), 0.0) + radial * sin(tilt));
  }
  return press;
}

Drop drop(vec4 r, vec3 kick, float age, float coreBias) {
  float jet = min(floor(r.x * uJets), uJets - 1.0);
  vec3 base, dir;
  float press = emitter(uTime - age, jet, base, dir);
  return dropFrom(labFix(), base, dir, press, jet, r, kick, age, coreBias);
}

vec3 shadeDrop(Drop d, vec3 camPos) {
  // a fan has one ring around the whole nozzle: its axis is the centre line
  vec3 ringPos, axis;
  emitter(uTime, uType == 3 ? (uJets - 1.0) * 0.5 : d.jet, ringPos, axis);
  return shadeDrop(d, labFix(), ringPos, axis, uLightColor * uLightI, uLightModel, camPos);
}
`;

export const GLSL_ALL = HASH + NOZZLE_UNIFORMS + PHYSICS + LIGHT + LAB_ADAPTER;
