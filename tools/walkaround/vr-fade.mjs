/**
 * 46d：映り込みを切る・戻すときに、数コマかけて薄く・濃くなっているかを、コマを並べて撮る。
 *   node tools/walkaround/vr-fade.mjs [--show=hanabi] [--t=205] [--out=shots/walkaround/mirror-fade.png]
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const b = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-gl=angle', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 800 } });
await p.goto(`http://localhost:${args.port ?? 5199}/tools/vr-look.html?show=${args.show ?? 'hanabi'}&t=${args.t ?? 205}&quality=vr&fade=1&every=1`);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const url = await p.evaluate(() => window.__info.strip);
const out = args.out ?? 'shots/walkaround/mirror-fade.png';
writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log(out);
await b.close();
