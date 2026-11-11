/**
 * Render single fireworks bursts with the show's own code (src/audio/pyro.ts),
 * spaced so each stands alone, for scripts/sound/compare.py (sound-design skill).
 *   node scripts/sound/render.mjs <out.wav> [--size=5] [--n=8] [--dist=300] [--gap=6] [--launch] [--feel='{...}'|measured] [--module=/src/audio/pyro.ts]
 *   --launch  launch each shell 4 s before it opens (the "ぽん" too)
 * Needs the dev server on :5199.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const out = process.argv[2];
const feelArg = process.argv.find((a) => a.startsWith('--feel='))?.slice(7) ?? '';
const o = {
  size: Number(arg('size', '5')),
  n: Number(arg('n', '8')),
  dist: Number(arg('dist', '300')),
  gap: Number(arg('gap', '6')),
  launch: process.argv.includes('--launch'),
  feel: feelArg,
  module: arg('module', '/src/audio/pyro.ts'),
};
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome', headless: true }));
const page = await browser.newPage();
await page.goto('http://localhost:5199/edit.html?fresh');
const b64 = await page.evaluate(async (o) => {
  const mod = await import(o.module);
  const feel = o.feel === 'measured' ? mod.MEASURED : o.feel ? { ...mod.PYRO_FEEL, ...JSON.parse(o.feel) } : undefined;
  const sr = 48000;
  const dur = 2 + o.n * o.gap + (o.launch ? 4 : 0);
  // straight ahead at the distance, launched long before the clip (no thump, no whistle)
  const bursts = Array.from({ length: o.n }, (_, i) => ({
    id: i, tLaunch: o.launch ? 1 + i * o.gap : -50, tBurst: (o.launch ? 5 : 2) + i * o.gap, tube: 0, origin: [0, 0, -o.dist], center: [0, 0, -o.dist],
    shell: 'mine', size: o.size, radius: 1, colors: [[1, 1, 1]], stars: 1, k: 1, burn: 1, seed: 1000 + i, source: 0,
  }));
  const buf = feel ? mod.renderPyro(bursts, [0, 0, 0], dur, sr, feel) : mod.renderPyro(bursts, [0, 0, 0], dur, sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const n = L.length;
  const v = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (p, s) => [...s].forEach((c, i) => v.setUint8(p + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
  const u = new Uint8Array(v.buffer);
  let bin = '';
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(bin);
}, o);
writeFileSync(out, Buffer.from(b64, 'base64'));
console.log(out);
await browser.close();
