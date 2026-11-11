/**
 * Fireworks sizes against the table (src/pyro/shells.ts): shoot the 花火版's
 * single 2.5 / 5 / 10号 shells from the 花火 seat at 80 % of their burn, when
 * they are widest, and write where each should appear (centre and diameter in
 * pixels) next to the shot; scripts/pyro-size-measure.py measures the shots.
 *   node scripts/pyro-size-check.mjs [--out=shots/stage2/size] [--light=real]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const out = arg('out', 'shots/stage2/size');
const light = arg('light', 'real');
mkdirSync(out, { recursive: true });
const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const rows = [];
for (const label of ['2.5号 菊', '5号 菊', '10号 菊']) {
  // where the burst is (from the compiled show), then the shot at 80 % of its burn
  await page.goto(`http://localhost:5199/play.html?show=pyrotest&cam=pyro&light=${light}&t=0&shot=1`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const b = await page.evaluate((label) => {
    const rt = window.__rt;
    const src = rt.file.cues.findIndex((c) => c.label === label);
    return rt.show.bursts.find((x) => x.source === src);
  }, label);
  const t = b.tBurst + 0.8 * b.burn;
  await page.goto(`http://localhost:5199/play.html?show=pyrotest&cam=pyro&light=${light}&t=${t}&shot=1`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const proj = await page.evaluate((b) => {
    const cam = window.__rt.stage.camera;
    cam.updateMatrixWorld();
    const V = cam.matrixWorldInverse.elements;
    const P = cam.projectionMatrix.elements;
    const mul = (m, v) => [0, 1, 2, 3].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
    const px = (p) => {
      const c = mul(P, mul(V, [...p, 1]));
      return [((c[0] / c[3]) * 0.5 + 0.5) * innerWidth, (0.5 - (c[1] / c[3]) * 0.5) * innerHeight];
    };
    // sideways in the picture: along the camera's right vector
    const right = [V[0], V[4], V[8]];
    const c = px(b.center);
    const e = px(b.center.map((x, k) => x + right[k] * b.radius));
    return { cx: c[0], cy: c[1], rPx: Math.hypot(e[0] - c[0], e[1] - c[1]) };
  }, b);
  const file = `${out}/${b.size}go.png`;
  await page.screenshot({ path: file });
  rows.push({ label, size: b.size, diameter: b.radius * 2, t, file, ...proj });
}
writeFileSync(`${out}/expected.json`, JSON.stringify(rows, null, 1));
console.log(JSON.stringify(rows, null, 1));
if (errors.length) console.log(errors.join('\n'));
await browser.close();
