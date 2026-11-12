import * as THREE from 'three';
import { CH, evaluate, type CompiledShow } from '../show/cues';
import type { Fixture, Layout } from '../show/layout';
import { theme } from '../ui/theme';

/**
 * The editor's selection outline in the 3D (Blender's look): a line of even
 * width (about 2 px on screen) around what is selected, seen even through
 * what stands in front, the active one (the last chosen) bright and the rest
 * darker. Only the editor's preview draws it; the player, the videos and the
 * Vision Pro export never do.
 *
 * The line goes round stand-in shapes (the user chose 台＋水の柱, 2026-11-06),
 * not the drawn bodies (show/bodies.ts, since 2026-11-12; far ones are a few
 * pixels): the
 * 台 (a small block where the nozzle stands, so a fixture with no water
 * still shows) and, while water runs, the column
 * (from the nozzle along the head to its height at the current pressure).
 * They are drawn into a mask (each fixture its own id in red and green, its
 * active flag in blue, nearer shapes in front) and the edges are painted
 * over the finished picture: the full width outside, half on each side
 * where two selected fixtures meet, so each keeps its own outline as in
 * Blender. With nothing selected nothing at all is drawn.
 */

export interface OutlineSelection {
  /** Fixture indices: bright. */
  active: number[];
  /** Fixture indices: darker. */
  others: number[];
  /** Fireworks tubes (layout.tubes indices). */
  tubesActive: number[];
  tubesOthers: number[];
}

/** Outline width in CSS pixels. */
const WIDTH_PX = 2;
/** Smallest stand-in on screen, CSS pixels (radius): far fixtures still get a ring. */
const MIN_BASE_PX = 3;
const MIN_COLUMN_PX = 1.5;
/** Water below this pressure is off: only the 台. */
const WATER_ON = 0.03;
/** The darker colour of the other selected ones: the accent at this brightness. */
const OTHER_DIM = 0.5;

const SHAPES = ['bases', 'columns', 'cones', 'sheets'] as const;
type ShapeKey = (typeof SHAPES)[number];

const EMPTY: OutlineSelection = { active: [], others: [], tubesActive: [], tubesOthers: [] };

const EDGE_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const EDGE_FS = /* glsl */ `
uniform sampler2D tMask;
uniform vec2 uTexel;
uniform float uRadius;
uniform vec3 uActive;
uniform vec3 uOther;
varying vec2 vUv;
float idOf(vec4 m) { return floor(m.r * 255.0 + 0.5) * 256.0 + floor(m.g * 255.0 + 0.5); }
void main() {
  vec4 m = texture2D(tMask, vUv);
  float me = idOf(m);
  // outside: the full width; on a fixture, half of it where another one meets
  float reach = me > 0.0 ? uRadius * 0.5 : uRadius;
  float best = 1e3;
  float act = 0.0;
  const int R = 4;
  for (int y = -R; y <= R; y++) {
    for (int x = -R; x <= R; x++) {
      float d = length(vec2(x, y));
      if (d > reach + 0.5) continue;
      vec4 s = texture2D(tMask, vUv + vec2(float(x), float(y)) * uTexel);
      float id = idOf(s);
      if (id > 0.0 && id != me) {
        // the active one's line wins wherever it reaches
        act = max(act, s.b);
        best = min(best, d);
      }
    }
  }
  if (best > reach + 0.5) discard;
  // a line between two fixtures takes the brighter colour
  if (me > 0.0) act = max(act, m.b);
  float a = 1.0 - smoothstep(reach - 0.5, reach + 0.5, best);
  gl_FragColor = vec4(mix(uOther, uActive, step(0.5, act)), a);
}`;

export class SelectionOutline {
  private sel: OutlineSelection = EMPTY;
  private readonly scene = new THREE.Scene();
  private readonly mask = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly edge: THREE.ShaderMaterial;
  /** Stand-in shapes: [0] the others (nearer in front), [1] the active ones (over everything). */
  private readonly sets: Record<ShapeKey, THREE.InstancedMesh>[] = [];
  private readonly cap = 512;

  constructor() {
    // ids and flags go into the mask as they are: no tone mapping, no fog
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false, fog: false });
    // the active one is never hidden behind the others
    const top = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false, fog: false, depthTest: false });
    // unit shapes standing on y = 0
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 24, 1).translate(0, 0.5, 0);
    const cone = new THREE.CylinderGeometry(1, 0.2, 1, 24, 1, true).translate(0, 0.5, 0);
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const make = (g: THREE.BufferGeometry, m: THREE.Material, order: number) => {
      const mesh = new THREE.InstancedMesh(g, m, this.cap);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = order;
      this.scene.add(mesh);
      return mesh;
    };
    for (const [m, order] of [[mat, 0], [top, 1]] as const) {
      this.sets.push({ bases: make(cyl, m, order), columns: make(cyl, m, order), cones: make(cone, m, order), sheets: make(box, m, order) });
    }
    this.edge = new THREE.ShaderMaterial({
      uniforms: {
        tMask: { value: this.mask.texture },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: WIDTH_PX },
        uActive: { value: new THREE.Color() },
        uOther: { value: new THREE.Color() },
      },
      vertexShader: EDGE_VS,
      fragmentShader: EDGE_FS,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.edge);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  set(sel: OutlineSelection) {
    this.sel = sel;
  }

  get active(): boolean {
    const s = this.sel;
    return s.active.length + s.others.length + s.tubesActive.length + s.tubesOthers.length > 0;
  }

  /** Paint the outline over what the renderer just drew to the screen. */
  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, layout: Layout, show: CompiledShow | null, t: number) {
    if (!this.active) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.mask.width !== size.x || this.mask.height !== size.y) this.mask.setSize(size.x, size.y);
    const pr = renderer.getPixelRatio();
    // world metres per drawing-buffer pixel at distance d
    const k = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / size.y;
    const n = [
      { bases: 0, columns: 0, cones: 0, sheets: 0 },
      { bases: 0, columns: 0, cones: 0, sheets: 0 },
    ];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    // id 1.. per fixture (tubes after the fixtures), in two bytes
    let id = 0;
    const put = (key: ShapeKey, active: boolean) => {
      const layer = active ? 1 : 0;
      const mesh = this.sets[layer][key];
      const i = n[layer][key]++;
      if (i >= this.cap) return;
      mesh.setMatrixAt(i, m4);
      mesh.instanceColor!.setXYZ(i, Math.floor(id / 256) / 255, (id % 256) / 255, active ? 1 : 0);
    };
    const fixture = (fx: Fixture, active: boolean) => {
      id++;
      pos.set(...fx.position);
      const px = camera.position.distanceTo(pos) * k * pr;
      const sp = fx.spec;
      // the 台: a low disc (a box for a mist screen)
      if (fx.type === 'mist' && sp.mist) {
        m4.compose(pos, q.identity(), scl.set(sp.mist.width, Math.max(0.3, px * MIN_BASE_PX), Math.max(sp.mist.depth, px * MIN_BASE_PX * 2)));
        put('sheets', active);
      } else {
        // a small block: seen from low down a flat disc would be a line
        const r = Math.max(baseRadius(fx), px * MIN_BASE_PX);
        m4.compose(pos, q.identity(), scl.set(r, Math.max(r * 0.5, px * MIN_BASE_PX * 2), r));
        put('bases', active);
      }
      if (!show) return;
      const p = evaluate(show, fx.index, CH.pressure, t);
      if (p < WATER_ON) return;
      const h = sp.height * p;
      if (fx.type === 'mist' && sp.mist) {
        m4.compose(pos, q.identity(), scl.set(sp.mist.width, h, Math.max(sp.mist.depth, px * MIN_COLUMN_PX * 2)));
        put('sheets', active);
        return;
      }
      // only a head that turns leans (Fixture.turns); the rest stand upright
      // as the water does (a flower reads tilt as how far it opens)
      if (fx.turns) {
        const pan = evaluate(show, fx.index, CH.pan, t);
        const tilt = evaluate(show, fx.index, CH.tilt, t);
        dir.set(Math.sin(pan), Math.cos(pan) * Math.cos(tilt), Math.cos(pan) * Math.sin(tilt)).normalize();
      } else dir.copy(up);
      q.setFromUnitVectors(up, dir);
      // a leaning jet peaks along its own direction, at h·cosθ (fountain-physics 4):
      // the stand-in ends at the top of the arc, not past it
      const len = h * Math.max(0.2, dir.y);
      if (fx.type === 'fan' || fx.type === 'ring') {
        // an opening shape: a cone as wide as the spread at the top
        const top = Math.max(fx.type === 'ring' ? (sp.p[0] ?? 1) + h * 0.35 : h * 0.6, px * MIN_COLUMN_PX);
        m4.compose(pos, q, scl.set(top, len, top));
        put('cones', active);
      } else {
        const r = Math.max(columnRadius(fx), px * MIN_COLUMN_PX);
        m4.compose(pos, q, scl.set(r, len, r));
        put('columns', active);
      }
    };
    // a water screen: its sheet of mist (at least a sliver while it is down)
    const screenUnit = (i: number, active: boolean) => {
      const u = layout.screens.find((x) => x.index === i);
      if (!u) return false;
      id++;
      pos.set(...u.center);
      const px = camera.position.distanceTo(pos) * k * pr;
      const p = show ? evaluate(show, i, CH.pressure, t) : 0;
      m4.compose(pos, q.identity(), scl.set(u.width, Math.max(u.height * p, px * MIN_BASE_PX * 2), Math.max(2.5, px * MIN_BASE_PX * 2)));
      put('sheets', active);
      return true;
    };
    // a zone of the projector: its column of the picture on the screens' line,
    // and the projector itself behind them
    const zone = (i: number, active: boolean) => {
      const z = layout.projector.find((x) => x.index === i);
      if (!z) return;
      id++;
      const w = layout.screen;
      pos.set((z.x0 + z.x1) / 2, 0, w.center[2]);
      const px = camera.position.distanceTo(pos) * k * pr;
      m4.compose(pos, q.identity(), scl.set(z.x1 - z.x0, w.height, Math.max(1, px * MIN_BASE_PX * 2)));
      put('sheets', active);
      pos.set(...layout.projectorAt);
      const r = Math.max(1.2, camera.position.distanceTo(pos) * k * pr * MIN_BASE_PX);
      m4.compose(pos, q.identity(), scl.set(r * 1.6, r, r));
      put('bases', active);
    };
    const fxs = layout.fixtures;
    const any = (i: number, active: boolean) => {
      if (fxs[i]) fixture(fxs[i], active);
      else if (!screenUnit(i, active)) zone(i, active);
    };
    // the active ones last, so they win where shapes overlap
    for (const i of this.sel.others) any(i, false);
    for (const i of this.sel.active) any(i, true);
    const tube = (i: number, active: boolean) => {
      const tb = layout.tubes[i];
      if (!tb) return;
      id++;
      pos.set(...tb.position);
      const r = Math.max(0.4, camera.position.distanceTo(pos) * k * pr * MIN_BASE_PX);
      m4.compose(pos, q.identity(), scl.set(r, r, r));
      put('bases', active);
    };
    for (const i of this.sel.tubesOthers) tube(i, false);
    for (const i of this.sel.tubesActive) tube(i, true);
    this.sets.forEach((set, layer) => {
      for (const key of SHAPES) {
        const mesh = set[key];
        mesh.count = Math.min(this.cap, n[layer][key]);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
      }
    });

    const ui = theme();
    // painted straight onto the finished (sRGB) picture: the token's values as they are
    const accent = new THREE.Color().setStyle(ui.accent, THREE.LinearSRGBColorSpace);
    this.edge.uniforms.uActive.value.copy(accent);
    this.edge.uniforms.uOther.value.copy(accent).multiplyScalar(OTHER_DIM);
    this.edge.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
    this.edge.uniforms.uRadius.value = Math.min(4, WIDTH_PX * pr);

    const before = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    const clear = renderer.getClearColor(new THREE.Color());
    const clearA = renderer.getClearAlpha();
    renderer.setRenderTarget(this.mask);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(before);
    renderer.setClearColor(clear, clearA);
    renderer.autoClear = false;
    renderer.render(this.quadScene, this.quadCam);
    renderer.autoClear = autoClear;
  }
}

/** Radius of the 台 (m): about the nozzle housing. */
function baseRadius(fx: Fixture): number {
  switch (fx.type) {
    case 'ring':
      return (fx.spec.p[0] ?? 1) + 0.3;
    case 'shooter':
      return 0.8;
    case 'oscillating':
    case 'fan':
      return 0.6;
    default:
      return 0.35;
  }
}

/** Radius of the water column stand-in (m). */
function columnRadius(fx: Fixture): number {
  switch (fx.type) {
    case 'shooter':
      return 1.2;
    case 'oscillating':
      return 0.5;
    default:
      return 0.35;
  }
}
