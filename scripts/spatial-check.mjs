/**
 * Check the Vision Pro export's spatial sound (src/audio/spatial.ts, 追記46b)
 * without a headset: the player builds the sound field for a range and a
 * seat, as if the head pointed front, 90° right, 90° left and straight up;
 * each is encoded as APAC and rendered for headphones by Apple's own
 * renderer (afconvert ... -l Binaural), and the left and right ears are
 * measured. Each sound (music, fireworks, water) is also measured alone,
 * with the direction it comes from (the field's intensity vector).
 *
 *   node scripts/spatial-check.mjs [--port=5199] [--show=hanabi] [--from=150] [--to=160] [--angle=audience] [--keep]
 *
 * Writes headphone files to listen to (the whole mix, each head direction,
 * and the stereo mix for comparison) to exports/visionpro/spatial-check/.
 * Movie: node scripts/spatial-check.mjs --movie=exports/visionpro/x.mov
 * prints the movie's audio tracks and renders its spatial track for headphones.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const port = arg('port', '5199');
const show = arg('show', 'hanabi');
const from = Number(arg('from', '150'));
const to = Number(arg('to', '160'));
const angle = arg('angle', 'audience');
const movie = arg('movie', null);
const outDir = 'exports/visionpro/spatial-check';
const work = mkdtempSync(join(tmpdir(), 'spatial-check-'));
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-inf');

/** A CAF file of float32 samples, interleaved, with a channel layout tag. */
function caf(path, data, channels, rate, tag) {
  const head = Buffer.alloc(8 + 12 + 32 + 12 + 12 + 12 + 4);
  let o = 0;
  head.write('caff', o); o += 4;
  head.writeUInt16BE(1, o); o += 2;
  head.writeUInt16BE(0, o); o += 2;
  head.write('desc', o); o += 4;
  head.writeBigInt64BE(32n, o); o += 8;
  head.writeDoubleBE(rate, o); o += 8;
  head.write('lpcm', o); o += 4;
  head.writeUInt32BE(1 | 2, o); o += 4; // float, little-endian
  head.writeUInt32BE(4 * channels, o); o += 4;
  head.writeUInt32BE(1, o); o += 4;
  head.writeUInt32BE(channels, o); o += 4;
  head.writeUInt32BE(32, o); o += 4;
  head.write('chan', o); o += 4;
  head.writeBigInt64BE(12n, o); o += 8;
  head.writeUInt32BE(tag, o); o += 4;
  head.writeUInt32BE(0, o); o += 4;
  head.writeUInt32BE(0, o); o += 4;
  head.write('data', o); o += 4;
  head.writeBigInt64BE(BigInt(data.byteLength + 4), o); o += 8;
  head.writeUInt32BE(0, o); o += 4;
  writeFileSync(path, Buffer.concat([head.subarray(0, o), Buffer.from(data.buffer, data.byteOffset, data.byteLength)]));
}

/** A WAV file's float32 stereo samples. */
function readWav(path) {
  const w = readFileSync(path);
  for (let i = 12; i < w.length; ) {
    const id = w.toString('ascii', i, i + 4);
    const size = w.readUInt32LE(i + 4);
    if (id === 'data') return new Float32Array(w.buffer.slice(w.byteOffset + i + 8, w.byteOffset + i + 8 + size));
    i += 8 + size + (size & 1);
  }
  throw new Error(`no data in ${path}`);
}

const HOA = (n) => ((190 << 16) | n) >>> 0;

/** Ambisonics (interleaved) → APAC → Apple's binaural rendering, as left and right. */
function binaural(name, data, channels, rate) {
  const c = join(work, `${name}.caf`);
  const a = join(work, `${name}.mp4`);
  const w = join(work, `${name}.wav`);
  caf(c, data, channels, rate, HOA(channels));
  execFileSync('afconvert', [c, a, '-d', 'apac', '-l', `0x${HOA(channels).toString(16)}`, '-b', '768000', '-u', 'csrc', '39', '-u', 'cdrc', '3', '-u', 'aspf', '75']);
  execFileSync('afconvert', [a, w, '-f', 'WAVE', '-d', 'LEF32', '-l', 'Binaural']);
  const s = readWav(w);
  return { file: w, l: s.filter((_, i) => i % 2 === 0), r: s.filter((_, i) => i % 2 === 1) };
}
const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / Math.max(1, x.length));

/** A biquad (RBJ) high- or low-pass at f, run over x. */
function pass(x, f, rate, high) {
  const w = (2 * Math.PI * f) / rate;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (high ? (1 + c) / 2 : (1 - c) / 2) / a0;
  const b1 = (high ? -(1 + c) : 1 - c) / a0;
  const a1 = (-2 * c) / a0;
  const a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
/**
 * How a head hears the side a sound is on: above ~1.5 kHz the far ear is in
 * the head's shadow (a level difference); below ~1 kHz the near ear hears it
 * first (a time difference, up to ~0.7 ms). Low sounds (the music, the
 * booms) show little level difference, so both are measured.
 */
function ears(l, r, rate) {
  const ild = db(rms(pass(l, 2000, rate, true))) - db(rms(pass(r, 2000, rate, true)));
  const ll = pass(l, 800, rate, false);
  const rl = pass(r, 800, rate, false);
  const max = Math.round(0.001 * rate);
  let best = 0, at = 0;
  for (let k = -max; k <= max; k++) {
    let c = 0;
    for (let i = max; i < ll.length - max; i += 2) c += ll[i] * rl[i + k];
    if (c > best) { best = c; at = k; }
  }
  // positive: the left ear hears it first (the sound is on the left)
  return { ild, itd: (at / rate) * 1000 };
}

/** Where the field's sound comes from, on average (first-order intensity: W times X, Y, Z). */
function direction(data, channels) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < data.length; i += channels) {
    const w = data[i];
    y += w * data[i + 1];
    z += w * data[i + 2];
    x += w * data[i + 3];
  }
  return { az: (Math.atan2(y, x) * 180) / Math.PI, el: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI };
}

/** Save a headphone file to listen to. */
function keep(src, name) {
  mkdirSync(outDir, { recursive: true });
  const dst = join(outDir, name);
  execFileSync('afconvert', [src, dst, '-f', 'm4af', '-d', 'aac', '-b', '256000']);
  return dst;
}

if (movie) {
  // the movie's tracks, read by AVFoundation, and its spatial track for headphones
  console.log(execFileSync('swift', ['scripts/spatial-info.swift', movie]).toString());
  const w = join(work, 'movie.wav');
  try {
    execFileSync('afconvert', [movie, w, '-f', 'WAVE', '-d', 'LEF32', '-l', 'Binaural']);
    const s = readWav(w);
    const l = s.filter((_, i) => i % 2 === 0);
    const r = s.filter((_, i) => i % 2 === 1);
    console.log(`afconvert → Binaural: ${(l.length / 48000).toFixed(2)} s, L ${f1(db(rms(l)))} dB, R ${f1(db(rms(r)))} dB`);
  } catch (e) {
    console.log('afconvert could not read the movie:', String(e.message).split('\n')[0]);
  }
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome', headless: true }));
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`http://localhost:${port}/play.html?show=${show}`);
await page.waitForFunction(() => window.__rt?.show && window.__clock?.music && window.__spatialSound, null, { timeout: 180000 });

const heads = { front: [0, 0], right90: [-90, 0], left90: [90, 0], up: [0, 90] };
const layers = ['all', 'music', 'pyro', 'water'];

/** The field from the page, for one head direction and one sound (or all), as float32 interleaved. */
async function field(head, layer) {
  const meta = await page.evaluate(
    async ({ from, to, angle, head, layer }) => {
      const rt = window.__rt;
      const c = window.__clock;
      const a = (await import('/src/show/cameras.ts')).ANGLES[angle];
      // the export's seat and heading (main.ts runExport)
      const seat = { x: a.pos[0], z: a.pos[2], toArray: () => [...a.pos] };
      const yaw = Math.atan2(-(a.target[0] - seat.x), -(a.target[2] - seat.z));
      const over = { head: { yaw: (head[0] * Math.PI) / 180, pitch: (head[1] * Math.PI) / 180 } };
      if (layer !== 'all' && layer !== 'music') over.music = null;
      if (layer !== 'all' && layer !== 'water') over.water = null;
      if (layer !== 'all' && layer !== 'pyro') over.pyro = null;
      // a sound alone without the music: the music still ducks the water, as in the mix
      const s = await window.__spatialSound(from, to, seat, yaw, over);
      const data = s.block(0, s.frames);
      window.__field = new Uint8Array(data.buffer);
      // the stereo export's same sound over the range, for the levels
      const sr = c.music.sampleRate;
      const a0 = Math.round(from * sr);
      const n = Math.round((to - from) * sr);
      const ms = (buf, g) => {
        if (!buf) return 0;
        let e = 0;
        for (let ch = 0; ch < 2; ch++) {
          const d = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1));
          for (let i = a0; i < a0 + n; i++) e += (d[i] * g) ** 2;
        }
        return e / (2 * n);
      };
      const stereo = {
        music: ms(c.music, c.gainOf('music')),
        water: ms(c.layerBuffer, c.gainOf('water')),
        pyro: ms(c.pyroBuffer, c.gainOf('pyro')),
      };
      return { channels: s.channels, rate: s.rate, frames: s.frames, bytes: window.__field.length, stereo, seat: a.pos, yaw };
    },
    { from, to, angle, head, layer },
  );
  const parts = [];
  const CH = 8 << 20;
  for (let i = 0; i < meta.bytes; i += CH) {
    const b64 = await page.evaluate(
      ({ i, n }) => {
        const u = window.__field.subarray(i, i + n);
        let s = '';
        for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode(...u.subarray(k, k + 0x8000));
        return btoa(s);
      },
      { i, n: CH },
    );
    parts.push(Buffer.from(b64, 'base64'));
  }
  const buf = Buffer.concat(parts);
  return { ...meta, data: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) };
}

console.log(`show=${show} ${from}-${to} s, seat '${angle}'`);
const rows = [];
let stereoLevels = null;
for (const layer of layers) {
  for (const [hn, head] of Object.entries(heads)) {
    if (layer !== 'all' && hn === 'left90') continue;
    const f = await field(head, layer);
    stereoLevels ??= f.stereo;
    if (layer === 'all' && hn === 'front') console.log(`seat ${f.seat.map((v) => v.toFixed(1)).join(', ')}, yaw ${((f.yaw * 180) / Math.PI).toFixed(1)}°, ${f.channels} ch, ${f.rate} Hz`);
    const dir = direction(f.data, f.channels);
    const w = db(rms(f.data.filter((_, i) => i % f.channels === 0)));
    const b = binaural(`${layer}_${hn}`, f.data, f.channels, f.rate);
    const L = db(rms(b.l));
    const R = db(rms(b.r));
    const e = ears(b.l, b.r, f.rate);
    rows.push({ layer, head: hn, W: w, L, R, az: dir.az, el: dir.el, ...e });
    console.log(`${layer.padEnd(5)} ${hn.padEnd(7)} ears L ${f1(L).padStart(6)} R ${f1(R).padStart(6)} dB  L-R ${f1(L - R).padStart(5)} dB, above 2 kHz ${f1(e.ild).padStart(5)} dB, left ear first by ${e.itd.toFixed(2).padStart(5)} ms  from az ${f1(dir.az).padStart(6)}° el ${f1(dir.el).padStart(5)}°`);
    if (layer === 'all') console.log(`      saved ${keep(b.file, `${show}_${from}-${to}s_${angle}_head-${hn}.m4a`)}`);
  }
}
// stereo levels against the headset's (looking ahead), per sound
console.log('\nlevel, stereo export vs headset looking ahead (mean of both ears):');
for (const layer of ['music', 'pyro', 'water']) {
  const r = rows.find((x) => x.layer === layer && x.head === 'front');
  const st = 10 * Math.log10(stereoLevels[layer] || 1e-20);
  const hs = 10 * Math.log10((10 ** (r.L / 10) + 10 ** (r.R / 10)) / 2);
  console.log(`  ${layer.padEnd(5)} stereo ${f1(st)} dB, headset ${f1(hs)} dB, difference ${f1(hs - st)} dB`);
}
// the stereo mix of the same range, to compare by ear
const stereo = await page.evaluate(async ({ from, to }) => {
  const c = window.__clock;
  const { mixSplash } = await import('/src/audio/splash.ts');
  const { limit } = await import('/src/audio/limit.ts');
  const { OUTPUT_CEILING } = await import('/src/audio/levels.ts');
  let m = mixSplash(c.music, c.layerBuffer, c.gainOf('water'), c.gainOf('music'));
  if (c.pyroBuffer) m = mixSplash(m, c.pyroBuffer, c.gainOf('pyro'));
  limit([m.getChannelData(0), m.getChannelData(1)], m.sampleRate, OUTPUT_CEILING);
  const sr = m.sampleRate;
  const a = Math.round(from * sr);
  const n = Math.round((to - from) * sr);
  const out = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) {
    out[2 * i] = m.getChannelData(0)[a + i];
    out[2 * i + 1] = m.getChannelData(1)[a + i];
  }
  let s = '';
  const u = new Uint8Array(out.buffer);
  for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode(...u.subarray(k, k + 0x8000));
  return { b64: btoa(s), rate: sr };
}, { from, to });
const sb = Buffer.from(stereo.b64, 'base64');
const sc = join(work, 'stereo.caf');
caf(sc, new Float32Array(sb.buffer, sb.byteOffset, sb.byteLength / 4), 2, stereo.rate, (101 << 16) | 2);
console.log(`saved ${keep(sc, `${show}_${from}-${to}s_${angle}_stereo.m4a`)} (the stereo export, for comparison)`);
await browser.close();
if (!process.argv.includes('--keep')) rmSync(work, { recursive: true, force: true });
else console.log('work files:', work);
