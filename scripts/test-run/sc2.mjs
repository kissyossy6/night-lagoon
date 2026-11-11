import { open, scenario, wait, BASE } from './lib.mjs';
const S = scenario(2, '前からある2つの版が変わっていない');
const { browser, page, errors } = await open({ w: 1024, h: 576 });
async function frame(qs, name) {
  await page.goto(`${BASE}/play.html?${qs}&shot=1`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  return S.shot(page, name);
}
const lag = [10, 45, 63, 67.9, 92, 106.6, 130, 163, 175.5, 178.6, 206];
const lagShots = [];
for (const t of lag) lagShots.push([t, await frame(`t=${t}`, `lagoon-${t}`)]);
S.rec('2.1', 'user', 'Night Lagoon の11の時刻を撮った（全部入りの画質）。前の印象と同じかは、あなたが見て決める', '', lagShots.map((x) => x[1]));
const fan = [[20, '水幕'], [62.53, 'ウィップのシアン扇'], [65.5, '静けさ'], [66.03, 'ピンクに持ち上げ']];
const fanShots = [];
for (const [t] of fan) fanShots.push([t, await frame(`show=fantasia&t=${t}`, `fantasia-${t}`)]);
S.rec('2.2', 'user', 'ファンタジア版の 20・62.53・65.5・66.03 秒を撮った。動きが前と同じかは、あなたが見て決める（ウィップの見え方だけは 11/06 に意図して変えた）', '', fanShots.map((x) => x[1]));
// 2.3 no firework cue in lagoon / fantasia
const counts = await page.evaluate(async () => {
  const { buildShow } = await import('/src/show/choreography.ts');
  const out = {};
  for (const v of ['lagoon', 'fantasia', 'hanabi']) {
    const f = buildShow(undefined, v);
    const cues = f.cues ?? [];
    out[v] = { cues: cues.length, pyro: cues.filter((c) => c.fire).length };
  }
  return out;
});
S.rec('2.3', counts.lagoon.pyro === 0 && counts.fantasia.pyro === 0 && counts.hanabi.pyro > 0 ? 'pass' : 'fail',
  `花火のキューの数: Night Lagoon ${counts.lagoon.pyro}／ファンタジア ${counts.fantasia.pyro}／花火版 ${counts.hanabi.pyro}（全キュー ${counts.lagoon.cues}／${counts.fantasia.cues}／${counts.hanabi.cues}）`);
// 2.4 gfx=off vs default
const offShots = [];
for (const [qs, name] of [['t=130', 'lagoon-130'], ['t=178.6', 'lagoon-178.6'], ['show=fantasia&t=20', 'fantasia-20'], ['show=fantasia&t=66.03', 'fantasia-66.03']]) {
  offShots.push(await frame(`${qs}&gfx=off`, `${name}-gfxoff`));
}
S.rec('2.4', 'user', '`?gfx=off` で同じ4時刻を撮った。全部入りとの違いが水面・着水・水幕の質感だけか、あなたが見て決める（色・時刻・振付は同じはず）', '', offShots);
S.rec('2.コンソール', errors.length ? 'fail' : 'pass', errors.length ? 'エラー: ' + errors.slice(0, 3).join(' | ') : '15コマ+の読み込みでコンソールのエラー 0');
S.save({ lagShots, fanShots });
await browser.close();
