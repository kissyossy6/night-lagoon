/**
 * Test shots of the lean patterns (Fire.angle / tilt / pattern): each one
 * fired alone from the barge (奥の台, 5 tubes) and shot from the audience
 * side, and the front-back leans from the side as well. Each shot is a
 * stack of frames from the launch to just after the opening (the brightest
 * of each pixel, like a long exposure), so the risers draw their paths.
 * Needs the dev server on :5199; stacks and sheet with
 * scripts/pyro-angle-sheet.py.
 *   node scripts/pyro-angle-shots.mjs [--out=shots/stage3/angles] [--light=real]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const out = arg('out', 'shots/stage3/angles');
const light = arg('light', 'real');
mkdirSync(out, { recursive: true });

// 4号 菊 from the barge: 160 m up, 98 m across, 4.4 s rise, 150 m safety (the barge has 155)
const base = { shell: 'kiku', size: 4, colors: ['#ffb050'] };
const GAP = 12;
const CASES = [
  { id: 'none', ja: 'なし（全部まっすぐ）', fire: {} },
  { id: 'fan', ja: '扇（広さ 40°）', fire: { pattern: 'fan' } },
  { id: 'v', ja: 'V字', fire: { pattern: 'v' } },
  { id: 'x', ja: 'X字（交差）', fire: { pattern: 'x' } },
  { id: 'sweep-lr', ja: '順に振る 左→右（0.3 秒おき）', fire: { pattern: 'sweep-lr', interval: 0.3 }, last: 1.2 },
  { id: 'sweep-out', ja: '順に振る 中央から外', fire: { pattern: 'sweep-out', interval: 0.3 }, last: 1.2 },
  { id: 'run-rl', ja: '1本で5連 右→左（中央の筒）', fire: { pattern: 'sweep-rl', count: 5, interval: 0.3 }, target: '@奥の台 中央', last: 1.2 },
  { id: 'back', ja: '奥へ 20°（よい）', fire: { tilt: -20 }, side: true },
  { id: 'toward', ja: '客席へ 15°（赤い警告）', fire: { tilt: 15 }, side: true },
];
const cues = CASES.map((c, i) => ({ t: 10 + i * GAP, target: c.target ?? '@奥の台', fire: { ...base, ...c.fire }, label: c.ja }));
const file = { title: '角度の型の試し打ち', bpm: 120, beatsPerBar: 4, offset: 0, duration: 10 + CASES.length * GAP, cues };

// 客席の側から（岸 z = 45 の後ろ）と、真横から（客席は右）
const VIEWS = {
  front: { pos: [0, 10, 150], target: [0, 115, -110], fov: 55 },
  side: { pos: [-430, 40, -70], target: [0, 115, -70], fov: 50 },
};

const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:5199/play.html?show=pyrotest&cam=pyro&light=${light}&t=0&shot=1`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.evaluate((file) => window.__rt.setShow(file), file);
const warnings = await page.evaluate(() => window.__rt.show.pyroWarnings.map((w) => [w.source, w.kind, w.level]));
console.log('warnings', JSON.stringify(warnings));

// frames from the launch to just after the last opening
const STEP = 0.2;
for (const [i, c] of CASES.entries()) {
  const from = cues[i].t - 4.4 - 0.1;
  const to = cues[i].t + (c.last ?? 0) + 0.7;
  for (const view of c.side ? ['front', 'side'] : ['front']) {
    const dir = `${out}/frames/${c.id}_${view}`;
    mkdirSync(dir, { recursive: true });
    let n = 0;
    for (let t = from; t <= to + 1e-6; t += STEP) {
      await page.evaluate(
        ({ v, t }) => {
          const rt = window.__rt;
          const cam = rt.stage.camera;
          cam.position.set(...v.pos);
          cam.lookAt(...v.target);
          cam.fov = v.fov;
          cam.updateProjectionMatrix();
          rt.render(t);
        },
        { v: VIEWS[view], t },
      );
      await page.screenshot({ path: `${dir}/${String(n++).padStart(3, '0')}.png` });
    }
    console.log(dir, n);
  }
}
await browser.close();
