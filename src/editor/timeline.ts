import { sectionSpans } from '../show/sections';
import type { Cue } from '../show/types';
import { compilePyro } from '../pyro/schedule';
import {
  kindOfLane,
  LAYOUT,
  leadOf,
  LANES,
  bodyOf,
  clockLabel,
  cueColors,
  cueLabel,
  durField,
  encodeTime,
  laneOf,
  luminance,
  secPerBar,
  secPerBeat,
  snapToBeat,
  spanOf,
  spreadOf,
  startOf,
  syncMissingLane,
  targetName,
  targetSuffix,
} from './model';
import { onThemeChange, theme } from '../ui/theme';
import type { Folder } from '../fixtures';
import { FOLDER_NAMES } from '../fixtures';
import { CHECK_KINDS, PICTURE, type Check, type PictureMap } from '../show/checks';
import type { EditorState } from './state';
import type { Transport } from './transport';
import { folderOfCue, folderOfLane, touchesLight, type EditorView } from './view';

/**
 * Canvas timeline: section bands, ruler with waveform, one lane per group
 * with cue blocks (packed into rows so overlapping cues stay visible), and
 * an overview strip for navigation.
 *
 * Lanes sit in folders by kind (水・水幕・花火, src/fixtures/). A folded
 * folder is one row with a thin strip per lane (its cues as lines); an open
 * one is a thin header row and then its lanes. The folder header has S and M
 * (src/editor/view.ts). Folding only changes what is drawn here.
 */

const HEAD_W = 124;
const SECT_H = 20;
const RULER_H = 46;
/** The row of the music's onsets (音の頭) under the ruler. */
const ONSET_H = 14;
/** Onsets weaker than this (0..1) are not marked, nor snapped to. */
const ONSET_MIN = 0.25;
/** A dragged cue snaps to an onset this close on screen (px), when no beat is closer. */
const ONSET_SNAP_PX = 8;
const NAV_H = 24;
const ROW_H = 21;
const LANE_PAD = 5;
const MIN_PX = 14;
const EDGE_PX = 6;
const TOP = SECT_H + RULER_H + ONSET_H;
/** Folder header row when open; folded rows are a strip per lane. */
const FOLDER_H = 24;
const STRIP = 6;
const FOLDED_MIN = 34;
/** Lanes inside a folder are indented in the header column. */
const INDENT = 8;
/** S and M boxes in the folder header. */
const BOX = 16;
const BOX_X = [HEAD_W - 44, HEAD_W - 24];

interface Block {
  i: number;
  lane: number;
  row: number;
  t0: number;
  span: number;
  invalid: boolean;
  /** Fireworks the safety checks flag: red (dangerous) or yellow (a stretch). */
  warn?: 'danger' | 'caution';
  /** Fireworks: seconds of rise drawn before the burst (t0). */
  lead: number;
}

interface LaneBox {
  y: number; // relative to the top of the lane area, before scroll
  h: number;
  rows: number;
  count: number;
}

interface FolderBox {
  folder: Folder;
  lanes: number[];
  y: number;
  h: number;
  open: boolean;
  count: number;
}

type Drag =
  | { mode: 'seek' }
  | { mode: 'nav'; grabOffset: number }
  | { mode: 'move'; x0: number; moved: boolean; orig: Map<number, number>; primary: number; key: string }
  | { mode: 'resize'; i: number; key: string }
  | { mode: 'marquee'; x0: number; y0: number; x1: number; y1: number; base: Set<number> };

let gesture = 0;

export class Timeline {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly tip: HTMLDivElement;
  private W = 0;
  private H = 0;
  private dpr = 1;
  /** Zoom (pixels per second) and the time at the left edge of the lanes. */
  pps = 28;
  viewT = 0;
  private scrollY = 0;
  private blocks: Block[] = [];
  private byIndex = new Map<number, Block>();
  /** Boxes of the open lanes (sparse: a folded lane has none). */
  private lanes: LaneBox[] = [];
  private folders: FolderBox[] = [];
  /** Blocks of folded lanes (drawn as the folder's strips, not hit). */
  private folded: Block[] = [];
  /** Problems per cue (src/show/checks.ts), from the editor. */
  private checks = new Map<number, Check[]>();
  private contentH = 0;
  /** A lane's name was clicked (the editor outlines its fixtures in the 3D). */
  onLaneHead: ((lane: number) => void) | null = null;
  private drag: Drag | null = null;
  private hover: Block | null = null;
  private playhead = 0;
  private queued = false;
  private packedPps = 0;
  /** The music's onsets (音の頭) strong enough to mark, in time order. */
  private onsets: { t: number; strength: number }[] = [];
  /** While dragging: the onset the cue snapped to, drawn as a guide. */
  private snapGuide: number | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly state: EditorState,
    private readonly transport: Transport,
    private readonly view: EditorView,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    host.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.tip = document.createElement('div');
    this.tip.className = 'tip';
    this.tip.hidden = true;
    host.appendChild(this.tip);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.pps = Math.max(8, (this.W - HEAD_W) / 44); // ~22 bars in view
    this.relayout();

    state.on((e) => {
      if (e.kind === 'file') {
        if (this.drag && (this.drag.mode === 'move' || this.drag.mode === 'resize')) this.refreshFrozen();
        else this.relayout();
      }
      this.request();
    });
    transport.onChange(() => this.request());
    onThemeChange(() => this.request());
    view.on((c) => {
      if (c !== 'filter') this.relayout();
      this.request();
    });

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('pointerleave', () => this.setHover(null));
    c.addEventListener('dblclick', (e) => this.onDouble(e));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  // ------------------------------------------------------------ geometry

  private get laneW() {
    return this.W - HEAD_W;
  }
  private get laneTop() {
    return TOP;
  }
  private get laneBottom() {
    return this.H - NAV_H;
  }
  private get duration() {
    return this.state.file.duration;
  }

  tx(t: number) {
    return HEAD_W + (t - this.viewT) * this.pps;
  }
  xt(x: number) {
    return this.viewT + (x - HEAD_W) / this.pps;
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(200, Math.round(r.width));
    this.H = Math.max(120, Math.round(r.height));
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.clampView();
    this.request();
  }

  private clampView() {
    const minPps = this.laneW / Math.max(1, this.duration);
    this.pps = Math.min(400, Math.max(minPps, this.pps));
    const visible = this.laneW / this.pps;
    this.viewT = Math.max(0, Math.min(this.viewT, this.duration - visible));
    const maxY = Math.max(0, this.contentH - (this.laneBottom - this.laneTop));
    this.scrollY = Math.max(0, Math.min(this.scrollY, maxY));
  }

  /** Pack cues into rows per lane, lanes into folders. */
  relayout() {
    const f = this.state.file;
    const minSpan = MIN_PX / this.pps;
    const gap = 3 / this.pps;
    syncMissingLane(f);
    const perLane: Block[][] = LANES.map(() => []);
    // red outranks yellow on a cue with both
    const warn = new Map<number, 'danger' | 'caution'>();
    for (const w of compilePyro(f, LAYOUT).warnings) if (warn.get(w.source) !== 'danger') warn.set(w.source, w.level);
    for (const [i, cs] of this.checks) {
      for (const c of cs) if (c.level !== 'info' && warn.get(i) !== 'danger') warn.set(i, c.level);
    }
    f.cues.forEach((cue, i) => {
      const l = laneOf(cue);
      const t0 = startOf(cue, f);
      const b: Block = {
        i,
        lane: Math.max(0, l),
        row: 0,
        t0: Number.isFinite(t0) ? t0 : 0,
        span: spanOf(cue),
        invalid: l < 0 || !!LANES[l]?.missing || !Number.isFinite(t0),
        warn: warn.get(i),
        lead: leadOf(cue),
      };
      perLane[b.lane].push(b);
    });
    this.blocks = [];
    this.folded = [];
    this.lanes = [];
    this.folders = [];
    let y = 0;
    const pack = (l: number) => {
      const list = perLane[l];
      list.sort((a, b) => a.t0 - b.t0 || a.i - b.i);
      const ends: number[] = [];
      for (const b of list) {
        const end = b.t0 + Math.max(b.span, minSpan) + gap;
        // a firework's rise is drawn before its burst and takes room too
        let r = ends.findIndex((e) => e <= b.t0 - b.lead);
        if (r < 0) r = ends.length;
        ends[r] = end;
        b.row = r;
      }
      const rows = Math.max(1, ends.length);
      // the projector's lane keeps room under its blocks for the picture strips (drawPicture)
      const h = rows * ROW_H + LANE_PAD * 2 + 4 + (LANES[l]?.group === 'projector' ? 12 : 0);
      this.lanes[l] = { y, h, rows, count: list.length };
      y += h;
      this.blocks.push(...list);
    };
    const order: Folder[] = [];
    LANES.forEach((_, l) => {
      const fo = folderOfLane(l);
      if (fo && !order.includes(fo)) order.push(fo);
    });
    for (const folder of order) {
      const lanes = LANES.map((_, l) => l).filter((l) => folderOfLane(l) === folder);
      const open = this.view.isOpen(folder);
      const count = lanes.reduce((n, l) => n + perLane[l].length, 0);
      const h = open ? FOLDER_H : Math.max(FOLDED_MIN, lanes.length * STRIP + 14);
      this.folders.push({ folder, lanes, y, h, open, count });
      y += h;
      if (open) for (const l of lanes) pack(l);
      else for (const l of lanes) this.folded.push(...perLane[l]);
    }
    // the この会場に無い lane belongs to no folder
    LANES.forEach((_, l) => {
      if (!folderOfLane(l)) pack(l);
    });
    this.contentH = y;
    this.byIndex = new Map(this.blocks.map((b) => [b.i, b]));
    this.packedPps = this.pps;
    this.clampView();
  }

  /** Problems per cue to mark on the blocks and in the tooltip. */
  /** Where the projector's picture lands (show/checks.ts pictureMap): strips under the projector's lane. */
  private picture: PictureMap | null = null;
  setPicture(map: PictureMap | null) {
    this.picture = map;
    this.request();
  }

  setChecks(list: Check[]) {
    this.checks = new Map();
    for (const c of list) this.checks.set(c.source, [...(this.checks.get(c.source) ?? []), c]);
    this.relayout();
    this.request();
  }

  /** Open the folder of lane l (or of cue i's lane) if it is folded. */
  private unfold(folder: Folder | null) {
    if (folder && !this.view.isOpen(folder)) this.view.setOpen(folder, true); // relayouts
  }

  /** During a drag: update times/spans of existing blocks without repacking. */
  private refreshFrozen() {
    const f = this.state.file;
    for (const b of this.blocks) {
      const cue = f.cues[b.i];
      if (!cue) continue;
      const t0 = startOf(cue, f);
      if (Number.isFinite(t0)) b.t0 = t0;
      b.span = spanOf(cue);
      b.lead = leadOf(cue);
    }
  }

  private rect(b: Block) {
    const lane = this.lanes[b.lane];
    const x = this.tx(b.t0);
    const w = Math.max(MIN_PX, b.span * this.pps);
    const y = this.laneTop + lane.y - this.scrollY + LANE_PAD + 2 + b.row * ROW_H;
    return { x, y, w, h: ROW_H - 3 };
  }

  /** Client-space rect of a cue block (for tests and scrolling). */
  blockRect(i: number) {
    const b = this.byIndex.get(i);
    if (!b) return null;
    const r = this.rect(b);
    const c = this.canvas.getBoundingClientRect();
    return { x: c.left + r.x, y: c.top + r.y, w: r.w, h: r.h };
  }

  /** Client-space rect of lane l (scrolled into view first). */
  laneRect(l: number) {
    this.unfold(folderOfLane(l));
    const lane = this.lanes[l];
    if (!lane) return null;
    const viewH = this.laneBottom - this.laneTop;
    if (lane.y < this.scrollY || lane.y + lane.h > this.scrollY + viewH) this.scrollY = lane.y - 4;
    this.clampView();
    this.draw();
    const c = this.canvas.getBoundingClientRect();
    return { x: c.left + HEAD_W, y: c.top + this.laneTop + lane.y - this.scrollY, w: this.laneW, h: lane.h };
  }

  /** Scroll so that cue i is visible. */
  reveal(i: number) {
    const cue = this.state.file.cues[i];
    if (cue && !this.byIndex.has(i)) this.unfold(folderOfCue(cue));
    const b = this.byIndex.get(i);
    if (!b) return;
    const visible = this.laneW / this.pps;
    if (b.t0 < this.viewT || b.t0 > this.viewT + visible * 0.9) this.viewT = b.t0 - visible * 0.25;
    const lane = this.lanes[b.lane];
    const y = lane.y + LANE_PAD + b.row * ROW_H;
    const viewH = this.laneBottom - this.laneTop;
    if (y < this.scrollY || y + ROW_H > this.scrollY + viewH) this.scrollY = y - viewH / 3;
    this.clampView();
    this.request();
  }

  private laneAt(y: number): number {
    const yy = y - this.laneTop + this.scrollY;
    return this.lanes.findIndex((l) => !!l && yy >= l.y && yy < l.y + l.h);
  }

  private folderAt(y: number): FolderBox | undefined {
    const yy = y - this.laneTop + this.scrollY;
    return this.folders.find((f) => yy >= f.y && yy < f.y + f.h);
  }

  /** The S (0) or M (1) box under (x, y) in a folder header, or -1. */
  private boxAt(fb: FolderBox, x: number, y: number): number {
    const by = this.laneTop + fb.y - this.scrollY + (fb.open ? (FOLDER_H - BOX) / 2 : 5);
    if (y < by || y > by + BOX) return -1;
    return BOX_X.findIndex((bx) => x >= bx && x <= bx + BOX);
  }

  private hit(x: number, y: number): { b: Block; edge: boolean } | null {
    if (x < HEAD_W || y < this.laneTop || y > this.laneBottom) return null;
    for (let k = this.blocks.length - 1; k >= 0; k--) {
      const b = this.blocks[k];
      const r = this.rect(b);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        const cue = this.state.file.cues[b.i];
        const edge = !!cue && durField(cue) !== null && x >= r.x + r.w - EDGE_PX && r.w >= 10;
        return { b, edge };
      }
    }
    return null;
  }

  // --------------------------------------------------------- interaction

  private local(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    this.canvas.focus({ preventScroll: true });
    const { x, y } = this.local(e);
    this.setHover(null);
    if (y >= this.laneBottom) {
      // overview strip: jump / drag the view window
      const t = ((x - HEAD_W) / this.laneW) * this.duration;
      const visible = this.laneW / this.pps;
      const inside = t >= this.viewT && t <= this.viewT + visible;
      const grab = inside ? t - this.viewT : visible / 2;
      this.drag = { mode: 'nav', grabOffset: grab };
      this.viewT = t - grab;
      this.clampView();
    } else if (y < this.laneTop) {
      if (x < HEAD_W) return;
      this.drag = { mode: 'seek' };
      this.transport.seek(Math.max(0, this.xt(x)));
    } else {
      const fb = this.folderAt(y);
      if (fb && x < HEAD_W) {
        // folder header: S, M, or fold / unfold
        const k = this.boxAt(fb, x, y);
        if (k === 0) this.view.toggleSolo(fb.folder);
        else if (k === 1) this.view.toggleMute(fb.folder);
        else this.view.setOpen(fb.folder, !fb.open);
        return;
      }
      if (fb && !fb.open) {
        this.view.setOpen(fb.folder, true);
        return;
      }
      if (x < HEAD_W) {
        const l = this.laneAt(y);
        if (l >= 0 && !LANES[l].missing) this.onLaneHead?.(l);
        return;
      }
      const h = this.hit(x, y);
      const st = this.state;
      if (h) {
        const i = h.b.i;
        if (e.shiftKey && !h.edge) {
          const sel = new Set(st.selection);
          if (sel.has(i)) {
            sel.delete(i);
            st.setSelection(sel, sel.size ? [...sel][sel.size - 1] : -1);
            this.request();
            return;
          }
          sel.add(i);
          st.setSelection(sel, i);
        } else if (!st.selection.has(i) || h.edge) {
          st.setSelection([i], i);
        } else {
          st.setSelection(st.selection, i);
        }
        st.seal();
        const key = `tl${++gesture}`;
        if (h.edge) {
          this.drag = { mode: 'resize', i, key };
        } else {
          const orig = new Map<number, number>();
          for (const k of st.selection) {
            const c = st.file.cues[k];
            const t = c ? startOf(c, st.file) : NaN;
            if (Number.isFinite(t)) orig.set(k, t);
          }
          this.drag = { mode: 'move', x0: x, moved: false, orig, primary: i, key };
        }
      } else {
        const base = e.shiftKey ? new Set(this.state.selection) : new Set<number>();
        if (!e.shiftKey && st.selection.size) st.setSelection([], -1);
        this.drag = { mode: 'marquee', x0: x, y0: y, x1: x, y1: y, base };
      }
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.request();
  }

  private onMove(e: PointerEvent) {
    const { x, y } = this.local(e);
    const d = this.drag;
    const f = this.state.file;
    if (!d) {
      const fb = y >= this.laneTop && y < this.laneBottom ? this.folderAt(y) : undefined;
      if (fb && (x < HEAD_W || !fb.open)) {
        const k = x < HEAD_W ? this.boxAt(fb, x, y) : -1;
        const name = FOLDER_NAMES[fb.folder];
        const text =
          k === 0 ? `S：${name}だけを見る（3D も${name}だけ）。もう一度押すと戻る`
          : k === 1 ? `M：${name}を 3D で消す（時間軸では薄く）。演出と書き出しはそのまま`
          : fb.open ? `${name}をたたむ` : `${name}を開く`;
        this.canvas.style.cursor = 'pointer';
        this.showTip(text, e);
        return;
      }
      const h = this.hit(x, y);
      this.canvas.style.cursor = h ? (h.edge ? 'ew-resize' : 'grab') : y < this.laneTop && x > HEAD_W ? 'col-resize' : y >= this.laneBottom ? 'pointer' : 'default';
      this.setHover(h ? h.b : null, e);
      return;
    }
    switch (d.mode) {
      case 'seek':
        this.transport.seek(Math.max(0, this.xt(x)));
        break;
      case 'nav': {
        const t = ((x - HEAD_W) / this.laneW) * this.duration;
        this.viewT = t - d.grabOffset;
        this.clampView();
        break;
      }
      case 'move': {
        if (!d.moved && Math.abs(x - d.x0) < 3) return;
        d.moved = true;
        this.canvas.style.cursor = 'grabbing';
        const p0 = d.orig.get(d.primary);
        if (p0 === undefined) return;
        let tp = p0 + (x - d.x0) / this.pps;
        tp = this.snap(tp, e.altKey);
        let delta = tp - p0;
        const minOrig = Math.min(...d.orig.values());
        delta = Math.max(delta, -minOrig);
        this.state.mutate(
          (file) => {
            for (const [k, t] of d.orig) {
              const c = file.cues[k];
              if (c) c.t = encodeTime(t + delta, file);
            }
          },
          { key: d.key, live: true, source: 'timeline' },
        );
        this.edgeScroll(x);
        break;
      }
      case 'resize': {
        const cue = f.cues[d.i];
        const field = cue ? durField(cue) : null;
        if (!cue || !field) return;
        const t0 = startOf(cue, f);
        const extra = field.kind === 'arg' ? field.extra : 0;
        let v = this.xt(x) - t0 - spreadOf(cue) - extra;
        const q = secPerBeat(f) / 4;
        v = e.altKey ? Math.round(v * 100) / 100 : Math.round(v / q) * q;
        this.state.mutate(
          (file) => {
            const c = file.cues[d.i];
            if (field.kind === 'dur') c.dur = Math.max(0, v);
            else c.args = { ...(c.args ?? {}), [field.key]: Math.max(field.key === 'hold' ? 0.05 : 0.25, v) };
          },
          { key: d.key, live: true, source: 'timeline' },
        );
        this.edgeScroll(x);
        break;
      }
      case 'marquee': {
        d.x1 = x;
        d.y1 = y;
        const x0 = Math.min(d.x0, x);
        const x1 = Math.max(d.x0, x);
        const y0 = Math.min(d.y0, y);
        const y1 = Math.max(d.y0, y);
        const sel = new Set(d.base);
        if (x1 - x0 > 2 || y1 - y0 > 2) {
          for (const b of this.blocks) {
            const r = this.rect(b);
            if (r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0) sel.add(b.i);
          }
          this.state.setSelection(sel, sel.size ? Math.min(...sel) : -1);
        }
        break;
      }
    }
    this.request();
  }

  private edgeScroll(x: number) {
    const margin = 30;
    if (x > this.W - margin) this.viewT += 4 / this.pps;
    else if (x < HEAD_W + margin && this.viewT > 0) this.viewT -= 4 / this.pps;
    this.clampView();
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    this.snapGuide = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (d && (d.mode === 'move' || d.mode === 'resize')) {
      this.state.seal();
      this.relayout();
    }
    this.canvas.style.cursor = 'default';
    this.request();
  }

  private onDouble(e: MouseEvent) {
    const { x, y } = this.local(e);
    if (x < HEAD_W || y < this.laneTop || y >= this.laneBottom) return;
    if (this.hit(x, y)) return;
    const lane = this.laneAt(y);
    if (lane < 0 || LANES[lane].missing) return;
    const f = this.state.file;
    let t = Math.max(0, this.xt(x));
    t = this.snap(t, e.altKey);
    this.snapGuide = null;
    const group = LANES[lane].group;
    // what a new cue of this lane looks like is the fixture table's (src/fixtures/)
    const cue: Cue = { t: encodeTime(t, f), ...kindOfLane(lane).cue.newCue(group, LAYOUT) };
    let index = -1;
    this.state.mutate(
      (file) => {
        file.cues.push(cue);
        index = file.cues.length - 1;
      },
      { structural: true, source: 'timeline' },
    );
    this.state.setSelection([index], index);
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const { x, y } = this.local(e);
    if (e.ctrlKey || e.metaKey) {
      const ax = Math.max(HEAD_W, x);
      const at = this.xt(ax);
      this.pps *= Math.exp(-e.deltaY * 0.0025);
      this.clampView();
      this.viewT = at - (ax - HEAD_W) / this.pps;
      this.clampView();
      if (Math.abs(this.pps / this.packedPps - 1) > 0.15) this.relayout();
    } else {
      const overflow = this.contentH > this.laneBottom - this.laneTop;
      const inLanes = y >= this.laneTop && y < this.laneBottom;
      const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!horizontal && inLanes && overflow) {
        this.scrollY += e.deltaY;
      } else {
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        this.viewT += d / this.pps;
      }
      this.clampView();
    }
    this.request();
  }

  zoomBy(k: number) {
    const ax = HEAD_W + this.laneW / 2;
    const at = this.xt(ax);
    this.pps *= k;
    this.clampView();
    this.viewT = at - (ax - HEAD_W) / this.pps;
    this.clampView();
    this.relayout();
    this.request();
  }

  private showTip(text: string, e: MouseEvent) {
    this.hover = null;
    this.tip.textContent = text;
    this.tip.hidden = false;
    const { x, y } = this.local(e);
    this.tip.style.left = `${Math.min(this.W - this.tip.offsetWidth - 6, x + 14)}px`;
    this.tip.style.top = `${y + 18}px`;
  }

  private setHover(b: Block | null, e?: MouseEvent) {
    if (this.hover === b && !b) return;
    this.hover = b;
    if (!b || !e) {
      this.tip.hidden = true;
      return;
    }
    const f = this.state.file;
    const cue = f.cues[b.i];
    if (!cue) return;
    const lines = [`${cueLabel(cue)}${cue.label && cue.macro ? ` (${cue.macro})` : ''}`];
    lines.push(`対象  ${targetName(cue.target)}${targetName(cue.target) !== cue.target ? `  (${cue.target})` : ''}`);
    lines.push(`時刻  ${cue.t}  = ${b.t0.toFixed(2)} 秒`);
    const body = bodyOf(cue);
    const spread = spreadOf(cue);
    lines.push(`長さ  ${body.toFixed(2)} 秒${spread > 0 ? ` + 時差 ${spread.toFixed(2)} 秒` : ''}`);
    if (cue.args && Object.keys(cue.args).length) lines.push(`引数  ${Object.entries(cue.args).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    if (cue.set?.color) lines.push(`色    ${cue.set.color}`);
    if (b.invalid) lines.push(LANES[b.lane]?.missing ? '⚠ この会場に狙う台がありません（このキューは動きません）' : '⚠ ターゲットまたは時刻が不正です');
    for (const c of this.checks.get(b.i) ?? []) {
      if (c.level === 'info' || c.kind === 'missing') continue;
      lines.push(`${c.level === 'danger' ? '⚠' : '△'} ${CHECK_KINDS[c.kind].title}${c.text ? `：${c.text}` : ''}`);
    }
    this.tip.textContent = lines.join('\n');
    this.tip.hidden = false;
    const { x, y } = this.local(e);
    const tw = this.tip.offsetWidth;
    const th = this.tip.offsetHeight;
    this.tip.style.left = `${Math.min(this.W - tw - 6, x + 14)}px`;
    this.tip.style.top = `${y + 18 + th > this.H ? y - th - 10 : y + 18}px`;
  }

  // --------------------------------------------------------------- frame

  /** Called every animation frame with the current show time. */
  tick(t: number, playing: boolean) {
    if (t !== this.playhead) {
      this.playhead = t;
      if (!this.drag) {
        const visible = this.laneW / this.pps;
        const jumped = !playing && (t > this.viewT + visible || t < this.viewT);
        if (jumped) {
          this.viewT = t - visible * 0.3;
          this.clampView();
        } else if (playing && (t > this.viewT + visible * 0.92 || t < this.viewT)) {
          this.viewT = t - visible * 0.08;
          this.clampView();
        }
      }
      this.request();
    }
  }

  /** The analysed music's onsets (src/audio/analysis.ts), marked under the ruler and snapped to. */
  setOnsets(list: readonly { t: number; strength: number }[]) {
    this.onsets = list.filter((o) => o.strength >= ONSET_MIN).sort((a, b) => a.t - b.t);
    this.request();
  }

  /**
   * Where a cue dragged or added at t lands: the nearest beat, or an onset
   * when one is within ONSET_SNAP_PX and nearer than that beat. Alt: as is.
   */
  private snap(t: number, alt: boolean): number {
    this.snapGuide = null;
    if (alt) return t;
    const f = this.state.file;
    const beat = snapToBeat(t, f);
    const reach = ONSET_SNAP_PX / this.pps;
    let best: number | null = null;
    // binary search for the first onset at or after t - reach
    let lo = 0;
    let hi = this.onsets.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.onsets[m].t < t - reach) lo = m + 1;
      else hi = m;
    }
    for (let k = lo; k < this.onsets.length && this.onsets[k].t <= t + reach; k++) {
      const o = this.onsets[k].t;
      if (best === null || Math.abs(o - t) < Math.abs(best - t)) best = o;
    }
    if (best !== null && Math.abs(best - t) < Math.abs(beat - t)) {
      this.snapGuide = best;
      return Math.round(best * 1000) / 1000;
    }
    return beat;
  }

  request() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  draw() {
    const g = this.g;
    const ui = theme();
    const { W, H } = this;
    const f = this.state.file;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = ui.tlBg;
    g.fillRect(0, 0, W, H);

    const spb = secPerBeat(f);
    const spBar = secPerBar(f);
    const t0 = this.viewT;
    const t1 = this.xt(W);
    const pxBeat = spb * this.pps;
    const pxBar = spBar * this.pps;
    const barStep = [1, 2, 4, 8, 16, 32].find((s) => s * pxBar >= 34) ?? 32;
    const firstBar = Math.max(0, Math.floor((t0 - f.offset) / spBar));
    const lastBar = Math.ceil((t1 - f.offset) / spBar);

    // ---------------------------------------------------------- lanes
    g.save();
    g.beginPath();
    g.rect(HEAD_W, this.laneTop, this.laneW, this.laneBottom - this.laneTop);
    g.clip();
    // lane backgrounds
    this.lanes.forEach((lane, l) => {
      const y = this.laneTop + lane.y - this.scrollY;
      g.fillStyle = l % 2 ? ui.tlRowA : ui.tlRowB;
      g.fillRect(HEAD_W, y, this.laneW, lane.h);
      g.fillStyle = ui.tlHead;
      g.fillRect(HEAD_W, y + lane.h - 1, this.laneW, 1);
    });
    // folder rows: a strip per lane when folded
    for (const fb of this.folders) {
      const y = this.laneTop + fb.y - this.scrollY;
      g.fillStyle = ui.tlRuler;
      g.fillRect(HEAD_W, y, this.laneW, fb.h);
      g.fillStyle = ui.tlHead;
      g.fillRect(HEAD_W, y + fb.h - 1, this.laneW, 1);
    }
    // section tints
    for (const s of sectionSpans(f, this.duration)) {
      const xa = this.tx(s.from);
      const xb = this.tx(s.to);
      g.fillStyle = s.color;
      g.globalAlpha = 0.07;
      g.fillRect(xa, this.laneTop, xb - xa, this.laneBottom - this.laneTop);
      g.globalAlpha = 1;
    }
    // beat / bar grid
    for (let bar = firstBar; bar <= lastBar; bar++) {
      const xb = Math.round(this.tx(f.offset + bar * spBar)) + 0.5;
      const strong = bar % barStep === 0;
      g.fillStyle = strong ? ui.tlGridStrong : ui.tlGrid;
      g.fillRect(xb, this.laneTop, 1, this.laneBottom - this.laneTop);
      if (pxBeat >= 9) {
        g.fillStyle = ui.tlGridFaint;
        for (let k = 1; k < f.beatsPerBar; k++) g.fillRect(Math.round(xb + k * pxBeat), this.laneTop, 1, this.laneBottom - this.laneTop);
      }
    }
    // folded folders: each lane's cues as a line
    const sel = this.state.selection;
    for (const fb of this.folders) {
      if (fb.open) continue;
      const y = this.laneTop + fb.y - this.scrollY;
      if (y > this.laneBottom || y + fb.h < this.laneTop) continue;
      const fade = this.view.shown(fb.folder) ? 1 : 0.35;
      const top = y + (fb.h - fb.lanes.length * STRIP) / 2 + 1;
      for (const b of this.folded) {
        const r = fb.lanes.indexOf(b.lane);
        if (r < 0) continue;
        const cue = f.cues[b.i];
        if (!cue) continue;
        const x = this.tx(b.t0);
        const w = Math.max(2, b.span * this.pps);
        if (x > W || x + w < HEAD_W) continue;
        const sy = top + r * STRIP;
        const light = !this.view.def.lightOnly || fb.folder === 'pyro' || touchesLight(cue);
        g.globalAlpha = (light ? 0.9 : 0.16) * fade;
        g.fillStyle = sel.has(b.i) ? ui.tlBlockSelected : cueColors(cue, b.lane)[0];
        g.fillRect(x, sy, w, STRIP - 2);
        if (b.warn || b.invalid) {
          g.globalAlpha = fade;
          g.fillStyle = b.invalid || b.warn === 'danger' ? ui.tlBlockInvalid : ui.tlCaution;
          g.beginPath();
          g.moveTo(x - 3, sy - 2);
          g.lineTo(x + 3, sy - 2);
          g.lineTo(x, sy + 2);
          g.closePath();
          g.fill();
        }
      }
      g.globalAlpha = 1;
    }
    // blocks
    g.font = `${ui.fsXs} ${ui.fontCanvas}`;
    g.textBaseline = 'middle';
    const lightOnly = !!this.view.def.lightOnly;
    for (const b of this.blocks) {
      const r = this.rect(b);
      if (r.x > W || r.x + r.w < HEAD_W || r.y > this.laneBottom || r.y + r.h < this.laneTop) continue;
      const cue = f.cues[b.i];
      if (!cue) continue;
      const folder = folderOfLane(b.lane);
      let fade = folder && !this.view.shown(folder) ? 0.35 : 1;
      // 光: the water's and screens' cues that do not touch the light stay faint
      if (lightOnly && folder !== 'pyro' && !touchesLight(cue)) fade *= 0.18;
      this.drawBlock(cue, b, r, sel.has(b.i), b.i === this.state.primary, fade);
    }
    this.drawPicture();
    // marquee
    const d = this.drag;
    if (d && d.mode === 'marquee' && (Math.abs(d.x1 - d.x0) > 2 || Math.abs(d.y1 - d.y0) > 2)) {
      g.fillStyle = ui.tlSelFill;
      g.strokeStyle = ui.tlSelLine;
      g.lineWidth = 1;
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      g.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      g.strokeRect(x + 0.5, y + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }
    g.restore();

    // --------------------------------------------------- lane headers
    g.save();
    g.beginPath();
    g.rect(0, this.laneTop, HEAD_W, this.laneBottom - this.laneTop);
    g.clip();
    this.lanes.forEach((lane, l) => {
      const y = this.laneTop + lane.y - this.scrollY;
      const def = LANES[l];
      const folder = folderOfLane(l);
      const ix = folder ? INDENT : 0;
      g.fillStyle = ui.tlRuler;
      g.fillRect(0, y, ix, lane.h);
      g.fillStyle = l % 2 ? ui.tlLaneA : ui.tlLaneB;
      g.fillRect(ix, y, HEAD_W - ix, lane.h);
      g.globalAlpha = folder && !this.view.shown(folder) ? 0.45 : 1;
      g.fillStyle = def.accent;
      g.fillRect(ix, y + 3, 3, lane.h - 6);
      const ty = Math.max(y, Math.min(this.laneTop, y + lane.h - 36));
      g.fillStyle = ui.tlLaneName;
      g.font = `${ui.fwBold} ${ui.fsSm} ${ui.fontCanvas}`;
      g.textBaseline = 'alphabetic';
      g.fillText(def.name, ix + 12, ty + 18, HEAD_W - ix - 16);
      g.fillStyle = ui.tlTextDim;
      g.font = `${ui.fs2xs} ${ui.fontMono}`;
      g.fillText(def.missing ? `${lane.count} キュー・動かない` : `${def.group} · ${lane.count}`, ix + 12, ty + 31, HEAD_W - ix - 16);
      // the projector: what the strips under its lane mean (drawPicture)
      if (def.group === 'projector' && this.picture?.zones.length && lane.h >= 76) {
        const ly = y + lane.h - 42;
        g.font = `${ui.fs2xs} ${ui.fontCanvas}`;
        const key: [string, string, number][] = [
          [def.accent, '霧に映る', 0.9],
          [def.accent, '下げた後の霧', 0.35],
          [ui.tlCaution, '霧が無い', 0.9],
        ];
        key.forEach(([c, text, a], k) => {
          g.globalAlpha = a;
          g.fillStyle = c;
          g.fillRect(ix + 12, ly + k * 12 - 4, 10, 2);
          g.globalAlpha = 1;
          g.fillStyle = ui.tlTextDim;
          g.fillText(text, ix + 26, ly + k * 12, HEAD_W - ix - 30);
        });
        g.fillText('下の線（左・中・右）', ix + 12, ly - 12, HEAD_W - ix - 16);
      }
      g.globalAlpha = 1;
      g.fillStyle = ui.tlHead;
      g.fillRect(0, y + lane.h - 1, HEAD_W, 1);
    });
    for (const fb of this.folders) this.drawFolderHead(fb);
    g.restore();
    g.fillStyle = ui.tlDivider;
    g.fillRect(HEAD_W - 1, this.laneTop, 1, this.laneBottom - this.laneTop);

    // ------------------------------------------------ sections + ruler
    g.fillStyle = ui.tlRuler;
    g.fillRect(0, 0, W, TOP);
    g.save();
    g.beginPath();
    g.rect(HEAD_W, 0, this.laneW, TOP);
    g.clip();
    g.textBaseline = 'middle';
    for (const s of sectionSpans(f, this.duration)) {
      const xa = this.tx(s.from);
      const xb = this.tx(s.to);
      if (xb < HEAD_W || xa > W) continue;
      g.fillStyle = s.color;
      g.globalAlpha = 0.75;
      g.fillRect(xa + 1, 2, xb - xa - 2, SECT_H - 3);
      g.globalAlpha = 1;
      g.fillStyle = ui.tlSectionText;
      g.font = `${ui.fwBold} ${ui.fsXs} ${ui.fontCanvas}`;
      const barOf = (x: number) => +((x - f.offset) / spBar + 1).toFixed(3);
      const label = `${s.name}  ${barOf(s.from)}–${barOf(s.to) - 1}`;
      const lx = Math.max(xa + 6, HEAD_W + 6);
      if (lx + g.measureText(label).width < xb - 4) g.fillText(label, lx, SECT_H / 2 + 0.5);
      else if (lx + 20 < xb) g.fillText(s.name.slice(0, 2), lx, SECT_H / 2 + 0.5);
    }
    // waveform
    const rulerY = SECT_H;
    const mid = rulerY + RULER_H / 2 + 4;
    const pk = this.transport.peaks;
    if (pk) {
      g.fillStyle = ui.tlWave;
      const amp = (RULER_H * 0.4) / Math.sqrt(pk.peak);
      for (let px = HEAD_W; px < W; px++) {
        const ta = this.xt(px);
        const tb = this.xt(px + 1);
        if (tb < 0 || ta > this.duration) continue;
        const b0 = Math.max(0, Math.floor(ta * pk.rate));
        const b1 = Math.min(pk.min.length, Math.max(b0 + 1, Math.floor(tb * pk.rate)));
        let lo = 0;
        let hi = 0;
        for (let k = b0; k < b1; k++) {
          if (pk.min[k] < lo) lo = pk.min[k];
          if (pk.max[k] > hi) hi = pk.max[k];
        }
        // square-root scale so the quiet intro still reads
        const y0 = mid - Math.sqrt(hi) * amp;
        const y1 = mid + Math.sqrt(-lo) * amp;
        g.fillRect(px, y0, 1, Math.max(1, y1 - y0));
      }
    }
    // bar numbers and beat ticks
    g.textBaseline = 'alphabetic';
    for (let bar = firstBar; bar <= lastBar; bar++) {
      const xb = Math.round(this.tx(f.offset + bar * spBar)) + 0.5;
      const strong = bar % barStep === 0;
      g.fillStyle = strong ? ui.tlTickStrong : ui.tlTick;
      g.fillRect(xb, rulerY, 1, strong ? 14 : 7);
      if (strong) {
        g.fillStyle = ui.tlTickText;
        g.font = `${ui.fwBold} ${ui.fsXs} ${ui.fontMono}`;
        g.fillText(String(bar + 1), xb + 4, rulerY + 12);
      }
      if (pxBeat >= 6) {
        g.fillStyle = ui.tlTick;
        for (let k = 1; k < f.beatsPerBar; k++) g.fillRect(Math.round(xb + k * pxBeat), rulerY, 1, 4);
      }
    }
    // seconds along the bottom of the ruler
    const secStep = [1, 2, 5, 10, 15, 30, 60].find((s) => s * this.pps >= 70) ?? 60;
    g.font = `${ui.fs2xs} ${ui.fontMono}`;
    for (let s = Math.ceil(t0 / secStep) * secStep; s <= t1; s += secStep) {
      const xs = Math.round(this.tx(s)) + 0.5;
      g.fillStyle = ui.tlMarker;
      g.fillRect(xs, SECT_H + RULER_H - 4, 1, 4);
      g.fillStyle = ui.tlMarkerStrong;
      g.fillText(clockLabel(s).replace(/\.00$/, ''), xs + 3, SECT_H + RULER_H - 4);
    }
    // the music's onsets (音の頭): a tick each, taller and brighter when stronger
    const oy = SECT_H + RULER_H;
    g.fillStyle = ui.tlDivider;
    g.fillRect(HEAD_W, oy, W - HEAD_W, 1);
    if (this.onsets.length) {
      g.fillStyle = ui.tlWave;
      for (const o of this.onsets) {
        if (o.t < t0 - 1 || o.t > t1 + 1) continue;
        const xo = Math.round(this.tx(o.t)) + 0.5;
        const h = 3 + Math.round((ONSET_H - 5) * o.strength);
        g.globalAlpha = 0.45 + 0.55 * o.strength;
        g.fillRect(xo - 0.5, oy + ONSET_H - h, 1.5, h);
      }
      g.globalAlpha = 1;
    }
    // end of show
    const xe = this.tx(this.duration);
    if (xe < W) {
      g.fillStyle = ui.tlShade;
      g.fillRect(xe, 0, W - xe, H);
    }
    g.restore();
    // corner
    g.fillStyle = ui.tlCorner;
    g.fillRect(0, 0, HEAD_W, TOP);
    g.fillStyle = ui.tlCornerText;
    g.font = `${ui.fsXs} ${ui.fontCanvas}`;
    g.textBaseline = 'middle';
    g.fillText('セクション', 12, SECT_H / 2 + 1);
    g.fillText('小節 / 波形', 12, SECT_H + 14);
    const ms = this.transport.music;
    g.fillStyle = ms === 'ready' ? ui.tlTextDim : ms === 'loading' ? ui.tlCaution : ui.tlTextDim;
    g.font = `${ui.fs2xs} ${ui.fontCanvas}`;
    g.fillText(ms === 'ready' ? '♪ 音楽あり' : ms === 'loading' ? '♪ 生成中…' : '音楽なし', 12, SECT_H + 32);
    g.fillStyle = ui.tlCornerText;
    g.fillText(this.onsets.length ? '音の頭' : '音の頭（解析待ち）', 12, SECT_H + RULER_H + ONSET_H / 2 + 1);
    g.fillStyle = ui.tlDivider;
    g.fillRect(0, TOP - 1, W, 1);
    g.fillRect(HEAD_W - 1, 0, 1, TOP);

    // ------------------------------------------- the onset snapped to
    if (this.snapGuide !== null && this.drag?.mode === 'move') {
      const xg = Math.round(this.tx(this.snapGuide)) + 0.5;
      if (xg >= HEAD_W && xg <= W) {
        g.fillStyle = ui.accent;
        g.fillRect(xg - 0.5, SECT_H + RULER_H, 1, this.laneBottom - SECT_H - RULER_H);
      }
    }

    // -------------------------------------------------------- playhead
    const xp = Math.round(this.tx(this.playhead)) + 0.5;
    if (xp >= HEAD_W && xp <= W) {
      g.fillStyle = ui.tlPlayhead;
      g.fillRect(xp - 0.5, SECT_H, 1.5, this.laneBottom - SECT_H);
      g.beginPath();
      g.moveTo(xp - 6, SECT_H);
      g.lineTo(xp + 6, SECT_H);
      g.lineTo(xp, SECT_H + 8);
      g.closePath();
      g.fill();
    }

    // vertical scroll indicator
    const viewH = this.laneBottom - this.laneTop;
    if (this.contentH > viewH) {
      const th = Math.max(20, (viewH * viewH) / this.contentH);
      const ty = this.laneTop + (this.scrollY / (this.contentH - viewH)) * (viewH - th);
      g.fillStyle = ui.tlScroll;
      g.fillRect(W - 5, ty, 3, th);
    }

    this.drawNav();
  }

  /**
   * Under the projector's lane, one thin strip per zone (top = left): bright
   * where the picture lands on mist, faint where it lands on mist that is
   * going down, the caution colour where the zone projects with no mist.
   */
  private drawPicture() {
    const map = this.picture;
    if (!map || !map.zones.length) return;
    const l = LANES.findIndex((x) => x.group === 'projector');
    const lane = this.lanes[l];
    if (l < 0 || !lane) return;
    const g = this.g;
    const ui = theme();
    const n = map.zones.length;
    const sh = 3;
    const y0 = this.laneTop + lane.y - this.scrollY + lane.h - 2 - n * sh;
    const i0 = Math.max(0, Math.floor(this.viewT / map.step));
    const i1 = Math.min(map.zones[0].length, Math.ceil(this.xt(this.W) / map.step) + 1);
    const colour = { [PICTURE.shown]: LANES[l].accent, [PICTURE.linger]: LANES[l].accent, [PICTURE.nomist]: ui.tlCaution } as Record<number, string>;
    const alpha = { [PICTURE.shown]: 0.9, [PICTURE.linger]: 0.35, [PICTURE.nomist]: 0.9 } as Record<number, number>;
    map.zones.forEach((row, k) => {
      const y = y0 + k * sh;
      let i = i0;
      while (i < i1) {
        const st = row[i];
        let j = i + 1;
        while (j < i1 && row[j] === st) j++;
        if (st !== PICTURE.off) {
          const xa = this.tx(i * map.step);
          const xb = this.tx(j * map.step);
          g.globalAlpha = alpha[st];
          g.fillStyle = colour[st];
          g.fillRect(xa, y, Math.max(1, xb - xa), sh - 1);
        }
        i = j;
      }
    });
    g.globalAlpha = 1;
  }

  private drawFolderHead(fb: FolderBox) {
    const g = this.g;
    const ui = theme();
    const y = this.laneTop + fb.y - this.scrollY;
    if (y > this.laneBottom || y + fb.h < this.laneTop) return;
    g.fillStyle = ui.tlRuler;
    g.fillRect(0, y, HEAD_W, fb.h);
    const shown = this.view.shown(fb.folder);
    const ty = y + (fb.open ? FOLDER_H / 2 : 13);
    g.textBaseline = 'middle';
    g.globalAlpha = shown ? 1 : 0.5;
    g.fillStyle = ui.tlLaneName;
    // one step above the lane names inside
    g.font = `${ui.fwBold} ${ui.fsMd} ${ui.fontCanvas}`;
    const name = `${fb.open ? '▾' : '▸'} ${FOLDER_NAMES[fb.folder]}`;
    g.fillText(name, 8, ty + 0.5);
    g.fillStyle = ui.tlTextDim;
    g.font = `${ui.fs2xs} ${ui.fontMono}`;
    const info = `${fb.lanes.length}行 · ${fb.count}`;
    if (fb.open) {
      const nx = 8 + g.measureText(name).width + 16;
      if (nx + g.measureText(info).width < BOX_X[0] - 8) g.fillText(info, nx, ty + 0.5);
    } else g.fillText(info, 20, ty + 15);
    g.globalAlpha = 1;
    // S and M
    const by = y + (fb.open ? (FOLDER_H - BOX) / 2 : 5);
    const on = [this.view.solo() === fb.folder, this.view.muted(fb.folder)];
    ['S', 'M'].forEach((label, k) => {
      const bx = BOX_X[k];
      if (on[k]) {
        g.fillStyle = k === 0 ? ui.tlSelLine : ui.tlTextDim;
        g.fillRect(bx, by, BOX, BOX);
      }
      g.strokeStyle = on[k] ? (k === 0 ? ui.tlSelLine : ui.tlTextDim) : ui.tlDivider;
      g.lineWidth = 1;
      g.strokeRect(bx + 0.5, by + 0.5, BOX - 1, BOX - 1);
      g.fillStyle = on[k] ? ui.tlBg : ui.tlTextDim;
      g.font = `${ui.fwBold} ${ui.fs2xs} ${ui.fontCanvas}`;
      g.textAlign = 'center';
      g.fillText(label, bx + BOX / 2, by + BOX / 2 + 0.5);
      g.textAlign = 'left';
    });
    g.fillStyle = ui.tlHead;
    g.fillRect(0, y + fb.h - 1, HEAD_W, 1);
  }

  private drawBlock(cue: Cue, b: Block, r: { x: number; y: number; w: number; h: number }, selected: boolean, primary: boolean, fade = 1) {
    const g = this.g;
    const ui = theme();
    const cols = cueColors(cue, b.lane);
    const x = Math.round(r.x) + 0.5;
    const y = Math.round(r.y) + 0.5;
    const w = Math.max(3, Math.round(r.w) - 1);
    const h = r.h;
    let fill: string | CanvasGradient = cols[0];
    if (cols.length > 1) {
      const gr = g.createLinearGradient(x, 0, x + w, 0);
      cols.forEach((c, k) => gr.addColorStop(k / (cols.length - 1), c));
      fill = gr;
    }
    // a firework's rise: a pale band from the launch up to the burst
    if (cue.fire && b.lead > 0) {
      const lw = b.lead * this.pps;
      g.globalAlpha = 0.28 * fade;
      g.fillStyle = cols[0];
      g.fillRect(x - lw, y + h * 0.3, lw, h * 0.4);
    }
    g.globalAlpha = selected ? 1 : 0.86 * fade;
    g.fillStyle = fill;
    roundRect(g, x, y, w, h, 3);
    g.fill();
    // stagger ramp: when the last fixture starts
    const spread = cue.macro === 'chase' ? 0 : spreadOf(cue);
    if (spread > 0 && spread * this.pps > 6) {
      g.globalAlpha = 0.35 * fade;
      g.strokeStyle = ui.tlRamp;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y + h);
      g.lineTo(x + Math.min(w, spread * this.pps), y);
      g.stroke();
    }
    // start marker; a firework's burst is a diamond
    g.globalAlpha = 0.9 * fade;
    g.fillStyle = ui.tlBlockMark;
    if (cue.fire) {
      const r = h * 0.38;
      g.beginPath();
      g.moveTo(x, y + h / 2 - r);
      g.lineTo(x + r, y + h / 2);
      g.lineTo(x, y + h / 2 + r);
      g.lineTo(x - r, y + h / 2);
      g.closePath();
      g.fill();
    } else g.fillRect(x, y + 1, 1.5, h - 2);
    g.globalAlpha = 1;
    const bad = b.invalid || b.warn;
    if (selected || bad) {
      g.lineWidth = selected ? 2 : 1.5;
      g.strokeStyle = bad ? (b.invalid || b.warn === 'danger' ? ui.tlBlockInvalid : ui.tlCaution) : primary ? ui.tlBlockPrimary : ui.tlBlockSelected;
      if (bad && !selected) g.setLineDash([3, 2]);
      roundRect(g, x - 0.5, y - 0.5, w + 1, h + 1, 3.5);
      g.stroke();
      g.setLineDash([]);
    } else if (fade > 0.5) {
      g.lineWidth = 1;
      g.strokeStyle = ui.tlBlockShadow;
      roundRect(g, x, y, w, h, 3);
      g.stroke();
    }
    // label
    if (w > 22 && (fade > 0.3 || selected)) {
      const lum = cols.length > 1 ? 0.6 : luminance(cols[0]);
      const dark = lum > 0.58;
      g.save();
      g.beginPath();
      g.rect(x + 3, y, w - 6, h);
      g.clip();
      const main = (cue.macro ? '∿ ' : '') + cueLabel(cue);
      g.font = `${ui.fwBold} ${ui.fsXs} ${ui.fontCanvas}`;
      g.fillStyle = dark ? ui.tlLabelDark : ui.tlLabelLight;
      // keep the label readable when the block starts left of the view
      const lx = Math.max(x + (cue.fire ? 10 : 5), Math.min(HEAD_W + 5, x + w - 40));
      g.fillText(main, lx, y + h / 2 + 0.5);
      const suffix = targetSuffix(cue);
      if (suffix) {
        const mw = g.measureText(main).width;
        g.font = `${ui.fsXs} ${ui.fontCanvas}`;
        g.fillStyle = dark ? ui.tlLabelSubDark : ui.tlLabelSubLight;
        g.fillText(suffix, lx + mw + 6, y + h / 2 + 0.5);
      }
      g.restore();
    }
    // resize grip on the selected block
    if (selected && durField(cue) && w >= 10) {
      g.fillStyle = ui.tlHandle;
      g.fillRect(x + w - 3, y + 4, 1.5, h - 8);
    }
  }

  private drawNav() {
    const g = this.g;
    const ui = theme();
    const { W, H } = this;
    const y0 = this.laneBottom;
    const f = this.state.file;
    const spBar = secPerBar(f);
    g.fillStyle = ui.tlNavBg;
    g.fillRect(0, y0, W, NAV_H);
    g.fillStyle = ui.tlDivider;
    g.fillRect(0, y0, W, 1);
    const sx = (t: number) => HEAD_W + (t / this.duration) * this.laneW;
    for (const s of sectionSpans(f, this.duration)) {
      g.fillStyle = s.color;
      g.globalAlpha = 0.35;
      const xa = sx(s.from);
      const xb = sx(s.to);
      g.fillRect(xa, y0 + 3, xb - xa - 1, NAV_H - 6);
    }
    g.globalAlpha = 0.9;
    const laneH = (NAV_H - 8) / LANES.length;
    for (const b of [...this.blocks, ...this.folded]) {
      g.fillStyle = LANES[b.lane].accent;
      g.fillRect(Math.round(sx(b.t0)), y0 + 4 + b.lane * laneH, 1, Math.max(1, laneH - 0.5));
    }
    g.globalAlpha = 1;
    const va = sx(this.viewT);
    const vb = sx(this.viewT + this.laneW / this.pps);
    g.strokeStyle = ui.tlNavView;
    g.lineWidth = 1;
    g.fillStyle = ui.tlNavViewFill;
    g.fillRect(va, y0 + 2, vb - va, NAV_H - 4);
    g.strokeRect(Math.round(va) + 0.5, y0 + 2.5, Math.max(4, vb - va - 1), NAV_H - 5);
    g.fillStyle = ui.tlPlayhead;
    g.fillRect(Math.round(sx(this.playhead)), y0 + 1, 1.5, NAV_H - 2);
    g.fillStyle = ui.tlTextDim;
    g.font = `${ui.fs2xs} ${ui.fontCanvas}`;
    g.textBaseline = 'middle';
    g.fillText('全体', 12, y0 + NAV_H / 2);
    void H;
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
