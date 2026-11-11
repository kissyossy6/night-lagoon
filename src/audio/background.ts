/**
 * Background music: an existing recording played under the show instead of a
 * generated score. The player and the editor look for
 * public/music/background.{mp3,m4a,ogg,wav}, or the viewer picks a file.
 *
 * The show clock follows the recording, but the choreography is written on its
 * own 120 BPM grid, so the fountains are not synchronised to the recording's
 * beats. The recording is cut to the show's length with a short fade.
 */

const CANDIDATES = ['background.mp3', 'background.m4a', 'background.ogg', 'background.wav'];
const ROOT = `${import.meta.env.BASE_URL}music/`;
/** Fade at the cut (s). */
const FADE = 2.5;

export interface BackgroundMusic {
  buffer: AudioBuffer;
  /** File name, for the status line. */
  name: string;
}

/** Decode audio data and fit it to the show: cut at 'duration' with a fade. */
async function decode(data: ArrayBuffer, ctx: BaseAudioContext, duration: number): Promise<AudioBuffer> {
  const src = await ctx.decodeAudioData(data);
  const sr = src.sampleRate;
  const length = Math.min(src.length, Math.round(duration * sr));
  const out = new AudioBuffer({ length, numberOfChannels: Math.max(2, src.numberOfChannels), sampleRate: sr });
  const fadeFrom = src.length > length ? length - Math.round(FADE * sr) : length;
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const a = src.getChannelData(Math.min(ch, src.numberOfChannels - 1));
    const b = out.getChannelData(ch);
    for (let i = 0; i < length; i++) b[i] = (a[i] as number) * (i < fadeFrom ? 1 : (length - i) / (length - fadeFrom));
  }
  return out;
}

/** The file placed in public/music, if any. */
export async function loadBackground(ctx: BaseAudioContext, duration: number): Promise<BackgroundMusic | null> {
  for (const name of CANDIDATES) {
    try {
      const res = await fetch(ROOT + name);
      // the dev server answers unknown paths with index.html
      if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) continue;
      return { buffer: await decode(await res.arrayBuffer(), ctx, duration), name };
    } catch {
      /* try the next name */
    }
  }
  return null;
}

/** A project's own music (docs/music-plan.md), from where the dev server keeps it. */
export async function loadMusicUrl(url: string, name: string, ctx: BaseAudioContext, duration: number): Promise<BackgroundMusic> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`曲を読めませんでした（${name}、HTTP ${res.status}）`);
  return { buffer: await decode(await res.arrayBuffer(), ctx, duration), name };
}

/** A file the viewer picked. */
export async function decodeFile(file: File, ctx: BaseAudioContext, duration: number): Promise<BackgroundMusic> {
  return { buffer: await decode(await file.arrayBuffer(), ctx, duration), name: file.name };
}
