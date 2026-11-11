import { open, scenario, openEditor, wait, ROOT } from './lib.mjs';
import { readdirSync, readFileSync, unlinkSync, statSync } from 'node:fs';
const S = scenario(16, '実機向けに書き出す（5形式）');
const { browser, page, errors } = await open({ w: 1440, h: 900 });
const dir = ROOT + 'exports/control/';
const created = [];
const snap = () => new Set(readdirSync(dir));
await openEditor(page, 'fresh', 'hanabi');
// 16.1 menu
await page.click('#cx-btn');
const items = await page.$$eval('#cx-pop button', (bs) => bs.map((b) => b.textContent.trim()));
const shotMenu = await S.shot(page, '1-menu');
await page.keyboard.press('Escape'); await page.mouse.click(700, 120);
const want = ['チャンネル CSV', 'DMX の割り当て表', 'キュー表', '花火の点火表', 'DMX の記録', 'Art-Net で送る', '動画・Vision Pro'];
const missing = want.filter((w) => !items.some((i) => i.includes(w)));
S.rec('16.1', missing.length === 0 ? 'pass' : 'fail', `「書き出し ▾」の項目: ${items.join('｜')}${missing.length ? '（足りない: ' + missing.join('・') + '）' : ''}`, '', [shotMenu]);
async function exportOne(id, { from, to, fps, tc, shot } = {}) {
  const before = snap();
  await page.click('#cx-btn');
  await page.click(`#cx-pop button[data-id="${id}"]`); await wait(400);
  if (from != null) { await page.check('input[name="cx-range"][value="part"]'); await page.fill('#cx-from', String(from)); await page.fill('#cx-to', String(to)); }
  if (fps) await page.selectOption('#cx-fps', String(fps));
  if (tc) await page.fill('#cx-tc', tc);
  await page.dispatchEvent('#cx-form', 'input'); await wait(400);
  const info = { note: (await page.textContent('#cx-note')).replace(/\s+/g, ' '), shotBefore: shot ? await S.shot(page, shot + '-dialog') : null };
  await page.click('#cx-go');
  const t0 = Date.now();
  await page.waitForFunction(() => !document.getElementById('cx-done').hidden || !document.getElementById('cx-error').hidden, null, { timeout: 240000 });
  info.secs = (Date.now() - t0) / 1000;
  info.state = (await page.textContent('#cx-state')).replace(/\s+/g, ' ');
  info.err = await page.evaluate(() => (document.getElementById('cx-error').hidden ? '' : document.getElementById('cx-error').textContent));
  info.reveal = await page.evaluate(() => !document.getElementById('cx-done').hidden && !!document.getElementById('cx-reveal'));
  info.shotAfter = shot ? await S.shot(page, shot + '-done') : null;
  info.files = readdirSync(dir).filter((f) => !before.has(f));
  created.push(...info.files);
  await page.click('#cx-cancel');
  return info;
}
const csv = (f) => readFileSync(dir + f, 'utf8');
// 16.2 patch
const P = await exportOne('dmx-patch', { shot: '2-patch' });
const pt = csv(P.files[0]); const pl = pt.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
const ph = pl[0].split(',');
const uniCol = ph.findIndex((h) => /ユニバース|universe/i.test(h)); const addrCol = ph.findIndex((h) => /開始|address|番地|アドレス/i.test(h));
const unis = new Set(pl.slice(1).map((r) => r.split(',')[uniCol]));
S.rec('16.2', P.files.length === 1 && !P.err && pl.length - 1 >= 300 && /[ぁ-んァ-ン一-龠]/.test(pt) ? 'pass' : 'fail', `DMX の割り当て表：${P.files[0]}（${(statSync(dir + P.files[0]).size / 1e3).toFixed(0)} KB）、1台1行で ${pl.length - 1} 行、ユニバース ${[...unis].join(',')}（${unis.size} 個）、先頭に UTF-8 の BOM ${pt.charCodeAt(0) === 0xfeff ? 'あり' : 'なし'}、日本語 ${/[ぁ-んァ-ン一-龠]/.test(pt) ? 'あり' : 'なし'}。見出し「${pl[0].slice(0, 80)}」1行目「${pl[1].slice(0, 80)}」。画面の言葉「${P.note}」`, 'Excel など実際の表計算ソフトで開いたときの見え方は、あなたの目で（BOM 付きの UTF-8 なので多くのソフトで文字化けしない作り）', [P.shotAfter]);
// 16.3 cue sheet
const Q = await exportOne('cue-sheet', { shot: '3-cuesheet' });
const ql = csv(Q.files[0]).replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
const nCues = await page.evaluate(() => window.__editor.state.file.cues.length);
S.rec('16.3', Q.files.length === 1 && ql.length - 1 === nCues ? 'pass' : 'fail', `キュー表：${Q.files[0]}、1キュー1行で ${ql.length - 1} 行（演出のキュー ${nCues}）。見出し「${ql[0].slice(0, 80)}」。3行目「${ql[3]?.slice(0, 120)}」`, '', [Q.shotAfter]);
const qtimes = ql.slice(1).map((r) => r.split(',')[0]); 
// 16.4 pyro (hanabi)
const Y = await exportOne('pyro-csv', { shot: '4-pyro' });
const yl = csv(Y.files[0]).replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
S.rec('16.4', Y.files.length === 1 && yl.length - 1 > 10 ? 'pass' : 'fail', `花火の点火表（花火版）：${Y.files[0]}、玉 ${yl.length - 1} 発。見出し「${yl[0].slice(0, 100)}」。1行目「${yl[1]?.slice(0, 140)}」`, '', [Y.shotAfter]);
// 16.5 channels csv 10-20 40fps
const C = await exportOne('channels-csv', { from: 10, to: 20, fps: 40, shot: '5-channels' });
const cl = csv(C.files[0]).split(/\r?\n/).filter(Boolean);
const cols = cl[0].split(',');
const t1 = Number(cl[1].split(',')[0]), t2 = Number(cl[2].split(',')[0]);
const tcs = [cl[1].split(',')[1], cl[2].split(',')[1], cl.at(-1).split(',')[1]];
S.rec('16.5', C.files.length === 1 && cols[0] === 'time_s' && cols[1] === 'timecode' && /^grid\[0\]\.pressure/.test(cols[2]) && Math.abs(t2 - t1 - 0.025) < 1e-6 && cl.length - 1 >= 400 ? 'pass' : 'fail', `チャンネル CSV 10〜20 秒・40 fps：${C.files[0]}（${(statSync(dir + C.files[0]).size / 1e6).toFixed(1)} MB）、行 ${cl.length - 1}（期待 400 or 401）、列 ${cols.length}。1行目の頭「${cols.slice(0, 4).join(',')}…」、時刻 ${t1} → ${t2}（差 ${(t2 - t1).toFixed(4)} ＝ 1/40 秒）、タイムコード ${tcs.join(' … ')}。画面の言葉「${C.note}」、書き出し ${C.secs.toFixed(1)} 秒`, '', [C.shotAfter]);
// 16.6 dmx record
const D = await exportOne('dmx-record', { from: 10, to: 20, fps: 40, shot: '6-dmxrec' });
const dbuf = readFileSync(dir + D.files[0]);
const headTxt = dbuf.subarray(0, 400).toString('latin1');
const braceOk = headTxt.includes('{') ;
S.rec('16.6', D.files.length === 1 && D.files[0].endsWith('.dmxrec') && braceOk ? 'pass' : 'fail', `DMX の記録 10〜20 秒：${D.files[0]}（${(dbuf.length / 1e6).toFixed(2)} MB）。先頭に説明の JSON ${braceOk ? 'あり' : 'なし'}（「${headTxt.replace(/[^\x20-\x7e]/g, '').slice(0, 140)}」）`, '', [D.shotAfter]);
// 16.7 timecode / fps
const T1 = await exportOne('channels-csv', { from: 10, to: 11, fps: 25, tc: '01:00:00:00' });
const tl = csv(T1.files[0]).split(/\r?\n/).filter(Boolean);
const tcc = [tl[1].split(',').slice(0, 2).join(' '), tl[2].split(',').slice(0, 2).join(' ')];
S.rec('16.7', T1.files.length === 1 && tcs[0] !== tl[1].split(',')[1] && tl.length - 1 >= 25 ? 'pass' : 'fail', `コマ数 25・開始 01:00:00:00 で書き出し：行 ${tl.length - 1}（1秒＝25）、タイムコード列 ${tcc.join(' ／ ')}（40 fps・00:00:00:00 のときは ${tcs[0]}）`);
// 16.8 ideal caution
await page.click('#light-seg button[data-mode="ideal"]'); await wait(800);
await page.click('#cx-btn'); await page.click('#cx-pop button[data-id="dmx-record"]'); await wait(500);
await page.dispatchEvent('#cx-form', 'input'); await wait(300);
const idealNote = (await page.textContent('#cx-note')).replace(/\s+/g, ' ');
const shotIdeal = await S.shot(page, '7-ideal-caution');
await page.click('#cx-cancel');
await page.click('#light-seg button[data-mode="real"]');
S.rec('16.8', /255/.test(idealNote) || /1 を超え/.test(idealNote) ? 'pass' : 'fail', `照明を「理想」にして「DMX の記録」の画面を開く：「${idealNote}」`, '', [shotIdeal]);
S.rec('16.9', P.reveal && C.reveal && C.state ? 'pass' : 'fail', `書き出し中・後の表示：「${C.state}」。完了後に「Finder で表示」のボタンが出る: ${C.reveal}（押すと Finder が開くので、この確認では押していない）`);
S.rec('16.10', 'user', '書き出し画面の言葉（形式の説明・範囲・タイムコード）が分かりやすいか。画面 5-channels-dialog・2-patch-dialog', '', ['shots/test-run/16/5-channels-dialog.jpg', 'shots/test-run/16/2-patch-dialog.jpg']);
S.rec('16.前提-前のファイル', 'info', 'exports/control/ は、この確認の前は空だった（前の 5 ファイルは以前の確認の後片付けで消えている）。「同じ名前は -2 を付けて書く」は、同じ設定で2回書き出して確かめる ↓');
const D2 = await exportOne('channels-csv', { from: 10, to: 20, fps: 40 });
S.rec('16.同名', D2.files[0] && /-2/.test(D2.files[0]) ? 'pass' : 'fail', `同じ設定でもう一度「チャンネル CSV」：新しいファイル ${D2.files[0]}（-2 が付いて、上書きしない）`);
for (const f of created) { try { unlinkSync(dir + f); } catch {} }
S.rec('16.後片付け', 'info', `この確認で書いた ${created.length} ファイルを消した: ${created.join(', ')}`);
S.rec('16.コンソール', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
S.save();
await browser.close();
