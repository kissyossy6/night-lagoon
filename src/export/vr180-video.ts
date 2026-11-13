import * as THREE from 'three';
import { BLUR_SAMPLES, BLUR_SHUTTER } from './blur';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { ShowRuntime } from '../show/runtime';
import { audioConfig, slice, yieldToPage } from './video';
import { Vr180 } from './vr180';
import type { SpatialAudio } from '../audio/spatial';

/**
 * The show as a stereo 180° movie for Apple Vision Pro, from the player.
 *
 * The browser draws both eyes (vr180.ts) and encodes them as HEVC in pieces
 * of a few seconds: side by side up to 4096 per eye, else four tiles (each
 * eye's top and bottom half), the most the browser's encoder takes. Each
 * piece goes to the dev server (scripts/vr180-store.ts), where
 * tools/apmp/join turns the pieces into one MV-HEVC movie as they arrive
 * and deletes them. Only the dev server (npm run dev) can do this.
 */

export interface Vr180ExportOptions {
  /** Pixels per eye (square, 180° × 180°). */
  eye: number;
  fps: number;
  from: number;
  to: number;
  /** The point between the eyes (m), and the heading of the view centre (rad, 0 = toward -z). */
  seat: THREE.Vector3;
  yaw: number;
  music: AudioBuffer | null;
  /**
   * The sound placed around the seat (src/audio/spatial.ts, 追記46b): the
   * movie's sound becomes APAC Ambisonics, with the stereo music as the
   * fallback track. Missing: the stereo music only, as before.
   */
  spatial?: SpatialAudio | null;
  /** File name of the movie (.mov). */
  name: string;
  onProgress?(p: { rendered: number; converted: number; total: number }): void;
  signal?: AbortSignal;
  /** Motion blur (stage 7 H1): each eye's frame is the average of BLUR_SAMPLES renders over the shutter. */
  blur?: boolean;
}

export interface Vr180Result {
  /** Project-relative path of the movie. */
  output: string;
  bytes: number;
  /** Show it in the Finder. */
  reveal(): void;
}

/** Seconds per piece: small enough that only a few hundred MB wait on disk. */
const PIECE = 10;
/** Pieces the browser may run ahead of the converter. */
const AHEAD = 2;
/** Bits per pixel per frame for the pieces (encoded again for the headset). */
const BPP = 0.15;
/**
 * Constant quality of the headset movie (join --quality), by frame rate.
 * 30 fps: 0.85 (docs/vr180-analysis.md 3). 60 fps at 4096: 0.8, the highest
 * that keeps the heaviest second under Apple's 150 Mbps peak. Measured on
 * the white finale (t = 210, 目線, 2026-11-13), per second: 0.85 → 200 Mbps,
 * 0.8 → 123, 0.75 → 74, 0.7 → 53 (the whole show at 0.85 averaged 56).
 */
const quality = (_eye: number, fps: number) => (fps > 30 ? 0.8 : 0.85);

/**
 * The highest frame rate per eye size. 7680 per eye at 60 fps is 7680² × 2
 * eyes × 60 = 7.1 Gpx/s, twice Apple Immersive Video (4320² × 2 × 90 =
 * 3.4 Gpx/s, the most the headset is known to play) and past HEVC level
 * 6.2's 4.3 G samples/s; a 3.5 min show would also take about a day to draw.
 * 4096 at 60 is 2.0 Gpx/s, within both.
 */
export const VR180_MAX_FPS = (eye: number) => (eye > 4096 ? 30 : 60);

/**
 * Movie bytes per second on the heaviest scenes, so the disk check errs
 * safe: 30 fps 12.5 MB/s at 4096, 17 MB/s at 7680 (the climax, t = 165-175);
 * 60 fps at 4096 and quality 0.8 about 9 MB/s (the finale, t = 208-212).
 * Quieter scenes take less: the whole show at 4096/60 fps came to a third.
 */
export const vr180BytesPerSecond = (eye: number, fps = 30) => (eye > 4096 ? 17e6 : fps > 30 ? 9e6 : 12.5e6);

/** Projector picture to match the eye: the screen spans far more pixels than in the flat player. */
export function vr180Projector(eye: number): [number, number] {
  const w = Math.max(1536, Math.round((eye * 0.75) / 2) * 2);
  return [w, Math.round((w * 288) / 1536 / 2) * 2];
}

async function api<T = unknown>(path: string, q: Record<string, string | number>, body?: BodyInit): Promise<T> {
  const url = `/__vr180/${path}?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))}`;
  let res: Response;
  try {
    res = await fetch(url, { method: path === 'status' ? 'GET' : 'POST', body });
  } catch {
    throw new Error('開発サーバーにつながりません（Vision Pro の書き出しは npm run dev で開いたときだけ使えます）');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    throw new Error(res.status === 404 && !json ? 'Vision Pro の書き出しは開発サーバー（npm run dev）で開いたときだけ使えます' : String(json?.error ?? res.status));
  }
  return json as T;
}

interface Status {
  state: 'running' | 'done' | 'error' | 'cancelled';
  frames: number;
  output: string;
  bytes: number;
  free: number;
  error?: string;
}

interface Stream {
  enc: VideoEncoder;
  muxer: Muxer<ArrayBufferTarget>;
  width: number;
  height: number;
  /** The next frame, RGBA, top row first. */
  data: Uint8Array<ArrayBuffer>;
  name: string;
  failure: unknown;
}

async function openStream(name: string, width: number, height: number, fps: number): Promise<Stream> {
  const config: VideoEncoderConfig = {
    codec: 'hvc1.1.6.L186.B0',
    width,
    height,
    bitrate: Math.round(width * height * fps * BPP),
    framerate: fps,
    hardwareAcceleration: 'prefer-hardware',
  };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error(`このブラウザは HEVC ${width}×${height} を書き出せません`);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'hevc', width, height, frameRate: fps }, fastStart: 'in-memory' });
  const s = { muxer, width, height, data: new Uint8Array(width * height * 4), name, failure: null } as Omit<Stream, 'enc'> as Stream;
  s.enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (s.failure ??= e) });
  s.enc.configure(config);
  return s;
}

/** The music for the range as its own small file; the converter adds it to the movie. */
async function audioFile(music: AudioBuffer, from: number, to: number): Promise<ArrayBuffer> {
  const audio = await audioConfig(music);
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    audio: { codec: audio.codec, numberOfChannels: 2, sampleRate: audio.config.sampleRate },
    fastStart: 'in-memory',
  });
  let failure: unknown = null;
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (failure ??= e) });
  aenc.configure(audio.config);
  const rate = audio.config.sampleRate;
  const [l, r] = await slice(music, from, to, rate);
  for (let i = 0; i < l.length; i += 4096) {
    const n = Math.min(4096, l.length - i);
    const data = new Float32Array(n * 2);
    data.set(l.subarray(i, i + n), 0);
    data.set(r.subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / rate) * 1e6), data });
    aenc.encode(ad);
    ad.close();
  }
  await aenc.flush();
  aenc.close();
  if (failure) throw failure;
  muxer.finalize();
  return muxer.target.buffer;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The spatial sound as ambi_0000.f32, ambi_0001.f32…: PIECE seconds each,
 * float32 little-endian, the channels interleaved (ACN order, SN3D), at
 * s.rate. The converter reads them in order (tools/apmp/join --ambisonics).
 */
async function uploadSpatial(id: string, s: SpatialAudio, signal?: AbortSignal) {
  const n = PIECE * s.rate;
  for (let k = 0, a = 0; a < s.frames; k++, a += n) {
    if (signal?.aborted) throw new DOMException('書き出しを中止しました', 'AbortError');
    const block = s.block(a, Math.min(n, s.frames - a));
    await api('file', { id, name: `ambi_${String(k).padStart(4, '0')}.f32` }, block.buffer);
    await yieldToPage();
  }
}

/**
 * Render and convert. The caller has stopped the live loop and set the
 * stage up for export quality; this only draws, encodes and uploads.
 */
export async function exportVr180(rt: ShowRuntime, o: Vr180ExportOptions): Promise<Vr180Result> {
  const W = o.eye;
  const total = Math.max(1, Math.round((o.to - o.from) * o.fps));
  const { id, free } = await api<{ id: string; free: number }>('start', {
    name: o.name,
    fps: o.fps,
    quality: quality(W, o.fps),
    // the spatial sound's order: the converter makes it APAC
    ...(o.spatial ? { ambi: o.spatial.order } : {}),
  });
  const cancel = () => api('cancel', { id }).catch(() => {});
  let converted = 0;
  const status = async () => {
    const s = await api<Status>('status', { id });
    if (s.state === 'error') throw new Error(`Vision Pro 用への変換に失敗しました：${s.error ?? ''}`);
    converted = s.frames;
    return s;
  };
  const vr = new Vr180(rt, { eye: W });
  try {
    // the movie, plus the pieces waiting for the converter, plus some room to spare
    const need = vr180BytesPerSecond(W, o.fps) * (o.to - o.from) + (AHEAD + 1) * PIECE * W * W * 2 * o.fps * BPP / 8 + 1e9;
    // (the spatial sound's raw samples, at most ~0.7 GB for a whole show, fit in the spare GB:
    // the converter deletes each piece as it reads it)
    if (free < need) {
      const gb = (b: number) => (b / 1e9).toFixed(1);
      throw new Error(`ディスクの空きが足りません（空き ${gb(free)} GB・必要 約 ${gb(need)} GB）。範囲を短くするか、片目 4096 にするか、空きを作ってください`);
    }
    // the spatial sound first, in pieces (a whole show is hundreds of MB), as raw float samples
    if (o.spatial) await uploadSpatial(id, o.spatial, o.signal);
    if (o.music) await api('file', { id, name: 'audio.mp4' }, await audioFile(o.music, o.from, o.to));

    const sbs = W <= 4096;
    const perPiece = Math.round(PIECE * o.fps);
    const us = 1e6 / o.fps;
    const rowBytes = W * 4;
    const n0 = vr.pixels.length;
    const blurSum = o.blur ? { left: new Uint16Array(n0), right: new Uint16Array(n0) } : null;
    const blurAvg = { left: new Uint8Array(o.blur ? n0 : 0), right: new Uint8Array(o.blur ? n0 : 0) };
    let rendered = 0;
    for (let k = 0; rendered < total; k++) {
      // stay at most AHEAD pieces in front of the converter
      while (rendered - converted > AHEAD * perPiece) {
        if (o.signal?.aborted) throw new DOMException('書き出しを中止しました', 'AbortError');
        await status();
        o.onProgress?.({ rendered, converted, total });
        await wait(500);
      }
      const stem = String(k).padStart(4, '0');
      const streams = sbs
        ? [await openStream(`${stem}_sbs.mp4`, 2 * W, W, o.fps)]
        : await Promise.all(['L0', 'L1', 'R0', 'R1'].map((t) => openStream(`${stem}_${t}.mp4`, W, W / 2, o.fps)));
      const n = Math.min(perPiece, total - rendered);
      for (let i = 0; i < n; i++) {
        if (o.signal?.aborted) throw new DOMException('書き出しを中止しました', 'AbortError');
        const t = o.from + (rendered + i) / o.fps;
        await rt.prepare(t);
        // with motion blur, both eyes are summed over the shutter first
        if (blurSum) {
          const open = BLUR_SHUTTER / o.fps;
          blurSum.left.fill(0);
          blurSum.right.fill(0);
          for (let s = 0; s < BLUR_SAMPLES; s++) {
            const ts = t + ((s + 0.5) / BLUR_SAMPLES) * open - open / 2;
            rt.advance(ts);
            for (const eye of ['left', 'right'] as const) {
              vr.renderEye(ts, eye, o.seat, o.yaw);
              const px = vr.pixels;
              const acc = blurSum[eye];
              for (let j = 0; j < px.length; j++) acc[j] += px[j];
            }
          }
          for (const eye of ['left', 'right'] as const) {
            const acc = blurSum[eye];
            const avg = blurAvg[eye];
            for (let j = 0; j < acc.length; j++) avg[j] = (acc[j] + (BLUR_SAMPLES >> 1)) / BLUR_SAMPLES;
          }
        } else rt.advance(t);
        for (const eye of ['left', 'right'] as const) {
          if (!blurSum) vr.renderEye(t, eye, o.seat, o.yaw);
          const px = blurSum ? blurAvg[eye] : vr.pixels;
          if (sbs) {
            // side by side: each eye fills its half of every row
            const x = eye === 'left' ? 0 : rowBytes;
            const d = streams[0].data;
            for (let y = 0; y < W; y++) d.set(px.subarray(y * rowBytes, (y + 1) * rowBytes), y * 2 * rowBytes + x);
          } else {
            const half = (W / 2) * rowBytes;
            for (let h = 0; h < 2; h++) streams[(eye === 'left' ? 0 : 2) + h].data.set(px.subarray(h * half, (h + 1) * half));
          }
        }
        for (const s of streams) {
          const f = new VideoFrame(s.data, { format: 'RGBX', codedWidth: s.width, codedHeight: s.height, timestamp: Math.round(i * us), duration: Math.round(us) });
          // a keyframe every two seconds, and at the start of every piece
          s.enc.encode(f, { keyFrame: i % (o.fps * 2) === 0 });
          f.close();
        }
        while (streams.some((s) => s.enc.encodeQueueSize > 2)) await yieldToPage();
        o.onProgress?.({ rendered: rendered + i + 1, converted, total });
        await yieldToPage();
      }
      for (const s of streams) {
        await s.enc.flush();
        s.enc.close();
        if (s.failure) throw s.failure;
        s.muxer.finalize();
        await api('file', { id, name: s.name }, s.muxer.target.buffer);
      }
      await api('ready', { id, k });
      rendered += n;
      void status().catch(() => {});
    }
    await api('end', { id });
    for (;;) {
      const s = await status();
      o.onProgress?.({ rendered, converted, total });
      if (s.state === 'done') return { output: s.output, bytes: s.bytes, reveal: () => void api('reveal', { id }) };
      if (s.state === 'cancelled') throw new DOMException('書き出しを中止しました', 'AbortError');
      if (o.signal?.aborted) throw new DOMException('書き出しを中止しました', 'AbortError');
      await wait(500);
    }
  } catch (e) {
    await cancel();
    throw e;
  } finally {
    vr.dispose();
  }
}
