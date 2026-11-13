import { kind } from '../../fixtures';
import { theme, type Theme } from '../../ui/theme';
import { crowdBand, crowdPeople, LAND_FAR, lineFrame, onLand, railPosts, rimOutline } from '../landscape';
import { isWaterPart, partPositions, type Part, type VenueDoc } from '../parts';
import type { Finding } from '../rules';
import type { ScaleTier, Venue, WaterShape } from '../types';

/**
 * The venue editor's top view: the water from above, x to the right, z down
 * (the audience at the bottom). Draws the parts, picks them and drags them;
 * what a drag changes goes back through the host (main.ts), which keeps the
 * file, the undo history and the panels.
 */

export type Tool = 'select' | 'place';

export interface Selection {
  part: number | null;
  /** A fixture of the selected part, by its place in the array (before 外す). */
  fixture: number | null;
}

export interface ViewHost {
  doc(): VenueDoc;
  selection(): Selection;
  findings(): Finding[];
  select(sel: Selection): void;
  /** A drag starts: the host keeps the file as it was, for undo. */
  begin(): boolean;
  /** During a drag: change the file in place (already begun). */
  live(change: (doc: VenueDoc) => void): void;
  /** The drag ended. */
  end(): void;
  /** The 1台を置く tool clicked at [x, z]. */
  place(at: [number, number]): void;
  tool(): Tool;
  /** A fireworks site's biggest size (号), 0 for none, null without seats. */
  pyroLimit(part: number): number | null;
  /** The venue as built (its banks, for where people stand); undefined while it does not build. */
  venue(): Venue | undefined;
}

/** Position snap per scale tier (m); angles snap to 15°. Alt turns both off. */
export const SNAP: Record<ScaleTier, number> = { desk: 0.01, garden: 0.05, plaza: 0.5, lagoon: 0.5 };
const ANGLE_SNAP = 15;

type Pt = [number, number];
interface Handle {
  at: Pt;
  shape: 'square' | 'circle';
  /** Moves the handle to [x, z] (snapped by the view). */
  drag: (p: Part, to: Pt, free: boolean) => void;
}

const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (d: number) => Math.PI * (d / 180);

/** A fixture of a part as drawn: where it stands and whether it is left out. */
interface Drawn {
  i: number;
  at: Pt;
  skipped: boolean;
}

export function drawnFixtures(p: Part): Drawn[] {
  if (!isWaterPart(p) && p.kind !== 'pyro') return [];
  const pos = partPositions(p).map(([x, , z]) => [x, z] as Pt);
  if (isWaterPart(p)) {
    for (const { i, by } of p.nudge ?? []) if (pos[i]) pos[i] = [pos[i][0] + by[0], pos[i][1] + by[1]];
  }
  const skip = new Set(isWaterPart(p) ? (p.skip ?? []) : []);
  return pos.map((at, i) => ({ i, at, skipped: skip.has(i) }));
}

/** The ends of a part drawn as a line (rows, screens, seats). */
function segment(p: Part): [Pt, Pt] | null {
  if (p.kind === 'line' || p.kind === 'band' || p.kind === 'pyro' || p.kind === 'seats' || p.kind === 'rail' || p.kind === 'crowd') return [p.from, p.to];
  if (p.kind === 'shore') return p.from && p.to ? [p.from, p.to] : null;
  if (p.kind === 'screen') return [[p.center[0] - p.width / 2, p.center[1]], [p.center[0] + p.width / 2, p.center[1]]];
  if (p.kind === 'projector') return [p.at, p.aim];
  return null;
}

export class TopView {
  private ctx: CanvasRenderingContext2D;
  /** Centre of the view (m) and pixels per metre. */
  private cx = 0;
  private cz = 0;
  private scale = 8;
  private w = 0;
  private h = 0;
  private hover: { part: number; fixture: number | null } | null = null;
  private drag: null | {
    kind: 'pan' | 'part' | 'handle' | 'fixture';
    start: Pt;
    startPx: Pt;
    moved: boolean;
    begun: boolean;
    snapshot?: Part;
    handle?: number;
    /** A fixture clicked in the selected part: picked on release, if not dragged. */
    pick?: number | null;
  } = null;
  private t: Theme;

  constructor(
    private canvas: HTMLCanvasElement,
    private host: ViewHost,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.t = theme();
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointerleave', () => {
      if (!this.drag && this.hover) {
        this.hover = null;
        this.draw();
      }
    });
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.resize();
  }

  // ------------------------------------------------------------ geometry
  private X = (x: number) => this.w / 2 + (x - this.cx) * this.scale;
  private Z = (z: number) => this.h / 2 + (z - this.cz) * this.scale;
  private toWorld(px: number, py: number): Pt {
    return [this.cx + (px - this.w / 2) / this.scale, this.cz + (py - this.h / 2) / this.scale];
  }
  private local(e: PointerEvent | WheelEvent): Pt {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  private snap(v: number, free: boolean) {
    const s = SNAP[this.host.doc().scale];
    return free ? v : Math.round(v / s) * s;
  }
  private snapPt = (p: Pt, free: boolean): Pt => [this.snap(p[0], free), this.snap(p[1], free)];
  private snapDeg = (d: number, free: boolean) => (free ? d : Math.round(d / ANGLE_SNAP) * ANGLE_SNAP);
  /** Numbers as typed by hand: no float dust from snapping (0.1 + 0.2). */
  private tidy = (v: number) => Math.round(v * 1e6) / 1e6;

  /** Where [x, z] is on the canvas (px), for scripts/venue-editor-check.mjs. */
  screenOf(x: number, z: number): Pt {
    return [this.X(x), this.Z(z)];
  }

  /** The view centre (m), for new parts. */
  centre(): Pt {
    return [this.snap(this.cx, false), this.snap(this.cz, false)];
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  /** Frame the venue: the water, its parts and the seats; with all, the fireworks too. */
  fit(all = false) {
    const doc = this.host.doc();
    const pts: Pt[] = [];
    for (const p of doc.parts) {
      if (p.kind === 'pyro' && !all) continue;
      // a bank runs to the horizon: frame the rest
      if (p.kind === 'shore') continue;
      const seg = segment(p);
      if (seg) pts.push(...seg);
      if (p.kind === 'arc' || p.kind === 'ring') pts.push([p.center[0] - p.radius, p.center[1] - p.radius], [p.center[0] + p.radius, p.center[1] + p.radius]);
      if (p.kind === 'crowd') pts.push(...crowdBand(p));
      for (const f of drawnFixtures(p)) pts.push(f.at);
    }
    const water = waterBox(doc.water);
    if (water) pts.push(...water);
    if (!pts.length) pts.push([-1, -1], [1, 1]);
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    this.cx = (x0 + x1) / 2;
    this.cz = (z0 + z1) / 2;
    const span = Math.max(x1 - x0, 0.2);
    const depth = Math.max(z1 - z0, 0.2);
    this.scale = Math.min((this.w - 80) / span, (this.h - 110) / depth);
    this.draw();
  }

  zoom(k: number) {
    this.scale *= k;
    this.draw();
  }

  // -------------------------------------------------------------- picking
  private handles(p: Part): Handle[] {
    const T = this;
    switch (p.kind) {
      case 'crowd': {
        // the ends of the front line, and the back edge's middle for the depth
        const { n } = lineFrame(p.from, p.to);
        const mid: Pt = [(p.from[0] + p.to[0]) / 2 + n[0] * p.depth, (p.from[1] + p.to[1]) / 2 + n[1] * p.depth];
        return [
          { at: p.from, shape: 'square', drag: (q, to, f) => ((q as typeof p).from = T.snapPt(to, f).map(T.tidy) as Pt) },
          { at: p.to, shape: 'square', drag: (q, to, f) => ((q as typeof p).to = T.snapPt(to, f).map(T.tidy) as Pt) },
          {
            at: mid,
            shape: 'circle',
            drag: (q, to, f) => {
              const c = q as typeof p;
              const d = (to[0] - c.from[0]) * n[0] + (to[1] - c.from[1]) * n[1];
              c.depth = T.tidy(Math.max(T.snap(d, f), SNAP[T.host.doc().scale]));
            },
          },
        ];
      }
      case 'shore':
        if (!p.from || !p.to) return [];
        return [
          { at: p.from, shape: 'square', drag: (q, to, f) => ((q as typeof p).from = T.snapPt(to, f).map(T.tidy) as Pt) },
          { at: p.to, shape: 'square', drag: (q, to, f) => ((q as typeof p).to = T.snapPt(to, f).map(T.tidy) as Pt) },
        ];
      case 'line':
      case 'band':
      case 'pyro':
      case 'seats':
      case 'rail':
        return [
          { at: p.from, shape: 'square', drag: (q, to, f) => ((q as typeof p).from = T.snapPt(to, f).map(T.tidy) as Pt) },
          { at: p.to, shape: 'square', drag: (q, to, f) => ((q as typeof p).to = T.snapPt(to, f).map(T.tidy) as Pt) },
        ];
      case 'arc': {
        const mid = rad((p.a0 + p.a1) / 2);
        const end = (a: number): Pt => [p.center[0] + Math.cos(rad(a)) * p.radius, p.center[1] + Math.sin(rad(a)) * p.radius];
        const angle = (to: Pt, f: boolean) => this.snapDeg(deg(Math.atan2(to[1] - p.center[1], to[0] - p.center[0])), f);
        return [
          { at: p.center, shape: 'square', drag: (q, to, f) => ((q as typeof p).center = T.snapPt(to, f).map(T.tidy) as Pt) },
          { at: [p.center[0] + Math.cos(mid) * p.radius, p.center[1] + Math.sin(mid) * p.radius], shape: 'circle', drag: (q, to, f) => ((q as typeof p).radius = T.tidy(Math.max(T.snap(Math.hypot(to[0] - p.center[0], to[1] - p.center[1]), f), SNAP[T.host.doc().scale]))) },
          { at: end(p.a0), shape: 'square', drag: (q, to, f) => ((q as typeof p).a0 = angle(to, f)) },
          { at: end(p.a1), shape: 'square', drag: (q, to, f) => ((q as typeof p).a1 = angle(to, f)) },
        ];
      }
      case 'ring': {
        const a0 = rad(p.a0 ?? 0);
        return [
          { at: p.center, shape: 'square', drag: (q, to, f) => ((q as typeof p).center = T.snapPt(to, f).map(T.tidy) as Pt) },
          {
            at: [p.center[0] + Math.cos(a0) * p.radius, p.center[1] + Math.sin(a0) * p.radius],
            shape: 'circle',
            drag: (q, to, f) => {
              const r = q as typeof p;
              r.radius = T.tidy(Math.max(T.snap(Math.hypot(to[0] - p.center[0], to[1] - p.center[1]), f), SNAP[T.host.doc().scale]));
              r.a0 = T.snapDeg(deg(Math.atan2(to[1] - p.center[1], to[0] - p.center[0])), f);
            },
          },
        ];
      }
      case 'screen':
        return [
          { at: [p.center[0] - p.width / 2, p.center[1]], shape: 'circle', drag: (q, to, f) => ((q as typeof p).width = T.tidy(Math.max(T.snap(2 * Math.abs(to[0] - p.center[0]), f), SNAP[T.host.doc().scale]))) },
          { at: [p.center[0] + p.width / 2, p.center[1]], shape: 'circle', drag: (q, to, f) => ((q as typeof p).width = T.tidy(Math.max(T.snap(2 * Math.abs(to[0] - p.center[0]), f), SNAP[T.host.doc().scale]))) },
        ];
      case 'projector':
        return [
          { at: p.at, shape: 'square', drag: (q, to, f) => ((q as typeof p).at = T.snapPt(to, f).map(T.tidy) as Pt) },
          { at: p.aim, shape: 'circle', drag: (q, to, f) => ((q as typeof p).aim = T.snapPt(to, f).map(T.tidy) as Pt) },
        ];
      default:
        return [];
    }
  }

  /** What is under the pointer: a handle of the selected part, a fixture, a part. */
  private pick(px: Pt): { part: number; fixture: number | null; handle: number | null } | null {
    const doc = this.host.doc();
    const sel = this.host.selection();
    if (sel.part != null && doc.parts[sel.part]) {
      const hs = this.handles(doc.parts[sel.part]);
      for (let k = hs.length - 1; k >= 0; k--) {
        if (Math.hypot(this.X(hs[k].at[0]) - px[0], this.Z(hs[k].at[1]) - px[1]) <= 7) return { part: sel.part, fixture: null, handle: k };
      }
    }
    let best: { part: number; fixture: number | null; d: number } | null = null;
    doc.parts.forEach((p, n) => {
      // skipped fixtures pick only on the selected part (to put them back)
      for (const f of drawnFixtures(p)) {
        if (f.skipped && n !== sel.part) continue;
        const d = Math.hypot(this.X(f.at[0]) - px[0], this.Z(f.at[1]) - px[1]);
        if (d <= 6 && (!best || d < best.d)) best = { part: n, fixture: p.kind === 'single' ? null : f.i, d };
      }
      const seg = segment(p);
      if (seg && p.kind !== 'line' && p.kind !== 'band' && p.kind !== 'pyro') {
        const d = distToSeg(px, [this.X(seg[0][0]), this.Z(seg[0][1])], [this.X(seg[1][0]), this.Z(seg[1][1])]);
        if (d <= 5 && (!best || d + 1 < best.d)) best = { part: n, fixture: null, d: d + 1 };
      }
      // areas: a crowd's band, a bank's paved strip (behind every line and dot)
      const w = this.toWorld(px[0], px[1]);
      const hit = p.kind === 'crowd' ? inPolygon(w, crowdBand(p)) : p.kind === 'shore' ? this.onStrip(p, doc.water, w) : false;
      if (hit && (!best || best.d > 5.5)) best = { part: n, fixture: null, d: 5.5 };
    });
    const b = best as { part: number; fixture: number | null; d: number } | null;
    return b ? { part: b.part, fixture: b.fixture, handle: null } : null;
  }

  // ------------------------------------------------------------- pointer
  private down(e: PointerEvent) {
    const px = this.local(e);
    this.canvas.setPointerCapture(e.pointerId);
    const start = this.toWorld(px[0], px[1]);
    if (e.button === 1 || e.button === 2) {
      this.drag = { kind: 'pan', start, startPx: px, moved: false, begun: false };
      return;
    }
    if (this.host.tool() === 'place') {
      this.host.place(this.snapPt(start, e.altKey).map(this.tidy) as Pt);
      return;
    }
    const hit = this.pick(px);
    if (!hit) {
      this.drag = { kind: 'pan', start, startPx: px, moved: false, begun: false };
      return;
    }
    const sel = this.host.selection();
    if (hit.handle != null) {
      this.drag = { kind: 'handle', start, startPx: px, moved: false, begun: false, handle: hit.handle };
      return;
    }
    // a part not selected: select it, a drag moves it whole. In the selected
    // part a click picks one fixture, and dragging that fixture is ずらす;
    // dragging any other of its fixtures still moves the part
    if (hit.part !== sel.part) {
      this.host.select({ part: hit.part, fixture: null });
      this.drag = { kind: 'part', start, startPx: px, moved: false, begun: false };
    } else if (hit.fixture != null && hit.fixture === sel.fixture) {
      this.drag = { kind: 'fixture', start, startPx: px, moved: false, begun: false };
    } else {
      this.drag = { kind: 'part', start, startPx: px, moved: false, begun: false, pick: hit.fixture };
    }
  }

  private move(e: PointerEvent) {
    const px = this.local(e);
    const d = this.drag;
    if (!d) {
      const hit = this.host.tool() === 'select' ? this.pick(px) : null;
      const h = hit ? { part: hit.part, fixture: hit.fixture } : null;
      if (JSON.stringify(h) !== JSON.stringify(this.hover)) {
        this.hover = h;
        this.canvas.style.cursor = hit ? (hit.handle != null ? 'grab' : 'move') : this.host.tool() === 'place' ? 'crosshair' : 'default';
        this.draw();
      }
      return;
    }
    if (!d.moved && Math.hypot(px[0] - d.startPx[0], px[1] - d.startPx[1]) < 3) return;
    d.moved = true;
    if (d.kind === 'pan') {
      this.cx -= (px[0] - d.startPx[0]) / this.scale;
      this.cz -= (px[1] - d.startPx[1]) / this.scale;
      d.startPx = px;
      this.draw();
      return;
    }
    const sel = this.host.selection();
    if (sel.part == null) return;
    if (!d.begun) {
      if (!this.host.begin()) {
        this.drag = null;
        return;
      }
      d.begun = true;
      d.snapshot = structuredClone(this.host.doc().parts[this.host.selection().part!]);
    }
    const at = this.toWorld(px[0], px[1]);
    const free = e.altKey;
    const base = d.snapshot!;
    this.host.live((doc) => {
      const n = this.host.selection().part!;
      const p = structuredClone(base);
      if (d.kind === 'handle') this.handles(p)[d.handle!].drag(p, at, free);
      else if (d.kind === 'part') movePart(p, this.snapPt([at[0] - d.start[0], at[1] - d.start[1]], free).map(this.tidy) as Pt);
      else if (d.kind === 'fixture' && isWaterPart(p)) nudge(p, this.host.selection().fixture!, at, free, this);
      doc.parts[n] = p;
    });
  }

  /** For nudge(): snapped offsets. */
  snapOffset(v: Pt, free: boolean): Pt {
    return this.snapPt(v, free).map(this.tidy) as Pt;
  }

  private up(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.kind === 'pan' && !d.moved && e.button === 0) this.host.select({ part: null, fixture: null });
    if (d.kind === 'part' && !d.moved && d.pick !== undefined) this.host.select({ part: this.host.selection().part, fixture: d.pick });
    if (d.begun) this.host.end();
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const px = this.local(e);
    const before = this.toWorld(px[0], px[1]);
    this.scale *= Math.exp(-e.deltaY * 0.0015);
    const after = this.toWorld(px[0], px[1]);
    this.cx += before[0] - after[0];
    this.cz += before[1] - after[1];
    this.draw();
  }

  /** Is [x, z] on a bank's paved strip (a rim's: between the water and the strip's outer edge)? */
  private onStrip(p: Extract<Part, { kind: 'shore' }>, w: WaterShape, q: Pt): boolean {
    // at least a few pixels wide, so a thin rim can still be picked
    const width = Math.max(p.width, 5 / this.scale);
    if (!p.from || !p.to) return w.kind !== 'infinite' && inPolygon(q, rimOutline(w, width)) && !inPolygon(q, rimOutline(w, 0));
    const { n } = lineFrame(p.from, p.to);
    const back = (r: Pt, d: number): Pt => [r[0] + n[0] * d, r[1] + n[1] * d];
    return inPolygon(q, [p.from, p.to, back(p.to, width), back(p.from, width)]);
  }

  /** Banks: the land faintly to the horizon, the paved strip along the water, the edge line. */
  private drawShores(doc: VenueDoc, sel: Selection) {
    const c = this.ctx;
    const t = this.t;
    const path = (pts: Pt[]) => {
      pts.forEach((q, i) => (i ? c.lineTo(this.X(q[0]), this.Z(q[1])) : c.moveTo(this.X(q[0]), this.Z(q[1]))));
      c.closePath();
    };
    doc.parts.forEach((p, n) => {
      if (p.kind !== 'shore') return;
      const on = n === sel.part;
      const hover = this.hover?.part === n && !on;
      const w = doc.water;
      c.fillStyle = t.vnSeat;
      if (!p.from || !p.to) {
        if (w.kind === 'infinite') return;
        // the land: everything but the water (even-odd)
        c.globalAlpha = 0.06;
        c.beginPath();
        c.rect(0, 0, this.w, this.h);
        path(rimOutline(w, 0));
        c.fill('evenodd');
        c.globalAlpha = on || hover ? 0.4 : 0.22;
        c.beginPath();
        path(rimOutline(w, p.width));
        path(rimOutline(w, 0).reverse());
        c.fill('evenodd');
        c.globalAlpha = 1;
        c.strokeStyle = on ? t.vnSel : t.vnSeat;
        c.lineWidth = on ? 2 : 1.5;
        c.beginPath();
        path(rimOutline(w, 0));
        c.stroke();
        return;
      }
      const { n: nn } = lineFrame(p.from, p.to);
      const back = (q: Pt, d: number): Pt => [q[0] + nn[0] * d, q[1] + nn[1] * d];
      c.globalAlpha = 0.06;
      c.beginPath();
      path([p.from, p.to, back(p.to, LAND_FAR), back(p.from, LAND_FAR)]);
      c.fill();
      c.globalAlpha = on || hover ? 0.4 : 0.22;
      c.beginPath();
      path([p.from, p.to, back(p.to, p.width), back(p.from, p.width)]);
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = on ? t.vnSel : t.vnSeat;
      c.lineWidth = on ? 2 : 1.5;
      c.beginPath();
      c.moveTo(this.X(p.from[0]), this.Z(p.from[1]));
      c.lineTo(this.X(p.to[0]), this.Z(p.to[1]));
      c.stroke();
      // which side is land: small ticks into it
      const { len, t: dir } = lineFrame(p.from, p.to);
      const step = Math.max(len / 40, 18 / this.scale);
      c.lineWidth = 1;
      c.beginPath();
      for (let u = step / 2; u < len; u += step) {
        const q: Pt = [p.from[0] + dir[0] * u, p.from[1] + dir[1] * u];
        c.moveTo(this.X(q[0]), this.Z(q[1]));
        c.lineTo(this.X(q[0]) + nn[0] * 6, this.Z(q[1]) + nn[1] * 6);
      }
      c.stroke();
    });
  }

  /** A rail: its line and posts; a crowd: its band and everyone in it (people over the water as crosses). */
  private drawScenery(p: Part, n: number, on: boolean, hover: boolean) {
    const c = this.ctx;
    const t = this.t;
    const font = (px: number) => `${px}px ${t.fontCanvas}`;
    if (p.kind === 'rail') {
      c.strokeStyle = on ? t.vnSel : t.vnText;
      c.globalAlpha = on || hover ? 1 : 0.75;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(this.X(p.from[0]), this.Z(p.from[1]));
      c.lineTo(this.X(p.to[0]), this.Z(p.to[1]));
      c.stroke();
      if (p.spacing * this.scale >= 5) {
        c.fillStyle = c.strokeStyle;
        for (const q of railPosts(p)) c.fillRect(this.X(q[0]) - 1.5, this.Z(q[1]) - 1.5, 3, 3);
      }
      c.globalAlpha = 1;
      return;
    }
    if (p.kind !== 'crowd') return;
    const band = crowdBand(p);
    c.beginPath();
    band.forEach((q, i) => (i ? c.lineTo(this.X(q[0]), this.Z(q[1])) : c.moveTo(this.X(q[0]), this.Z(q[1]))));
    c.closePath();
    c.fillStyle = t.vnSeat;
    c.globalAlpha = on || hover ? 0.22 : 0.12;
    c.fill();
    c.globalAlpha = 1;
    c.setLineDash([4, 3]);
    c.strokeStyle = on ? t.vnSel : t.vnSeat;
    c.lineWidth = 1;
    c.stroke();
    c.setLineDash([]);
    const people = crowdPeople({ ...p, seed: n }, 0, [0, 0]);
    const v = this.host.venue();
    const doc = this.host.doc();
    const r = Math.max(0.8, 0.2 * this.scale);
    // dots only while they can be told apart
    if (people.length && 0.5 / Math.sqrt(p.density) * this.scale >= 1.2) {
      for (const q of people) {
        const x = this.X(q.x);
        const y = this.Z(q.z);
        if (x < -5 || y < -5 || x > this.w + 5 || y > this.h + 5) continue;
        if (!onLand(v?.scenery, doc.water, q.x, q.z)) {
          c.strokeStyle = t.vnStop;
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(x - 2, y - 2);
          c.lineTo(x + 2, y + 2);
          c.moveTo(x + 2, y - 2);
          c.lineTo(x - 2, y + 2);
          c.stroke();
          continue;
        }
        c.fillStyle = on ? t.vnSel : t.vnText;
        c.globalAlpha = q.sit ? 0.55 : 0.8;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    }
    const mx = band.reduce((a, q) => a + q[0], 0) / 4;
    const mz = band.reduce((a, q) => a + q[1], 0) / 4;
    c.fillStyle = on ? t.vnSel : t.vnText;
    c.font = font(11);
    c.textAlign = 'center';
    c.fillText(`客${p.name ? `「${p.name}」` : ''} ${people.length.toLocaleString('ja-JP')}人`, this.X(mx), this.Z(mz) + 4);
    c.textAlign = 'left';
  }

  // ---------------------------------------------------------------- draw
  draw() {
    const c = this.ctx;
    const t = this.t;
    const doc = this.host.doc();
    if (!doc) return; // before the first venue is open
    const sel = this.host.selection();
    c.fillStyle = t.vnBg;
    c.fillRect(0, 0, this.w, this.h);
    this.drawWater(doc.water);
    this.drawShores(doc, sel);
    this.drawGrid();
    const font = (px: number) => `${px}px ${t.fontCanvas}`;
    doc.parts.forEach((p, n) => {
      const on = n === sel.part;
      const hover = this.hover?.part === n && !on;
      if (p.kind === 'rail' || p.kind === 'crowd') this.drawScenery(p, n, on, hover);
      else if (p.kind === 'seats') {
        c.setLineDash([6, 4]);
        c.strokeStyle = on ? t.vnSel : t.vnSeat;
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(this.X(p.from[0]), this.Z(p.from[1]));
        c.lineTo(this.X(p.to[0]), this.Z(p.to[1]));
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = on ? t.vnSel : t.vnText;
        c.font = font(11);
        c.textAlign = 'center';
        c.fillText(`客席${p.name ? `（${p.name}）` : ''}`, this.X((p.from[0] + p.to[0]) / 2), this.Z((p.from[1] + p.to[1]) / 2) + 16);
        c.textAlign = 'left';
      } else if (p.kind === 'screen') {
        const y = this.Z(p.center[1]) - (p.fixture === 'mound' ? 6 : 0);
        c.strokeStyle = on ? t.vnSel : kind(p.fixture).lane.accent;
        c.globalAlpha = on || hover ? 1 : 0.7;
        c.lineWidth = p.fixture === 'screen' ? 3 : 2;
        c.beginPath();
        c.moveTo(this.X(p.center[0] - p.width / 2), y);
        c.lineTo(this.X(p.center[0] + p.width / 2), y);
        c.stroke();
        c.globalAlpha = 1;
      } else if (p.kind === 'projector') {
        // the throw: thin lines to the ends of each screen it lights, the
        // line to the point it faces, and the projector as a small block
        const col = on ? t.vnSel : kind('projector').lane.accent;
        const x0 = this.X(p.at[0]);
        const z0 = this.Z(p.at[1]);
        c.strokeStyle = col;
        c.globalAlpha = on || hover ? 0.55 : 0.3;
        c.lineWidth = 1;
        for (const q of doc.parts) {
          if (q.kind !== 'screen' || (p.covers && (q.name === undefined || !p.covers.includes(q.name)))) continue;
          for (const ex of [q.center[0] - q.width / 2, q.center[0] + q.width / 2]) {
            c.beginPath();
            c.moveTo(x0, z0);
            c.lineTo(this.X(ex), this.Z(q.center[1]));
            c.stroke();
          }
        }
        c.globalAlpha = on || hover ? 1 : 0.8;
        c.setLineDash([4, 3]);
        c.beginPath();
        c.moveTo(x0, z0);
        c.lineTo(this.X(p.aim[0]), this.Z(p.aim[1]));
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = col;
        c.fillRect(x0 - 6, z0 - 4, 12, 8);
        c.fillStyle = on ? t.vnSel : t.vnText;
        c.font = font(11);
        c.textAlign = 'center';
        c.fillText(p.name ?? 'プロジェクター', x0, z0 + 18);
        c.textAlign = 'left';
        c.globalAlpha = 1;
      } else if (p.kind === 'arc' && on) {
        c.strokeStyle = t.vnHover;
        c.lineWidth = 1;
        c.beginPath();
        c.arc(this.X(p.center[0]), this.Z(p.center[1]), p.radius * this.scale, rad(p.a0), rad(p.a1), p.a1 < p.a0);
        c.stroke();
      } else if (p.kind === 'ring' && on) {
        c.strokeStyle = t.vnHover;
        c.lineWidth = 1;
        c.beginPath();
        c.arc(this.X(p.center[0]), this.Z(p.center[1]), p.radius * this.scale, 0, Math.PI * 2);
        c.stroke();
      }
      const fixtures = drawnFixtures(p);
      if (!fixtures.length) return;
      if (p.kind === 'pyro') {
        const lim = this.host.pyroLimit(n);
        const mid = fixtures[Math.floor(fixtures.length / 2)].at;
        c.fillStyle = on ? t.vnSel : t.vnText;
        c.font = font(11);
        c.textAlign = 'center';
        c.fillText(`${p.site}${lim == null ? '' : lim ? `・${lim}号まで` : '・打てない'}`, this.X(mid[0]), this.Z(mid[1]) - 10);
        c.textAlign = 'left';
      }
      const colour = p.kind === 'pyro' ? kind('pyro').lane.accent : kind((p as { fixture: string }).fixture).lane.accent;
      const small = isWaterPart(p) && kind(p.fixture).place.spacing < 2 && this.scale < 14;
      const r = small ? 1.6 : 2.6;
      for (const f of fixtures) {
        const x = this.X(f.at[0]);
        const y = this.Z(f.at[1]);
        if (f.skipped) {
          if (!on) continue;
          c.strokeStyle = t.vnSkipped;
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(x - 3, y - 3);
          c.lineTo(x + 3, y + 3);
          c.moveTo(x + 3, y - 3);
          c.lineTo(x - 3, y + 3);
          c.stroke();
          continue;
        }
        if (p.kind === 'pyro') {
          c.fillStyle = colour;
          c.fillRect(x - 3, y - 3, 6, 6);
        } else {
          c.fillStyle = colour;
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.fill();
        }
        if (on || hover) {
          c.strokeStyle = on ? t.vnSel : t.vnHover;
          c.lineWidth = 1;
          c.beginPath();
          c.arc(x, y, r + 2.5, 0, Math.PI * 2);
          c.stroke();
        }
        if (on && sel.fixture === f.i) {
          c.fillStyle = t.vnSel;
          c.beginPath();
          c.arc(x, y, r + 2, 0, Math.PI * 2);
          c.fill();
        }
      }
    });
    // the selected part's handles and name
    if (sel.part != null && doc.parts[sel.part]) {
      const p = doc.parts[sel.part];
      c.strokeStyle = t.vnSel;
      c.fillStyle = t.vnHandle;
      c.lineWidth = 1;
      for (const h of this.handles(p)) {
        const x = this.X(h.at[0]);
        const y = this.Z(h.at[1]);
        c.beginPath();
        if (h.shape === 'square') c.rect(x - 4.5, y - 4.5, 9, 9);
        else c.arc(x, y, 5, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
    }
    // findings
    for (const f of this.host.findings()) {
      if (!f.at) continue;
      c.strokeStyle = f.level === 'stop' ? t.vnStop : f.level === 'danger' ? t.vnDanger : t.vnNote;
      c.lineWidth = 1.5;
      c.beginPath();
      // 止める is a square, 赤 and 黄 are rings (as the dots in the list)
      if (f.level === 'stop') c.rect(this.X(f.at[0]) - 9, this.Z(f.at[1]) - 9, 18, 18);
      else c.arc(this.X(f.at[0]), this.Z(f.at[1]), 10, 0, Math.PI * 2);
      c.stroke();
    }
    this.drawScale();
  }

  private drawWater(w: WaterShape) {
    const c = this.ctx;
    const t = this.t;
    if (w.kind === 'infinite') return;
    c.fillStyle = t.vnWater;
    c.strokeStyle = t.vnWaterLine;
    c.lineWidth = 1;
    c.beginPath();
    if (w.kind === 'circle') c.arc(this.X(0), this.Z(0), w.radius * this.scale, 0, Math.PI * 2);
    else {
      const x = this.X(-w.width / 2);
      const y = this.Z(-w.depth / 2);
      const r = w.kind === 'roundedRect' ? Math.min(w.radius, w.width / 2, w.depth / 2) * this.scale : 0;
      c.roundRect(x, y, w.width * this.scale, w.depth * this.scale, r);
    }
    c.fill();
    c.stroke();
  }

  private gridStep() {
    const steps = [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 500];
    return steps.find((s) => s * this.scale >= 18) ?? 1000;
  }

  private drawGrid() {
    const c = this.ctx;
    const step = this.gridStep();
    const [x0, z0] = this.toWorld(0, 0);
    const [x1, z1] = this.toWorld(this.w, this.h);
    c.lineWidth = 1;
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      c.strokeStyle = Math.abs(Math.round(x / step)) % 5 === 0 ? this.t.vnGridStrong : this.t.vnGrid;
      c.beginPath();
      c.moveTo(Math.round(this.X(x)) + 0.5, 0);
      c.lineTo(Math.round(this.X(x)) + 0.5, this.h);
      c.stroke();
    }
    for (let z = Math.ceil(z0 / step) * step; z <= z1; z += step) {
      c.strokeStyle = Math.abs(Math.round(z / step)) % 5 === 0 ? this.t.vnGridStrong : this.t.vnGrid;
      c.beginPath();
      c.moveTo(0, Math.round(this.Z(z)) + 0.5);
      c.lineTo(this.w, Math.round(this.Z(z)) + 0.5);
      c.stroke();
    }
  }

  private drawScale() {
    const c = this.ctx;
    const len = this.gridStep() * 5;
    const px = len * this.scale;
    const x = this.w - 24 - px;
    const y = this.h - 36;
    c.strokeStyle = this.t.vnText;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + px, y);
    c.moveTo(x, y - 4);
    c.lineTo(x, y + 4);
    c.moveTo(x + px, y - 4);
    c.lineTo(x + px, y + 4);
    c.stroke();
    c.fillStyle = this.t.vnText;
    c.font = `11px ${this.t.fontCanvas}`;
    c.textAlign = 'center';
    c.fillText(len >= 1 ? `${len} m` : `${Math.round(len * 100)} cm`, x + px / 2, y - 8);
    c.textAlign = 'left';
  }
}

/** Moves a whole part by [dx, dz]. */
export function movePart(p: Part, [dx, dz]: Pt) {
  const add = (q: Pt): Pt => [Math.round((q[0] + dx) * 1e6) / 1e6, Math.round((q[1] + dz) * 1e6) / 1e6];
  if ('from' in p && p.from && p.to) {
    p.from = add(p.from);
    p.to = add(p.to);
  }
  if ('center' in p) p.center = add(p.center);
  if (p.kind === 'single') p.at = add(p.at);
  if (p.kind === 'projector') {
    p.at = add(p.at);
    p.aim = add(p.aim);
  }
}

/** ずらす: one fixture of an array to [x, z]; back on its place removes the nudge. */
function nudge(p: Extract<Part, { group: string }>, i: number, to: Pt, free: boolean, view: TopView) {
  if (p.kind === 'single') {
    p.at = view.snapOffset(to, free);
    return;
  }
  const base = partPositions(p)[i];
  if (!base) return;
  const by = view.snapOffset([to[0] - base[0], to[1] - base[2]], free);
  const rest = (p.nudge ?? []).filter((n) => n.i !== i);
  if (by[0] || by[1]) rest.push({ i, by });
  rest.sort((a, b) => a.i - b.i);
  if (rest.length) p.nudge = rest;
  else delete p.nudge;
}

function distToSeg(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = dx * dx + dz * dz || 1;
  const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l));
  return Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dz);
}

/** The water's corners, for framing. */
function waterBox(w: WaterShape): Pt[] | null {
  if (w.kind === 'infinite') return null;
  if (w.kind === 'circle') return [[-w.radius, -w.radius], [w.radius, w.radius]];
  return [[-w.width / 2, -w.depth / 2], [w.width / 2, w.depth / 2]];
}

/** Is p inside the polygon (even-odd)? */
function inPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) inside = !inside;
  }
  return inside;
}
