import type { Fire } from '../show/types';
import type { FixtureKind } from './types';

/**
 * Fireworks (folder 花火): a cue fires shells from tubes. The shells and
 * the safety distances are src/pyro/ (shells.ts, schedule.ts).
 */

/** A new fireworks cue's shell. */
export const DEFAULT_FIRE: Fire = { shell: 'kiku', size: 5, colors: ['#ffb050'] };

export const PYRO_KINDS: FixtureKind[] = [
  {
    id: 'pyro',
    name: '花火',
    label: '花火の筒',
    folder: 'pyro',
    lane: { base: '#4a3b2c', accent: '#ffb35c' },
    cue: {
      sections: ['fire'],
      unit: 'tubes',
      // one shell from the middle tube of the farthest row (every size fits there)
      newCue: (_group, layout) => {
        const site = layout.venue.pyro[layout.venue.pyro.length - 1];
        const mid = site ? Math.floor(site.tubes.length / 2) : 0;
        return { target: site ? `pyro:${site.name}[${mid}-${mid}]` : 'pyro', fire: { ...DEFAULT_FIRE, colors: [...DEFAULT_FIRE.colors] } };
      },
    },
    // tubes in a rack stand side by side (仮: a 10号 mortar is ~30 cm across)
    place: { on: ['barge', 'land'], spacing: 0.3, flow: 0, flowPer: 'unit', lean: 0 },
  },
];
