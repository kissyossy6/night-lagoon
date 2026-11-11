import type { NozzleSpec, NozzleType } from '../core/nozzles';
import type { ParamKey } from '../show/types';
import type { FixtureKind } from './types';

/**
 * Water fixtures (folder 水): the nozzle presets, the values a water cue
 * sets, and the kinds of fixture the venues place.
 */

const base = {
  origin: [0, 0, 0] as [number, number, number],
  pressure: 1,
  p2: [0, 0, 0, 0] as [number, number, number, number],
  kCol: 0.04,
  kDrop: 1.1,
  kMist: 5.0,
  turb: 0.06,
  color: '#00b4ff',
  intensity: 1.4,
  bore: 0.06,
  beam: 16,
  candela: 1,
};

/**
 * One nozzle per type, parameters from World of Color (docs/research.md).
 * Moved here from src/core/nozzles.ts (which keeps the physics); the kinds
 * below start from these.
 */
export const NOZZLES: Record<NozzleType, NozzleSpec> = {
  // WoC "Grid": 12 m, 2.44 m lattice, aerated
  vertical: {
    ...base,
    type: 'vertical',
    height: 12,
    jets: 5,
    p: [2.44, 0, 0, 0],
    spread: 0.015,
    aeration: 0.6,
    breakup: 0.7,
  },
  // WoC "Geyser": 61 m, ~150 L per shot, white aerated column
  shooter: {
    ...base,
    type: 'shooter',
    height: 61,
    jets: 1,
    p: [6.0, 1.2, 0, 0],
    spread: 0.035,
    aeration: 1.0,
    breakup: 0.9,
    turb: 0.14,
    bore: 0.35,
    beam: 11, // several narrow XL rings
    candela: 12,
    kDrop: 0.9,
  },
  // WoC "Single Water Whip": 30 m, +-55 deg, full stroke < 2 s
  oscillating: {
    ...base,
    type: 'oscillating',
    height: 30,
    jets: 1,
    p: [0.96, 4.0, 0.15, 0],
    beam: 30, // assumed: a medium beam so the stroke stays lit
    candela: 1.5,
    spread: 0.012,
    aeration: 0.45,
    breakup: 1.1,
  },
  // WoC "Dual Water Whip" in fan mode: 15 m sheet of jets
  fan: {
    ...base,
    type: 'fan',
    height: 15,
    jets: 11,
    p: [1.6, 0.15, 5.0, 0],
    beam: 40, // one wide ring around the fan nozzle
    candela: 0.5,
    spread: 0.012,
    aeration: 0.5,
    breakup: 0.8,
  },
  // WoC "Flower Spout": frothy outward ring opening to ~18 m
  ring: {
    ...base,
    type: 'ring',
    height: 10,
    jets: 16,
    p: [1.2, 0.5, 0.15, 6.0],
    spread: 0.02,
    aeration: 0.85,
    breakup: 0.6,
    turb: 0.08,
    bore: 0.12,
    beam: 25,
    candela: 0.8,
  },
  // WoC water screen section: 15 m high, lit by projection
  mist: {
    ...base,
    type: 'mist',
    height: 15,
    jets: 1,
    p: [0, 0, 0, 0],
    spread: 0.0,
    aeration: 1,
    breakup: 0,
    mist: { width: 30, depth: 2.5 },
  },
};


export interface ParamDef {
  key: ParamKey;
  ja: string;
  min: number;
  max: number;
  step: number;
  def: number | string;
}

/** The values a water (or screen) cue sets, as the inspector edits them. */
export const WATER_PARAMS: ParamDef[] = [
  { key: 'pressure', ja: '水圧', min: 0, max: 1, step: 0.01, def: 0.8 },
  { key: 'pan', ja: 'パン°', min: -60, max: 60, step: 1, def: 0 },
  { key: 'tilt', ja: 'チルト°', min: -45, max: 45, step: 1, def: 0 },
  { key: 'color', ja: '色', min: 0, max: 0, step: 0, def: '#00b4ff' },
  { key: 'intensity', ja: '明るさ', min: 0, max: 1.5, step: 0.01, def: 1 },
];

const waterCue: FixtureKind['cue'] = {
  sections: ['set', 'motion', 'macro'],
  unit: 'fixtures',
  newCue: (group) => ({ target: group, set: { pressure: 0.8 }, dur: 0.5 }),
};

/**
 * Placement numbers are 仮 (docs/detailed-design.md 6.3). Spacing: the
 * nearest two of a kind in the lagoon stand a little further apart than it
 * (grid 1.22 m across its staggered rows, chaser 1.6 m on its arcs).
 * Flow: grid from its 1 hp pump per nozzle (docs/research.md: Q = P·η/(ρgH)
 * = 0.75 kW × 0.6 / (9.81 kN/m³ × 12 m) ≈ 4 L/s); geyser from ~150 L per
 * shot over ~2 s; the rest by height and jets, to be checked.
 * Lean: the heads that move (oscillating whips, fans) reach the cue's tilt
 * range, ±45° (WATER_PARAMS; OASE's 2-axis drive S is ±45°, fountain-physics
 * references); a flower's jets open 0.5 rad (29°) outward (NOZZLES.ring p.y);
 * the rest stand upright (their spread is under 2°).
 */
const onWater = (spacing: number, flow: number, lean = 0): FixtureKind['place'] => ({ on: ['water'], spacing, flow, flowPer: 'unit', lean });

/** The lagoon's kinds (World of Color class, docs/research.md). */
export const WATER_KINDS: FixtureKind[] = [
  // Grid: WoC's 600+ workhorse jets on a 2.44 m lattice
  {
    id: 'grid',
    name: 'グリッド',
    label: 'グリッド（垂直 12 m）',
    folder: 'water',
    lane: { base: '#2c4468', accent: '#4fa3ff' },
    nozzle: { type: 'vertical', spec: { jets: 1, p: [0, 0, 0, 0] }, spray: 300, mist: 18, strands: 2 },
    cue: waterCue,
    place: onWater(1.2, 4),
  },
  // Whips: single water whips, 30 m, +-55 deg
  {
    id: 'whip',
    name: 'ウィップ',
    label: 'ウィップ（首振り 30 m）',
    folder: 'water',
    lane: { base: '#3b3566', accent: '#a98bff' },
    // real lighting: brightest just above the nozzle, thinning all the way
    // up, faint at the top, dark where it hangs down. Aerated, it carries
    // little light inside (guide); the colour thins every fadeLen metres of
    // path and the hanging part every fallFade metres fallen (the user and
    // the World of Color footage, 2026-10-27 and 2026-11-06)
    nozzle: { type: 'oscillating', spec: { jets: 1, p: [0, 0, 0, 0], fadeLen: 18, fallFade: 4, guide: 0.15 }, spray: 2600, mist: 120, strands: 3 },
    cue: waterCue,
    place: onWater(3, 8, 45),
  },
  // Chasers: 24 m, valve cycle < 0.8 s
  {
    id: 'chaser',
    name: 'チェイサー',
    label: 'チェイサー（弁 25 m）',
    folder: 'water',
    lane: { base: '#2d4a52', accent: '#4fe0d0' },
    nozzle: {
      type: 'shooter',
      spec: { height: 25, jets: 1, p: [0, 0, 0, 0], spread: 0.025, aeration: 0.9, bore: 0.12, breakup: 0.8, beam: 14, candela: 3 },
      spray: 1400,
      mist: 60,
      strands: 2,
      burst: 1.0,
    },
    cue: waterCue,
    place: onWater(1.2, 10),
  },
  // Fans: dual water whips in fan mode
  {
    id: 'fan',
    name: 'ファン',
    label: 'ファン（扇 15 m）',
    folder: 'water',
    lane: { base: '#30445a', accent: '#7fd1ff' },
    // real lighting as the whips: brightest at the nozzle, thin at the top,
    // dark on the way down (the user, 2026-11-06)
    nozzle: { type: 'fan', spec: { p: [1.6, 0, 0, 0], fadeLen: 15, fallFade: 4, guide: 0.3 }, spray: 3600, mist: 160, strands: 2 },
    cue: waterCue,
    place: onWater(5, 10, 45),
  },
  // Flower spouts: frothy outward rings
  {
    id: 'flower',
    name: 'フラワー',
    label: 'フラワー（花 10 m）',
    folder: 'water',
    lane: { base: '#4a3550', accent: '#ff8fd8' },
    nozzle: { type: 'ring', spec: { p: [1.2, 0.5, 0, 0] }, spray: 3600, mist: 200, strands: 2 },
    cue: waterCue,
    place: onWater(5, 12, 29),
  },
  // Geysers: 61 m, ~150 L per shot. A thick white body that widens with
  // height and sheds a heavy mist curtain (show footage, docs/video-review.md
  // R6); the wider bore and cone let the four ribbons merge into one column
  {
    id: 'geyser',
    name: 'ガイザー',
    label: 'ガイザー（空気式 61 m）',
    folder: 'water',
    lane: { base: '#42474f', accent: '#e8eef8' },
    nozzle: { type: 'shooter', spec: { p: [0, 0, 0, 0], bore: 0.6, spread: 0.05 }, spray: 11000, mist: 1100, strands: 4, burst: 2.0 },
    cue: waterCue,
    place: onWater(6, 75),
  },
  ...smallKinds(),
];

/**
 * The smaller scales' kinds (docs/detailed-design.md 6.4), all 仮.
 *
 * Height: no higher than the water's way to the rim in the sample venue
 * (fountain-layout: the jet's height ≤ its distance to the rim) — a desk
 * pump lifts 0.1–0.6 m, but in a 60 × 30 cm tank 0.1 m is what stays in.
 * Flow: the bore's area × the speed that reaches the height, Q = A·√(2gh)
 * (desk 2.5 mm at 0.1 m ≈ 0.007 L/s; garden 8 mm at 1 m ≈ 0.2; a small fan
 * 7 × 4 mm at 0.5 m ≈ 0.3; floor 16 mm at 4 m ≈ 1.8; a floor whip 20 mm at
 * 6 m ≈ 3.4). Spacing: about the gap two such jets keep in the samples.
 *
 * They are drawn and moved with the physics made for 100 m (drop 5 cm,
 * mist 50 cm): at desk and garden scale that is not checked against real
 * water yet (dev-plan B7).
 */
function smallKinds(): FixtureKind[] {
  const jet = (id: string, name: string, label: string, accent: string, height: number, bore: number, spray: number, place: FixtureKind['place']): FixtureKind => ({
    id,
    name,
    label,
    folder: 'water',
    lane: { base: '#2c4468', accent },
    nozzle: { type: 'vertical', spec: { height, jets: 1, p: [0, 0, 0, 0], bore }, spray, mist: Math.max(2, Math.round(spray / 16)), strands: 2 },
    cue: waterCue,
    place,
  });
  return [
    jet('desk-jet', 'ミニ噴き上げ', 'ミニ噴き上げ（机・垂直 0.1 m）', '#8fc4ff', 0.1, 0.0025, 40, onWater(0.03, 0.007)),
    jet('garden-jet', '庭の噴き上げ', '庭の噴き上げ（庭・垂直 1 m）', '#6fb0ff', 1, 0.008, 120, onWater(0.25, 0.2)),
    // a fixed fan: the head does not move, its jets open ±45° (NOZZLES.fan p.x)
    {
      id: 'garden-fan',
      name: '小さい扇',
      label: '小さい扇（庭・扇 0.5 m）',
      folder: 'water',
      lane: { base: '#30445a', accent: '#9fdcff' },
      nozzle: { type: 'fan', spec: { height: 0.5, jets: 7, p: [1.6, 0, 0, 0], bore: 0.004, fadeLen: 0.5, fallFade: 0.15, guide: 0.3 }, spray: 280, mist: 12, strands: 2 },
      cue: waterCue,
      place: onWater(0.5, 0.3, 45),
    },
    jet('floor-jet', '床の噴き上げ', '床の噴き上げ（広場・垂直 4 m）', '#5a9cff', 4, 0.016, 260, onWater(1, 1.8)),
    // a small whip: its head leans 20° at most
    {
      id: 'floor-whip',
      name: '床の首振り',
      label: '床の首振り（広場・首振り 6 m）',
      folder: 'water',
      lane: { base: '#3b3566', accent: '#c0a8ff' },
      nozzle: { type: 'oscillating', spec: { height: 6, jets: 1, p: [0, 0, 0, 0], bore: 0.02, fadeLen: 6 }, spray: 520, mist: 24, strands: 3 },
      cue: waterCue,
      place: onWater(1.5, 3.4, 20),
    },
  ];
}
