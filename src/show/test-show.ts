import { BEATS_PER_BAR, BPM, SHOW_DURATION } from './song';
import type { ShowFile } from './types';

/** Every fixture type running at once, for checking the renderer. */
export const TEST_SHOW: ShowFile = {
  title: 'test',
  bpm: BPM,
  beatsPerBar: BEATS_PER_BAR,
  offset: 0,
  duration: SHOW_DURATION,
  cues: [
    { t: 0, target: 'grid', set: { pressure: 0.85, color: '#00b4ff' }, dur: 1.5, stagger: 0.03, order: 'center' },
    { t: 0, target: 'whip', set: { pressure: 1, color: '#c03cff' }, dur: 1 },
    { t: 0.5, target: 'whip', macro: 'sway', args: { amp: 45, period: 4, dur: 60 }, stagger: 0.15 },
    { t: 0, target: 'fan', set: { pressure: 0.9, color: '#3cff5a' }, dur: 1 },
    { t: 0, target: 'flower', set: { pressure: 1, color: '#ff7a00' }, dur: 1 },
    { t: 1, target: 'flower', macro: 'bloom', args: { to: 20, dur: 3 } },
    { t: 1, target: 'chaser', macro: 'chase', args: { speed: 14, hold: 0.5, laps: 6 }, set: { color: '#ff3000' } },
    { t: 2, target: 'geyser', macro: 'pulse', args: { hold: 1.4 }, set: { color: '#ffffff' }, stagger: 0.25, order: 'center' },
  ],
};
