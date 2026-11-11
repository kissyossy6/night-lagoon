import type { VenueDoc } from './parts';

/**
 * Venues made in the venue editor (venue.html), kept in this browser.
 * Values that must outlive the browser go out as JSON (the editor's
 * 会場 ▾ → JSON を書き出す); a file dropped into src/venues/builtin/ becomes
 * a built-in venue.
 */
const KEY = 'water-show-venues:v1';

export function loadMyVenues(): VenueDoc[] {
  try {
    const s = localStorage.getItem(KEY);
    const list = s ? (JSON.parse(s) as VenueDoc[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveAll(list: VenueDoc[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: the editor still works for this visit */
  }
}

export function saveMyVenue(doc: VenueDoc) {
  const list = loadMyVenues().filter((d) => d.id !== doc.id);
  saveAll([...list, doc]);
}

export function deleteMyVenue(id: string) {
  saveAll(loadMyVenues().filter((d) => d.id !== id));
}

/** A new id for a venue of mine. */
export function newVenueId(): string {
  return `my-${Date.now().toString(36)}`;
}
