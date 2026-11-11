import type { ProjectDoc, ProjectSummary } from './types';

/**
 * The samples: every projects/sample-* folder, read at build time, so they are
 * there with or without the dev server. A folder dropped in (or made with the
 * list's 見本にする) is a new sample; git tracks only these folders (.gitignore).
 */
const docs = import.meta.glob<ProjectDoc>('/projects/sample-*/project.json', { eager: true, import: 'default' });
const thumbs = import.meta.glob<string>('/projects/sample-*/thumb.jpg', { eager: true, query: '?url', import: 'default' });

const folderOf = (path: string) => path.split('/')[2];
const thumbOf = new Map(Object.entries(thumbs).map(([p, url]) => [folderOf(p), url]));

/** Samples in the order of their `order` field, then name. */
export const SAMPLES: ProjectDoc[] = Object.entries(docs)
  .map(([path, doc]) => ({ ...doc, id: folderOf(path), sample: true }))
  .sort((a, b) => ((a as { order?: number }).order ?? 99) - ((b as { order?: number }).order ?? 99) || a.name.localeCompare(b.name, 'ja'));

export function sampleDoc(id: string): ProjectDoc | null {
  return SAMPLES.find((s) => s.id === id) ?? null;
}

export function sampleSummaries(): ProjectSummary[] {
  return SAMPLES.map((s) => ({
    id: s.id,
    name: s.name,
    created: s.created,
    updated: s.updated,
    generate: s.generate,
    venue: s.show?.venue,
    duration: s.show?.duration,
    cues: s.show?.cues.length,
    thumb: thumbOf.get(s.id),
    sample: true,
    description: s.description,
  }));
}
