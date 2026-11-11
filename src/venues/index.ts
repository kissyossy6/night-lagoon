import { LAGOON } from './lagoon';
import { buildVenue, type VenueDoc } from './parts';
import { loadMyVenues } from './store';
import type { Venue } from './types';

export { LAGOON };
export type * from './types';
export { deleteMyVenue, loadMyVenues, newVenueId, saveMyVenue } from './store';
export { buildVenue, PART_NAMES, type Part, type PartKind, type VenueDoc } from './parts';

/**
 * Built-in venues: every JSON file in builtin/ (drop a venue file the
 * venue editor wrote there and it joins the list). The lagoon is built once,
 * in lagoon.ts, so LAGOON and VENUES.lagoon are the same object.
 */
const files = import.meta.glob<VenueDoc>('./builtin/*.json', { eager: true, import: 'default' });
const TIER_ORDER = ['desk', 'garden', 'plaza', 'lagoon'];
/** Smallest first (机・庭・広場・湖), as the scale buttons. */
export const VENUE_DOCS: VenueDoc[] = Object.values(files).sort((a, b) => TIER_ORDER.indexOf(a.scale) - TIER_ORDER.indexOf(b.scale) || a.name.localeCompare(b.name, 'ja'));
export const VENUES: Record<string, Venue> = Object.fromEntries(
  VENUE_DOCS.map((d) => [d.id, d.id === LAGOON.id ? LAGOON : buildVenue(d)]),
);
export const DEFAULT_VENUE_ID = 'lagoon';

/** Venues of mine, built once per saved version (the player asks often). */
const mine = new Map<string, { json: string; venue: Venue }>();

/**
 * The venue a show file names: a built-in one, else one made in the venue
 * editor (this browser's); unknown or missing ids give the lagoon.
 */
export function getVenue(id?: string): Venue {
  const builtIn = VENUES[id ?? DEFAULT_VENUE_ID];
  if (builtIn || !id) return builtIn ?? LAGOON;
  const doc = loadMyVenues().find((d) => d.id === id);
  if (!doc) return LAGOON;
  const json = JSON.stringify(doc);
  const hit = mine.get(id);
  if (hit && hit.json === json) return hit.venue;
  try {
    const venue = buildVenue(doc);
    mine.set(id, { json, venue });
    return venue;
  } catch {
    return LAGOON;
  }
}
