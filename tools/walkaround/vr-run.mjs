/**
 * 46d 段階 2：重い所だけ自動で描く大きさを下げる（src/xr/resolution.ts）を、場面を流して確かめる。
 * 自動なし（大きさ 1 のまま）と自動ありを同じ所で流し、0.5 秒ごとの平均の時間・大きさ・越えたコマ数を並べる。
 *
 *   node tools/walkaround/vr-run.mjs [--show=hanabi] [--run=196,210] [--budget=5] [--laps=2] [--port=5199]
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const show = args.show ?? 'hanabi';
const run = args.run ?? '196,210';
const budget = args.budget ?? '5';
const laps = args.laps ?? '1';
const port = args.port ?? '5199';
const b = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-gl=angle', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 800 } });
const out = {};
for (const auto of [false, true]) {
  await p.goto(`http://localhost:${port}/tools/vr-look.html?show=${show}&quality=vr&offscreen=1&run=${run}&budget=${budget}&laps=${laps}${auto ? '&auto=1' : ''}`);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  out[auto ? 'auto' : 'fixed'] = await p.evaluate(() => window.__info);
}
await b.close();
const f = out.fixed;
const a = out.auto;
console.log(`${show} ${run} 秒、目安 ${budget} ms、${laps} 周（最後の周を数える）`);
console.log(`  自動なし：平均 ${f.meanMs} ms、越えたコマ ${f.over}/${f.frames}`);
console.log(`  自動あり：平均 ${a.meanMs} ms、越えたコマ ${a.over}/${a.frames}、大きさの平均 ${a.meanScale}、映り込みを切ったコマ ${a.noMirror}/${a.frames}`);
// how much of the stretch ran at each scale (auto)
const share = {};
for (const [, , sc] of a.run) {
  const k = sc >= 0.95 ? '1' : sc >= 0.8 ? '0.85' : sc >= 0.65 ? '0.7' : sc >= 0.55 ? '0.6' : '0.5';
  share[k] = (share[k] ?? 0) + 1;
}
console.log(`  大きさごとの時間の割合：${Object.entries(share).sort((x, y) => Number(y[0]) - Number(x[0])).map(([k, n]) => `${k} 倍 ${Math.round((100 * n) / a.run.length)}%`).join('、')}`);
if (args.quiet) process.exit(0);
console.log('  秒      なし ms  越え |  あり ms  大きさ  越え  映り込み切');
for (let i = 0; i < f.run.length; i++) {
  const [k, ms0, , o0] = f.run[i];
  const [, ms1, s1, o1, nm] = a.run[i] ?? [];
  console.log(`  ${String(k).padEnd(6)} ${String(ms0).padStart(6)} ${String(o0).padStart(5)} | ${String(ms1).padStart(7)} ${String(s1).padStart(6)} ${String(o1).padStart(5)} ${String(nm).padStart(6)}`);
}
