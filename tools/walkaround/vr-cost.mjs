/**
 * 46d 段階 1a：VR の描き方（tools/vr-look.html、src/xr/）の重さを、両目ぶんで測る。撮るのもこれで。
 *
 *   node tools/walkaround/vr-cost.mjs [--t=178.6] [--show=lagoon] [--rounds=3] [--port=5199]
 *        [--sets="quality=vr|quality=vr&refl=0.25|quality=low&refl=0.35&bloom=1024"]
 *        [--shot=<出力フォルダ>]   1コマずつ撮る（左右の目を並べた PNG）
 *
 * 1つの組み合わせを rounds 回測った中央値と最小（機械が混んでいるときは最小のほうが本当の重さに近い）（ms／コマ、60 コマ、毎コマ画素を1つ読んで GPU を待つ）。
 * 目標：このMac で 5 ms 前後（docs/walkaround-plan.md「重さの見積もり」）。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.join('=')];
  }),
);
const times = String(args.t || '178.6').split(',');
const rounds = Number(args.rounds || 3);
const show = args.show || 'lagoon';
const port = args.port || '5199';
const sets = String(args.sets || 'quality=vr').split('|');
const shot = args.shot;
if (shot) mkdirSync(shot, { recursive: true });

const launch = { headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`show=${show}${shot ? ' (shots)' : `, median of ${rounds} rounds (60 frames each, both eyes)`}`);
for (const t of times) {
  for (const set of sets) {
    const base = `http://localhost:${port}/tools/vr-look.html?show=${show}&t=${t}&${set}`;
    if (shot) {
      await page.goto(`${base}&shot=1`);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
      const name = `${shot}/vr_${show}_t${t}_${set.replace(/[&=]/g, '-')}.png`;
      await page.locator('#stage canvas').screenshot({ path: name });
      console.log(name, errors.length ? errors.join(' / ') : '');
      errors.length = 0;
      continue;
    }
  }
  if (shot) continue;
  // the sets take turns, round after round, after one round thrown away: the GPU's clock
  // rises over the first loads, and other work on the machine comes in bursts
  const ms = Object.fromEntries(sets.map((s) => [s, []]));
  const info = {};
  for (let r = -1; r < rounds; r++) {
    for (const set of sets) {
      await page.goto(`http://localhost:${port}/tools/vr-look.html?show=${show}&t=${t}&${set}&perf=1`);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
      if (r >= 0) ms[set].push(await page.evaluate(() => window.__perf));
      info[set] = await page.evaluate(() => window.__info);
    }
  }
  for (const set of sets) {
    console.log(`t=${t} ${set}: ${med(ms[set]).toFixed(2)} ms (min ${Math.min(...ms[set]).toFixed(2)})  eye ${info[set]?.eye?.join('×')}${errors.length ? `  errors: ${errors.slice(0, 2).join(' / ')}` : ''}`);
  }
  errors.length = 0;
}
await browser.close();
