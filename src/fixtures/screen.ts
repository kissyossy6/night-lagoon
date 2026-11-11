import type { FixtureKind } from './types';

/**
 * The projector's full output, in cue brightness: 1 is the picture as it was
 * made (the level the screens were tuned at, runtime.ts PROJECTOR_GAIN), and
 * the projector has half again over that for a picture that must read through
 * thin mist (the break's light is 1.4). The one place this ceiling lives: the
 * inspector's slider, the player and the export (DMX 255) all read it, so a
 * value up to it is played and exported as written, never clipped.
 */
export const PROJECTOR_MAX = 1.5;

/**
 * Mist screens (folder 水幕). A cue sets their mist like water (pressure =
 * height fraction). The picture is the projector's (its own lane in the same
 * folder): brightness per zone and the clip; files from before version 3
 * that set intensity on a screen are converted (src/show/projector.ts). Screens may stand behind or in front of each other (the lagoon's
 * sheet and mounds share a line), so their spacing is not checked.
 *
 * Flow 仮: 1.5 L/s per metre of width (to be checked against a maker's
 * sheet; docs/detailed-design.md 6.3).
 */
const screenPlace: FixtureKind['place'] = { on: ['water'], spacing: 0, flow: 1.5, flowPer: 'metre', lean: 0 };

export const SCREEN_KINDS: FixtureKind[] = [
  {
    id: 'screen',
    name: '水スクリーン (横長)',
    label: '水幕（横長の1枚）',
    folder: 'screen',
    lane: { base: '#3a3550', accent: '#ffcf6b' },
    cue: {
      sections: ['set', 'motion', 'clip', 'macro'],
      // the picture's brightness is the projector's (its own lane)
      params: ['pressure'],
      unit: 'fixtures',
      newCue: (group) => ({ target: group, set: { pressure: 1, intensity: 1 }, dur: 2 }),
    },
    place: screenPlace,
  },
  {
    id: 'mound',
    name: '水スクリーン (3つの山)',
    label: '水幕（山）',
    folder: 'screen',
    lane: { base: '#3d3a4a', accent: '#ffb37a' },
    cue: {
      sections: ['set', 'motion', 'clip', 'macro'],
      // the picture's brightness is the projector's (its own lane)
      params: ['pressure'],
      unit: 'fixtures',
      newCue: (group) => ({ target: group, set: { pressure: 0.8 }, dur: 0.5 }),
    },
    place: screenPlace,
  },
  // The projector behind the screens (src/show/layout.ts ProjectorZone): the
  // picture's brightness per zone, and what it plays. Not placed by hand yet:
  // a venue with screens has one, zoned by its mounds.
  {
    id: 'projector',
    name: 'プロジェクター',
    label: 'プロジェクター（水幕の映像）',
    folder: 'screen',
    lane: { base: '#353a50', accent: '#b9c8ff' },
    cue: {
      sections: ['zone', 'set', 'motion', 'clip'],
      params: ['intensity'],
      max: { intensity: PROJECTOR_MAX },
      unit: 'fixtures',
      newCue: (group) => ({ target: group, set: { intensity: 1 }, dur: 1 }),
    },
    place: { on: ['land'], spacing: 0, flow: 0, flowPer: 'unit', lean: 0 },
  },
];
