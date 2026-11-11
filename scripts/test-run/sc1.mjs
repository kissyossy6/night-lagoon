import { open, scenario, openPlayer, startShow, wait } from './lib.mjs';
const S = scenario(1, '花火版を通して観る');
const { browser, page, errors } = await open();
await openPlayer(page, 'show=hanabi');
S.rec('前提', 'info', `開いた。題「${await page.title()}」、音量の初期値は100%`, '');
const lv = await page.evaluate(() => [...document.querySelectorAll('#vol input')].map((i) => i.value));
S.rec('前提-音量', lv.join() === '1,1,1' ? 'pass' : 'fail', `音量スライダー ${lv.join(',')}（期待 1,1,1）`);
await page.evaluate(() => { document.getElementById('start')?.remove?.(); });
// 1.1 run from the start in real time; sample time + frame rate
await page.reload();
await page.waitForFunction(() => !document.getElementById('go').disabled, null, { timeout: 90000 });
await page.click('#go');
await wait(1500);
const samples = [];
let last = 0, stall = 0, msg = '';
const pyroSeen = [];
const t0 = Date.now();
while (true) {
  const t = await page.evaluate(() => window.__clock.time());
  const playing = await page.evaluate(() => window.__clock.playing);
  samples.push([Date.now() - t0, t]);
  if (t - last < 0.05 && playing) stall++;
  last = t;
  const st = await page.evaluate(() => document.getElementById('status')?.textContent ?? '');
  if (st && st !== msg) { msg = st; S.rec('1.9-途中', 'info', `t=${t.toFixed(1)}s に画面の言葉「${st}」`); }
  if (t > 40 && !pyroSeen.length && false) {}
  if (t > 100 && !S.rows.find((r) => r.id === '1.2-shot')) S.rec('1.2-shot', 'info', 't=100 付近', '', [await S.shot(page, 't100-playing')]);
  if (!playing || t >= 216) break;
  await wait(2000);
  if (Date.now() - t0 > 330000) break;
}
const tEnd = await page.evaluate(() => window.__clock.time());
const stillPlaying = await page.evaluate(() => window.__clock.playing);
S.rec('1.1', tEnd > 215 ? 'pass' : 'fail', `通して流した。実時間 ${(Date.now() - t0) / 1000 | 0} 秒で、曲の時刻 ${tEnd.toFixed(1)} 秒（全長 約217秒）。止まった判定 ${stall} 回`, errors.length ? 'コンソールのエラー: ' + errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
await wait(1500);
const endPlaying = await page.evaluate(() => window.__clock.playing);
const ender = await page.evaluate(() => document.getElementById('play').getAttribute('aria-label'));
S.rec('1.終わり', 'info', `最後まで流れたあとの再生ボタン: ${ender}（再生中=${endPlaying}）`, '', [await S.shot(page, 'end')]);
S.save({ samples: samples.length });
await browser.close();
