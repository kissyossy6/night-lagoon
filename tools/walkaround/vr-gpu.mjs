/**
 * 46d 段階 1a：VR の描き方の GPU の時間を、シーンの部品ごとに合計して出す（tools/vr-look.html?gpu=1、タイマーのクエリ）。
 * 「off:…」はシーンの外の描画（水の GPU の計算、後処理の全画面の処理）。機械の混み具合に左右されにくい。
 *   node tools/walkaround/vr-gpu.mjs "quality=vr" "quality=high&refl=0.5&bloom=1024&gfx=all" [--show=hanabi --t=205.99]
 */
import { chromium } from 'playwright';
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const sets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const b = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-gl=angle', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 800 } });
for (const set of sets.length ? sets : ['quality=vr']) {
  await p.goto(`http://localhost:${opts.port ?? 5199}/tools/vr-look.html?show=${opts.show ?? 'lagoon'}&t=${opts.t ?? 178.6}&gpu=1&${set}`);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  const i = await p.evaluate(() => window.__info);
  console.log(`${set}: GPU ${i.total} ms/コマ（両目）${i.disjoint ? ' ※disjoint' : ''}`);
  for (const [k, v] of Object.entries(i.gpu)) if (v >= 0.05) console.log(`   ${v.toFixed(2).padStart(6)}  ${k}`);
}
await b.close();
