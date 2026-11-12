import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LightingMode } from '../core/nozzles';
import { projectionScreen } from '../screen/screen';
import type { Quality } from '../show/layout';
import { ShowRuntime } from '../show/runtime';
import { CH, evaluate, type CompiledShow } from '../show/cues';
import type { ShowFile } from '../show/types';
import type { Camera } from './view';
import { SelectionOutline } from './outline';
import { LAGOON } from '../venues';

/**
 * The 3D preview: a ShowRuntime sized to its panel (the Stage itself sizes
 * to the window), rendered only when the time, the show or the camera
 * changed, at a reduced pixel ratio so editing stays responsive.
 */

const CAM_POS = new THREE.Vector3(0, 6, 78);
const CAM_TARGET = new THREE.Vector3(0, 18, -5);

export class Preview {
  readonly rt: ShowRuntime;
  readonly controls: OrbitControls;
  private dirty = 2;
  private lastT = -1;
  /** Last setShow() cost, ms. */
  compileMs = 0;
  error: string | null = null;
  /** Called after the venue changed and the camera went to its seat. */
  onVenue: (() => void) | null = null;
  /** The selection outline (editor only), drawn over the picture. */
  readonly outline = new SelectionOutline();
  /** The whole show for the outline's water columns (not the S/M-filtered one). */
  outlineShow: () => CompiledShow | null = () => null;

  constructor(
    private readonly container: HTMLElement,
    quality: Quality,
    pixelRatio = 0.75,
  ) {
    // the preview renders on demand, so the projector draws every frame it renders
    const screen = projectionScreen({ width: 1024, height: 192, every: 1 });
    // a video frame arrives after its seek: draw again even if the time stood still
    screen.onVideoFrame = () => this.invalidate();
    this.rt = new ShowRuntime(container, screen, quality, pixelRatio);
    const cam = this.rt.stage.camera;
    cam.fov = 50;
    this.controls = new OrbitControls(cam, this.rt.stage.renderer.domElement);
    this.resetCamera();
    this.controls.addEventListener('change', () => this.invalidate());
    // Stage listens to window resize and sizes to the window; we run after it
    window.addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  resetCamera() {
    const cam = this.rt.stage.camera;
    // another venue: its audience seat (the lagoon keeps the editor's own view)
    const v = this.rt.venue;
    const seat = v === LAGOON ? null : (v.seats.find((s) => s.id === 'audience') ?? v.seats[0]);
    if (seat) {
      cam.position.set(...seat.pos);
      this.controls.target.set(...seat.target);
    } else {
      cam.position.copy(CAM_POS);
      this.controls.target.copy(CAM_TARGET);
    }
    cam.updateProjectionMatrix();
    this.controls.update();
    this.invalidate();
  }

  getCamera(): Camera {
    const p = this.rt.stage.camera.position;
    const t = this.controls.target;
    return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
  }

  setCamera(c: Camera) {
    this.rt.stage.camera.position.set(...c.pos);
    this.controls.target.set(...c.target);
    this.rt.stage.camera.updateProjectionMatrix();
    this.controls.update();
    this.invalidate();
  }

  /** A seat of the venue as a camera, if it has one by that id. */
  seat(id: string): Camera | null {
    const s = this.rt.venue.seats.find((x) => x.id === id);
    return s ? { pos: [...s.pos], target: [...s.target] } : null;
  }

  /**
   * The fixture whose water column passes nearest a click (client pixels),
   * at show time t: the column from the nozzle along its head direction to
   * its height at the current pressure. -1 when none is within 14 px.
   */
  pick(clientX: number, clientY: number, show: CompiledShow, t: number): number {
    const cam = this.rt.stage.camera;
    const r = this.rt.stage.renderer.domElement.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    const toScreen = (v: THREE.Vector3) => {
      v.project(cam);
      return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, behind: v.z > 1 };
    };
    let best = -1;
    let bestD = 14;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const fx of this.rt.layout.fixtures) {
      if (fx.index * 7 >= show.tracks.length) continue;
      const p = Math.max(0.05, evaluate(show, fx.index, CH.pressure, t));
      // only a head that turns leans (Fixture.turns, as the water is drawn)
      const turns = fx.turns;
      const pan = turns ? evaluate(show, fx.index, CH.pan, t) : 0;
      const tilt = turns ? evaluate(show, fx.index, CH.tilt, t) : 0;
      const h = fx.spec.height * p;
      a.set(...fx.position);
      b.set(Math.sin(pan), Math.cos(pan) * Math.cos(tilt), Math.cos(pan) * Math.sin(tilt)).multiplyScalar(h).add(a);
      const sa = toScreen(a.clone());
      const sb = toScreen(b.clone());
      if (sa.behind && sb.behind) continue;
      const dx = sb.x - sa.x;
      const dy = sb.y - sa.y;
      const len2 = dx * dx + dy * dy;
      const k = len2 > 0 ? Math.max(0, Math.min(1, ((px - sa.x) * dx + (py - sa.y) * dy) / len2)) : 0;
      const d = Math.hypot(sa.x + k * dx - px, sa.y + k * dy - py);
      if (d < bestD) {
        bestD = d;
        best = fx.index;
      }
    }
    return best;
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const s = this.rt.stage;
    s.renderer.setSize(w, h);
    s.composer.setSize(w, h);
    s.camera.aspect = w / h;
    s.camera.updateProjectionMatrix();
    const size = s.renderer.getDrawingBufferSize(new THREE.Vector2());
    s.water.getRenderTarget().setSize(Math.round(size.x * 0.5), Math.round(size.y * 0.5));
    this.invalidate();
  }

  invalidate() {
    this.dirty = 2;
  }

  setShow(file: ShowFile) {
    const t0 = performance.now();
    try {
      const before = this.rt.venue;
      this.rt.setShow(file);
      if (this.rt.venue !== before) {
        this.resetCamera();
        this.onVenue?.();
      }
      this.error = null;
    } catch (e) {
      this.error = String(e instanceof Error ? e.message : e);
      console.warn('[editor] setShow failed', e);
    }
    this.compileMs = performance.now() - t0;
    this.invalidate();
  }

  setLighting(mode: LightingMode) {
    this.rt.setLighting(mode);
    this.invalidate();
  }

  setQuality(q: Quality) {
    this.rt.build(q);
    this.invalidate();
  }

  /** Render if anything changed since the last frame. */
  frame(t: number) {
    if (t === this.lastT && this.dirty <= 0) return;
    this.lastT = t;
    if (this.dirty > 0) this.dirty--;
    this.rt.render(t);
    // nothing selected: nothing more is drawn
    if (this.outline.active) this.outline.render(this.rt.stage.renderer, this.rt.stage.camera, this.rt.layout, this.outlineShow(), t);
  }
}
