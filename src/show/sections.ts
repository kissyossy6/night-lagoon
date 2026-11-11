import { SECTIONS, barToSeconds } from './song';
import type { ShowFile, ShowSection } from './types';

/**
 * The named stretches of a show (序章, 目覚め, …) that the editor's timeline,
 * its section chip, the player's seek bar and the waveform scope label. They
 * are part of the show file (ShowFile.sections) so they can be renamed,
 * moved, added and removed in the editor; a file without them gets the song's
 * own form below. They are labels only: the projected scenes stay timed by
 * the song's form (song.ts SECTIONS), which the pictures were drawn for.
 *
 * Sections run back to back: each ends where the next one starts, the last at
 * the show's end, so there are never gaps or overlaps to manage.
 */

const BUILT_IN: Record<string, { name: string; color: string }> = {
  intro: { name: '序章', color: '#1d3a7a' },
  awakening: { name: '目覚め', color: '#167a6e' },
  theme: { name: 'テーマ', color: '#a0462a' },
  story: { name: '物語', color: '#5a3a8c' },
  build: { name: '高まり', color: '#a3741c' },
  finale: { name: 'フィナーレ', color: '#b0305f' },
  ending: { name: 'ラスト', color: '#d8dde6' },
  coda: { name: '終章', color: '#3a5f8c' },
};

/** Colours handed to sections that do not choose one. */
export const SECTION_PALETTE = ['#1d3a7a', '#167a6e', '#a0462a', '#5a3a8c', '#a3741c', '#b0305f', '#3a5f8c', '#4f6b2a'];

/** The song's form, as sections (what a file without `sections` uses). */
export const DEFAULT_SECTIONS: readonly ShowSection[] = SECTIONS.map((s) => ({
  name: BUILT_IN[s.name]?.name ?? s.name,
  t: barToSeconds(s.from),
  color: BUILT_IN[s.name]?.color,
}));

/** A section with its end and colour worked out. */
export interface SectionSpan {
  name: string;
  from: number;
  to: number;
  color: string;
  /** Index in the file's list. */
  i: number;
}

/**
 * A show on its own music (ShowFile.music) starts as one stretch: the
 * recording's form above belongs to Rhapsody in Blue (docs/music-plan.md).
 */
export const OWN_MUSIC_SECTIONS: readonly ShowSection[] = [{ name: '全体', t: 0, color: SECTION_PALETTE[0] }];

/** The file's sections, or, when it has none, its music's form. */
export function sectionsOf(file?: Pick<ShowFile, 'sections' | 'music'>): readonly ShowSection[] {
  if (file?.sections?.length) return file.sections;
  return file?.music ? OWN_MUSIC_SECTIONS : DEFAULT_SECTIONS;
}

/** Sections in time order with their ends (the next start, or `duration`). */
export function sectionSpans(file: Pick<ShowFile, 'sections' | 'music'> | undefined, duration: number): SectionSpan[] {
  const list = sectionsOf(file)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.t - b.s.t);
  return list.map(({ s, i }, k) => ({
    name: s.name,
    from: s.t,
    to: Math.max(s.t, k + 1 < list.length ? list[k + 1].s.t : duration),
    color: s.color ?? SECTION_PALETTE[i % SECTION_PALETTE.length],
    i,
  }));
}

/** The section playing at `t` (the first one before the show starts). */
export function spanAt(spans: SectionSpan[], t: number): SectionSpan | undefined {
  let at = spans[0];
  for (const s of spans) if (t >= s.from) at = s;
  return at;
}

/** Keep only well-formed sections from a loaded file; undefined when none. */
export function normaliseSections(x: unknown): ShowSection[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out = x
    .filter((s): s is ShowSection => !!s && typeof s === 'object' && typeof s.name === 'string' && Number.isFinite(s.t))
    .map((s) => ({ name: s.name, t: Math.max(0, s.t), ...(typeof s.color === 'string' ? { color: s.color } : {}) }));
  return out.length ? out : undefined;
}
