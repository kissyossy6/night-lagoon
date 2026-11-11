import { open, scenario, openEditor, wait } from './lib.mjs';
const S = scenario(2, '前からある2つの版が変わっていない');
const { browser, page, errors } = await open({ w: 1440, h: 900 });
await openEditor(page, 'fresh');
const out = [];
for (const v of ['lagoon', 'fantasia', 'hanabi']) {
  await page.click('#file-btn'); await page.click(`#file-pop [data-variant="${v}"]`); await wait(2500);
  await page.click('.ws-tabs .tab[data-tab="all"]'); await wait(500);
  const info = await page.evaluate(() => { const e = window.__editor; const f = e.state.file; return { n: f.cues.length, pyro: f.cues.filter((c) => c.fire).length, lanes: e.lanes().map((l) => l.name).join('・'), dur: f.duration }; });
  out.push([v, info, await S.shot(page, `editor-${v}`)]);
}
const name = { lagoon: 'Night Lagoon', fantasia: 'ファンタジア版', hanabi: '花火版' };
S.rec('2.5', out[0][1].pyro === 0 && out[1][1].pyro === 0 && out[2][1].pyro > 0 && out[0][1].lanes === out[1][1].lanes ? 'pass' : 'fail', 'エディタ「ファイル ▾」から読み込んだ：' + out.map(([v, i]) => `${name[v]} キュー ${i.n}・花火 ${i.pyro}・長さ ${i.dur.toFixed(0)} 秒`).join('／') + `。レーン（Night Lagoon）: ${out[0][1].lanes}`, 'キューの数は音楽の解析のあとの数（会場の画面は解析前の 430／539／447 と数える）。「前と同じ並びか」はあなたが画面で見る', out.map((x) => x[2]));
S.rec('2.6', 'user', 'あなたが前に作った演出（ブラウザの自動保存）が同じに見えるか。このテストは別のブラウザプロフィールで動かしていて、あなたの自動保存は見えない。あなたの画面でエディタを開いて確かめる');
S.rec('2.エディタコンソール', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
S.save({}, 'b');
await browser.close();
