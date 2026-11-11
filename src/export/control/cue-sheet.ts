import { cueTime, resolveTarget } from '../../show/cues';
import { zoneName } from '../../show/checks';
import { sectionSpans, spanAt } from '../../show/sections';
import { BOM } from './dmx-patch';
import { num, row, timecodeAt } from './common';
import { cueText, mediaText } from './words';
import type { ShowFile } from '../../show/types';
import type { ControlExporter, ExportOptions } from './types';

/**
 * D6 キュー表: the show as a script people read, one row a cue of the show
 * file (macros as written, not expanded), in time order
 * (docs/detailed-design.md 5.4).
 *
 *   time_s,timecode,section,target,what,media_server,label
 *
 * media_server: what a projector cue (or an older file's screen cue) asks of
 * the media server, the clip and where in it to start; the projector's
 * brightness is DMX (the patch).
 *
 * target is the venue's name for it when there is one ('前列', '奥の台'),
 * else the plain notation. A range limits the rows to the cues starting in it.
 */

/** The cues written, in time order: those starting in the range. */
function cueRows(file: ShowFile, opts: ExportOptions) {
  const [from, to] = opts.range ?? [-Infinity, Infinity];
  return file.cues
    .map((c, i) => ({ c, i, t: cueTime(c.t, file) }))
    .filter((r) => Number.isFinite(r.t) && r.t >= from - 1e-9 && r.t <= to + 1e-9)
    .sort((a, b) => a.t - b.t || a.i - b.i);
}

export const cueSheet: ControlExporter = {
  id: 'cue-sheet',
  label: 'キュー表',
  hint: '人が読む台本：時刻・場面・機材・何をするか・メディアサーバーへの合図（キュー1つで1行）',
  ext: 'csv',
  mime: 'text/csv',
  timed: true,
  estimate: (show, _layout, opts) => cueRows(show.file, opts).length * 110,
  amount: (show, _layout, opts) => `${cueRows(show.file, opts).length.toLocaleString()} キュー`,
  async *run(show, layout, opts) {
    const file = show.file;
    const spans = sectionSpans(file, file.duration);
    // the venue's names, by the target they stand for ('grid[0-87]' -> '前列')
    const names = new Map<string, string>();
    for (const v of layout.venue.selections) if (!names.has(v.target)) names.set(v.target, v.name);
    // the projector's zones by name: 'プロジェクター（中央）'
    const zonesOf = (target: string) => {
      const mine = new Set(resolveTarget(target, layout));
      const n = layout.projector.length;
      const z = layout.projector.map((x, k) => (mine.has(x.index) ? zoneName(k, n) : '')).filter(Boolean);
      return z.length === n ? 'プロジェクター（全部）' : `プロジェクター（${z.join('・')}）`;
    };
    const nameOf = (target: string) =>
      target.startsWith('@') ? target.slice(1) : /^projector\b/.test(target) && layout.projector.length > 1 ? zonesOf(target) : (names.get(target) ?? target);
    const rows = cueRows(file, opts);
    let out = BOM + row(['time_s', 'timecode', 'section', 'target', 'what', 'media_server', 'label']);
    for (const { c, t } of rows)
      out += row([num(t), timecodeAt(t, opts), spanAt(spans, t)?.name ?? '', nameOf(c.target), cueText(c, { clip: false }), c.clip ? mediaText(c.clip) : '', c.label ?? '']);
    yield out;
  },
};
