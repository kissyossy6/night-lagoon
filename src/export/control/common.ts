import type { CompiledShow } from '../../show/cues';
import type { Layout } from '../../show/layout';
import type { ExportOptions } from './types';

/**
 * Shared by the exports: the timecode (D7), the frames of a range, the names
 * of the channels, CSV cells.
 */

/** 'HH:MM:SS:FF' -> frames at fps. Throws on a malformed or out-of-range code. */
export function parseTimecode(tc: string, fps: number): number {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})[:;](\d{2})$/.exec(tc.trim());
  if (!m) throw new Error(`タイムコードは 時:分:秒:コマ（例 01:00:00:00）で書いてください：${tc}`);
  const [h, mi, s, f] = m.slice(1).map(Number);
  if (h > 23 || mi > 59 || s > 59 || f >= fps) throw new Error(`タイムコードの値が範囲の外です（コマは 0〜${fps - 1}）：${tc}`);
  return ((h * 60 + mi) * 60 + s) * fps + f;
}

/** Frames -> 'HH:MM:SS:FF' (wraps after 24 h, as timecode does). */
export function formatTimecode(frames: number, fps: number): string {
  const day = 24 * 3600 * fps;
  const n = ((Math.round(frames) % day) + day) % day;
  const f = n % fps;
  const s = Math.floor(n / fps);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f)}`;
}

/** Timecode of show time t: the start code plus t on the fps frame grid. */
export function timecodeAt(t: number, opts: ExportOptions): string {
  return formatTimecode(parseTimecode(opts.timecodeStart, opts.fps) + Math.round(t * opts.fps), opts.fps);
}

/**
 * Frames k of the range: show time k / fps for k0..k1 inclusive. Always on
 * the grid of the whole show, so a part lines up with the whole.
 */
export function frameSpan(show: CompiledShow, opts: ExportOptions): { k0: number; k1: number } {
  const [from, to] = opts.range ?? [0, show.file.duration];
  const eps = 1e-6;
  const k0 = Math.max(0, Math.ceil(from * opts.fps - eps));
  const k1 = Math.floor(Math.min(to, show.file.duration) * opts.fps + eps);
  return { k0, k1: Math.max(k0, k1) };
}

/** 'grid[0]', 'whip[23]', 'screen[0]', 'mound[2]' for every channel index of the layout. */
export function channelNames(layout: Layout): string[] {
  const names = new Array<string>(layout.channels).fill('');
  for (const [g, list] of Object.entries(layout.groups)) list.forEach((idx, k) => (names[idx] = `${g}[${k}]`));
  return names.map((n, i) => n || `ch[${i}]`);
}

/** A value with at most `digits` decimals, without trailing zeros ('0.5', '0', '-12.25'). */
export function num(v: number, digits = 3): string {
  const p = 10 ** digits;
  const r = Math.round(v * p) / p;
  return Object.is(r, -0) ? '0' : String(r);
}

/** One CSV cell: quoted when it holds a comma, quote or line break. */
export function cell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const row = (cells: (string | number)[]) => `${cells.map(cell).join(',')}\r\n`;

/** Let the page breathe between chunks (progress bar, cancel button). */
export const breathe = () => new Promise<void>((r) => setTimeout(r, 0));
