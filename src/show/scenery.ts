import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { focusOf, LAND_FAR, lineFrame, railPosts, rimOutline, venuePeople } from '../venues/landscape';
import type { Pt2, ScaleTier, Venue, WaterShape } from '../venues/types';
import { CH } from './cues';
import type { ParamHistory } from './history';
import type { Layout } from './layout';

/**
 * The venue's scenery (2026-11-12): the banks and the land behind them, the
 * rails along the water, and the audience (src/venues/landscape.ts places
 * them; the venue editor's parts 岸・手すり・客). Things in front of the
 * stage give a seat depth, above all in the Vision Pro's 180° stereo.
 *
 * A night show, so all of it is dark and seen only where something lights
 * it, as the fixtures' bodies (bodies.ts): a faint moon behind the stage and
 * the night sky; the show itself — the lit columns of water (each fixture's
 * LED colour and brightness times how much water stands over it, gathered
 * into a dozen lights across the stage), the picture on the mist screens,
 * the fireworks overhead. The audience faces the show, so from the seats
 * they are black backs and heads against the bright water, their tops and
 * shoulders catching a little of its colour.
 *
 * People never cover the show from the camera: anyone standing between the
 * camera and the stage whose head would rise above the bottom tenth of the
 * show (or who is within an arm's length of the camera) is not drawn for that
 * camera. This is worked out on the GPU from the camera's position, so it
 * holds for every seat, the automatic camera, the free camera and both eyes
 * of a 180° frame.
 *
 * Four draws: the land, the rails (instanced boxes), standing and sitting
 * people (instanced). The player can hide it all (表示 → 景色, ?scenery=0);
 * hidden, nothing of it is drawn and the picture is exactly the one from
 * before it existed.
 */

/** Show lights gathered across the stage, plus the screens' pictures. */
const STAGE_BINS = 12;
const MAX_LIGHTS = 16;
/** Fixtures read per bin at most (the rest of the bin counts as these). */
const PER_BIN = 16;
/** How bright a lit column lights what is about as far from it as it is tall (tuned on the lagoon's shore). */
const COLUMN_GAIN = 0.12;
/** The projected picture's light toward the audience. */
const SCREEN_GAIN = 0.5;

/** Paving tiles (m) per scale; 0: plain. Their light and dark slabs give the ground a scale, and depth in stereo. */
const TILE: Record<ScaleTier, number> = { desk: 0, garden: 0.25, plaza: 0.6, lagoon: 1.2 };

const LIGHT_GLSL = /* glsl */ `
uniform vec3 uLightPos[${MAX_LIGHTS}];
uniform vec3 uLightCol[${MAX_LIGHTS}];
uniform float uLightR[${MAX_LIGHTS}];
uniform int uLightCount;
uniform vec3 uPyro;
// as bodies.ts: a faint moon high behind the stage, left; the night sky above, the dark water below
const vec3 MOON_DIR = vec3(-0.42, 0.62, -0.66);
const vec3 MOON = vec3(0.055, 0.062, 0.08);
const vec3 SKY = vec3(0.010, 0.013, 0.022);
const vec3 GROUND = vec3(0.0015, 0.002, 0.003);
vec3 shade(vec3 P, vec3 n, vec3 v, vec3 alb, float ks, float sp) {
  vec3 col = alb * mix(GROUND, SKY, 0.5 + 0.5 * n.y);
  vec3 L = normalize(MOON_DIR);
  col += MOON * max(dot(n, L), 0.0) * (alb + ks * pow(max(dot(n, normalize(L + v)), 0.0), sp));
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 d = uLightPos[i] - P;
    float d2 = dot(d, d);
    vec3 l = d * inversesqrt(max(d2, 1e-8));
    float r2 = uLightR[i] * uLightR[i];
    float fall = r2 / (r2 + d2);
    float nl = max(dot(n, l), 0.0);
#ifdef MATTE
    col += uLightCol[i] * (fall * nl) * alb;
#else
    col += uLightCol[i] * fall * (alb * nl + ks * nl * pow(max(dot(n, normalize(l + v)), 0.0), sp));
#endif
  }
  col += uPyro * (0.4 + 0.6 * max(n.y, 0.0)) * alb;
  return col;
}`;

// ------------------------------------------------------------------ land
const LAND_VS = /* glsl */ `
attribute float aSurf;
varying vec3 vW;
varying vec3 vN;
varying float vSurf;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normal;
  vSurf = aSurf;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const LAND_FS = /* glsl */ `
${LIGHT_GLSL}
uniform float uTile;
varying vec3 vW;
varying vec3 vN;
varying float vSurf;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  // seen from its back (a face from behind, the land from below): light that side
  if (dot(n, v) < 0.0) n = -n;
  // 0 paving along the water, 1 the ground behind it, 2 the bank's face
  vec3 alb = vSurf < 0.5 ? vec3(0.16, 0.155, 0.15) : vSurf < 1.5 ? vec3(0.04, 0.045, 0.038) : vec3(0.05, 0.05, 0.052);
  float ks = vSurf > 1.5 ? 0.3 : 0.05;
  if (uTile > 0.0 && vSurf < 1.5) {
    // slabs (or turf) a little lighter and darker, fading out where they get smaller than a pixel
    float s = vSurf < 0.5 ? uTile : uTile * 3.0;
    vec2 cell = floor(vW.xz / s);
    float px = length(fwidth(vW.xz));
    alb *= 1.0 + (h21(cell) - 0.5) * 0.35 * (1.0 - smoothstep(0.15 * s, 0.6 * s, px));
  }
  gl_FragColor = vec4(shade(vW, n, v, alb, ks, 24.0), 1.0);
}`;

// ----------------------------------------------------------------- rails
const BOX_VS = /* glsl */ `
attribute vec3 aAt;
attribute vec3 aSize;
attribute float aYaw;
varying vec3 vW;
varying vec3 vN;
vec3 yaw(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z); }
void main() {
  vec3 p = yaw(position * aSize, aYaw) + aAt;
  vW = (modelMatrix * vec4(p, 1.0)).xyz;
  vN = yaw(normal / aSize, aYaw);
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
}`;

const BOX_FS = /* glsl */ `
${LIGHT_GLSL}
varying vec3 vW;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  // dark painted steel
  gl_FragColor = vec4(shade(vW, n, v, vec3(0.05, 0.052, 0.055), 0.35, 40.0), 1.0);
}`;

// ---------------------------------------------------------------- people
const PERSON_VS = /* glsl */ `
uniform vec4 uStage;     // what stands on the water, from above: min x, min z, max x, max z
uniform vec2 uStageH;    // its usual column height (m), and how near the camera no one stands (m)
attribute vec3 aPos;     // feet
attribute vec4 aBody;    // height (m), width share, heading (0 = toward -z), clothes tone
varying vec3 vW;
varying vec3 vN;
varying float vTone;
varying float vSkin;
vec3 yaw(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z); }
// would this person cover the show from the camera?
bool blocks(vec3 feet, float top) {
  vec2 c = cameraPosition.xz;
  vec2 d = feet.xz - c;
  float dist = length(d);
  if (dist < uStageH.y) return true;
  vec2 dir = d / dist;
  vec2 safe = mix(dir, vec2(1e-6), vec2(lessThan(abs(dir), vec2(1e-6))));
  vec2 inv = 1.0 / safe;
  vec2 t0 = (uStage.xy - c) * inv;
  vec2 t1 = (uStage.zw - c) * inv;
  vec2 lo = min(t0, t1);
  vec2 hi = max(t0, t1);
  float enter = max(lo.x, lo.y);
  float leave = min(hi.x, hi.y);
  if (leave < max(enter, 0.0)) return false;   // not toward the stage
  float tE = max(enter, 0.0);
  if (dist >= tE) return false;                  // beside or behind the show
  float base = atan(-cameraPosition.y, tE);
  float topS = atan(uStageH.x - cameraPosition.y, tE);
  return atan(top - cameraPosition.y, dist) > base + 0.1 * (topS - base);
}
void main() {
  float h = aBody.x;
  vec3 local = vec3(position.x * aBody.y, position.y, position.z) * h;
  vec3 p = yaw(local, aBody.z) + aPos;
  // the head's top: the shape's highest point (1 standing, 0.52 sitting)
  float top = aPos.y + h * HEAD_TOP;
  if (blocks(aPos, top)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vW = (modelMatrix * vec4(p, 1.0)).xyz;
  vN = yaw(vec3(normal.x / aBody.y, normal.y, normal.z), aBody.z);
  vTone = aBody.w;
  vSkin = uv.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
}`;

const PERSON_FS = /* glsl */ `
${LIGHT_GLSL}
varying vec3 vW;
varying vec3 vN;
varying float vTone;
varying float vSkin;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  // clothes from near black to mid grey with a faint tint; hair and skin darker or warmer
  vec3 cloth = mix(vec3(0.025, 0.026, 0.03), vec3(0.16, 0.15, 0.14), vTone * vTone);
  cloth *= mix(vec3(1.0), vec3(0.85, 0.95, 1.15), step(0.5, fract(vTone * 7.0)));
  vec3 alb = vSkin > 0.5 ? (fract(vTone * 13.0) < 0.75 ? vec3(0.02, 0.016, 0.012) : vec3(0.09, 0.065, 0.05)) : cloth;
  gl_FragColor = vec4(shade(vW, n, v, alb, 0.06, 12.0), 1.0);
}`;

/** A tube from a to b (radii ra at a, rb at b; rx/rz squash it), oriented along a → b. */
function tube(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, segs: number, sx = 1, sz = 1, skin = 0, caps = true): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(rb, ra, len, segs, 1, !caps);
  g.scale(sx, 1, sz);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return mark(g, skin);
}

function ball(c: THREE.Vector3, rx: number, ry: number, rz: number, skin = 0): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 7, 5);
  g.scale(rx, ry, rz);
  g.translate(c.x, c.y, c.z);
  return mark(g, skin);
}

/** uv.x carries whether a vertex is skin and hair (1) or clothes (0). */
function mark(g: THREE.BufferGeometry, skin: number): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2).fill(skin), 2));
  return g;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * One person 1 m tall (scaled to each one's height), facing -z: a standing
 * adult's proportions (head an eighth of the height, shoulders a quarter
 * wide), or sitting on the ground with the knees up (head top at 0.52).
 */
function personGeometry(sit: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // few vertices (thousands of people): six-sided tubes, open where they
  // meet another part or the ground, indexed
  if (!sit) {
    parts.push(tube(V(0, 0, 0), V(0, 0.48, 0), 0.06, 0.08, 6, 1, 0.68, 0, false));
    parts.push(tube(V(0, 0.47, 0), V(0, 0.8, 0), 0.085, 0.1, 6, 1, 0.62, 0, false));
    parts.push(tube(V(0, 0.8, 0), V(0, 0.845, 0), 0.1, 0.045, 6, 1, 0.6, 0, false));
    parts.push(ball(V(0, 0.93, 0), 0.058, 0.07, 0.066, 1));
    for (const s of [-1, 1]) parts.push(tube(V(s * 0.12, 0.79, 0), V(s * 0.125, 0.46, 0.01), 0.032, 0.026, 4, 1, 1, 0, false));
  } else {
    parts.push(tube(V(0, 0.02, 0.02), V(0, 0.36, 0.04), 0.1, 0.095, 6, 1, 0.65, 0, false));
    parts.push(tube(V(0, 0.35, 0.04), V(0, 0.395, 0.04), 0.095, 0.045, 6, 1, 0.6, 0, false));
    parts.push(ball(V(0, 0.465, 0.035), 0.058, 0.07, 0.066, 1));
    // both legs as one block, knees up, the arms round them hidden in it
    parts.push(tube(V(0, 0.07, 0), V(0, 0.21, -0.22), 0.07, 0.06, 6, 1.9, 0.9, 0, false));
    parts.push(tube(V(0, 0.21, -0.22), V(0, 0.02, -0.33), 0.055, 0.05, 6, 2.1, 0.9, 0, true));
  }
  const g = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return g;
}

/** A flat piece of land at height y (its outline, holes cut out), facing up. */
function flat(outer: Pt2[], holes: Pt2[][], y: number, surf: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, z))));
  const g = new THREE.ShapeGeometry(shape).toNonIndexed();
  const pos = g.getAttribute('position');
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) out.set([pos.getX(i), y, pos.getY(i)], i * 3);
  g.dispose();
  return land(out, [0, 1, 0], surf);
}

/** A vertical face along a polyline from the water up to y, facing to the left of each step (+ its normal). */
function face(line: Pt2[], y: number, closed: boolean, toward: (a: Pt2, b: Pt2) => Pt2): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const n = closed ? line.length : line.length - 1;
  for (let i = 0; i < n; i++) {
    const a = line[i];
    const b = line[(i + 1) % line.length];
    const [nx, nz] = toward(a, b);
    const quad = [
      [a[0], 0, a[1]],
      [b[0], 0, b[1]],
      [b[0], y, b[1]],
      [a[0], 0, a[1]],
      [b[0], y, b[1]],
      [a[0], y, a[1]],
    ];
    for (const q of quad) {
      pos.push(...q);
      nor.push(nx, 0, nz);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aSurf', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(2), 1));
  return g;
}

function land(pos: Float32Array, n: [number, number, number], surf: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const nor = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) nor.set(n, i);
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aSurf', new THREE.BufferAttribute(new Float32Array(pos.length / 3).fill(surf), 1));
  return g;
}

/** Is the outline clockwise seen from above with z down (the shape's own sense)? */
const clockwise = (pts: Pt2[]) => THREE.ShapeUtils.isClockWise(pts.map(([x, z]) => new THREE.Vector2(x, z)));

/** The land of every bank: the paved strip, the ground to the horizon, the face down to the water. */
function landGeometry(venue: Venue): THREE.BufferGeometry | null {
  const sc = venue.scenery;
  if (!sc?.shores.length) return null;
  const w: WaterShape = venue.water;
  const parts: THREE.BufferGeometry[] = [];
  for (const s of sc.shores) {
    const y = s.height;
    if (s.rim) {
      if (w.kind === 'infinite') continue;
      const edge = rimOutline(w, 0);
      const strip = rimOutline(w, Math.max(s.width, 1e-4));
      const F = LAND_FAR;
      parts.push(flat(strip, [edge], y, 0));
      parts.push(flat([[-F, -F], [F, -F], [F, F], [-F, F]], [strip], y, 1));
      // the face looks into the water: toward the inside of the outline
      const cw = clockwise(edge);
      parts.push(face(edge, y, true, (a, b) => {
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const l = Math.hypot(dx, dz) || 1;
        return cw ? [dz / l, -dx / l] : [-dz / l, dx / l];
      }));
    } else {
      const { n, t } = lineFrame(s.from, s.to);
      const at = (p: Pt2, d: number): Pt2 => [p[0] + n[0] * d, p[1] + n[1] * d];
      const wd = Math.max(s.width, 1e-4);
      parts.push(flat([s.from, s.to, at(s.to, wd), at(s.from, wd)], [], y, 0));
      parts.push(flat([at(s.from, wd), at(s.to, wd), at(s.to, LAND_FAR), at(s.from, LAND_FAR)], [], y, 1));
      // the bank's face toward the water, and its two ends
      parts.push(face([s.from, s.to], y, false, () => [-n[0], -n[1]]));
      parts.push(face([s.from, at(s.from, LAND_FAR)], y, false, () => [-t[0], -t[1]]));
      parts.push(face([s.to, at(s.to, LAND_FAR)], y, false, () => [t[0], t[1]]));
    }
  }
  if (!parts.length) return null;
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
}

export class SceneryView {
  /** Everything; hidden by the player's 表示 → 景色. */
  readonly object = new THREE.Group();
  /** The rails and the people: left out of the water's reflection (small and dark, and costly to draw twice). */
  readonly unreflected = new THREE.Group();
  /** People drawn at most (some are left out per camera), rail posts. */
  readonly people: number;
  readonly posts: number;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.ShaderMaterial[] = [];
  private lights = {
    uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
    uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
    uLightR: { value: new Array<number>(MAX_LIGHTS).fill(1) },
    uLightCount: { value: 0 },
    uPyro: { value: new THREE.Vector3() },
  };
  /** Fixtures read for the show's light, per bin, and how many each stands for. */
  private bins: { fixtures: number[]; weight: number }[] = [];
  private lastKey = NaN;
  private screenLights: { pos: THREE.Vector3; col: THREE.Vector3; r: number }[] = [];

  constructor(
    private layout: Layout,
    venue: Venue = layout.venue,
  ) {
    this.object.name = 'scenery';
    this.object.add(this.unreflected);
    const sc = venue.scenery;
    const scale = venue.scale;

    // ---- the show's light: fixtures gathered across the stage
    const fx = layout.fixtures;
    if (fx.length) {
      const xs = fx.map((f) => f.position[0]);
      const x0 = Math.min(...xs);
      const span = Math.max(1e-6, Math.max(...xs) - x0);
      const groups: number[][] = Array.from({ length: STAGE_BINS }, () => []);
      for (const f of fx) groups[Math.min(STAGE_BINS - 1, Math.floor(((f.position[0] - x0) / span) * STAGE_BINS))].push(f.index);
      for (const g of groups) {
        if (!g.length) continue;
        const step = Math.max(1, Math.ceil(g.length / PER_BIN));
        const pick = g.filter((_, i) => i % step === 0);
        this.bins.push({ fixtures: pick, weight: g.length / pick.length });
      }
    }

    // ---- land
    const landGeo = landGeometry(venue);
    if (landGeo) {
      // matte (the ground's sheen was not seen), and left out of the water's
      // reflection: on the plaza, where it fills half the frame, the two cost 6 ms
      const m = this.material(LAND_VS, LAND_FS, { uTile: { value: TILE[scale] } }, { MATTE: '' });
      m.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(landGeo, m);
      mesh.frustumCulled = false;
      this.unreflected.add(mesh);
      this.geos.push(landGeo);
    }

    // ---- rails: posts, the top rail and a middle one, as boxes
    const boxes: { at: [number, number, number]; size: [number, number, number]; yaw: number }[] = [];
    for (const r of sc?.rails ?? []) {
      const { t, len } = lineFrame(r.from, r.to);
      const yaw = Math.atan2(t[1], t[0]);
      const post = Math.max(0.002, r.height * 0.05);
      const bar = Math.max(0.0015, r.height * 0.042);
      for (const p of railPosts(r)) boxes.push({ at: [p[0], r.base + r.height / 2, p[1]], size: [post, r.height, post], yaw });
      const mid: [number, number] = [(r.from[0] + r.to[0]) / 2, (r.from[1] + r.to[1]) / 2];
      boxes.push({ at: [mid[0], r.base + r.height - bar / 2, mid[1]], size: [len + post, bar, bar * 1.2], yaw });
      boxes.push({ at: [mid[0], r.base + r.height * 0.5, mid[1]], size: [len, bar * 0.8, bar * 0.8], yaw });
    }
    this.posts = boxes.length;
    if (boxes.length) {
      const base = new THREE.BoxGeometry(1, 1, 1);
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index;
      g.setAttribute('position', base.getAttribute('position'));
      g.setAttribute('normal', base.getAttribute('normal'));
      g.setAttribute('aAt', new THREE.InstancedBufferAttribute(new Float32Array(boxes.flatMap((b) => b.at)), 3));
      g.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(boxes.flatMap((b) => b.size)), 3));
      // yaw turns +x toward the rail's direction: the box shader turns by -yaw's sense, so pass the angle as it is
      g.setAttribute('aYaw', new THREE.InstancedBufferAttribute(new Float32Array(boxes.map((b) => b.yaw)), 1));
      g.instanceCount = boxes.length;
      const mesh = new THREE.Mesh(g, this.material(BOX_VS, BOX_FS));
      mesh.frustumCulled = false;
      this.unreflected.add(mesh);
      this.geos.push(g, base);
    }

    // ---- people
    const pts: Pt2[] = [...venue.groups.flatMap((g) => g.positions.map((p) => [p[0], p[2]] as Pt2)), ...venue.screens.map((s) => [s.center[0], s.center[2]] as Pt2)];
    const focus = focusOf(pts);
    const all = venuePeople(sc, venue.water, focus);
    this.people = all.length;
    if (all.length) {
      // the stage seen from above, and its usual column height
      const xs = pts.map((p) => p[0]);
      const zs = pts.map((p) => p[1]);
      const sx = Math.max(...xs) - Math.min(...xs);
      const sz = Math.max(...zs) - Math.min(...zs);
      const pad = 0.02 * Math.max(sx, sz, 0.1);
      const heights = layout.fixtures.map((f) => f.spec.height).sort((a, b) => a - b);
      const usual = heights.length ? heights[Math.floor(heights.length / 2)] : 1;
      const stage = {
        uStage: { value: new THREE.Vector4(Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad) },
        // no one stands within 0.6 m of the camera (a person's own space)
        uStageH: { value: new THREE.Vector2(usual, 0.6) },
      };
      for (const sit of [false, true]) {
        const list = all.filter((p) => p.sit === sit);
        if (!list.length) continue;
        const base = personGeometry(sit);
        const g = new THREE.InstancedBufferGeometry();
        g.index = base.index;
        g.setAttribute('position', base.getAttribute('position'));
        g.setAttribute('normal', base.getAttribute('normal'));
        g.setAttribute('uv', base.getAttribute('uv'));
        g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap((p) => [p.x, p.y, p.z])), 3));
        g.setAttribute('aBody', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap((p) => [p.h, p.w, p.yaw, p.tone])), 4));
        g.instanceCount = list.length;
        const m = this.material(PERSON_VS, PERSON_FS, stage, { HEAD_TOP: sit ? '0.53' : '1.0' });
        const mesh = new THREE.Mesh(g, m);
        mesh.frustumCulled = false;
        this.unreflected.add(mesh);
        this.geos.push(g, base);
      }
    }
  }

  private material(vs: string, fs: string, extra: Record<string, THREE.IUniform> = {}, defines: Record<string, string> = {}) {
    const m = new THREE.ShaderMaterial({ uniforms: { ...this.lights, ...extra }, vertexShader: vs, fragmentShader: fs, defines });
    this.mats.push(m);
    return m;
  }

  /** Anything to draw? */
  get empty(): boolean {
    return this.object.children.length === 1 && this.unreflected.children.length === 0;
  }

  /** The pictures on the mist screens light the audience too (set before update()). */
  setScreenLights(lights: { pos: THREE.Vector3; col: THREE.Vector3; r: number }[]) {
    this.screenLights = lights;
  }

  /** Fireworks' light from overhead (linear colour), zero without fireworks. */
  setPyro(c: THREE.Vector3) {
    this.lights.uPyro.value.copy(c);
  }

  /** The show's light at time t (after the history was brought up to t). */
  update(t: number, history: ParamHistory) {
    const key = Math.round(t * 120);
    if (key === this.lastKey && !this.screenLights.length) return;
    this.lastKey = key;
    const L = this.lights;
    const fx = this.layout.fixtures;
    let k = 0;
    for (const bin of this.bins) {
      let wx = 0;
      let wy = 0;
      let wz = 0;
      let wsum = 0;
      let r2 = 0;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      for (const i of bin.fixtures) {
        const p = history.current(i, CH.pressure, t);
        if (p < 0.02) continue;
        const I = Math.max(0, history.current(i, CH.intensity, t));
        if (I <= 0) continue;
        const f = fx[i];
        const H = Math.max(1e-3, f.spec.height * Math.min(1, p));
        const e = I * Math.sqrt(Math.min(1, p)) * bin.weight;
        cr += Math.max(0, history.current(i, CH.r, t)) * e;
        cg += Math.max(0, history.current(i, CH.g, t)) * e;
        cb += Math.max(0, history.current(i, CH.b, t)) * e;
        wx += f.position[0] * e;
        wy += 0.45 * H * e;
        wz += f.position[2] * e;
        r2 += H * H * e;
        wsum += e;
      }
      if (wsum <= 0) continue;
      L.uLightPos.value[k].set(wx / wsum, wy / wsum, wz / wsum);
      // a bin's columns together: brightness grows with how many there are (a sqrt: they hide each other)
      const n = Math.sqrt(wsum) / wsum;
      L.uLightCol.value[k].set(cr * n * COLUMN_GAIN, cg * n * COLUMN_GAIN, cb * n * COLUMN_GAIN);
      L.uLightR.value[k] = Math.sqrt(r2 / wsum);
      k++;
    }
    for (const s of this.screenLights) {
      if (k >= MAX_LIGHTS) break;
      L.uLightPos.value[k].copy(s.pos);
      L.uLightCol.value[k].copy(s.col).multiplyScalar(SCREEN_GAIN);
      L.uLightR.value[k] = s.r;
      k++;
    }
    L.uLightCount.value = k;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
