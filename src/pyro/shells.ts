import type { ShellName } from '../show/types';

/**
 * Aerial shells by size (号) and kind. Sizes, heights, diameters and safety
 * distances are sourced (docs/detailed-design.md 3.2, checked 2026-11-03);
 * the per-kind values below them (star counts, drag, burn times, tails) were
 * not found in any source and are set by eye.
 */

export interface SizeRow {
  /** 号 */
  size: number;
  /** Burst height above the tube (m). */
  height: number;
  /** Burst diameter as drawn (m): the catalogues' value x PHOTO_SPREAD. */
  diameter: number;
  /** Launch to burst (s). */
  rise: number;
  /** Nearest the audience may be (m): Kanagawa class A, 割物. */
  safety: number;
}

/**
 * The catalogues' diameters against photographs: measured the same way
 * (width over height above the far horizon), a real 10号 is 0.70 (Omagari)
 * and 0.72-0.74 (Nagaoka) as wide as it is high, ours drawn at the catalogue
 * size 0.87 (2026-11-03, shots/stage2/real/). The catalogues' "約" values run
 * large; every size is drawn at 0.82 of them.
 */
export const PHOTO_SPREAD = 0.82;

/** Diameters are the catalogues' (docs/detailed-design.md 3.2); see PHOTO_SPREAD. */
const CATALOGUE: (Omit<SizeRow, 'diameter'> & { catalogue: number })[] = [
  { size: 2.5, height: 90, catalogue: 50, rise: 3.3, safety: 100 },
  { size: 3, height: 120, catalogue: 60, rise: 3.8, safety: 140 },
  { size: 4, height: 160, catalogue: 120, rise: 4.4, safety: 150 },
  { size: 5, height: 190, catalogue: 170, rise: 4.8, safety: 220 },
  { size: 6, height: 220, catalogue: 220, rise: 5.2, safety: 250 },
  { size: 7, height: 250, catalogue: 240, rise: 5.5, safety: 250 },
  { size: 8, height: 280, catalogue: 280, rise: 5.9, safety: 250 },
  { size: 10, height: 330, catalogue: 310, rise: 6.4, safety: 300 },
];

export const SIZE_TABLE: SizeRow[] = CATALOGUE.map(({ catalogue, ...r }) => ({ ...r, diameter: catalogue * PHOTO_SPREAD }));

export const MIN_SIZE = SIZE_TABLE[0].size;
export const MAX_SIZE = SIZE_TABLE[SIZE_TABLE.length - 1].size;

/**
 * The table at any size, interpolated between rows. Below 2.5号 (the small
 * shells a 千輪 throws) it scales down with the size, as the table does
 * between 2.5 and 3; the safety distance never goes below the smallest row.
 */
export function sizeRow(size: number): SizeRow {
  const T = SIZE_TABLE;
  if (size <= T[0].size) {
    const k = Math.max(0.2, size / T[0].size);
    return { size, height: T[0].height * k, diameter: T[0].diameter * k, rise: T[0].rise * Math.sqrt(k), safety: T[0].safety };
  }
  if (size >= T[T.length - 1].size) return { ...T[T.length - 1], size };
  let i = 0;
  while (T[i + 1].size < size) i++;
  const a = T[i];
  const b = T[i + 1];
  const u = (size - a.size) / (b.size - a.size);
  const mix = (x: number, y: number) => x + (y - x) * u;
  return { size, height: mix(a.height, b.height), diameter: mix(a.diameter, b.diameter), rise: mix(a.rise, b.rise), safety: Math.max(a.safety, mix(a.safety, b.safety)) };
}

/** How one kind of shell opens and burns. Set by eye (no source found). */
export interface ShellKind {
  id: number;
  ja: string;
  /** Stars per 号 (yashi: a fixed few). */
  starsPerSize: number;
  /** Fixed star count, for the kinds that have a few big stars. */
  stars?: number;
  /** Air drag on a star (1/s): high stops it quickly, low lets it fly and fall. */
  k: number;
  /** Seconds a star burns. */
  burn: number;
  /** Opened size against the table's diameter. */
  spread: number;
  /** Tail: points behind the star, and seconds between them. */
  trail: number;
  trailDt: number;
  /** Size of a star's glow against a plain one. */
  starSize: number;
  /** Brightness of a star against a plain one. */
  bright: number;
}

export const SHELLS: Record<ShellName, ShellKind> = {
  botan: { id: 0, ja: '牡丹', starsPerSize: 60, k: 1.2, burn: 1.6, spread: 1, trail: 2, trailDt: 0.02, starSize: 1, bright: 1 },
  kiku: { id: 1, ja: '菊', starsPerSize: 60, k: 1.2, burn: 1.8, spread: 1, trail: 6, trailDt: 0.05, starSize: 0.9, bright: 1 },
  // gold charcoal stars that hang and fall: little drag after the opening,
  // a long burn and a long tail
  // burn 4.5 → 5.75 (2026-11-08, the reference page's willow hangs 5-6.5 s; docs/reports/hanabi-reference.html idea 6)
  yanagi: { id: 2, ja: '柳', starsPerSize: 40, k: 0.5, burn: 5.75, spread: 0.55, trail: 10, trailDt: 0.12, starSize: 0.7, bright: 0.7 },
  yashi: { id: 3, ja: '椰子', starsPerSize: 0, stars: 10, k: 0.6, burn: 2.5, spread: 0.9, trail: 10, trailDt: 0.09, starSize: 2.6, bright: 4 },
  ring: { id: 4, ja: '型物 (輪)', starsPerSize: 40, k: 1.2, burn: 1.5, spread: 0.7, trail: 2, trailDt: 0.02, starSize: 1.3, bright: 1.6 },
  // the parent opens weakly and throws small shells that pop 0.8 s later
  senrin: { id: 5, ja: '千輪', starsPerSize: 0, stars: 0, k: 1.2, burn: 0.3, spread: 0.6, trail: 0, trailDt: 0.02, starSize: 1, bright: 1 },
  strobe: { id: 6, ja: '点滅', starsPerSize: 50, k: 1.2, burn: 2.5, spread: 0.8, trail: 0, trailDt: 0.02, starSize: 1.1, bright: 1.3 },
  comet: { id: 7, ja: '彗星', starsPerSize: 0, stars: 0, k: 1, burn: 0.4, spread: 0, trail: 0, trailDt: 0.02, starSize: 1, bright: 1 },
  mine: { id: 1, ja: 'スターマイン', starsPerSize: 60, k: 1.2, burn: 1.8, spread: 1, trail: 6, trailDt: 0.05, starSize: 0.9, bright: 1 },
};

/**
 * How strongly a burst lights the sky around it in its colour (Fire.glow's
 * default; 1 is the comparison lab's idea 2 in full, which was too bright:
 * the owner chose a tenth, 2026-11-08).
 */
export const SKY_GLOW = 0.1;

/** The little shells of a 千輪: how many, their size, and when they pop. */
export const SENRIN = { children: 20, size: 1.5, delay: 0.8, jitter: 0.7, k: 2, burn: 0.9, stars: 36 };

/** A star mine's shots: small shells, the run's colours taken in turn. */
export const MINE = { minSize: 2.5, maxSize: 3, count: 12, spread: 15 };

/** Riser (the rising shell's tail): points and spacing; a comet's is longer and bright. */
export const RISER = { trail: 8, trailDt: 0.05 };
export const COMET = { trail: 10, trailDt: 0.07 };

export const SHELL_NAMES = Object.keys(SHELLS) as ShellName[];

/**
 * Leaning the tubes (deg from upright). A display may angle its mortars
 * away from the audience, never toward it; past caution the shell opens
 * noticeably lower and the rack is hard to build (yellow), past max it is
 * not built at all and the lean is held at max. spread is a pattern's
 * default width. Set by eye (no source found for the limits).
 */
export const ANGLE = { caution: 30, max: 45, spread: 40 };
