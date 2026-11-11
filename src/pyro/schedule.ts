import * as THREE from 'three';
import { cueTime } from '../show/cues';
import type { Layout } from '../show/layout';
import type { Fire, FirePattern, ShellName, ShowFile } from '../show/types';
import type { Vec3 } from '../venues';
import { ANGLE, MINE, SENRIN, SHELLS, sizeRow } from './shells';

/**
 * Fireworks schedule: the show's fire cues, split into single shells, each
 * with its launch worked out back from the burst time (the cue's t) and the
 * shell's rise. Everything that varies from shell to shell comes from the
 * cue's seed, so a show compiles to the same bursts every time and the
 * picture at any time depends on that time alone.
 */

export interface Burst {
  id: number;
  /** Launch = tBurst - rise. A 千輪's small shell 'launches' when its parent opens. */
  tLaunch: number;
  tBurst: number;
  tube: number;
  /** Where the riser starts: the tube, or a 千輪 parent's centre. */
  origin: Vec3;
  /** Where it opens. */
  center: Vec3;
  shell: ShellName;
  size: number;
  /** Opened radius (m). */
  radius: number;
  colors: [number, number, number][];
  stars: number;
  k: number;
  burn: number;
  seed: number;
  /** Index of the cue in the show file. */
  source: number;
  /** For a 千輪's small shells: the parent burst's id. */
  parent?: number;
  /** How strongly it lights the sky around it (Fire.glow); missing means SKY_GLOW (shells.ts). */
  glow?: number;
}

/**
 * Something about a cue's shells the editor flags (dev-plan F: red is
 * dangerous, yellow is a stretch). The cue is never dropped.
 * - tube: the tube is nearer the audience than the size's safety distance
 * - burst: leaned, the point under where it opens (the middle of where its
 *   stars and any dud come down) is nearer than that distance
 * - toward: it leans toward the audience
 * - steep: it leans more than ANGLE.caution from upright (held at ANGLE.max)
 */
export interface PyroWarning {
  source: number;
  tube: number;
  size: number;
  kind: 'tube' | 'burst' | 'toward' | 'steep';
  level: 'danger' | 'caution';
  /** tube, burst: metres needed and metres there are. toward, steep: the limit and the lean (deg). */
  need: number;
  have: number;
}

const G = 9.81;

/**
 * Resolve 'pyro', 'pyro:奥の台', 'pyro:奥の台[0-2]', 'pyro[0-4:2]' and
 * '@name' (the venue's selections, as for water cues) into tube indices.
 */
export function resolveTubes(target: string, layout: Layout, depth = 0): number[] {
  const out: number[] = [];
  for (const part of String(target ?? '').split(',').map((s) => s.trim())) {
    if (part.startsWith('@')) {
      const named = layout.selections[part.slice(1)];
      if (named !== undefined && depth < 4) out.push(...resolveTubes(named, layout, depth + 1));
      continue;
    }
    const m = /^([^[\],]+?)(?:\[(\d+)-(\d+)(?::(\d+))?\])?$/.exec(part);
    if (!m) continue;
    const g = layout.pyroGroups[m[1]];
    if (!g) continue;
    if (m[2] === undefined) out.push(...g);
    else {
      const step = Math.max(1, Number(m[4] ?? 1));
      for (let i = Number(m[2]); i <= Math.min(Number(m[3]), g.length - 1); i += step) out.push(g[i]);
    }
  }
  return out;
}

/** Small deterministic random numbers (0..1) from a seed. */
export function rng(seed: number) {
  let s = (Math.floor(seed) >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const hashSeed = (...v: number[]) => v.reduce((h, x) => (Math.imul(h ^ (x | 0), 2654435761) + 0x9e3779b9) >>> 0, 0x811c9dc5);

const tmp = new THREE.Color();
function rgb(hex: string): [number, number, number] {
  tmp.set(/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#ffffff'); // linear
  return [tmp.r, tmp.g, tmp.b];
}

/** Distance from a tube to the nearest of the audience (the venue's front edge, else its seats). */
export function audienceDistance(p: Vec3, layout: Layout): number {
  const edge = layout.venue.audience;
  if (edge) {
    const [ax, , az] = edge.from;
    const [bx, , bz] = edge.to;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const u = Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[2] - az) * dz) / len2));
    return Math.hypot(p[0] - (ax + dx * u), p[2] - (az + dz * u));
  }
  let d = Infinity;
  for (const s of layout.venue.seats) d = Math.min(d, Math.hypot(p[0] - s.pos[0], p[2] - s.pos[2]));
  return d;
}

/** The biggest size (号) a tube may fire, from its distance to the audience. */
export function maxSizeAt(p: Vec3, layout: Layout): number {
  const d = audienceDistance(p, layout);
  let best = 0;
  for (let s = 2.5; s <= 10 + 1e-6; s += 0.5) if (sizeRow(s).safety <= d) best = s;
  return best;
}

/** One shell of a cue before its look: which tube, which of its run, when (after the cue's t) and its lean (deg). */
interface Shot {
  tube: number;
  j: number;
  dt: number;
  lateral: number;
  tilt: number;
}

/** Positions -1..1 of n things in a row, left to right. */
const across = (n: number) => Array.from({ length: n }, (_, i) => (n > 1 ? (2 * i) / (n - 1) - 1 : 0));

/** The order steps of a sweep go off in: their indices (left to right), first to last. */
function sweepOrder(pattern: FirePattern, n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (pattern === 'sweep-rl') return idx.reverse();
  if (pattern === 'sweep-out') {
    const u = across(n);
    return idx.sort((a, b) => Math.abs(u[a]) - Math.abs(u[b]) || a - b);
  }
  return idx;
}

/**
 * Share a cue's lean out over its tubes and shots (Fire.pattern). Tubes are
 * placed left to right by where they stand, whatever order the target
 * names them in. With no pattern a star mine sweeps each run left to
 * right (+-angle) as before, and anything else leans by angle alone.
 */
function aim(f: Fire, tubes: number[], layout: Layout, count: number, interval: number, mine: boolean): Shot[] {
  const base = f.angle ?? 0;
  const tilt = f.tilt ?? 0;
  const half = (f.spread ?? ANGLE.spread) / 2;
  const p = f.pattern;
  const rank = new Map<number, number>();
  [...new Set(tubes)].sort((a, b) => layout.tubes[a].position[0] - layout.tubes[b].position[0] || a - b).forEach((t, i) => rank.set(t, i));
  const u = across(rank.size);
  const out: Shot[] = [];
  const sweep = p === 'sweep-lr' || p === 'sweep-rl' || p === 'sweep-out';
  if (sweep && count === 1 && rank.size > 1) {
    // single shots: the tubes go off in turn
    const order = sweepOrder(p, rank.size);
    for (const tube of tubes) {
      const i = rank.get(tube)!;
      out.push({
        tube,
        j: 0,
        dt: order.indexOf(i) * interval,
        lateral: base + u[i] * half,
        tilt,
      });
    }
    return out;
  }
  const uj = across(count);
  const order = sweep ? sweepOrder(p, count) : [];
  for (const tube of tubes) {
    const ui = u[rank.get(tube)!];
    for (let j = 0; j < count; j++) {
      let lateral = base;
      if (sweep) lateral = base + uj[order[j]] * half;
      else if (p === 'fan') lateral = base + ui * half;
      else if (p === 'v') lateral = base + Math.sign(ui) * half;
      else if (p === 'x') lateral = base - Math.sign(ui) * half;
      // a star mine sweeps its shots across the sky, left to right, and
      // takes the colours in turn
      else if (mine) lateral = (f.angle ?? MINE.spread) * uj[j];
      out.push({ tube, j, dt: j * interval, lateral, tilt });
    }
  }
  return out;
}

/** A lean (deg) held at ANGLE.max from upright: [lateral, tilt, from upright]. */
function held(lateral: number, tilt: number): [number, number, number] {
  const lean = Math.hypot(lateral, tilt);
  const k = lean > ANGLE.max ? ANGLE.max / lean : 1;
  return [lateral * k, tilt * k, lean * k];
}

/** Where a shell opens: h metres from the tube along its lean (deg). */
function aimed(pos: Vec3, lateral: number, tilt: number, h: number): Vec3 {
  const a = THREE.MathUtils.degToRad(lateral);
  const b = THREE.MathUtils.degToRad(tilt);
  return [pos[0] + Math.sin(a) * Math.cos(b) * h, pos[1] + Math.cos(a) * Math.cos(b) * h, pos[2] + Math.sin(b) * h];
}

export interface PyroSchedule {
  bursts: Burst[];
  warnings: PyroWarning[];
}

export function compilePyro(file: ShowFile, layout: Layout): PyroSchedule {
  const raw: Omit<Burst, 'id'>[] = [];
  const children: { parent: number; b: Omit<Burst, 'id' | 'parent'> }[] = [];
  const warnings: PyroWarning[] = [];
  file.cues.forEach((cue, source) => {
    const f = cue.fire;
    if (!f || !SHELLS[f.shell]) return;
    const t0 = cueTime(cue.t, file);
    if (!Number.isFinite(t0)) return;
    const tubes = resolveTubes(cue.target, layout);
    const mine = f.shell === 'mine';
    const count = Math.max(1, Math.round(f.count ?? (mine ? MINE.count : 1)));
    const interval = Math.max(0.02, f.interval ?? 0.25);
    const colors = (f.colors?.length ? f.colors : ['#ffffff']).slice(0, 3).map(rgb);
    const seed = f.seed ?? (source + 1) * 7919;
    const size = mine ? Math.min(MINE.maxSize, Math.max(MINE.minSize, f.size)) : Math.min(10, Math.max(2.5, Number(f.size) || 2.5));
    const need = sizeRow(size).safety;
    const height = sizeRow(size).height;
    const flagged = new Map<string, PyroWarning>();
    const flag = (w: Omit<PyroWarning, 'source' | 'size'>) => {
      const key = `${w.tube}:${w.kind}`;
      const was = flagged.get(key);
      const worse = w.kind === 'tube' || w.kind === 'burst' ? !was || w.have < was.have : !was || w.have > was.have;
      if (worse) flagged.set(key, { source, size, ...w });
    };
    const shots = aim(f, tubes, layout, count, interval, mine);
    for (const tube of tubes) {
      const pos = layout.tubes[tube].position;
      const have = audienceDistance(pos, layout);
      if (have < need) flag({ tube, kind: 'tube', level: 'danger', need, have });
    }
    for (const { tube, j, dt, lateral, tilt } of shots) {
      const pos = layout.tubes[tube].position;
      {
        // the safety checks use the lean as set, without the scatter
        const [la, ti, lean] = held(lateral, tilt);
        if (lean > 0.5) {
          const c = aimed(pos, la, ti, height);
          const haveB = audienceDistance([c[0], 0, c[2]], layout);
          if (haveB < need) flag({ tube, kind: 'burst', level: 'danger', need, have: haveB });
        }
        if (tilt > 0.5) flag({ tube, kind: 'toward', level: 'danger', need: 0, have: tilt });
        if (lean > ANGLE.caution + 0.01)
          flag({
            tube,
            kind: 'steep',
            level: 'caution',
            need: ANGLE.caution,
            have: Math.hypot(lateral, tilt),
          });
      }
      const r = rng(hashSeed(seed, tube, j));
      const shell: ShellName = mine ? 'kiku' : f.shell;
      const kind = SHELLS[shell];
      const row = sizeRow(size);
      // a little scatter, as no two shells fly quite alike
      const [la, ti] = held(lateral + (r() - 0.5) * 4, tilt);
      const h = row.height * (0.97 + r() * 0.06);
      const at = aimed(pos, la, ti, h);
      const center: Vec3 = [at[0], at[1], at[2] + (r() - 0.5) * h * 0.04];
      const tBurst = t0 + dt;
      const cols = mine ? [colors[j % colors.length]] : colors;
      const stars = kind.stars ?? Math.round(kind.starsPerSize * size);
      const b: Omit<Burst, 'id'> = {
        tLaunch: tBurst - row.rise,
        tBurst,
        tube,
        origin: pos,
        center,
        shell,
        size,
        radius: (row.diameter / 2) * kind.spread,
        colors: cols,
        stars,
        k: kind.k,
        burn: fireBurn(f, kind.burn),
        seed: hashSeed(seed, tube, j, 17),
        source,
        ...(f.glow !== undefined && Number.isFinite(Number(f.glow)) ? { glow: Math.max(0, Number(f.glow)) } : {}),
      };
      raw.push(b);
      if (shell === 'senrin') {
        const kid = sizeRow(SENRIN.size);
        for (let c = 0; c < SENRIN.children; c++) {
          // thrown out from the parent, falling a little before they pop
          const u = r() * 2 - 1;
          const th = r() * Math.PI * 2;
          const s = Math.sqrt(1 - u * u);
          const d = b.radius * (0.35 + 0.65 * Math.cbrt(r()));
          const dt = SENRIN.delay + r() * SENRIN.jitter;
          children.push({
            parent: raw.length - 1,
            b: {
              tLaunch: tBurst,
              tBurst: tBurst + dt,
              tube,
              origin: center,
              center: [center[0] + s * Math.cos(th) * d, center[1] + u * d - 0.5 * G * dt * dt * 0.3, center[2] + s * Math.sin(th) * d],
              shell: 'botan',
              size: SENRIN.size,
              radius: (kid.diameter / 2) * 0.5,
              colors: [cols[c % cols.length]],
              stars: SENRIN.stars,
              k: SENRIN.k,
              burn: SENRIN.burn,
              seed: hashSeed(b.seed, c),
              source,
              ...(b.glow !== undefined ? { glow: b.glow } : {}),
            },
          });
        }
      }
    }
    warnings.push(...flagged.values());
  });
  // ids in burst order; a 千輪's small shells point back at their parent
  const all = [
    ...raw.map((b, i) => ({ b, key: i, parent: -1 })),
    ...children.map((c, i) => ({
      b: c.b,
      key: raw.length + i,
      parent: c.parent,
    })),
  ];
  all.sort((x, y) => x.b.tBurst - y.b.tBurst || x.key - y.key);
  const idOf = new Map<number, number>();
  all.forEach((x, id) => idOf.set(x.key, id));
  const bursts: Burst[] = all.map((x, id) => ({
    ...x.b,
    id,
    ...(x.parent >= 0 ? { parent: idOf.get(x.parent)! } : {}),
  }));
  return { bursts, warnings };
}

/** Seconds a burst is visible after it opens (stars and their fade). */
/** A cue's own burn time (Fire.burn) when it has a usable one, else the kind's. */
export function fireBurn(f: Fire, kindBurn: number): number {
  const v = Number(f.burn);
  return f.burn !== undefined && Number.isFinite(v) && v > 0 ? Math.min(12, Math.max(0.3, v)) : kindBurn;
}

export const afterglow = (b: Burst) => b.burn * 1.2 + 0.2;
