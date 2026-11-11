import { BOM } from './dmx-patch';
import { num, row, timecodeAt } from './common';
import { colorName, warningText } from './words';
import type { CompiledShow } from '../../show/cues';
import type { ControlExporter, ExportOptions } from './types';

/**
 * D5 花火の点火表（汎用 CSV）: one row a shell, by launch time
 * (docs/detailed-design.md 5.5). The shells are the ones drawn
 * (CompiledShow.bursts); a 千輪's small shells are not rows of their own.
 *
 *   event,launch_s,launch_tc,burst_s,site,tube,x,y,z,angle,tilt,shell,size_gou,colors,warning
 *
 * launch = burst - rise time. tube is the number within its site (0 from the
 * left), x y z the tube (m). angle and tilt are the lean the shell flies at
 * (deg; angle + toward stage right, tilt + toward the audience), worked out
 * from where it opens, so a star mine's scatter is in. The formats of the
 * firing systems (Finale 3D, FireOne, Cobra) come later.
 */

/** The shells written, by launch time: those launched in the range (a 千輪's small shells are not rows). */
function shellsIn(show: CompiledShow, opts: ExportOptions) {
  const [from, to] = opts.range ?? [-Infinity, Infinity];
  return show.bursts.filter((b) => b.parent === undefined && b.tLaunch >= from - 1e-9 && b.tLaunch <= to + 1e-9).sort((a, b) => a.tLaunch - b.tLaunch || a.tube - b.tube || a.id - b.id);
}

export const pyroCsv: ControlExporter = {
  id: 'pyro-csv',
  label: '花火の点火表',
  hint: '玉1発で1行：点火の時刻（開く時刻−上がる時間）・筒・角度・玉・警告',
  ext: 'csv',
  mime: 'text/csv',
  timed: true,
  estimate: (show, _layout, opts) => shellsIn(show, opts).length * 140 + 200,
  amount: (show, _layout, opts) => `${shellsIn(show, opts).length.toLocaleString()} 発`,
  async *run(show, layout, opts) {
    const shells = shellsIn(show, opts);
    const warn = new Map<string, string[]>();
    for (const w of show.pyroWarnings) {
      const k = `${w.source}:${w.tube}`;
      const list = warn.get(k) ?? warn.set(k, []).get(k)!;
      const text = warningText(w);
      if (!list.includes(text)) list.push(text);
    }
    let out = BOM + row(['event', 'launch_s', 'launch_tc', 'burst_s', 'site', 'tube', 'x', 'y', 'z', 'angle', 'tilt', 'shell', 'size_gou', 'colors', 'warning']);
    shells.forEach((b, i) => {
      const tube = layout.tubes[b.tube];
      const inSite = layout.pyroGroups[`pyro:${tube.site}`]?.indexOf(b.tube) ?? b.tube;
      const [dx, dy, dz] = [0, 1, 2].map((k) => b.center[k] - b.origin[k]);
      const angle = (Math.atan2(dx, dy) * 180) / Math.PI;
      const tilt = (Math.atan2(dz, dy) * 180) / Math.PI;
      const fire = show.file.cues[b.source]?.fire;
      const colors = (fire?.colors ?? []).map(colorName).join('→');
      out += row([
        i + 1,
        num(b.tLaunch),
        timecodeAt(b.tLaunch, opts),
        num(b.tBurst),
        tube.site,
        inSite,
        num(tube.position[0], 1),
        num(tube.position[1], 1),
        num(tube.position[2], 1),
        num(angle, 1),
        num(tilt, 1),
        b.shell,
        b.size,
        colors,
        (warn.get(`${b.source}:${b.tube}`) ?? []).join(' / '),
      ]);
    });
    yield out;
  },
};
