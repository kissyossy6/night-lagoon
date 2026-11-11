import { CH, CHANNELS, evaluate, type CompiledShow } from '../../show/cues';
import type { Layout } from '../../show/layout';
import { breathe, channelNames, frameSpan, num, timecodeAt } from './common';
import { kindOf } from './profiles';
import type { ControlExporter, ExportOptions } from './types';

/**
 * D1 チャンネル CSV: every channel of every fixture, the water screens'
 * pressure and the projector zones' brightness (csvColumns), one row per
 * frame (docs/detailed-design.md 5.2).
 *
 *   time_s,timecode,grid[0].pressure,grid[0].pan,…,grid[0].intensity,grid[1].pressure,…
 *
 * Units: pressure 0..1, pan and tilt in degrees, r g b 0..1 (linear, as the
 * LED drivers take them), intensity 0..1 (above 1 in the ideal lighting).
 * Three decimals.
 */

const RAD = 180 / Math.PI;

/** The value written for one channel: evaluate()'s, with pan and tilt in degrees. */
export function channelValue(show: CompiledShow, fixture: number, channel: number, t: number): number {
  const v = evaluate(show, fixture, channel, t);
  return channel === CH.pan || channel === CH.tilt ? v * RAD : v;
}

/**
 * The columns: every channel of a fixture; a water screen's pressure only
 * (it holds mist); a projector zone's brightness only (2026-11-08: the
 * picture is the projector's).
 */
export function csvColumns(layout: Layout): { fixture: number; channel: number; name: string }[] {
  const names = channelNames(layout);
  const out: { fixture: number; channel: number; name: string }[] = [];
  for (let f = 0; f < layout.channels; f++) {
    const kind = kindOf(layout, f);
    const chans = kind === 'screen' ? ['pressure'] : kind === 'projector' ? ['intensity'] : [...CHANNELS];
    for (const c of chans) out.push({ fixture: f, channel: CHANNELS.indexOf(c as (typeof CHANNELS)[number]), name: `${names[f]}.${c}` });
  }
  return out;
}

/** Rows per chunk (10 s at 40 fps). */
const ROWS = 400;

export const channelsCsv: ControlExporter = {
  id: 'channels-csv',
  label: 'チャンネル CSV',
  hint: '水の機材は全部のチャンネル（圧力・左右・前後・色・明るさ）、水幕は水圧、プロジェクターは区画の明るさを、コマごとに1行',
  ext: 'csv',
  mime: 'text/csv',
  timed: true,
  estimate(show, layout, opts) {
    const { k0, k1 } = frameSpan(show, opts);
    // about 4 bytes a value: many are '0' or '1', the moving ones '0.123'
    return (k1 - k0 + 1) * (csvColumns(layout).length * 4 + 24);
  },
  amount(show, layout, opts) {
    const { k0, k1 } = frameSpan(show, opts);
    return `${(k1 - k0 + 1).toLocaleString()} コマ・${layout.channels} 台`;
  },
  async *run(show: CompiledShow, layout: Layout, opts: ExportOptions) {
    const cols = csvColumns(layout);
    yield `${['time_s', 'timecode', ...cols.map((c) => c.name)].join(',')}\r\n`;
    const { k0, k1 } = frameSpan(show, opts);
    const cells = new Array<string>(2 + cols.length);
    for (let a = k0; a <= k1; a += ROWS) {
      let out = '';
      for (let k = a; k <= Math.min(k1, a + ROWS - 1); k++) {
        const t = k / opts.fps;
        cells[0] = num(t);
        cells[1] = timecodeAt(t, opts);
        cols.forEach((c, j) => (cells[2 + j] = num(channelValue(show, c.fixture, c.channel, t))));
        out += `${cells.join(',')}\r\n`;
      }
      yield out;
      await breathe();
    }
  },
};
