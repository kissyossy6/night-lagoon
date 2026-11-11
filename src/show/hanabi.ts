import type { Cue, Fire } from './types';

/**
 * The 花火版 ('hanabi'): Night Lagoon as it is, with fireworks over it
 * (docs/show-plan.md「花火版」). The fountains do not change; the sky is
 * the last card in the hand. It stays dark until the story is over, opens
 * with the finale and climbs with it, and the last chord is the biggest:
 *   162.62  the finale's first hit: the barge opens a fan of 3号 in the
 *           scene's red-orange over the whips' fan (their risers climb in
 *           the silence before it)
 *   166.94  4号 cross from the barge as the whips cross
 *   169.5   the colours remembered, one at a time from the land: cyan,
 *   170.83  pink,
 *   172.52  purple (peonies: short-lived, gone in the blackout at 173.8)
 *   174.29  the gold peak: three gold willows hang over the gold water and
 *           fall slowly into the hush (176.6-178.4)
 *   178.54  the chorus with the geyser gate: the whole land row, cyan to blue
 *   182.06  the hammered chords: one barge shell on each, left to right
 *   201.44  the last climb's chords, each bigger: 3号, 4号, 5号, white
 *   205.99  the final chord: three 10号 in white from the land, opened
 *           apart, over the white water, the barge's 4号 fan under them
 * Burst times are the music map's (docs/show-plan.md); a shell is launched
 * its rise before (src/pyro/schedule.ts). Every tube is inside its safety
 * distance: no warning.
 */
const P = {
  red: '#ff3000',
  orange: '#ff7a00',
  cyan: '#00b4ff',
  blue: '#1e3cff',
  pink: '#ff4fd0',
  purple: '#c03cff',
  gold: '#ffb050',
  silver: '#e8ecff',
  white: '#ffffff',
};

/** The barge (5 tubes, 155 m: up to 4号) and the land behind (7 tubes, 305 m: up to 10号). */
const BARGE = 'pyro:奥の台';
const LAND = 'pyro:奥の陸';

/** The ending's hammered chords (measured), one barge tube each. */
const HAMMER = [182.06, 182.47, 183.09, 183.45, 183.77];

export function hanabiFireworks(): Cue[] {
  const cues: Cue[] = [];
  const fire = (t: number, target: string, f: Fire, label: string) => cues.push({ t, target, fire: f, label });

  // the finale's first wave: the theme's fan again, now in the sky too
  fire(162.62, BARGE, { shell: 'kiku', size: 3, colors: [P.red], pattern: 'fan', spread: 40 }, '花火 第1波 扇');
  fire(166.94, BARGE, { shell: 'kiku', size: 4, colors: [P.orange], pattern: 'x', spread: 50 }, '花火 交差');
  // the colours remembered, one at a time
  fire(169.5, `${LAND}[1-5:2]`, { shell: 'kiku', size: 5, colors: [P.cyan], pattern: 'fan', spread: 30 }, '花火 色の記憶 シアン');
  fire(170.83, `${LAND}[0-6:3]`, { shell: 'botan', size: 5, colors: [P.pink], pattern: 'v', spread: 30 }, '花火 色の記憶 ピンク');
  fire(172.52, `${LAND}[1-5:2]`, { shell: 'botan', size: 5, colors: [P.purple], pattern: 'fan', spread: 30 }, '花火 色の記憶 紫');
  // the gold peak, falling slowly into the hush and gone before the chorus:
  // 3.8 s (the willow's 5.75 hung under 178.54; with each star's ±12 % the
  // last ends at 178.55, 2026-11-08, shots/pyro-adopt/willow-cue.jpg)
  fire(174.29, `${LAND}[0-6:3]`, { shell: 'yanagi', size: 7, colors: [P.gold], pattern: 'fan', spread: 20, burn: 3.8 }, '花火 金の柳');
  // the chorus: the whole land row with the geyser gate
  fire(178.54, LAND, { shell: 'kiku', size: 6, colors: [P.cyan, P.blue], pattern: 'fan', spread: 30 }, '花火 サビ 全部');
  HAMMER.forEach((t, i) => fire(t, `${BARGE}[${i}-${i}]`, { shell: 'botan', size: 3, colors: [P.cyan], angle: (i - 2) * 10 }, `花火 連打 ${i + 1}`));
  // the last climb's chords, each bigger, the colour drained to white
  fire(201.44, `${BARGE}[0-4:2]`, { shell: 'botan', size: 3, colors: [P.silver] }, '花火 登り 1');
  fire(202.58, BARGE, { shell: 'kiku', size: 4, colors: [P.silver], pattern: 'fan', spread: 30 }, '花火 登り 2');
  fire(203.76, `${LAND}[1-5:2]`, { shell: 'kiku', size: 5, colors: [P.white], pattern: 'v', spread: 30 }, '花火 登り 3');
  // the final chord: three, opened apart, so the last hit is a shape and not a white wall
  fire(205.99, `${LAND}[0-6:3]`, { shell: 'kiku', size: 10, colors: [P.white], pattern: 'v', spread: 30 }, '花火 最後の和音 10号');
  fire(205.99, BARGE, { shell: 'kiku', size: 4, colors: [P.white], pattern: 'fan', spread: 40 }, '花火 最後の和音 扇');
  return cues;
}
