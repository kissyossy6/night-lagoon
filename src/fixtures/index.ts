import type { LaneStyle, Venue } from '../venues/types';
import { PYRO_KINDS } from './pyro';
import { SCREEN_KINDS } from './screen';
import type { FixtureKind, Folder } from './types';
import { WATER_KINDS } from './water';

export type * from './types';
export { NOZZLES, WATER_PARAMS, type ParamDef } from './water';
export { DEFAULT_FIRE } from './pyro';

/** Every kind of fixture, by id (the fixture table, docs/editor-architecture.md 4.3). */
export const KINDS: Record<string, FixtureKind> = Object.fromEntries([...WATER_KINDS, ...SCREEN_KINDS, ...PYRO_KINDS].map((k) => [k.id, k]));

export const FOLDER_NAMES: Record<Folder, string> = { water: '水', screen: '水幕', pyro: '花火' };

/** A kind by id; throws for an unknown one (a venue naming a kind that is not in the table). */
export function kind(id: string): FixtureKind {
  const k = KINDS[id];
  if (!k) throw new Error(`機材の種類 '${id}' が表にありません (src/fixtures/)`);
  return k;
}

/**
 * The timeline's lanes for a venue: its water groups in order, then its
 * screen groups, then the fireworks. Names and colours come from the kinds;
 * a group may rename its lane (label).
 */
export function lanesOf(venue: Venue): (LaneStyle & { kind: string })[] {
  const lanes: (LaneStyle & { kind: string })[] = [];
  const add = (group: string, kindId: string, label?: string) => {
    if (lanes.some((l) => l.group === group)) return;
    const k = kind(kindId);
    lanes.push({ group, kind: kindId, name: label ?? k.name, base: k.lane.base, accent: k.lane.accent });
  };
  for (const g of venue.groups) add(g.name, g.kind, g.label);
  for (const s of venue.screens) add(s.group, s.group);
  // the projector behind the screens (src/show/layout.ts)
  if (venue.screens.length) add('projector', 'projector');
  if (venue.pyro.length) add('pyro', 'pyro');
  // two groups of one kind (a desk tank's grid and chaser): say which is which
  const twice = new Set(lanes.filter((l, i) => lanes.findIndex((m) => m.name === l.name) !== i).map((l) => l.name));
  for (const l of lanes) if (twice.has(l.name)) l.name = `${l.name}・${l.group}`;
  return lanes;
}
