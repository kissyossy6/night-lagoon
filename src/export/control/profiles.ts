import { PROJECTOR_MAX } from '../../show/projector';
import { CH, CHANNELS, evaluate, type CompiledShow } from '../../show/cues';
import type { Layout } from '../../show/layout';
import type { NozzleType } from '../../core/nozzles';
import { channelNames } from './common';
import { lanesOf } from '../../fixtures';

/**
 * DMX profiles (the channels of each kind of fixture, in order) and the
 * patch (which universe and address each fixture starts at). The one place
 * for both; the patch table (D2), the DMX recording (D3) and Art-Net (D4)
 * all read them (docs/detailed-design.md 5.3).
 */

export type Kind = NozzleType | 'screen' | 'projector';

/** One DMX function: 8 bits, or 16 (coarse then fine) over a range of the channel's values. */
export interface Slot {
  /** Column name in the patch table. */
  label: string;
  channel: number;
  bits: 8 | 16;
  /** Value range mapped to 0..255 (0..65535); outside it is clipped (and noted). */
  min: number;
  max: number;
  /** Units of min and max: evaluate()'s are radians for pan and tilt. */
  deg?: boolean;
}

const pump = (label = 'ポンプ'): Slot => ({ label, channel: CH.pressure, bits: 8, min: 0, max: 1 });
const rgbI: Slot[] = [
  { label: 'R', channel: CH.r, bits: 8, min: 0, max: 1 },
  { label: 'G', channel: CH.g, bits: 8, min: 0, max: 1 },
  { label: 'B', channel: CH.b, bits: 8, min: 0, max: 1 },
  { label: '明るさ', channel: CH.intensity, bits: 8, min: 0, max: 1 },
];
const head = (label: string, channel: number, min: number, max: number): Slot => ({ label, channel, bits: 16, min, max, deg: true });

/**
 * Travel of the moving heads (deg). The whip is WoC's single water whip,
 * +-55 deg (src/core/nozzles.ts); the fan is the dual whip in fan mode, the
 * same mechanism. A flower's tilt opens its ring of jets outward (0 = up).
 */
export const HEAD_RANGE = { whip: 55, flowerOpen: 90 } as const;

export const PROFILES: Record<Kind, Slot[]> = {
  vertical: [pump(), ...rgbI],
  oscillating: [pump(), head('左右', CH.pan, -HEAD_RANGE.whip, HEAD_RANGE.whip), head('前後', CH.tilt, -HEAD_RANGE.whip, HEAD_RANGE.whip), ...rgbI],
  shooter: [pump('弁'), ...rgbI],
  fan: [pump('弁'), head('左右', CH.pan, -HEAD_RANGE.whip, HEAD_RANGE.whip), head('前後', CH.tilt, -HEAD_RANGE.whip, HEAD_RANGE.whip), ...rgbI],
  ring: [pump('弁'), head('開き', CH.tilt, 0, HEAD_RANGE.flowerOpen), ...rgbI],
  mist: [pump(), ...rgbI],
  // a water screen holds mist only: the picture is the projector's
  screen: [pump()],
  // one zone of the projector (src/show/layout.ts ProjectorZone): 255 is its
  // full output (PROJECTOR_MAX); what it plays goes to the media server
  // (the cue sheet), not DMX
  projector: [{ label: '明るさ', channel: CH.intensity, bits: 8, min: 0, max: PROJECTOR_MAX }],
};

/** DMX channels a slot takes. */
const width = (s: Slot) => s.bits / 8;
export const footprint = (k: Kind) => PROFILES[k].reduce((n, s) => n + width(s), 0);

export function kindOf(layout: Layout, channel: number): Kind {
  if (channel < layout.fixtures.length) return layout.fixtures[channel].type;
  return layout.projector.some((z) => z.index === channel) ? 'projector' : 'screen';
}

export interface PatchEntry {
  /** Channel index of the layout (fixtures, then the water screens). */
  channel: number;
  name: string;
  group: string;
  kind: Kind;
  /** 1-based, as lighting desks count; Art-Net numbers from 0 (universe - 1). */
  universe: number;
  /** 1..512 */
  address: number;
  footprint: number;
}

export interface Patch {
  entries: PatchEntry[];
  /** Universes used, ascending. */
  universes: number[];
  /** Overlaps and other trouble in a hand-made patch. */
  warnings: string[];
}

/**
 * Fixtures packed in layout order from universe 1 address 1; one never
 * straddles two universes. Groups the venue patches by hand start where the
 * venue says, and the rest follow after the last address used.
 */
export function buildPatch(layout: Layout): Patch {
  const names = channelNames(layout);
  const groupOf = new Array<string>(layout.channels).fill('');
  for (const [g, list] of Object.entries(layout.groups)) for (const i of list) groupOf[i] = g;
  const entries: PatchEntry[] = [];
  const warnings: string[] = [];
  const place = (channel: number, at: { u: number; a: number }) => {
    const kind = kindOf(layout, channel);
    const n = footprint(kind);
    if (at.a + n - 1 > 512) {
      at.u++;
      at.a = 1;
    }
    entries.push({ channel, name: names[channel], group: groupOf[channel], kind, universe: at.u, address: at.a, footprint: n });
    at.a += n;
  };
  const hand = layout.venue.patch ?? {};
  const done = new Set<number>();
  for (const [g, start] of Object.entries(hand)) {
    const list = layout.groups[g];
    if (!list) {
      warnings.push(`割り当ての「${g}」という機材の組が会場にありません`);
      continue;
    }
    const at = { u: start.universe, a: start.address };
    for (const i of list) {
      place(i, at);
      done.add(i);
    }
  }
  // the automatic part starts after the highest address in use
  const last = entries.reduce((m, e) => (e.universe * 513 + e.address + e.footprint > m.u * 513 + m.a ? { u: e.universe, a: e.address + e.footprint } : m), { u: 1, a: 1 });
  for (let i = 0; i < layout.channels; i++) if (!done.has(i)) place(i, last);
  // overlaps (only a hand-made patch can make them)
  const byU = new Map<number, PatchEntry[]>();
  for (const e of entries) (byU.get(e.universe) ?? byU.set(e.universe, []).get(e.universe)!).push(e);
  for (const list of byU.values()) {
    list.sort((a, b) => a.address - b.address);
    for (let k = 1; k < list.length; k++) {
      const p = list[k - 1];
      if (p.address + p.footprint > list[k].address) warnings.push(`ユニバース ${p.universe} の ${p.name} と ${list[k].name} の番地が重なっています`);
    }
  }
  return { entries: entries.sort((a, b) => a.channel - b.channel), universes: [...byU.keys()].sort((a, b) => a - b), warnings };
}

/** A slot's value at t as DMX: 1 byte, or coarse and fine. Also whether it was clipped. */
export function slotBytes(show: CompiledShow, channel: number, s: Slot, t: number, out: Uint8Array, at: number): boolean {
  let v = evaluate(show, channel, s.channel, t);
  if (s.deg) v *= 180 / Math.PI;
  const u = (v - s.min) / (s.max - s.min);
  const clipped = u < -1e-6 || u > 1 + 1e-6;
  const c = Math.min(1, Math.max(0, u));
  if (s.bits === 8) out[at] = Math.round(c * 255);
  else {
    const n = Math.round(c * 65535);
    out[at] = n >> 8;
    out[at + 1] = n & 255;
  }
  return clipped;
}

/**
 * Every universe's 512 bytes at show time t, into frames (one per
 * patch.universes entry, in that order).
 */
export function dmxFrame(show: CompiledShow, patch: Patch, t: number, frames: Uint8Array[]) {
  const slot = universeSlots(patch);
  for (const f of frames) f.fill(0);
  for (const e of patch.entries) {
    const buf = frames[slot.get(e.universe)!];
    let at = e.address - 1;
    for (const s of PROFILES[e.kind]) {
      slotBytes(show, e.channel, s, t, buf, at);
      at += width(s);
    }
  }
}

const slotsOf = new WeakMap<Patch, Map<number, number>>();
function universeSlots(patch: Patch) {
  let m = slotsOf.get(patch);
  if (!m) slotsOf.set(patch, (m = new Map(patch.universes.map((u, k) => [u, k]))));
  return m;
}

/**
 * What DMX cannot carry over the range: brightness above 1 (the ideal
 * lighting), a head past its travel. Read from the cue tracks, whose values
 * only move between a segment's from and to, so nothing is sampled.
 */
export function clipNotes(show: CompiledShow, layout: Layout, patch: Patch, range?: [number, number]): string[] {
  const [a, b] = range ?? [-Infinity, Infinity];
  const nCh = CHANNELS.length;
  const lane = new Map(lanesOf(layout.venue).map((l) => [l.group, l.name]));
  const found = new Map<string, { group: string; label: string; lo: number; hi: number; min: number; max: number; deg: boolean; n: number }>();
  for (const e of patch.entries) {
    for (const s of PROFILES[e.kind]) {
      const segs = show.tracks[e.channel * nCh + s.channel];
      let lo = Infinity;
      let hi = -Infinity;
      const see = (v: number) => {
        const x = s.deg ? (v * 180) / Math.PI : v;
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      };
      // the default holds until the first segment
      if (!segs.length || segs[0].start > a) see(evaluate(show, e.channel, s.channel, -1));
      segs.forEach((g, i) => {
        const end = i + 1 < segs.length ? segs[i + 1].start : Infinity;
        if (end < a || g.start > b) return;
        see(g.from);
        see(g.to);
      });
      if (lo >= s.min - 1e-6 && hi <= s.max + 1e-6) continue;
      const key = `${e.group}.${s.label}`;
      const f = found.get(key) ?? found.set(key, { group: e.group, label: s.label, lo, hi, min: s.min, max: s.max, deg: !!s.deg, n: 0 }).get(key)!;
      f.lo = Math.min(f.lo, lo);
      f.hi = Math.max(f.hi, hi);
      f.n++;
    }
  }
  const v = (x: number, d: boolean) => (d ? `${Math.round(x)}°` : String(Math.round(x * 100) / 100));
  return [...found.values()].map((f) => {
    const over = f.hi > f.max + 1e-6 ? `最大 ${v(f.hi, f.deg)}` : `最小 ${v(f.lo, f.deg)}`;
    const edge = f.hi > f.max + 1e-6 ? (f.deg ? v(f.max, true) : '255') : f.deg ? v(f.min, true) : '0';
    return `${lane.get(f.group) ?? f.group}の${f.label}：${over} → ${edge} で止まります（${f.n} 台）`;
  });
}
