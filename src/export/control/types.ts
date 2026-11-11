import type { CompiledShow } from '../../show/cues';
import type { Layout } from '../../show/layout';

/**
 * Exports for real equipment (docs/detailed-design.md 5): tables and DMX the
 * controllers, lighting desks and firing systems read. Every value comes from
 * evaluate(show, fixture, channel, t), the same values the picture is drawn
 * from, and every export shares one timecode setting (D7).
 */

/** Frame rates offered. 40 is ParamHistory's RATE (src/show/history.ts). */
export const FPS_CHOICES = [40, 30, 25, 44] as const;

export interface ExportOptions {
  /** Frames per second; rows (or DMX frames) are at k / fps of show time. */
  fps: number;
  /** Timecode of show time 0, 'HH:MM:SS:FF' (no drop frame). */
  timecodeStart: string;
  /** Show time range (s); missing means the whole show. */
  range?: [number, number];
}

export type ExporterId = 'channels-csv' | 'dmx-patch' | 'cue-sheet' | 'pyro-csv' | 'dmx-record';

/** What an exporter writes, piece by piece (big files never sit in memory at once). */
export type Chunk = string | Uint8Array;

export interface ControlExporter {
  id: ExporterId;
  /** Menu label (Japanese). */
  label: string;
  /** One line under the label. */
  hint: string;
  ext: string;
  mime: string;
  /** Uses fps and range (a table over time), or not (the patch). */
  timed: boolean;
  /** Rough size in bytes, to choose between a download and the dev server. */
  estimate(show: CompiledShow, layout: Layout, opts: ExportOptions): number;
  /** How much the file holds, in its own unit ('455 キュー', '58 発', '8,681 コマ・376 台', '376 台'). */
  amount(show: CompiledShow, layout: Layout, opts: ExportOptions): string;
  run(show: CompiledShow, layout: Layout, opts: ExportOptions): AsyncIterable<Chunk>;
  /** Cautions shown (yellow) before exporting, e.g. values DMX has to cut off. */
  notes?(show: CompiledShow, layout: Layout, opts: ExportOptions): string[];
}
