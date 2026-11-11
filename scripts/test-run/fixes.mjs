/**
 * Checks for the fixes of 2026-11-07 (handoff 追記22). Adds rows to scenarios 1, 9 and 16
 * (results/<n>fix.json), so report.mjs shows them with the scenario they belong to.
 *   node scripts/test-run/fixes.mjs        (the test server on :5200)
 */
import { open, scenario, openPlayer, openEditor, wait, BASE } from './lib.mjs';

const { browser, page, errors } = await open({ w: 1440, h: 900 });

// ---------------------------------------------------------------- scenario 1
const S1 = scenario(1, '花火版を通して観る');
const titles = [];
for (const [qs, want] of [['', 'Rhapsody in Blue'], ['show=fantasia', 'Rhapsody in Blue — Fantasia'], ['show=hanabi', 'Rhapsody in Blue — 花火']]) {
  await openPlayer(page, qs);
  const got = { tab: await page.title(), h1: await page.textContent('#start h1') };
  titles.push({ qs: qs || '(なし)', want, ...got, ok: got.tab === want && got.h1 === want });
  if (qs === 'show=hanabi') titles.shot = await S1.shot(page, 'fix-title-hanabi');
}
S1.rec('1.題', titles.every((t) => t.ok) ? 'pass' : 'fail', `始まりの画面の題とタブの名前：${titles.map((t) => `${t.qs} →「${t.h1}」（タブ「${t.tab}」）`).join('／')}`, '', [titles.shot]);

// the other versions end the same way (one clock for all)
for (const [qs, name] of [['t=208', 'Rhapsody in Blue'], ['show=fantasia&t=208', 'ファンタジア版']]) {
  errors.length = 0;
  await openPlayer(page, qs);
  await page.click('#go');
  await wait(1500);
  const t0 = Date.now();
  let ui = '';
  while (Date.now() - t0 < 30000) {
    ui = await page.evaluate(() => [window.__clock.playing, document.getElementById('play').getAttribute('aria-label'), document.getElementById('status').textContent, document.getElementById('time').textContent].join(' | '));
    if (ui.startsWith('false')) break;
    await wait(1000);
  }
  const stack = errors.find((e) => /call stack/.test(e));
  S1.rec(`1.終わり-${name}`, ui.startsWith('false') && !stack ? 'pass' : 'fail', `${name}を ?${qs} から流して、曲の終わりの後：再生中・ボタン・状態・時刻「${ui}」。${stack ? 'エラー: ' + stack : 'コンソールのエラー ' + errors.length}`);
}
S1.save({}, 'fix');

// ---------------------------------------------------------------- scenario 9
const S9 = scenario(9, 'エディタで演出を直して、本番で観る');
errors.length = 0;
await openEditor(page, 'fresh');
await page.click('#file-btn');
const menu = await page.$$eval('#file-pop [data-act="variant"]', (bs) => bs.map((b) => `${b.dataset.variant}=${b.textContent}`));
const wantMenu = ['lagoon=Rhapsody in Blue (今の演出) を読み込む', 'fantasia=ファンタジア版を読み込む', 'hanabi=花火版を読み込む'];
S9.rec('9.版のメニュー', menu.join() === wantMenu.join() ? 'pass' : 'fail', `「ファイル ▾」の版の項目（版の一覧 SHOW_VARIANTS から作る）：${menu.join('｜')}`, '', [await S9.shot(page, 'fix-file-menu')]);
await page.keyboard.press('Escape');
await page.mouse.click(700, 500);

// undo past the limit: 305 changes, back to the oldest kept, then the notice
const lim = await page.evaluate(() => {
  const s = window.__editor.state;
  for (let k = 0; k < 305; k++) s.mutate((f) => { f.cues[0].label = 'undo-test ' + k; });
  return { dropped: s.dropped };
});
await page.evaluate(() => { for (let k = 0; k < 299; k++) document.getElementById('undo-btn').click(); });
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.press('Control+z'); await wait(300);
const limToast = await page.textContent('#toast');
const limLeft = await page.evaluate(() => window.__editor.state.canUndo);
S9.rec('9.元に戻す上限', lim.dropped >= 5 && !limLeft && /300 回/.test(limToast) ? 'pass' : 'fail', `305 回直したあと、⌘Z（↶）を 300 回で戻せる一番前に着き、お知らせ「${limToast}」が出る（消えた分 ${lim.dropped}）。300 回までなら最初まで戻れる（7.7 は 13 回で戻った）`, '', [await S9.shot(page, 'fix-undo-limit')]);

// the restore notice names every version: change something, reopen without ?fresh
await openEditor(page, 'fresh');
await page.evaluate(() => window.__editor.state.mutate((f) => { f.cues[0].label = 'autosave-test'; }));
await wait(2500);
await page.goto(`${BASE}/edit.html`);
await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 90000 });
await wait(800);
const restoreToast = await page.textContent('#toast');
S9.rec('9.復元のお知らせ', /Rhapsody in Blue \/ ファンタジア版 \/ 花火版/.test(restoreToast) ? 'pass' : 'fail', `自動保存のある状態で開き直したお知らせ：「${restoreToast}」`, '', [await S9.shot(page, 'fix-restore-toast')]);
await page.evaluate(() => localStorage.clear());
S9.rec('9.コンソール-直し', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0（上の3つの確かめの間）');
S9.save({}, 'fix');

// ---------------------------------------------------------------- scenario 16
const S16 = scenario(16, '実機向けの書き出し');
errors.length = 0;
await openEditor(page, 'fresh', 'hanabi');
const notes = {};
for (const id of ['dmx-patch', 'cue-sheet', 'pyro-csv', 'channels-csv', 'dmx-record']) {
  await page.click('#cx-btn');
  await page.click(`#cx-pop button[data-id="${id}"]`); await wait(400);
  await page.dispatchEvent('#cx-form', 'input'); await wait(300);
  notes[id] = (await page.textContent('#cx-note')).replace(/\s+/g, ' ');
  if (id === 'cue-sheet') notes.shot = await S16.shot(page, 'fix-cue-sheet-note');
  await page.click('#cx-cancel');
}
const cues = await page.evaluate(() => window.__editor.state.file.cues.length);
const unitOk = /^\d[\d,]* 台・/.test(notes['dmx-patch']) && new RegExp(`^${cues.toLocaleString('en')} キュー・`).test(notes['cue-sheet']) && /^\d+ 発・/.test(notes['pyro-csv']) && /^[\d,]+ コマ・\d+ 台・/.test(notes['channels-csv']) && /^[\d,]+ コマ・\d+ 台・/.test(notes['dmx-record']);
S16.rec('16.見積もりの単位', unitOk ? 'pass' : 'fail', `書き出しの画面の見積もり（花火版、キュー ${cues}）：割り当て表「${notes['dmx-patch']}」／キュー表「${notes['cue-sheet']}」／点火表「${notes['pyro-csv']}」／チャンネル CSV「${notes['channels-csv']}」／DMX の記録「${notes['dmx-record']}」`, 'キュー表はキュー1つで1行、点火表は玉1発で1行、CSV と DMX の記録はコマごと、割り当て表は1台1行', [notes.shot]);
S16.rec('16.コンソール-直し', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
S16.save({}, 'fix');
await browser.close();
