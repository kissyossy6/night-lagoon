import { Muxer, StreamTarget } from 'mp4-muxer';
import type { ShowRuntime } from '../show/runtime';
import { FrameBlend } from './blur';

/**
 * Video export: the show rendered frame by frame into an MP4 (H.264 + AAC).
 *
 * The water is an analytic function of show time (README: どの時刻にも前計算
 * なしでシークできる), so each frame is drawn at exactly i / fps, however long
 * it takes, and encoded with WebCodecs. Nothing is recorded in real time:
 * no dropped frames, and the music lines up sample for sample.
 */

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  /** Show time range (s). */
  from: number;
  to: number;
  /** Point the camera for show time t (called before each frame). */
  camera(t: number): void;
  /** Music for the range, or null for a silent video. */
  music: AudioBuffer | null;
  onProgress?(done: number, total: number): void;
  signal?: AbortSignal;
  /** Motion blur (stage 7 H1): average BLUR_SAMPLES renders over the shutter. */
  blur?: boolean;
}

/** Bits per pixel per frame. Spray and mist are fine noise and need a lot. */
const BPP = 0.25;

/** H.264 profiles to try, the highest level first (4K needs 5.1+). */
const AVC = ['avc1.640034', 'avc1.640033', 'avc1.64002a', 'avc1.640028', 'avc1.4d0034', 'avc1.42003e'];

async function videoConfig(width: number, height: number, fps: number): Promise<VideoEncoderConfig> {
  const bitrate = Math.round(width * height * fps * BPP);
  for (const codec of AVC) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' } };
    const { supported } = await VideoEncoder.isConfigSupported(config);
    if (supported) return config;
  }
  throw new Error(`この解像度（${width}×${height}）の H.264 書き出しに、このブラウザは対応していません`);
}

/** AAC if the browser encodes it, else Opus (48 kHz only). */
export async function audioConfig(music: AudioBuffer): Promise<{ config: AudioEncoderConfig; codec: 'aac' | 'opus' }> {
  const aac: AudioEncoderConfig = { codec: 'mp4a.40.2', sampleRate: music.sampleRate, numberOfChannels: 2, bitrate: 192_000 };
  if ((await AudioEncoder.isConfigSupported(aac)).supported) return { config: aac, codec: 'aac' };
  const opus: AudioEncoderConfig = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 192_000 };
  if ((await AudioEncoder.isConfigSupported(opus)).supported) return { config: opus, codec: 'opus' };
  throw new Error('音声の書き出し（AAC / Opus）に、このブラウザは対応していません');
}

/** The music between from and to, stereo, at the given rate. */
export async function slice(music: AudioBuffer, from: number, to: number, rate: number): Promise<Float32Array[]> {
  const sr = music.sampleRate;
  const a = Math.min(music.length, Math.round(from * sr));
  const b = Math.min(music.length, Math.round(to * sr));
  const length = Math.round((to - from) * sr);
  const out = [0, 1].map((ch) => {
    const d = new Float32Array(length);
    d.set(music.getChannelData(Math.min(ch, music.numberOfChannels - 1)).subarray(a, b));
    return d;
  });
  if (rate === sr) return out;
  const ctx = new OfflineAudioContext(2, Math.round((to - from) * rate), rate);
  const buf = ctx.createBuffer(2, length, sr);
  out.forEach((d, ch) => buf.copyToChannel(d, ch));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const r = await ctx.startRendering();
  return [r.getChannelData(0), r.getChannelData(1)];
}

/**
 * The file as many small pieces instead of one ArrayBuffer: a whole show at
 * 4K is gigabytes, past what one buffer (or one Blob part) may hold. The muxer
 * appends, then patches the mdat header near the start when it finalizes.
 */
class Pieces {
  readonly parts: Uint8Array[] = [];
  private readonly starts: number[] = [];
  private end = 0;

  write(data: Uint8Array, pos: number) {
    if (pos > this.end) this.append(new Uint8Array(pos - this.end));
    // overwrite what is already there (header patches), append the rest
    let i = 0;
    if (pos < this.end) {
      i = Math.min(data.length, this.end - pos);
      for (let k = 0; k < this.parts.length; k++) {
        const s = this.starts[k] as number;
        const part = this.parts[k] as Uint8Array;
        const a = Math.max(pos, s);
        const b = Math.min(pos + i, s + part.length);
        if (a < b) part.set(data.subarray(a - pos, b - pos), a - s);
      }
    }
    if (i < data.length) this.append(data.slice(i));
  }

  private append(data: Uint8Array) {
    this.parts.push(data);
    this.starts.push(this.end);
    this.end += data.length;
  }
}

/** Yield to the page (progress, cancel button) without the background-tab timer clamp. */
const channel = new MessageChannel();
export const yieldToPage = () =>
  new Promise<void>((resolve) => {
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });

/**
 * Render and encode. The caller sizes the stage (Stage.setFixedSize) and
 * puts it back afterwards; this only draws frames and muxes them.
 */
export async function exportVideo(rt: ShowRuntime, o: ExportOptions): Promise<Blob> {
  const vConfig = await videoConfig(o.width, o.height, o.fps);
  const audio = o.music ? await audioConfig(o.music) : null;
  const file = new Pieces();
  const muxer = new Muxer({
    target: new StreamTarget({ onData: (data, pos) => file.write(data, pos) }),
    video: { codec: 'avc', width: o.width, height: o.height, frameRate: o.fps },
    audio: audio ? { codec: audio.codec, numberOfChannels: 2, sampleRate: audio.config.sampleRate } : undefined,
    // the index goes at the end; nothing has to fit in memory as one block
    fastStart: false,
  });

  let failure: Error | null = null;
  const fail = (e: DOMException) => (failure ??= e);
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: fail });
  venc.configure(vConfig);

  // the music first: it is quick, and the muxer interleaves by time anyway
  if (audio && o.music) {
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: fail });
    aenc.configure(audio.config);
    const rate = audio.config.sampleRate;
    const [l, r] = await slice(o.music, o.from, o.to, rate);
    const BLOCK = 4096;
    for (let i = 0; i < l.length; i += BLOCK) {
      const n = Math.min(BLOCK, l.length - i);
      const data = new Float32Array(n * 2);
      data.set(l.subarray(i, i + n), 0);
      data.set(r.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / rate) * 1e6), data });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
  }

  const canvas = rt.stage.renderer.domElement;
  const blend = o.blur ? new FrameBlend(rt.stage.renderer, o.width, o.height) : null;
  const total = Math.max(1, Math.round((o.to - o.from) * o.fps));
  const frameUs = 1e6 / o.fps;
  for (let i = 0; i < total; i++) {
    if (o.signal?.aborted) throw new DOMException('書き出しを中止しました', 'AbortError');
    if (failure) throw failure;
    const t = o.from + i / o.fps;
    o.camera(t);
    await rt.prepare(t);
    if (blend) blend.render(rt, t, o.fps);
    else rt.render(t);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
    // a keyframe every two seconds, so the file seeks well in any player
    venc.encode(frame, { keyFrame: i % (o.fps * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 3) await yieldToPage();
    o.onProgress?.(i + 1, total);
    await yieldToPage();
  }
  await venc.flush();
  venc.close();
  blend?.dispose();
  if (failure) throw failure;
  muxer.finalize();
  return new Blob(file.parts as BlobPart[], { type: 'video/mp4' });
}
