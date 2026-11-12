import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { kind } from '../fixtures';
import { HISTORY_GLSL, RATE, type ParamHistory } from './history';
import type { Fixture, Layout } from './layout';

/**
 * The fixtures' bodies (2026-11-12): the nozzle, pump or head each fountain
 * stands on, the water screens' pipes, the projector and the fireworks
 * tubes. Until then only water and light were drawn.
 *
 * A night show, so the bodies are dark metal and resin, seen only where
 * something lights them: a faint moon and the night sky, the fixture's own
 * LED ring (its colour and brightness as the cues set them, read from the
 * same parameter history as the water, and stronger while its lit column of
 * water stands over it) and the fireworks overhead. The LED ring itself
 * glows in its colour and goes dark at brightness 0. A head that turns
 * (Fixture.turns: whips, the lagoon's fans) turns with the cue's pan and tilt
 * exactly as the water's direction is made (headDir in core/glsl.ts), so
 * the nozzle points where its water goes.
 *
 * Simple hand-made shapes (cylinders, cones, spheres, rings, boxes), sized
 * from each fixture's bore and height: a 12 m lagoon grid and a 10 cm desk
 * jet differ by a hundred times. In the lagoon they stand on platforms under
 * the water and only their heads come out of it, as World of Color's do.
 *
 * Drawn as one instanced mesh per shape, all moved on the GPU, so the cost
 * does not grow with the number of draw calls. The player can hide them
 * (表示 → 機材, ?fixtures=0); hidden, nothing of them is drawn and the
 * picture is exactly the one from before they existed.
 */

type Prim = 'cyl' | 'cone' | 'flare' | 'torus' | 'sphere' | 'box';
const PRIMS: Prim[] = ['cyl', 'cone', 'flare', 'torus', 'sphere', 'box'];

/** How a part moves: fixed, with the head (pan and tilt), or with the tilt only (the gimbal's outer ring). */
const enum Mode {
  Fixed = 0,
  Head = 1,
  Tilt = 2,
}
/** What a part is made of. */
const enum Surf {
  Metal = 0,
  Resin = 1,
  Led = 2,
  Lens = 3,
}
/** Laying a part down before it is placed: its long (y) axis along x or along z. */
const enum Lay {
  Up = 0,
  AlongX = 1,
  AlongZ = 2,
}

type V3 = [number, number, number];

interface Part {
  prim: Prim;
  /** Centre, in the fixture's frame (y up from the nozzle exit; the head's frame for a part that moves). */
  at: V3;
  /** Size along x, y, z (the shape's own axes before it is laid down). */
  size: V3;
  mode?: Mode;
  surf?: Surf;
  lay?: Lay;
}

interface Body {
  /** Channel whose history drives it (fixture or projector zone), -1 for none. */
  ch: number;
  origin: V3;
  /** The LED ring (in the head's frame when it turns) and how far its light reaches on the body (m); 0: no own light. */
  led: V3;
  reach: number;
  turns: boolean;
  parts: Part[];
}

const cyl = (r: number, y0: number, y1: number, o: Partial<Part> = {}): Part => ({ prim: 'cyl', at: [0, (y0 + y1) / 2, 0], size: [r, y1 - y0, r], ...o });
/** A ring (torus) of radius R lying flat, its tube t thick. */
const ring = (R: number, t: number, y: number, o: Partial<Part> = {}): Part => ({ prim: 'torus', at: [0, y, 0], size: [R, t / 0.2, R], ...o });

/** The parts of one water fixture, sized from its bore and height. */
function fixtureBody(fx: Fixture): Body {
  const s = fx.spec;
  const style = kind(fx.kind).nozzle?.body ?? 'nozzle';
  const H = Mode.Head;
  const turn = fx.turns;
  const head = turn ? H : Mode.Fixed;
  const parts: Part[] = [];
  let led: V3 = [0, 0, 0];
  let reach = 0;

  if (style === 'pump') {
    // a small desk pump just under the surface: a black head, the nozzle
    // tube, and LED beads round the nozzle
    const u = Math.max(0.003, s.bore * 2.4);
    parts.push(cyl(u, -1.6 * u, 0.3 * u, { surf: Surf.Resin }));
    parts.push(cyl(0.3 * u, 0.3 * u, 1.25 * u));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      parts.push({ prim: 'sphere', at: [Math.cos(a) * 0.68 * u, 0.36 * u, Math.sin(a) * 0.68 * u], size: [0.2 * u, 0.2 * u, 0.2 * u], surf: Surf.Led });
    }
    led = [0, 0.4 * u, 0];
    reach = 2.5 * u;
  } else if (style === 'floor') {
    // under a floor grate: the rim and bars of the grate at the floor, the
    // nozzle's tip and its LED ring seen through the holes
    const u = Math.max(0.01, s.bore * 2.5);
    parts.push(ring(2.6 * u, 0.32 * u, 0.012));
    for (const d of [-0.9, 0.9]) {
      parts.push({ prim: 'box', at: [d * u, 0.012, 0], size: [0.22 * u, 0.3 * u, 5 * u] });
      parts.push({ prim: 'box', at: [0, 0.012, d * u], size: [5 * u, 0.3 * u, 0.22 * u] });
    }
    parts.push(cyl(0.42 * u, -1.5 * u, 0.15 * u, { mode: head }));
    parts.push(ring(0.42 * u, 0.12 * u, 0.15 * u, { mode: head }));
    parts.push(ring(1.15 * u, 0.25 * u, 0.004, { surf: Surf.Led }));
    led = [0, 0.004, 0];
    reach = 3 * u;
  } else if (fx.type === 'oscillating' || fx.type === 'fan') {
    // a moving head on a two-axis gimbal (a whip, the lagoon's fans): a drum
    // under the water, the yoke's arms, the outer ring that tilts, and the
    // barrel that pans and tilts, pivoting at the nozzle exit (the water's
    // origin) so the water leaves along the barrel. The garden's small fan
    // does not turn: the same head, fixed upright on its stem
    const fan = fx.type === 'fan';
    // small for its height: the machine stays under the water, only the
    // head out of it (seen low over the water, a big head was a black box
    // on the horizon)
    const u = Math.max(0.006, (fan ? 0.018 : 0.009) * s.height);
    parts.push(cyl(1.1 * u, -2.2 * u, -0.06 * u, { surf: Surf.Resin }));
    if (turn) {
      for (const d of [-1, 1]) parts.push({ prim: 'box', at: [d * 0.98 * u, 0.15 * u, 0], size: [0.18 * u, 0.85 * u, 0.32 * u] });
      parts.push(ring(0.8 * u, 0.16 * u, 0, { mode: Mode.Tilt }));
      // the pivots of the outer ring in the arms
      for (const d of [-1, 1]) parts.push({ prim: 'cyl', at: [d * 0.87 * u, 0, 0], size: [0.1 * u, 0.2 * u, 0.1 * u], lay: Lay.AlongX });
    } else parts.push(cyl(0.35 * u, -0.6 * u, 0.1 * u));
    if (fan) {
      // a fan's head: a flat wedge opening along its blades (x)
      parts.push(cyl(0.32 * u, -0.55 * u, 0.5 * u, { mode: head }));
      parts.push({ prim: 'flare', at: [0, 0.78 * u, 0], size: [1.25 * u, 0.56 * u, 0.24 * u], mode: head });
      parts.push(ring(0.48 * u, 0.12 * u, 0.32 * u, { mode: head, surf: Surf.Led }));
      led = [0, 0.32 * u, 0];
    } else {
      parts.push(cyl(0.3 * u, -0.7 * u, 1.0 * u, { mode: H }));
      parts.push({ prim: 'cone', at: [0, 1.16 * u, 0], size: [0.3 * u, 0.32 * u, 0.3 * u], mode: H });
      parts.push(ring(0.44 * u, 0.12 * u, 0.72 * u, { mode: H, surf: Surf.Led }));
      led = [0, 0.72 * u, 0];
    }
    reach = 3 * u;
  } else if (fx.type === 'ring') {
    // a flower: a ring of small nozzles on a round manifold, each with its LED
    const R = s.p[0];
    const u = Math.max(0.004, s.bore * 0.8);
    parts.push(ring(R, 1.1 * u, -0.1 * u, { surf: Surf.Resin }));
    parts.push(cyl(1.4 * u, -1.5 * u, 0.25 * u, { surf: Surf.Resin }));
    const n = Math.max(1, Math.round(s.jets));
    for (let j = 0; j < n; j++) {
      const a = (2 * Math.PI * j) / n;
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      parts.push({ ...cyl(0.42 * u, -0.6 * u, 0.9 * u), at: [x, 0.15 * u, z] });
      parts.push({ ...ring(0.62 * u, 0.15 * u, 0.3 * u, { surf: Surf.Led }), at: [x, 0.3 * u, z] });
    }
    led = [0, 0.3 * u, 0];
    // its LEDs stand round the whole ring
    reach = R + 2 * u;
  } else if (fx.type === 'shooter') {
    // a chaser: a short thick barrel; a geyser (wide bore): a fat one whose
    // housing stays under the water, only the barrel's mouth out of it
    const geyser = s.bore >= 0.3;
    const u = Math.max(0.006, s.bore * (geyser ? 1.2 : 1.4));
    const deck = geyser ? -0.04 * u : 0.2 * u;
    parts.push(cyl(1.18 * u, -2 * u, deck, { surf: Surf.Resin }));
    parts.push(ring(1.12 * u, 0.2 * u, deck + 0.06 * u, { surf: Surf.Led }));
    const top = geyser ? 0.42 * u : 1.55 * u;
    const r = geyser ? 0.72 * u : 0.55 * u;
    parts.push(cyl(r, deck, top));
    parts.push(ring(r, 0.14 * u, top));
    led = [0, deck + 0.06 * u, 0];
    reach = 3 * u;
  } else {
    // a grid jet (and the garden's): a short housing, its LED ring and a
    // tapered nozzle
    const u = Math.max(0.004, s.bore * 2);
    parts.push(cyl(u, -3 * u, 0.3 * u, { surf: Surf.Resin }));
    parts.push(ring(1.02 * u, 0.22 * u, 0.36 * u, { surf: Surf.Led }));
    parts.push({ prim: 'cone', at: [0, 0.85 * u, 0], size: [0.5 * u, 1.1 * u, 0.5 * u] });
    led = [0, 0.36 * u, 0];
    reach = 3 * u;
  }
  return { ch: fx.index, origin: fx.position, led, reach, turns: turn, parts };
}

/** The water screens' pipes, the projector behind them and the fireworks tubes. */
function otherBodies(layout: Layout): Body[] {
  const out: Body[] = [];
  const none = { led: [0, 0, 0] as V3, reach: 0, turns: false };
  for (const u of layout.screens) {
    // a long pipe along the screen, all but its top under the water (the
    // mounds' a little in front of the wide sheet's): a dark rail across
    // the whole lagoon read as a wall
    const r = Math.max(0.01, 0.008 * u.height);
    out.push({
      ch: -1,
      origin: [u.center[0], 0, u.center[2] + (u.dome ? 0.8 : 0)],
      ...none,
      parts: [{ prim: 'cyl', at: [0, -0.75 * r, 0], size: [r, u.width, r], lay: Lay.AlongX, surf: Surf.Resin }],
    });
  }
  if (layout.projector.length) {
    // a compact box on a post behind the screens, its lens toward the
    // audience (+z); the lens shows a little of what it throws. Unlit, it is
    // only a dark shape against the glow low on the horizon
    const [x, y, z] = layout.projectorAt;
    const post = Math.max(0.05, y - 0.3);
    out.push({
      ch: layout.projector[0].index,
      origin: [x, y, z],
      ...none,
      parts: [
        { prim: 'box', at: [0, 0, 0], size: [1.1, 0.6, 1.3], surf: Surf.Resin },
        { prim: 'cyl', at: [0, -0.3 - post / 2, 0], size: [0.12, post, 0.12] },
        { prim: 'cyl', at: [0, 0, 0.72], size: [0.15, 0.14, 0.15], lay: Lay.AlongZ, surf: Surf.Lens },
      ],
    });
  }
  // fireworks: each tube a mortar standing in its own small crate (a site's
  // tubes can be tens of metres apart: one rack under all of them was a long
  // wall across the lagoon)
  const parts: Part[] = [];
  for (const { position: p } of layout.tubes) {
    const lo = Math.max(0.05, p[1] - 0.8);
    parts.push({ prim: 'box', at: [p[0], lo / 2, p[2]], size: [0.7, lo, 0.7], surf: Surf.Resin });
    parts.push({ prim: 'cyl', at: [p[0], p[1] - 0.4, p[2]], size: [0.12, 0.8, 0.12], surf: Surf.Resin });
    parts.push({ prim: 'torus', at: [p[0], p[1], p[2]], size: [0.12, 0.2, 0.12] });
  }
  if (parts.length) out.push({ ch: -1, origin: [0, 0, 0], ...none, parts });
  return out;
}

/**
 * A tube with only its top closed: the bottoms stand in the water or under
 * the floor, never seen, and the shapes are kept light (264 grid jets in
 * the lagoon; the vertices are what costs).
 */
function tube(top: number, bottom: number, n: number): THREE.BufferGeometry {
  const side = new THREE.CylinderGeometry(top, bottom, 1, n, 1, true);
  const cap = new THREE.CircleGeometry(top, n).rotateX(-Math.PI / 2).translate(0, 0.5, 0);
  const g = mergeGeometries([side, cap])!;
  side.dispose();
  cap.dispose();
  return g;
}

function primGeometry(p: Prim): THREE.BufferGeometry {
  switch (p) {
    case 'cyl':
      return tube(1, 1, 12);
    case 'cone':
      return tube(0.56, 1, 12);
    case 'flare':
      return tube(1, 0.3, 12);
    case 'torus':
      return new THREE.TorusGeometry(1, 0.2, 4, 16).rotateX(Math.PI / 2);
    case 'sphere':
      return new THREE.SphereGeometry(1, 8, 5);
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

const BODY_VS = /* glsl */ `
${HISTORY_GLSL}
uniform float uTime;
uniform float uProjecting;
attribute float aCh;
attribute vec3 aOrigin;
attribute vec3 aAt;
attribute vec3 aSize;
attribute vec4 aInfo;  // mode (0 fixed, 1 head, 2 tilt only), surface, lay (0 up, 1 along x, 2 along z), light reach (m)
attribute vec4 aLed;   // LED ring position in the fixture's (head's) frame, turns (1/0)
varying vec3 vW;
varying vec3 vN;
varying vec3 vLed;
varying vec3 vLedPos;
varying vec3 vHead;
varying float vP;
varying float vSurf;
varying float vReach;
vec3 rotZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
// as headDir in core/glsl.ts: pan toward +x, then tilt toward the audience (+z)
vec3 turnHead(vec3 v, float pan, float tilt) { return rotX(rotZ(v, -pan), tilt); }
vec3 lay(vec3 v, float l) {
  if (l > 1.5) return vec3(v.x, -v.z, v.y);
  if (l > 0.5) return vec3(v.y, -v.x, v.z);
  return v;
}
void main() {
  vec4 a = vec4(0.0);
  vec4 b = vec4(0.0);
  if (aCh >= 0.0) {
    int f = int(aCh + 0.5);
    a = histAt(uHistA, f, uTime);
    b = histAt(uHistB, f, uTime);
  }
  vec3 p = lay(position * aSize, aInfo.z) + aAt;
  vec3 n = lay(normal / aSize, aInfo.z);
  if (aInfo.x > 1.5) {
    p = rotX(p, a.z);
    n = rotX(n, a.z);
  } else if (aInfo.x > 0.5) {
    p = turnHead(p, a.y, a.z);
    n = turnHead(n, a.y, a.z);
  }
  bool turns = aLed.w > 0.5;
  vHead = turns ? turnHead(vec3(0.0, 1.0, 0.0), a.y, a.z) : vec3(0.0, 1.0, 0.0);
  vLedPos = aOrigin + (turns ? turnHead(aLed.xyz, a.y, a.z) : aLed.xyz);
  vec4 w = modelMatrix * vec4(aOrigin + p, 1.0);
  vW = w.xyz;
  vN = normalize(n);
  vLed = max(b.rgb, 0.0) * max(b.a, 0.0);
  // the projector's lens: what it throws, as white, while a screen is up to catch it
  if (aInfo.y > 2.5) vLed = vec3(clamp(b.a, 0.0, 1.0) * uProjecting);
  vP = clamp(a.x, 0.0, 1.0);
  vSurf = aInfo.y;
  vReach = aInfo.w;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const BODY_FS = /* glsl */ `
uniform vec3 uPyro;
varying vec3 vW;
varying vec3 vN;
varying vec3 vLed;
varying vec3 vLedPos;
varying vec3 vHead;
varying float vP;
varying float vSurf;
varying float vReach;
// a faint moon high behind the stage, left; the night sky above, the dark water below
const vec3 MOON_DIR = vec3(-0.42, 0.62, -0.66);
const vec3 MOON = vec3(0.055, 0.062, 0.08);
const vec3 SKY = vec3(0.010, 0.013, 0.022);
const vec3 GROUND = vec3(0.0015, 0.002, 0.003);
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(cameraPosition - vW);
  bool resin = vSurf > 0.5 && vSurf < 1.5;
  // dark anodised metal and black resin; the metal shines a little more
  vec3 alb = resin ? vec3(0.03, 0.031, 0.034) : vec3(0.055, 0.058, 0.064);
  float ks = resin ? 0.12 : 0.45;
  float sp = resin ? 18.0 : 40.0;
  vec3 col = alb * mix(GROUND, SKY, 0.5 + 0.5 * n.y);
  vec3 L = normalize(MOON_DIR);
  float nl = max(dot(n, L), 0.0);
  col += MOON * nl * (alb + ks * pow(max(dot(n, normalize(L + v)), 0.0), sp));
  // the fixture's own LED: its spill on the head, and the light its lit
  // column of water sends back down while it runs
  if (vReach > 0.0) {
    vec3 d = vLedPos - vW;
    float dist = length(d);
    vec3 l = d / max(dist, 1e-5);
    float fall = 1.0 / (1.0 + dist * dist / (vReach * vReach));
    float wrap = 0.3 + 0.7 * max(dot(n, l), 0.0);
    float column = smoothstep(0.02, 0.3, vP) * (0.4 + 0.6 * max(dot(n, vHead), 0.0));
    vec3 E = vLed * fall * (0.5 * wrap + 1.6 * column);
    col += E * (alb + ks * 0.5 * pow(max(dot(n, normalize(l + v)), 0.0), sp));
  }
  // fireworks overhead
  col += uPyro * (0.4 + 0.6 * max(n.y, 0.0)) * alb;
  if (vSurf > 1.5) {
    // the LED ring (or the lens) glows in its own colour; dark glass when off
    col = vec3(0.004, 0.0045, 0.005) + vLed * (vSurf > 2.5 ? 0.35 : 0.6);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class FixtureBodies {
  readonly object = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private geos: THREE.BufferGeometry[] = [];
  readonly uTime: THREE.IUniform<number> = { value: 0 };
  readonly uKNow: THREE.IUniform<number> = { value: 0 };
  private uPyro: THREE.IUniform<THREE.Vector3> = { value: new THREE.Vector3() };
  private uProjecting: THREE.IUniform<number> = { value: 0 };
  /** Parts drawn (instances over all shapes). */
  readonly count: number;

  constructor(layout: Layout, history: ParamHistory) {
    this.object.name = 'fixture-bodies';
    const bodies = [...layout.fixtures.map(fixtureBody), ...otherBodies(layout)];
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uHistA: { value: history.texA },
        uHistB: { value: history.texB },
        uHistRate: { value: RATE },
        uKNow: this.uKNow,
        uTime: this.uTime,
        uPyro: this.uPyro,
        uProjecting: this.uProjecting,
      },
      vertexShader: BODY_VS,
      fragmentShader: BODY_FS,
      side: THREE.DoubleSide,
    });
    let count = 0;
    for (const prim of PRIMS) {
      const rows = bodies.flatMap((b) => b.parts.filter((p) => p.prim === prim).map((p) => ({ b, p })));
      if (!rows.length) continue;
      const base = primGeometry(prim);
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index;
      g.setAttribute('position', base.getAttribute('position'));
      g.setAttribute('normal', base.getAttribute('normal'));
      const n = rows.length;
      const ch = new Float32Array(n);
      const origin = new Float32Array(n * 3);
      const at = new Float32Array(n * 3);
      const size = new Float32Array(n * 3);
      const info = new Float32Array(n * 4);
      const led = new Float32Array(n * 4);
      rows.forEach(({ b, p }, i) => {
        ch[i] = b.ch;
        origin.set(b.origin, i * 3);
        at.set(p.at, i * 3);
        size.set(p.size, i * 3);
        info.set([p.mode ?? Mode.Fixed, p.surf ?? Surf.Metal, p.lay ?? Lay.Up, b.reach], i * 4);
        led.set([...b.led, b.turns ? 1 : 0], i * 4);
      });
      g.setAttribute('aCh', new THREE.InstancedBufferAttribute(ch, 1));
      g.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3));
      g.setAttribute('aAt', new THREE.InstancedBufferAttribute(at, 3));
      g.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 3));
      g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
      g.setAttribute('aLed', new THREE.InstancedBufferAttribute(led, 4));
      g.instanceCount = n;
      this.geos.push(g, base);
      const mesh = new THREE.Mesh(g, this.mat);
      mesh.frustumCulled = false;
      this.object.add(mesh);
      count += n;
    }
    this.count = count;
  }

  /** Show time t, after the history was brought up to it; whether the projector runs (a screen is up). */
  update(t: number, kNow: number, projecting: boolean) {
    this.uTime.value = t;
    this.uKNow.value = kNow;
    this.uProjecting.value = projecting ? 1 : 0;
  }

  /** Fireworks' light from overhead (linear colour), zero without fireworks. */
  setPyro(c: THREE.Vector3) {
    this.uPyro.value.copy(c);
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    this.mat.dispose();
  }
}
