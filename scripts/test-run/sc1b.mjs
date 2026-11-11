import { open, scenario, openPlayer, wait, BASE } from './lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const S = scenario(1, '花火版を通して観る');
const { browser, page, errors } = await open({ w: 1280, h: 720 });
await openPlayer(page, 'show=hanabi');
// 1.2: first firework time
const info = await page.evaluate(async () => {
  const { buildShow } = await import('/src/show/choreography.ts');
  const f = buildShow(undefined, 'hanabi');
  const fires = f.cues.filter((c) => c.fire).sort((a, b) => a.t - b.t);
  return { first: fires[0]?.t, last: fires.at(-1)?.t, n: fires.length, times: fires.map((c) => [c.t, c.target]).slice(0, 40) };
});
S.rec('1.2', info.first >= 162 ? 'pass' : 'fail', `花火版の花火のキューは ${info.n} 個。最初は ${info.first} 秒、最後は ${info.last} 秒（162 秒より前には無い）`);
await page.click('#go');
await wait(800);
await page.evaluate(() => window.__clock.pause());
await page.evaluate(() => { document.getElementById('bar')?.classList.remove('idle'); });
const pick = async (label) => {
  await page.click('#cam-open');
  const all = await page.$$('#cam button');
  for (const b of all) {
    const tx = (await b.textContent()).trim().replace(/[0-9]$/, '');
    if (tx === label) { await b.click(); return true; }
  }
  await page.keyboard.press('Escape');
  return false;
};
const camNames = await page.$$eval('#cam button', () => []).catch(() => []);
await page.click('#cam-open');
const labels = await page.$$eval('#cam button', (bs) => bs.map((b) => b.textContent.trim()));
await page.keyboard.press('Escape');
S.rec('1.8-席', 'info', `カメラ▾の席: ${labels.join('・')}`);
const moments = [[163.6, '扇'], [167.7, 'X字'], [179.2, '陸の7本'], [206.9, '最後の10号']];
const shots = {};
for (const cam of ['客席', '花火と水', '花火']) {
  const ok = await pick(cam);
  if (!ok) { S.rec('1.8-' + cam, 'fail', `カメラ「${cam}」の項目が見つからない`); continue; }
  for (const [t, nm] of moments) {
    await page.evaluate((tt) => window.__clock.seek(tt), t);
    await wait(900);
    (shots[cam] ??= []).push(await S.shot(page, `${cam}-${t}`));
  }
}
S.rec('1.3', 'user', '扇（163.6秒）・X字（167.7）・陸の7本（179.2）・最後の10号（206.9）を3つの席（客席・花火と水・花火）で撮った。場面ごとに見分けられるか、あなたが見て決める', '', Object.values(shots).flat());
S.rec('1.6', 'user', '10号の大きさ（花火と水の席の最後の画面）が水の噴水と比べて不自然でないか', '', [shots['花火と水']?.[3]].filter(Boolean));
S.rec('1.7', 'user', '花火の光の水面への映り（客席の最後の画面）', '', [shots['客席']?.[3]].filter(Boolean));
S.rec('1.8', 'user', '「花火と水」「花火」で花火が画面に収まるか（客席では上に切れることがある）', '', [...(shots['花火と水'] ?? []), ...(shots['花火'] ?? [])]);
S.rec('1.コンソール', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
// step 6: ?t=200 plays to the end and stops
errors.length = 0;
await openPlayer(page, 'show=hanabi&t=200');
await page.click('#go');
await wait(1500);
const t0 = Date.now();
let playing = true, uiState = '';
while (Date.now() - t0 < 40000) {
  uiState = await page.evaluate(() => [window.__clock.playing, document.getElementById('play').getAttribute('aria-label'), document.getElementById('status').textContent, document.getElementById('time').textContent].join(' | '));
  playing = uiState.startsWith('true');
  if (!playing) break;
  await wait(1000);
}
const endErr = errors.find((e) => /call stack/.test(e));
S.rec('1.終わり', !playing ? 'pass' : 'fail', `t=200 から流して ${((Date.now() - t0) / 1000).toFixed(0)} 秒後（曲の終わり 3:37 を過ぎた後）の画面：再生中=${playing}、再生ボタン・状態の言葉・時刻は「${uiState}」。${endErr ? 'コンソールのエラー: ' + endErr : ''}`, playing ? '再現：?show=hanabi&t=215 を開いて「ショーを始める」→ 3:37 で時刻が止まるのに再生が止まらない（ボタンは「一時停止」のまま、「おしまい」が出ない）。原因の候補は src/show/clock.ts の time() が終わりで pause() を呼び、pause() がまた time() を呼んで止まらなくなること（pause() の先頭で playing が true のまま）。' : '', [await S.shot(page, 'end-after-t200')]);
S.save({}, 'b');
await browser.close();
