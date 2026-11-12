/**
 * What the fixtures' bodies (src/show/bodies.ts) cost per frame of the
 * player at quality 高. Needs the dev server on :5199.
 *
 *   node scripts/bodies-cost.mjs [--t=10,63,178.6] [--show=lagoon] [--venue=plaza] [--rounds=4] [--size=1280x720]
 *
 * Each time is played with the bodies shown and hidden (?fixtures=0),
 * alternating for several rounds so drift of the machine falls on both; the
 * player's own ?perf timing (60 frames, the GPU finished each frame by a
 * pixel read). Prints the median ms of each and the difference.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const times = String(args.t ?? '10,63,178.6').split(',');
const rounds = Number(args.rounds ?? 4);
const [w, h] = String(args.size ?? '1280x720').split('x').map(Number);
const extra = `show=${args.show ?? 'lagoon'}${args.venue ? `&venue=${args.venue}` : ''}&quality=high`;
const launch = { headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: w, height: h } });
const perf = async (url) => {
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  return page.evaluate(() => window.__perf);
};
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`quality 高, ${w}x${h}, ${extra}, median of ${rounds} rounds (60 frames each)`);
for (const t of times) {
  const on = [];
  const off = [];
  for (let r = 0; r < rounds; r++) {
    on.push(await perf(`http://localhost:5199/play.html?${extra}&t=${t}&shot=1&perf=1`));
    off.push(await perf(`http://localhost:5199/play.html?${extra}&fixtures=0&t=${t}&shot=1&perf=1`));
  }
  const a = med(on);
  const b = med(off);
  console.log(`  t=${t}: 機材あり ${a.toFixed(2)} ms / なし ${b.toFixed(2)} ms  (${a - b >= 0 ? '+' : ''}${(a - b).toFixed(2)})`);
}
await browser.close();
