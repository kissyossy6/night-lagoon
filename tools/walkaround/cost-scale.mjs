/**
 * 46d（歩き回る方法の調べ）：本番画面の1コマの重さが、描く画素の数と画質でどう変わるかを測る。
 * Vision Pro の WebXR（片目 約 1920×1824 ≒ 350万画素を両目）に収まるかの見積もりに使う。
 * 開発サーバー（:5199）が要る。src/ は触らない（本番画面の ?perf をそのまま使う）。
 *
 *   ~/.nvm/versions/node/v26.13.1/bin/node tools/walkaround/cost-scale.mjs [--t=63,178.6] [--show=lagoon] [--rounds=3] [--port=5199]
 *
 * 大きさ（headless なので devicePixelRatio=1、画素数＝窓の大きさ）× 画質（高・中・低）× 描き方（今／?gfx=off）。
 * 1つの組み合わせを rounds 回測り、中央値（ms/コマ、60 コマ、毎コマ画素を1つ読んで GPU の終わりを待つ）。
 * 結果は docs/walkaround-plan.md の「重さの見積もり」に写す。
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const times = String(args.t ?? '63,178.6').split(',');
const rounds = Number(args.rounds ?? 3);
const show = args.show ?? 'lagoon';
const sizes = String(args.sizes ?? '1280x720,1920x1080,2560x1440,3840x1824').split(',');
const qualities = String(args.q ?? 'high,medium,low').split(',');
const gfxs = ['', 'off'];
const port = args.port ?? '5199';

const launch = { headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`show=${show}, median of ${rounds} rounds (60 frames each)`);
for (const size of sizes) {
  const [w, h] = size.split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  for (const t of times) {
    const row = [];
    for (const quality of qualities) {
      for (const gfx of gfxs) {
        if (quality === 'low' && gfx === 'off') continue; // 低は描き方の足しが元から切
        const url = `http://localhost:${port}/play.html?show=${show}&quality=${quality}${gfx ? `&gfx=${gfx}` : ''}&t=${t}&shot=1&perf=1`;
        const ms = [];
        for (let r = 0; r < rounds; r++) {
          await page.goto(url);
          await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
          ms.push(await page.evaluate(() => window.__perf));
        }
        row.push(`${quality}${gfx ? '/gfx=off' : ''} ${med(ms).toFixed(1)}`);
      }
    }
    console.log(`${size} (${((w * h) / 1e6).toFixed(2)} MP) t=${t}: ${row.join(' | ')}`);
  }
  await page.close();
}
await browser.close();
