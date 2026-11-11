import { BEATS_PER_BAR, BPM, SHOW_DURATION } from './song';
import type { Cue, ShowFile } from './types';

/**
 * The fireworks test shots (?show=pyrotest, stage 2): every kind and size of
 * shell one at a time, to check them against the table (src/pyro/shells.ts),
 * and one heavy stretch with the fountains for the frame time. The 花火版
 * itself is src/show/hanabi.ts.
 */
export const PYROTEST_TITLE = '花火の試し打ち';

/** Times of the single shells measured against the table (2.5, 5, 10号). */
export const PYROTEST_SIZES = { s25: 4, s5: 12, s10: 22 };
/** The heavy stretch: a star mine on every tube over the full fountains. */
export const PYROTEST_HEAVY = { from: 100, to: 118 };

const W = { red: '#ff2a1a', green: '#3cff6a', blue: '#3a6cff', gold: '#ffb050', white: '#ffffff', silver: '#e8ecff', pink: '#ff5fd0', purple: '#b04cff' };

export function buildPyroTest(): ShowFile {
  const cues: Cue[] = [
    // sizes against the table, alone in the sky
    { t: PYROTEST_SIZES.s25, target: '@奥の台 中央', fire: { shell: 'kiku', size: 2.5, colors: [W.red] }, label: '2.5号 菊' },
    { t: PYROTEST_SIZES.s5, target: '@奥の陸 中央', fire: { shell: 'kiku', size: 5, colors: [W.gold] }, label: '5号 菊' },
    { t: PYROTEST_SIZES.s10, target: '@奥の陸 中央', fire: { shell: 'kiku', size: 10, colors: [W.silver] }, label: '10号 菊' },
    // every kind
    { t: 32, target: 'pyro:奥の台[1-1]', fire: { shell: 'botan', size: 4, colors: [W.green] }, label: '牡丹' },
    { t: 38, target: '@奥の陸 中央', fire: { shell: 'yanagi', size: 7, colors: [W.gold] }, label: '柳' },
    { t: 47, target: '@奥の陸 中央', fire: { shell: 'yashi', size: 6, colors: [W.gold] }, label: '椰子' },
    { t: 53, target: 'pyro:奥の台[3-3]', fire: { shell: 'ring', size: 4, colors: [W.pink] }, label: '型物 (輪)' },
    { t: 59, target: '@奥の陸 中央', fire: { shell: 'senrin', size: 5, colors: [W.silver, W.gold] }, label: '千輪' },
    { t: 67, target: '@奥の陸 中央', fire: { shell: 'strobe', size: 5, colors: [W.white] }, label: '点滅' },
    { t: 73, target: '@奥の台', fire: { shell: 'comet', size: 3, colors: [W.gold] }, label: '彗星' },
    { t: 79, target: '@奥の台 中央', fire: { shell: 'mine', size: 2.5, colors: [W.red, W.green, W.blue], count: 16, interval: 0.2, angle: 20 }, label: 'スターマイン' },
    { t: 90, target: '@奥の陸 中央', fire: { shell: 'kiku', size: 7, colors: [W.red, W.green, W.white] }, label: '変化 (3色)' },
    // the heavy stretch: everything at once
    { t: PYROTEST_HEAVY.from, target: 'grid', set: { pressure: 0.85, color: '#ffb000' }, dur: 1.5, stagger: 0.01, order: 'center' },
    { t: PYROTEST_HEAVY.from, target: 'whip', set: { pressure: 1, color: '#ffffff' }, dur: 1 },
    { t: PYROTEST_HEAVY.from + 0.5, target: 'whip', macro: 'sway', args: { amp: 40, period: 4, dur: 16 }, stagger: 0.15 },
    { t: PYROTEST_HEAVY.from, target: 'fan', set: { pressure: 0.9, color: '#ff7a00' }, dur: 1 },
    { t: PYROTEST_HEAVY.from + 1, target: 'geyser', macro: 'pulse', args: { hold: 1.4 }, set: { color: '#ffffff' }, stagger: 0.25, order: 'center' },
    { t: PYROTEST_HEAVY.from + 4, target: 'geyser', macro: 'pulse', args: { hold: 1.4 }, set: { color: '#ffffff' }, stagger: 0.25, order: 'edges' },
    { t: PYROTEST_HEAVY.from + 2, target: '@奥の台', fire: { shell: 'mine', size: 3, colors: [W.gold, W.red, W.white], count: 30, interval: 0.25, angle: 25 }, label: 'スターマイン 全部' },
    { t: PYROTEST_HEAVY.from + 4, target: 'pyro:奥の陸[0-6:2]', fire: { shell: 'kiku', size: 8, colors: [W.white, W.gold], count: 3, interval: 1.5 }, label: '8号 3連' },
    { t: PYROTEST_HEAVY.from + 9, target: '@奥の陸', fire: { shell: 'yanagi', size: 6, colors: [W.gold] }, label: '柳 全部' },
    { t: PYROTEST_HEAVY.to - 2, target: 'grid', set: { pressure: 0 }, dur: 2 },
    { t: PYROTEST_HEAVY.to - 2, target: 'whip,fan', set: { pressure: 0 }, dur: 2 },
    // too close on purpose: the editor shows the red warning
    { t: 130, target: 'pyro:奥の台[2-2]', fire: { shell: 'kiku', size: 5, colors: [W.blue] }, label: '保安距離の確認 (近すぎる)' },
  ];
  return { title: PYROTEST_TITLE, bpm: BPM, beatsPerBar: BEATS_PER_BAR, offset: 0, duration: SHOW_DURATION, cues };
}
