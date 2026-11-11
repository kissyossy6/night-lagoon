/**
 * The editor's side of the video store (scripts/video-store.ts): the files in
 * public/videos/, uploads into it, and each file's length.
 */

let known: string[] = [];
const lengths = new Map<string, number>();
const probing = new Set<string>();

/** Videos found so far ("videos/boat.mp4"). */
export const knownVideos = () => known;

export const videoName = (src: string) => src.replace(/^.*\//, '');

/** Ask the dev server for the files in public/videos/. Empty without one. */
export async function refreshVideos(): Promise<string[]> {
  try {
    const r = await fetch('/__videos');
    if (!r.ok) return known;
    known = ((await r.json()) as { src: string }[]).map((x) => x.src);
  } catch {
    /* no dev server (a build): only the videos the show names */
  }
  return known;
}

/** Copy a file into public/videos/; resolves to its src. */
export async function uploadVideo(file: File): Promise<string> {
  let r: Response;
  try {
    r = await fetch(`/__videos?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  } catch {
    throw new Error('開発サーバー (pnpm dev) に接続できません');
  }
  const body = (await r.json().catch(() => ({}))) as { src?: string; error?: string };
  if (!r.ok || !body.src) {
    throw new Error(r.status === 404 ? '動画の取り込みは開発サーバー (pnpm dev) でだけ使えます' : (body.error ?? `取り込みに失敗しました (${r.status})`));
  }
  await refreshVideos();
  return body.src;
}

/** Length (s) of a video, or undefined until known; onKnown fires once it is. */
export function videoLength(src: string, onKnown: () => void): number | undefined {
  const d = lengths.get(src);
  if (d !== undefined || probing.has(src)) return d;
  probing.add(src);
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.muted = true;
  v.addEventListener('loadedmetadata', () => {
    lengths.set(src, v.duration);
    v.removeAttribute('src');
    onKnown();
  });
  v.addEventListener('error', () => {
    lengths.set(src, NaN);
    onKnown();
  });
  v.src = src;
  return undefined;
}
