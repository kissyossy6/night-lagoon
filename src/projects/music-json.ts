import type { ShowFile } from '../show/types';
import { musicUrl } from './store';

/**
 * The project's own music inside a show's JSON (docs/music-plan.md): the
 * JSON written from the editor or the list carries the music file as
 * music.data (a data: URL), and reading it back puts the file into the new
 * project's folder. Before this the JSON brought only the music's name, and
 * the show played silent in another project or on another computer.
 */

export interface MusicData {
  data: string;
  name: string;
  duration: number;
}

/** The show with its music inside, and a line for the toast. */
export async function showWithMusic(show: ShowFile, projectId: string): Promise<{ out: ShowFile; note: string }> {
  const m = show.music;
  if (!m) return { out: show, note: '' };
  try {
    const r = await fetch(musicUrl(projectId, m.file));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    const data = await new Promise<string>((ok, fail) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.onerror = () => fail(fr.error);
      fr.readAsDataURL(blob);
    });
    return { out: { ...show, music: { ...m, data } as ShowFile['music'] }, note: `（曲「${m.name}」も入れました。${(blob.size / 1048576).toFixed(1)} MB）` };
  } catch {
    return { out: show, note: `（曲「${m.name}」は読めなかったので入っていません。読み込んだ先で「曲を選ぶ…」から入れてください）` };
  }
}

/** The music a JSON carries (read before normaliseShow, which drops it), or null. */
export function musicDataOf(raw: unknown): MusicData | null {
  const m = (raw as { music?: { data?: unknown; name?: unknown; duration?: unknown } } | null)?.music;
  if (!m || typeof m.data !== 'string' || !m.data.startsWith('data:')) return null;
  return { data: m.data, name: typeof m.name === 'string' && m.name ? m.name : 'music', duration: Number(m.duration) > 0 ? Number(m.duration) : 0 };
}

/** Keep the carried music in a project's folder; the show's music field for it. */
export async function keepMusic(d: MusicData, save: (blob: Blob, name: string) => Promise<string>, fallbackDuration: number): Promise<NonNullable<ShowFile['music']>> {
  const blob = await (await fetch(d.data)).blob();
  const file = await save(blob, d.name);
  return { file, name: d.name, duration: d.duration || fallbackDuration };
}
