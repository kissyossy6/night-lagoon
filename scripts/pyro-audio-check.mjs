import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({ args: ['--use-gl=angle'] }).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:5199/play.html?show=pyrotest');
await page.waitForFunction(() => window.__rt && window.__rt.show, null, { timeout: 60000 });
const r = await page.evaluate(async () => {
  const { renderPyro } = await import('/src/audio/pyro.ts');
  const rt = window.__rt;
  const seat = rt.venue.seats.find((s) => s.id === 'audience').pos;
  const t0 = performance.now();
  const buf = renderPyro(rt.show.bursts, seat, 140, 48000);
  const ms = performance.now() - t0;
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  // first sample above 0.05 after each measured burst
  const onset = (from) => { for (let i = Math.round(from * 48000); i < L.length; i++) if (Math.abs(L[i]) + Math.abs(R[i]) > 0.1) return i / 48000; return -1; };
  const b = rt.show.bursts.filter((x) => [4, 12, 22].includes(x.tBurst));
  const exp = b.map((x) => ({ t: x.tBurst, size: x.size, dist: Math.hypot(...x.center.map((c, k) => c - seat[k])), heard: onset(x.tBurst - 0.05) }));
  // 0-30 s as 16-bit wav
  const n = 30 * 48000, out = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, 48000, true); out.setUint32(28, 48000 * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { out.setInt16(44 + i * 4, L[i] * 32767, true); out.setInt16(46 + i * 4, R[i] * 32767, true); }
  return { ms, peak, exp, wav: Array.from(new Uint8Array(out.buffer)) };
});
writeFileSync(process.argv[2], Buffer.from(r.wav));
console.log(JSON.stringify({ ms: r.ms, peak: r.peak, exp: r.exp, errors }, null, 1));
await browser.close();
