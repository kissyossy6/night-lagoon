import * as THREE from 'three';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { analyseMusic } from '../audio/analysis';
import { loadBackground } from '../audio/background';
import type { LightingMode } from '../core/nozzles';
import { projectionScreen } from '../screen/screen';
import { ANGLES, useVenueAngles, type AngleName } from '../show/cameras';
import { buildShow, variantOf } from '../show/choreography';
import { nearSeat } from '../show/near-seat';
import { setCurves } from '../show/cues';
import { ShowRuntime } from '../show/runtime';
import { SHOW_DURATION } from '../show/song';
import { audioConfig, slice } from './video';
import { Vr180 } from './vr180';

/**
 * Stereo 180° test bench (tools/vr180.html), driven by scripts/vr180.mjs.
 *
 *   __vr.still({ t, eye })                 both eyes as PNG downloads, timings
 *   __vr.clip({ from, to, fps, eye })      HEVC downloads: one side-by-side
 *                                          file up to 4096 per eye, else four
 *                                          tiles (each eye's top and bottom
 *                                          half), joined by tools/apmp
 *
 * URL: ?light=real|ideal&pw=1536&ph=288 (projector picture size; scale it with the eye size)
 *      &venue=<id> (the show placed there)&seat=near|<angle> (default audience)&show=fantasia|hanabi
 */

const q = new URLSearchParams(location.search);
const logEl = document.getElementById('log')!;
const log = (s: string) => (logEl.textContent = s);

const screen = projectionScreen({ width: Number(q.get('pw') ?? 1536), height: Number(q.get('ph') ?? 288), every: 1 });
const rt = new ShowRuntime(document.getElementById('stage')!, screen, 'high', 1);
rt.setLighting((q.get('light') as LightingMode) ?? 'real');
const renderer = rt.stage.renderer;
renderer.setPixelRatio(1);

const seat = new THREE.Vector3();
let yaw = 0;
/** The seat once the show (and so its venue) is set: an angle, or 近い席 (near-seat.ts). */
function placeSeat() {
  useVenueAngles(rt.venue);
  const id = q.get('seat') ?? 'audience';
  const v = id === 'near' ? nearSeat(rt.venue) : ANGLES[id as AngleName];
  seat.set(...v.pos);
  // the view centre: level, toward the stage centre
  yaw = Math.atan2(-(v.target[0] - seat.x), -(v.target[2] - seat.z));
}

let music: AudioBuffer | null = null;
const ready = loadBackground(new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 44100 }), SHOW_DURATION).then((m) => {
  music = m?.buffer ?? null;
  const features = music ? analyseMusic(music) : undefined;
  if (features) setCurves(features.curves);
  const show = buildShow(features, variantOf(q.get('show')));
  rt.setShow(q.get('venue') ? { ...show, venue: q.get('venue')! } : show);
  placeSeat();
});

let vr: Vr180 | null = null;
function bench(eye: number): Vr180 {
  if (vr?.eyeSize !== eye) {
    vr?.dispose();
    vr = new Vr180(rt, { eye });
  }
  return vr;
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

async function frame(v: Vr180, t: number, each: (eye: 'left' | 'right') => void | Promise<void>) {
  await rt.prepare(t);
  rt.advance(t);
  for (const eye of ['left', 'right'] as const) {
    v.renderEye(t, eye, seat, yaw);
    await each(eye);
  }
}

async function still(o: { t: number; eye: number; tag?: string }) {
  await ready;
  const v = bench(o.eye);
  // warm up shaders and buffers at this size
  await frame(v, o.t, () => {});
  const timing: Record<string, unknown> = {};
  const t0 = performance.now();
  await frame(v, o.t, async (eye) => {
    timing[eye] = { ...v.timing };
    const c = new OffscreenCanvas(o.eye, o.eye);
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(v.pixels.buffer as ArrayBuffer), o.eye, o.eye), 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    download(blob, `vr180_${o.tag ?? 'still'}_${o.eye}_${eye}_t${o.t}.png`);
  });
  return { eye: o.eye, face: v.faceSize, timing, totalMs: performance.now() - t0 };
}

/** Bits per pixel per frame for the intermediate files (re-encoded for the headset). */
const BPP = 0.15;

interface Stream {
  enc: VideoEncoder;
  muxer: Muxer<ArrayBufferTarget>;
  width: number;
  height: number;
  /** The next frame, RGBA, top row first. */
  data: Uint8Array<ArrayBuffer>;
  name: string;
}

async function stream(name: string, width: number, height: number, fps: number, withAudio: boolean): Promise<Stream> {
  const config: VideoEncoderConfig = {
    codec: 'hvc1.1.6.L186.B0',
    width,
    height,
    bitrate: Math.round(width * height * fps * BPP),
    framerate: fps,
    hardwareAcceleration: 'prefer-hardware',
  };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error(`HEVC ${width}×${height} は書き出せません`);
  const audio = withAudio && music ? await audioConfig(music) : null;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'hevc', width, height, frameRate: fps },
    audio: audio ? { codec: audio.codec, numberOfChannels: 2, sampleRate: audio.config.sampleRate } : undefined,
    fastStart: 'in-memory',
  });
  const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => console.error(e) });
  enc.configure(config);
  return { enc, muxer, width, height, data: new Uint8Array(width * height * 4), name, ...(audio ? { audio } : {}) } as Stream & { audio?: typeof audio };
}

async function addAudio(s: Stream & { audio?: Awaited<ReturnType<typeof audioConfig>> | null }, from: number, to: number) {
  if (!s.audio || !music) return;
  const aenc = new AudioEncoder({ output: (c, m) => s.muxer.addAudioChunk(c, m), error: (e) => console.error(e) });
  aenc.configure(s.audio.config);
  const rate = s.audio.config.sampleRate;
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
}

async function clip(o: { from: number; to: number; fps: number; eye: number; tag?: string }) {
  await ready;
  const W = o.eye;
  const v = bench(W);
  const tag = `${o.tag ?? 'clip'}_${W}`;
  const sbs = W <= 4096;
  const streams = sbs
    ? [await stream(`vr180_${tag}_sbs.mp4`, 2 * W, W, o.fps, true)]
    : await Promise.all(
        ['L0', 'L1', 'R0', 'R1'].map((k, i) => stream(`vr180_${tag}_${k}.mp4`, W, W / 2, o.fps, i === 0)),
      );
  await addAudio(streams[0], o.from, o.to);
  const total = Math.round((o.to - o.from) * o.fps);
  const us = 1e6 / o.fps;
  const times: number[] = [];
  const t0 = performance.now();
  for (let i = 0; i < total; i++) {
    const tf = performance.now();
    const t = o.from + i / o.fps;
    await frame(v, t, (eye) => {
      const px = v.pixels;
      const row = W * 4;
      if (sbs) {
        // side by side: each eye fills its half of every row
        const s = streams[0];
        const x = eye === 'left' ? 0 : row;
        for (let y = 0; y < W; y++) s.data.set(px.subarray(y * row, (y + 1) * row), y * 2 * row + x);
      } else
        for (let h = 0; h < 2; h++) {
          const half = (W / 2) * row;
          streams[(eye === 'left' ? 0 : 2) + h].data.set(px.subarray(h * half, (h + 1) * half));
        }
    });
    for (const s of streams) {
      const f = new VideoFrame(s.data, { format: 'RGBX', codedWidth: s.width, codedHeight: s.height, timestamp: Math.round(i * us), duration: Math.round(us) });
      s.enc.encode(f, { keyFrame: i % (o.fps * 2) === 0 });
      f.close();
    }
    while (streams.some((s) => s.enc.encodeQueueSize > 2)) await new Promise((r) => setTimeout(r, 5));
    times.push(performance.now() - tf);
    log(`${tag}: ${i + 1}/${total}  ${(times.at(-1)! / 1000).toFixed(2)} s/frame`);
  }
  for (const s of streams) {
    await s.enc.flush();
    s.enc.close();
    s.muxer.finalize();
    download(new Blob([s.muxer.target.buffer], { type: 'video/mp4' }), s.name);
  }
  const sorted = [...times].sort((a, b) => a - b);
  return {
    eye: W,
    face: v.faceSize,
    frames: total,
    files: streams.map((s) => ({ name: s.name, bytes: s.muxer.target.buffer.byteLength })),
    msPerFrame: { median: sorted[sorted.length >> 1], max: sorted.at(-1) },
    totalMs: performance.now() - t0,
  };
}

declare global {
  interface Window {
    __vr?: { still: typeof still; clip: typeof clip; ready: Promise<void> };
  }
}
window.__vr = { still, clip, ready };
