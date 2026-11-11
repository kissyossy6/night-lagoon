import type { Layout, ScreenUnit } from './layout';
import { zonesOfScreen } from './layout';
import type { Cue, ShowFile } from './types';

/**
 * The projector owns the picture (docs/reports/2026-11-08-screen/projector.md).
 *
 * From file version 3 the water screens only hold mist (pressure); how bright
 * the picture is comes from the projector's zones ('projector',
 * 'projector[1-1]'). Older files put the brightness on the screens
 * ('intensity' on 'screen' and 'mound' cues); they are converted when they
 * are compiled, so the file itself is never rewritten and the editor opens
 * and saves it as before.
 *
 * The conversion keeps the picture as it was wherever only one screen has
 * mist in a zone: when a screen's mist starts to rise, its zones jump to that
 * screen's brightness (unseen: there is no mist yet) and then follow that
 * screen's brightness, with the same timing. Where two screens have mist in
 * one zone at once, the one that rose last decides; it is the one place the
 * picture can change (in the three versions: the wide sheet's last mist at
 * 2:37.5-2:40.8, which the break's picture now replaces).
 */

/** The projector's full output (the one place it lives: src/fixtures/screen.ts). */
export { PROJECTOR_MAX } from '../fixtures/screen';

/** File format that has the projector. */
export const PROJECTOR_VERSION = 3;

/** Seconds the mist hangs after its cue reaches zero (runtime.ts mistAt: 12 x 0.25 s). */
export const MIST_LINGER = 3;

/** A compiled intensity or pressure segment (cues.ts Segment), as read here. */
export interface Seg {
  start: number;
  dur: number;
  ease: Cue['ease'];
  to: number;
  from: number;
}

/** Whether a file needs converting: before version 3, with screens to convert. */
export function needsProjector(file: ShowFile, layout: Layout): boolean {
  return (file.version ?? 1) < PROJECTOR_VERSION && layout.projector.length > 0;
}

/** Screens a cue's intensity lands on, by layout channel. */
export function isScreen(layout: Layout, channel: number): boolean {
  return channel >= layout.screenIndex && channel < layout.screenIndex + layout.screens.length;
}

/** The projector channels a screen's brightness goes to. */
export function zoneChannels(layout: Layout, channel: number): number[] {
  const u = layout.screens.find((s) => s.index === channel);
  return u ? zonesOfScreen(layout.projector, u).map((z) => z.index) : [];
}

/** When each stretch of a screen's mist starts and is gone, from its pressure track. */
function mistSpans(pressure: Seg[]): [number, number][] {
  const eps = 1e-3;
  const spans: [number, number][] = [];
  let open = -1;
  for (const s of pressure) {
    if (open < 0 && s.from <= eps && s.to > eps) open = s.start;
    else if (open >= 0 && s.to <= eps) {
      spans.push([open, s.start + s.dur + MIST_LINGER]);
      open = -1;
    }
  }
  if (open >= 0) spans.push([open, Infinity]);
  return spans;
}

const value = (segs: Seg[], t: number, def: number, at: (s: Seg, t: number) => number) => {
  let v = def;
  for (const s of segs) {
    if (s.start > t) break;
    v = at(s, t);
  }
  return v;
};

/**
 * Projector cues that reproduce the screens' brightness (see the top). The
 * tracks are the old file compiled without conversion.
 */
export function projectorCues(
  layout: Layout,
  track: (channel: number, ch: 'pressure' | 'intensity') => Seg[],
  def: number,
  at: (s: Seg, t: number) => number,
): Cue[] {
  // rank keeps a zone's cues at one time in order once zones are merged:
  // the jump first, then a fade it was in, then the copied cues as compiled
  const out: (Cue & { rank: number })[] = [];
  let seq = 0;
  const spans = new Map<ScreenUnit, [number, number][]>(layout.screens.map((u) => [u, mistSpans(track(u.index, 'pressure'))]));
  for (const zone of layout.projector) {
    const here = layout.screens.filter((u) => zonesOfScreen(layout.projector, u).some((z) => z.index === zone.index));
    const marks = [...new Set(here.flatMap((u) => spans.get(u)!.flat()))].filter(Number.isFinite).sort((a, b) => a - b);
    let owner: ScreenUnit | null = null;
    for (let k = 0; k < marks.length; k++) {
      const p = marks[k];
      const q = marks[k + 1] ?? Infinity;
      // the screen whose mist rose last among those that have mist here
      let best: ScreenUnit | null = null;
      let from = -Infinity;
      for (const u of here) for (const [a, b] of spans.get(u)!) if (a <= p && p < b && a > from) [best, from] = [u, a];
      if (!best) {
        owner = null;
        continue;
      }
      const segs = track(best.index, 'intensity');
      const target = `projector[${zone.index - layout.projector[0].index}-${zone.index - layout.projector[0].index}]`;
      if (best !== owner) {
        // jump to this screen's brightness; a fade it is in the middle of goes on
        out.push({ t: p, target, set: { intensity: value(segs, p, def, at) }, dur: 0, ease: 'linear', rank: 0 });
        const going = segs.find((s) => s.start < p && s.start + s.dur > p);
        if (going) out.push({ t: p, target, set: { intensity: going.to }, dur: going.start + going.dur - p, ease: 'linear', rank: 1 });
      }
      for (const s of segs) if (s.start >= p && s.start < q) out.push({ t: s.start, target, set: { intensity: s.to }, dur: s.dur, ease: s.ease, rank: 2 + seq++ / 1e6 });
      owner = best;
    }
  }
  return mergeZones(out, layout.projector.length);
}

/** One cue for all zones (or a run of zones) where the same cue was made per zone. */
function mergeZones(cues: (Cue & { rank: number })[], n: number): Cue[] {
  const key = (c: Cue & { rank: number }) => `${c.t}|${c.set?.intensity}|${c.dur}|${c.ease}|${Math.min(c.rank, 2)}`;
  const groups = new Map<string, { cue: Cue & { rank: number }; zones: number[] }>();
  for (const c of cues) {
    const z = Number(/\[(\d+)-/.exec(c.target)![1]);
    const g = groups.get(key(c));
    if (g) g.zones.push(z);
    else groups.set(key(c), { cue: c, zones: [z] });
  }
  const out: (Cue & { rank: number })[] = [];
  for (const { cue, zones } of groups.values()) {
    zones.sort((a, b) => a - b);
    const run = zones.every((z, i) => i === 0 || z === zones[i - 1] + 1);
    if (zones.length === n) out.push({ ...cue, target: 'projector' });
    else if (run) out.push({ ...cue, target: `projector[${zones[0]}-${zones[zones.length - 1]}]` });
    else for (const z of zones) out.push({ ...cue, target: `projector[${z}-${z}]` });
  }
  return out.sort((a, b) => Number(a.t) - Number(b.t) || a.rank - b.rank).map(({ rank: _, ...c }) => c);
}

/** The old file's cues without the screens' brightness (the cue list keeps its order). */
export function withoutScreenIntensity(file: ShowFile, layout: Layout, targets: (cue: Cue) => number[]): Cue[] {
  return file.cues.map((c) => {
    if (c.set?.intensity === undefined || c.fire) return c;
    const fx = targets(c);
    if (!fx.length || !fx.every((f) => isScreen(layout, f))) return c;
    const { intensity: _, ...set } = c.set;
    return { ...c, set };
  });
}
