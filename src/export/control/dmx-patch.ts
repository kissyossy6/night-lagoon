import { PROFILES, buildPatch } from './profiles';
import { row } from './common';
import type { ControlExporter } from './types';

/**
 * D2 DMX の割り当て表: where each fixture sits on DMX, one row a fixture
 * (docs/detailed-design.md 5.3).
 *
 *   fixture,group,index,type,universe,artnet_universe,address,footprint,channels
 *
 * channels lists the fixture's DMX channels from its start address, e.g.
 * '1 ポンプ / 2 左右(上位) / 3 左右(下位) / …'. UTF-8 with a BOM, so a
 * spreadsheet opens the Japanese as it is.
 */

export const BOM = '﻿';

/** '1 ポンプ / 2 R / …' for a profile. */
export function slotList(kind: keyof typeof PROFILES): string {
  const out: string[] = [];
  let n = 1;
  for (const s of PROFILES[kind]) {
    if (s.bits === 16) {
      out.push(`${n++} ${s.label}(上位)`, `${n++} ${s.label}(下位)`);
    } else out.push(`${n++} ${s.label}`);
  }
  return out.join(' / ');
}

export const dmxPatch: ControlExporter = {
  id: 'dmx-patch',
  label: 'DMX の割り当て表',
  hint: '機材ごとのユニバース・番地・チャンネルの並び（1台1行）',
  ext: 'csv',
  mime: 'text/csv',
  timed: false,
  estimate: (_show, layout) => layout.channels * 90,
  amount: (_show, layout) => `${layout.channels} 台`,
  async *run(_show, layout) {
    const patch = buildPatch(layout);
    let out = BOM + row(['fixture', 'group', 'index', 'type', 'universe', 'artnet_universe', 'address', 'footprint', 'channels']);
    for (const e of patch.entries) {
      const index = layout.groups[e.group]?.indexOf(e.channel) ?? 0;
      out += row([e.name, e.group, index, e.kind, e.universe, e.universe - 1, e.address, e.footprint, slotList(e.kind)]);
    }
    yield out;
  },
};
