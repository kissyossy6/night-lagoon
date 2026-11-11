import { open, scenario, openPlayer, wait } from './lib.mjs';
const S = scenario(4, 'カメラ・照明・画質を替えて見る');
const { browser, page, errors } = await open({ w: 1024, h: 576 });
await openPlayer(page, 'show=hanabi&t=100');
await page.click('#go'); await wait(600);
await page.evaluate(() => window.__clock.pause());
const bar = await page.evaluate(() => [...document.querySelectorAll('#row > *')].map((e) => (e.textContent || '').trim().replace(/\s+/g, ' ')).filter(Boolean));
const need = ['波形', '水音', '音量', 'カメラ', '表示', '動画を書き出す', 'エディタ ↗'];
const miss = need.filter((n) => !bar.some((b) => b.includes(n)));
S.rec('4.0', miss.length ? 'fail' : 'pass', `下のバー: ${bar.join(' | ')}${miss.length ? '（足りない: ' + miss.join('・') + '）' : ''}`, '', [await S.shot(page, 'bar')]);
// cameras
await page.click('#cam-open');
const labels = await page.$$eval('#cam button', (bs) => bs.map((b) => [b.dataset.v, b.textContent.trim().replace(/[0-9]$/, '')]));
await page.keyboard.press('Escape'); await page.mouse.click(500, 200);
const want = ['客席', '目線', 'スクリーン前', '遠景', '水面', '左', '右', '空撮', '花火と水', '花火', 'おまかせ', '自由'];
const missCam = want.filter((w) => !labels.some(([, l]) => l === w));
const shots = [];
const nows = [];
for (const [v, l] of labels) {
  await page.click('#cam-open');
  await page.click(`#cam button[data-v="${v}"]`);
  await wait(700);
  const now = (await page.textContent('#cam-now')).trim();
  nows.push(`${l}→${now}`);
  shots.push(await S.shot(page, `cam-${v}`));
}
S.rec('4.1', !missCam.length && labels.length === 12 ? 'pass' : 'fail', `カメラの項目 ${labels.length}: ${labels.map((x) => x[1]).join('・')}${missCam.length ? '（足りない: ' + missCam.join('・') + '）' : ''}。選ぶたびに「カメラ ○」の表示が替わる: ${nows.join('、')}`, '', shots);
S.rec('4.1-見た目', 'user', '12 の席で画面が崩れていないか（上の画面）。「おまかせ」が場面に合わせて切り替わるかは再生して見る必要がある', '');
// auto camera moves with time
await page.click('#cam-open'); await page.click('#cam button[data-v="auto"]');
const autoShots = [];
for (const t of [20, 90, 150]) { await page.evaluate((x) => window.__clock.seek(x), t); await wait(900); autoShots.push(await S.shot(page, `auto-${t}`)); }
S.rec('4.1-おまかせ', 'user', '「おまかせ」で 20・90・150 秒の画面。場面で違う席になっているか', '', autoShots);
// lighting
await page.click('#cam-open'); await page.click('#cam button[data-v="audience"]');
await page.evaluate(() => window.__clock.seek(206));
const light = async () => page.evaluate(() => document.querySelector('#light button[aria-pressed="true"]').textContent);
const L0 = await light();
await page.click('#view-open'); await page.click('#light button[data-v="ideal"]'); await wait(800);
const L1 = await light(); const idealShot = await S.shot(page, 'light-ideal');
await page.click('#light button[data-v="real"]'); await wait(800);
const realShot = await S.shot(page, 'light-real');
await page.mouse.click(500, 200);
await page.keyboard.press('KeyL'); await wait(500);
const L2 = await light();
await page.keyboard.press('KeyL'); await wait(300);
const L3 = await light();
S.rec('4.2-切替', L0 === 'リアル' && L1 === '理想' && L2 === '理想' && L3 === 'リアル' ? 'pass' : 'fail', `照明：初め ${L0} → 理想ボタン ${L1} → L キー ${L2} → もう一度 ${L3}`);
S.rec('4.2', 'user', '206 秒（最後の和音）の「理想」と「リアル」。違いが分かるか、名前（リアル＝機材どおり／理想＝見栄え優先）が合っているか', '', [idealShot, realShot]);
// wave & splash
const scopeHidden = () => page.evaluate(() => document.getElementById('scope').hidden);
const w0 = await scopeHidden();
await page.click('#wave'); await wait(400); const w1 = await scopeHidden(); const waveShot = await S.shot(page, 'wave-on');
await page.keyboard.press('KeyW'); await wait(300); const w2 = await scopeHidden();
const sp = () => page.evaluate(() => document.getElementById('splash').getAttribute('aria-pressed'));
const s0 = await sp(); await page.click('#splash'); const s1 = await sp(); await page.keyboard.press('KeyS'); const s2 = await sp();
S.rec('4.3', w0 && !w1 && w2 && s0 === 'true' && s1 === 'false' && s2 === 'true' ? 'pass' : 'fail', `波形：初め隠れ=${w0} → ボタン後 隠れ=${w1} → W キー後 隠れ=${w2}。水音：${s0} → ${s1} → ${s2}（S キー）`, '', [waveShot]);
S.rec('4.4', 'user', 'バーの見た目（グラファイト＋琥珀）。字が小さすぎないか', '', [await S.shot(page, 'bar-final')]);
S.rec('4.コンソール', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
S.save();
await browser.close();
