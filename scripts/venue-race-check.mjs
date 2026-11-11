// node scripts/venue-race-check.mjs（開発サーバー :5199 が要る）
// 開いた直後（曲の解析の前）に会場を切り替え、解析の後も残るかを見る。音は出さない。
import { chromium } from 'playwright';
const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--mute-audio'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://localhost:5199/edit.html?fresh');
await page.waitForFunction(() => window.__editor?.state, null, { timeout: 60000 });
const musicAtSwitch = await page.evaluate(() => String(window.__editor.transport.music));
await page.evaluate(() => { document.getElementById('venue-btn').click(); });
await page.click('#venue-pop button:has-text("広場")');
const right = await page.evaluate(() => window.__editor.state.file.venue);
await page.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 90000 });
await page.waitForTimeout(1500);
const after = await page.evaluate(() => ({ venue: window.__editor.state.file.venue, btn: document.getElementById('venue-btn').textContent, cues: window.__editor.state.file.cues.length }));
console.log(JSON.stringify({ musicAtSwitch, right, after, errs }));
console.log(after.venue === right ? 'PASS 会場が残った' : 'FAIL 会場が戻った');
// 2つ目：解析の前にキューを1つ消したら、作り直しで消えずに残る
await page.goto('http://localhost:5199/edit.html?fresh');
await page.waitForFunction(() => window.__editor?.state, null, { timeout: 60000 });
const n0 = await page.evaluate(() => { const s = window.__editor.state; s.mutate((f) => { f.cues = f.cues.slice(1); }, { structural: true }); return s.file.cues.length; });
await page.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 90000 });
await page.waitForTimeout(1500);
const n1 = await page.evaluate(() => window.__editor.state.file.cues.length);
console.log(n1 === n0 ? `PASS 編集が残った（${n1}）` : `FAIL 編集が消えた（${n0} → ${n1}）`);
await browser.close();
