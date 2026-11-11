import { open, scenario, openEditor, wait } from './lib.mjs';
const S = scenario(16, '実機向けに書き出す（5形式）');
const { browser, page, errors } = await open({ w: 1440, h: 900 });
await openEditor(page, 'fresh', 'lagoon');
const notes = {};
for (const mode of ['real', 'ideal']) {
  await page.click(`#light-seg button[data-mode="${mode}"]`); await wait(900);
  for (const range of [[10, 11], [60, 70], null]) {
    await page.click('#cx-btn'); await page.click('#cx-pop button[data-id="dmx-record"]'); await wait(400);
    if (range) { await page.check('input[name="cx-range"][value="part"]'); await page.fill('#cx-from', String(range[0])); await page.fill('#cx-to', String(range[1])); }
    else await page.check('input[name="cx-range"][value="all"]');
    await page.dispatchEvent('#cx-form', 'input'); await wait(500);
    const t = (await page.textContent('#cx-note')).replace(/\s+/g, ' ');
    const caut = await page.$$eval('#cx-note .caution', (e) => e.map((x) => x.textContent));
    notes[`${mode}:${range ? range.join('-') : '全編'}`] = { t, caut };
    if (mode === 'ideal' && range && range[0] === 60) await S.shot(page, '8-ideal-60-70');
    if (mode === 'real' && range && range[0] === 60) await S.shot(page, '8-real-60-70');
    await page.click('#cx-cancel');
  }
}
const lines = Object.entries(notes).map(([k, v]) => `${k}：黄色の注意 ${v.caut.length} 行${v.caut[0] ? '「' + v.caut[0].slice(0, 70) + '」' : ''}`);
const anyCaut = Object.values(notes).some((v) => v.caut.length);
const lightDep = JSON.stringify(Object.entries(notes).filter(([k]) => k.startsWith('real')).map(([, v]) => v.caut)) !== JSON.stringify(Object.entries(notes).filter(([k]) => k.startsWith('ideal')).map(([, v]) => v.caut));
S.rec('16.8', anyCaut ? 'pass' : 'fail', `「DMX の記録」の画面の黄色い注意（255 で止まる 等）：` + lines.join('／') + `。照明の「リアル」「理想」で注意が${lightDep ? '変わる' : '変わらない（値の範囲しだい。照明の切り替えでは変わらない）'}`, '', ['shots/test-run/16/8-ideal-60-70.jpg', 'shots/test-run/16/8-real-60-70.jpg']);
S.save({ notes }, 'b');
await browser.close();
