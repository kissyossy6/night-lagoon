import doc from './builtin/lagoon.json';
import { buildVenue, type VenueDoc } from './parts';

/**
 * The lagoon, after World of Color (docs/research.md), written as parts in
 * builtin/lagoon.json. The positions it gives are the same numbers the old
 * hand-written lagoon gave (scripts/venue-check.mjs compares them).
 */
export const LAGOON = buildVenue(doc as VenueDoc);
