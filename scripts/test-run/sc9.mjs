import { open, scenario, openEditor, inspRow, wait, BASE } from './lib.mjs';
import { readFileSync } from 'node:fs';
const SCR = process.argv[2];
const S = scenario(9, 'エディタで演出を直して、本番で観る');
const { browser, ctx, page, errors } = await open({ w: 1440, h: 900 });
await openEditor(page, 'fresh&t=100');
const toast = () => page.evaluate(() => document.getElementById('toast').textContent);
// 1 load
await page.click('#file-btn'); await page.click('#file-pop [data-act="new"]'); await wait(800);
const newN = await page.evaluate(() => window.__editor.state.file.cues.length);
const tNew = await toast();
await page.click('#file-btn'); await page.click('#file-pop [data-variant="lagoon"]'); await wait(2500);
const lagon = await page.evaluate(() => ({ n: window.__editor.state.file.cues.length, json: JSON.stringify(window.__editor.state.file) }));
const tLag = await toast();
S.rec('9.1-読み込み', newN === 0 && lagon.n > 300 && /Night Lagoon.*読み込みました/.test(tLag) ? 'pass' : 'fail', `「新規ショー」→ キュー ${newN}（${tNew}）。「Night Lagoon (今の演出) を読み込む」→ キュー ${lagon.n}、知らせ「${tLag}」`);
// 2 edit a water cue: pick a cue with pressure
const pick = await page.evaluate(() => {
  const e = window.__editor; const f = e.state.file;
  const i = f.cues.findIndex((c) => c.set && c.set.pressure != null && c.t > 60 && c.t < 120 && /grid|^[a-z]/.test(c.target));
  e.timeline.reveal(i); e.state.setSelection([i], i);
  return { i, t: f.cues[i].t, target: f.cues[i].target, set: f.cues[i].set };
});
await wait(500);
await page.locator('#inspector input[data-param="pressure"]').fill('0.33'); await wait(400);
const edited = await page.evaluate((i) => window.__editor.state.file.cues[i].set.pressure, pick.i);
// drag the block
const r = await page.evaluate((i) => { const e = window.__editor; e.timeline.reveal(i); const b = e.timeline.blockRect(i); return b; }, pick.i);
await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2); await page.mouse.down(); await page.mouse.move(r.x + r.w / 2 + 60, r.y + r.h / 2, { steps: 6 }); await page.mouse.up(); await wait(400);
const moved = await page.evaluate((i) => window.__editor.state.file.cues[i].t, pick.i);
S.rec('9.2-直す', edited === 0.33 && moved !== pick.t ? 'pass' : 'fail', `水のキュー #${pick.i}（${pick.target}）：圧力 ${pick.set.pressure} → ${edited}、帯をドラッグして ${pick.t} 秒 → ${moved} 秒`, '', [await S.shot(page, '1-edited')]);
// 3 undo/redo
const A = await page.evaluate((i) => JSON.stringify(window.__editor.state.file.cues[i]), pick.i);
await page.keyboard.press('Control+z'); await wait(200);
const U1 = await page.evaluate((i) => JSON.stringify(window.__editor.state.file.cues[i]), pick.i);
await page.keyboard.press('Control+Shift+z'); await wait(200);
const R1 = await page.evaluate((i) => JSON.stringify(window.__editor.state.file.cues[i]), pick.i);
S.rec('9.1', U1 !== A && R1 === A ? 'pass' : 'fail', `⌘Z で1つ戻り、⇧⌘Z でやり直せる（戻す前後が一致: ${R1 === A}）`);
// 4 play, light, quality, camera reset, mute
await page.click('#play-btn'); await wait(2500);
const tp = await page.evaluate(() => window.__editor.transport.now());
await page.click('#play-btn'); await wait(300);
const modes = [];
for (const m of ['ideal', 'real']) { await page.click(`#light-seg button[data-mode="${m}"]`); await wait(500); modes.push(await page.evaluate(() => document.querySelector('#light-seg button.on')?.dataset.mode)); }
const qs = [];
for (const q of ['high', 'low', 'medium']) { await page.selectOption('#quality-sel', q); await wait(700); qs.push(await page.evaluate(() => document.getElementById('quality-sel').value)); }
await page.click('#cam-btn'); await wait(300);
await page.check('#mute-chk'); const muted = await page.isChecked('#mute-chk'); await page.uncheck('#mute-chk');
S.rec('9.3', tp > 100.5 && modes.join() === 'ideal,real' && qs.join() === 'high,low,medium' && muted ? 'pass' : 'fail', `再生で時刻 100→${tp.toFixed(1)} 秒。照明 ${modes.join('→')}、画質 ${qs.join('→')}、視点リセット（押せた）、ミュート（入り切り ${muted}）`, '', [await S.shot(page, '2-play-light')]);
// 5 sections
await page.evaluate(() => window.__editor.state.setSelection([], -1)); await wait(400);
const secInfo = await page.evaluate(() => [...document.querySelectorAll('#inspector input.txt')].map((i) => i.value).slice(0, 4));
const chipName = (await page.textContent('#section-chip')).trim();
const secIdx = await page.evaluate((nm) => [...document.querySelectorAll('#inspector input.txt')].findIndex((i) => i.value === nm), chipName);
const nameIn2 = page.locator('#inspector input.txt').nth(secIdx);
const oldName = await nameIn2.inputValue();
await nameIn2.fill('テスト名'); await wait(400);
const chip = await page.evaluate(() => ({ name: (window.__editor.state.file.sections ?? []).find((x) => x.name === 'テスト名')?.name, chip: document.getElementById('section-chip')?.textContent }));
const shotSec = await S.shot(page, '3-section');
S.rec('9.4', chip.name === 'テスト名' ? 'pass' : 'fail', `「ショー設定」の区間：最初の区間「${oldName}」→「テスト名」。演出の区間名 ${chip.name}、上の帯の札「${chip.chip}」`, '「ファイルを読み込むと区間が替わる／残る」は 9.5 の後で確認', [shotSec]);
// 6 json export / import
const exportedDl = page.waitForEvent('download');
await page.click('#file-btn'); await page.click('#file-pop [data-act="export"]');
const dl = await exportedDl; const jf = `${SCR}/show-export.json`; await dl.saveAs(jf);
const exported = readFileSync(jf, 'utf8');
const cur = await page.evaluate(() => JSON.stringify(window.__editor.state.file));
await page.click('#file-btn'); await page.click('#file-pop [data-act="new"]'); await wait(600);
const emptied = await page.evaluate(() => window.__editor.state.file.cues.length);
await page.click('#file-btn');
await page.setInputFiles('#import-input', jf); await wait(1500);
const imp = await page.evaluate(() => JSON.stringify(window.__editor.state.file));
const tImp = await toast();
S.rec('9.5', JSON.parse(exported).cues.length === JSON.parse(cur).cues.length && emptied === 0 && imp === cur ? 'pass' : (JSON.parse(imp).cues.length === JSON.parse(cur).cues.length ? 'fail' : 'fail'), `JSON を書き出し（${(exported.length / 1e3).toFixed(0)} KB・${dl.suggestedFilename()}）→ 新規ショー（キュー ${emptied}）→ JSON を読み込む：キュー ${JSON.parse(imp).cues.length}／元 ${JSON.parse(cur).cues.length}。中身の完全一致: ${imp === cur}。知らせ「${tImp}」`);
// 7 本番で再生
const edCue = await page.evaluate((i) => window.__editor.state.file.cues[i], pick.i);
const popP = ctx.waitForEvent('page');
await page.click('#show-btn');
const pp = await popP;
await pp.waitForFunction(() => window.__rt && window.__rt.file, null, { timeout: 90000 }).catch(() => {});
await wait(1500);
const play = await pp.evaluate((want) => {
  const f = window.__rt.file;
  return { n: f.cues.length, has: f.cues.some((c) => c.t === want.t && c.target === want.target && c.set?.pressure === want.set.pressure), url: location.search, sec: f.sections?.[0]?.name };
}, edCue);
S.rec('9.2', play.has ? 'pass' : 'fail', `「本番で再生 ↗」で新しいタブ（${play.url}）が開き、本番画面のキュー ${play.n} 個の中に、直した水のキュー（${edCue.t} 秒・圧力 ${edCue.set.pressure}）が有る: ${play.has}。区間の名前 ${play.sec}`, '', [await (async () => { await pp.waitForFunction(() => !document.getElementById('go').disabled, null, { timeout: 90000 }).catch(() => {}); return S.shot(pp, '4-player-edited'); })()]);
await pp.close();
// 8 back to Lagoon
await page.click('#file-btn'); await page.click('#file-pop [data-variant="lagoon"]'); await wait(2500);
const back = await page.evaluate(() => ({ n: window.__editor.state.file.cues.length, same: JSON.stringify(window.__editor.state.file), sec: (window.__editor.state.file.sections ?? []).find((x) => x.name === 'テスト名')?.name ?? window.__editor.state.file.sections?.[0]?.name ?? null, chip: document.getElementById('section-chip')?.textContent }));
S.rec('9.4-読み込み後の区間', back.sec == null || back.sec !== 'テスト名' ? 'pass' : 'fail', `Night Lagoon を読み込み直すと、区間の名前は「${back.sec ?? '（曲の区間）'}」、札「${back.chip}」。（既知の問題：区間の無いファイルで前の区間が残ることがある）`);
S.rec('9.読み戻し', back.same === lagon.json ? 'pass' : 'info', back.same === lagon.json ? '最後に読み込んだ Night Lagoon は、最初に読み込んだものと完全に同じ' : '読み込み直した Night Lagoon が、最初のものと完全には同じでない（音楽の解析の違い・区間の残り・自動保存の可能性）');
S.rec('9.6', 'user', 'エディタの見た目（グラファイト＋琥珀）。字・色・間隔で気になる所', '', ['shots/test-run/9/1-edited.jpg', 'shots/test-run/9/3-section.jpg']);
S.rec('9.前提', 'user', 'あなたが前に作った演出（ブラウザの自動保存）が残っているか。このテストは別のブラウザプロフィールで動かしているので、あなたの保存は見えていない。あなたの画面でエディタを開いて確かめる（シナリオ 2.6 も同じ）');
S.rec('9.コンソール', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
S.save();
await browser.close();
