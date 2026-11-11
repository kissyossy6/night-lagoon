/**
 * Side-by-side looks of the fireworks for a decision: the same frame with
 * one knob changed (star brightness, core white, smoke density).
 *   node scripts/pyro-looks.mjs --knob=gain|core|smoke --values=0.6,1,1.6 --t=107 --cam=wide [--light=real] [--out=shots/stage2/looks]
 *   --view=x,y,z:tx,ty,tz:fov  a camera of its own instead of a seat
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const knob = arg('knob', 'gain');
const values = arg('values', '0.6,1,1.6').split(',').map(Number);
const t = Number(arg('t', '107'));
const cam = arg('cam', 'wide');
const light = arg('light', 'real');
const out = arg('out', 'shots/stage2/looks');
const view = arg('view', '');
mkdirSync(out, { recursive: true });
const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:5199/play.html?show=pyrotest&cam=${cam}&light=${light}&t=${t}&shot=1`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
for (const v of values) {
  await page.evaluate(
    ({ knob, v, t, light, view }) => {
      const rt = window.__rt;
      if (view) {
        const [p, tg, fov] = view.split(':');
        const cam = rt.stage.camera;
        cam.position.set(...p.split(',').map(Number));
        cam.lookAt(...tg.split(',').map(Number));
        cam.fov = Number(fov);
        cam.updateProjectionMatrix();
      }
      const base = light === 'ideal' ? 1.3 : 1;
      rt.fireworks.setGain(knob === 'gain' ? v * base : base);
      // core: the white of the star's core; deep: no white core, tails in the star's colour
      rt.fireworks.setCore(knob === 'core' ? v : 0, knob === 'deep' ? v : 0.15);
      rt.smoke.density = knob === 'smoke' ? v : 1;
      rt.render(t);
    },
    { knob, v, t, light, view },
  );
  const file = `${out}/${knob}_${v}_t${t}_${view ? 'view' : cam}.png`;
  await page.screenshot({ path: file });
  console.log(file);
}
await browser.close();
