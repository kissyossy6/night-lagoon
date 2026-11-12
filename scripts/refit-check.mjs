/**
 * 会場に合わせて組み替える (src/venues/refit.ts): Rhapsody in Blue (the lake)
 * aimed again for every smaller built-in venue. Counts the cues that move
 * nothing before and after, which groups stood in, what was left, and checks
 * the rules: times, colours and the cues that already worked are unchanged,
 * every new target is in the venue, and a few places map as they should
 * (the middle band → the middle row; on a one-line desk, the whole line).
 *
 *   node scripts/refit-check.mjs    (needs the dev server on :5199)
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5199';
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
};

const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--mute-audio'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/play.html?shot=1&t=0`);

const r = await page.evaluate(async () => {
  const { refitCues, mapPlaces, writePart } = await import('/src/venues/refit.ts');
  const { getVenue } = await import('/src/venues/index.ts');
  const { MAIN_SHOW } = await import('/src/show/choreography.ts');
  const { buildLayout } = await import('/src/show/layout.ts');
  const { resolveTarget } = await import('/src/show/cues.ts');
  const show = MAIN_SHOW;
  const lake = getVenue('lagoon');
  const out = { cues: show.cues.length, venues: {} };
  for (const id of ['plaza', 'garden', 'desk', 'desk-8']) {
    const v = getVenue(id);
    const { cues, report } = refitCues(show, lake, v);
    const l = buildLayout(v, 'low');
    // times always kept; values kept but for the lean (pan, tilt) and the
    // head macros, which only a stand-in that cannot lean leaves out
    const HEAD = ['sway', 'spread', 'lean', 'bloom'];
    const noHead = (set) => JSON.stringify(Object.fromEntries(Object.entries(set ?? {}).filter(([k]) => k !== 'pan' && k !== 'tilt')));
    const same = cues.every((c, i) => {
      const o = show.cues[i];
      if (c.t !== o.t) return false;
      if (c === o) return true;
      const macroOk = c.macro === o.macro || (!c.macro && HEAD.includes(o.macro));
      return macroOk && noHead(c.set) === noHead(o.set);
    });
    // a stand-in group whose heads do not move gets no lean
    const fixedLean = cues.filter((c, i) => {
      if (c === show.cues[i]) return false;
      const fixed = c.target.split(',').some((p) => {
        const g = p.replace(/\[.*$/, '');
        const fx = l.groups[g]?.[0];
        return fx !== undefined && l.fixtures[fx]?.type !== 'oscillating' && !show.cues[i].target.split(',').some((q) => q.replace(/\[.*$/, '') === g);
      });
      return fixed && (c.set?.pan !== undefined || c.set?.tilt !== undefined || HEAD.includes(c.macro));
    }).length;
    // a target that names a group or a place the venue does not have
    const bad = cues.filter((c, i) => c !== show.cues[i] && resolveTarget(c.target, l).length === 0).length;
    out.venues[id] = { ...report, same, bad, fixedLean, kept: cues.filter((c, i) => c === show.cues[i]).length };
  }
  // places: the lake's middle band of the grid → the plaza's middle row; on the desk, the whole line
  const L = buildLayout(lake, 'low');
  const pos = (l, g) => l.groups[g].map((i) => l.fixtures[i].position);
  const P = buildLayout(getVenue('plaza'), 'low');
  const D = buildLayout(getVenue('desk-8'), 'low');
  const mid = Array.from({ length: 88 }, (_, i) => 88 + i);
  const left = Array.from({ length: 12 }, (_, i) => i);
  out.midPlaza = writePart('grid', mapPlaces(pos(L, 'grid'), mid, pos(P, 'grid')), 36);
  out.midDesk = writePart('grid', mapPlaces(pos(L, 'grid'), mid, pos(D, 'grid')), 8);
  out.whipLeftPlaza = writePart('whip', mapPlaces(pos(L, 'whip'), left, pos(P, 'whip')), 8);
  out.plazaRows = ['前列', '中列', '後列'].map((n) => P.selections[n]);
  return out;
});

console.log(`Rhapsody in Blue: ${r.cues} cues`);
for (const [id, v] of Object.entries(r.venues)) {
  console.log(`\n${id}: 動かない ${v.noneBefore} → ${v.noneAfter}、組み替えた ${v.changed}、そのまま ${v.kept}`);
  console.log(`  代わり：${v.swaps.map((s) => `${s.from}→${s.to} ${s.n}`).join('・') || 'なし'}`);
  console.log(`  借りる群が動いていて入れなかった：${v.busy}、首振りだけで入れなかった：${v.headOnly}`);
  console.log(`  代わりが無く残した：${v.left.map((s) => `${s.group} ${s.n}`).join('・') || 'なし'}`);
  ok(v.same, `${id}：時刻は元のまま、値も首の傾き以外は元のまま`);
  ok(v.fixedLean === 0, `${id}：首の動かない代わりの機材に、傾き・首振りを渡していない（${v.fixedLean}）`);
  ok(v.bad === 0, `${id}：組み替えたキューは全部この会場の台を狙う`);
  ok(v.noneAfter < v.noneBefore, `${id}：動かないキューが減った（${v.noneBefore} → ${v.noneAfter}）`);
}
console.log(`\nplaza rows: ${r.plazaRows.join(' / ')}`);
ok(r.midPlaza === r.plazaRows[1], `湖の中帯 → 広場の中列（${r.midPlaza}）`);
ok(r.midDesk === 'grid', `湖の中帯 → 一列の机では列全体（${r.midDesk}）`);
ok(/^whip\[0-[34]\]$/.test(r.whipLeftPlaza), `湖の左の首振り12台 → 広場の左半分（${r.whipLeftPlaza}）`);
// the editor: 会場 ▾ → 広場, the question accepted, ⌘Z twice (the refit, then the switch)
{
  const ed = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  ed.on('pageerror', (e) => errors.push(String(e)));
  let asked = '';
  ed.on('dialog', (d) => {
    asked = d.message();
    void d.accept();
  });
  await ed.goto(`${BASE}/edit.html?fresh`);
  await ed.waitForFunction(() => window.__editorReady === true, null, { timeout: 90000 });
  await ed.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 90000 }).catch(() => {});
  const before = await ed.evaluate(() => JSON.stringify(window.__editor.state.file.cues));
  await ed.click('#venue-btn');
  await ed.locator('#venue-pop button', { hasText: '広場の床噴水' }).click();
  await ed.waitForTimeout(300);
  const after = await ed.evaluate(() => ({ venue: window.__editor.state.file.venue, cues: JSON.stringify(window.__editor.state.file.cues), toast: document.getElementById('toast').textContent }));
  ok(/組み替えますか/.test(asked), `会場を変えると、組み替えるか聞く`);
  ok(after.venue === 'plaza' && after.cues !== before, `組み替えた（${after.toast.slice(0, 80)}…）`);
  await ed.keyboard.press('ControlOrMeta+z');
  await ed.waitForTimeout(150);
  const undo1 = await ed.evaluate(() => ({ venue: window.__editor.state.file.venue, cues: JSON.stringify(window.__editor.state.file.cues) }));
  ok(undo1.venue === 'plaza' && undo1.cues === before, '⌘Z 1回で組み替えだけ戻る（会場は広場のまま）');
  await ed.keyboard.press('ControlOrMeta+z');
  await ed.waitForTimeout(150);
  ok((await ed.evaluate(() => window.__editor.state.file.venue ?? 'lagoon')) === 'lagoon', '⌘Z 2回で会場も湖に戻る');
  await ed.close();
}
ok(errors.length === 0, `ページのエラーなし${errors.length ? '：' + errors.slice(0, 2).join(' / ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
