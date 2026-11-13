/**
 * 46d 段階 1a：VR の描き方の重さを、毎コマの準備（advance）・目ごとの準備（aim）・描画に分けて見る。
 * GPU を待つ時間と、待たない CPU の時間（allCpu。GPU が詰まると CPU も待たされるので、GPU の重さも混ざる）。
 *   node tools/walkaround/vr-prof.mjs "quality=vr" "quality=vr&scale=0.1&hide=6" …   （:5199、tools/vr-look.html?prof=1）
 */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-gl=angle', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 800 } });
for (const set of process.argv.slice(2)) {
  await p.goto(`http://localhost:5199/tools/vr-look.html?show=lagoon&t=178.6&prof=1&${set}`);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  const i = await p.evaluate(() => window.__info);
  console.log(set, Object.entries(i).filter(([k]) => k !== 'look').map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`).join(' '));
}
await b.close();
