/**
 * Venue / named-target check (stage 1). Needs the dev server on :5199.
 *
 *   node scripts/venue-check.mjs
 *
 * Compiles throwaway cues in the browser (nothing is saved) and fails unless
 * '@前列' moves exactly the fixtures 'grid[0-87]' does, inside lists too,
 * and the built-in shows compile the same as with the plain lagoon layout.
 *
 * Parts (stage 5, src/venues/parts.ts): the lagoon written as parts gives the
 * same numbers as the shape calls it was written with by hand, and 外す /
 * ずらす / names / slanted bands do what they say.
 *
 * Rules (src/venues/rules.ts): each rule fires on a venue made to break it,
 * on single fixtures too, and the lagoon has no 止める.
 */
import { chromium } from 'playwright';

const launch = { headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage();
await page.goto('http://localhost:5199/lab.html');
const res = await page.evaluate(async () => {
  const { buildLayout } = await import('/src/show/layout.ts');
  const { compileShow, resolveTarget } = await import('/src/show/cues.ts');
  const { getVenue, LAGOON } = await import('/src/venues/index.ts');
  const layout = buildLayout(LAGOON, 'low');
  const file = (target) => ({
    title: 'check', bpm: 120, beatsPerBar: 4, offset: 0, duration: 10,
    cues: [{ t: 1, target, set: { pressure: 0.8, color: '#ff0000' }, dur: 0.5, stagger: 0.02, order: 'center' }],
  });
  // what one cue sets, fixture by fixture (the cue index is the same in both)
  const moves = (target) => JSON.stringify(compileShow(file(target), layout).plain);
  const ids = (t) => resolveTarget(t, layout);
  const withNested = { ...layout, selections: { ...layout.selections, 前と鞭: '@前列,whip', 輪: '@輪', 深い: '@深い2', 深い2: '@深い3', 深い3: '@深い4', 深い4: '@深い5', 深い5: 'fan' } };
  return {
    frontSame: moves('@前列') === moves('grid[0-87]'),
    frontCount: ids('@前列').length,
    listSame: JSON.stringify(ids('@前列,whip')) === JSON.stringify(ids('grid[0-87],whip')),
    nestedSame: JSON.stringify(resolveTarget('@前と鞭', withNested)) === JSON.stringify(ids('grid[0-87],whip')),
    loopStops: resolveTarget('@輪', withNested).length === 0,
    tooDeep: resolveTarget('@深い', withNested).length,
    unknownEmpty: ids('@ない名前').length === 0,
    everyPreset: LAGOON.selections.every((s) => JSON.stringify(ids('@' + s.name)) === JSON.stringify(ids(s.target))),
    editorLane: (await import('/src/editor/model.ts')).laneOf({ t: 0, target: '@左アーク' }),
    defaultVenue: getVenue() === LAGOON && getVenue('nowhere') === LAGOON && buildLayout().venue === LAGOON,
    parts: await (async () => {
      const { arc, band, line } = await import('/src/venues/shapes.ts');
      const { buildVenue, VENUES } = await import('/src/venues/index.ts');
      const exact = (a, b) => a.length === b.length && a.every((p, i) => p.every((v, j) => Object.is(v, b[i][j])));
      // the lagoon's fixtures as the hand-written lagoon.ts placed them
      const hand = {
        grid: [...band(88, -52.5, 52.5, 15.5, 2.44), ...band(88, -52.5, 52.5, 13.06, 2.44), ...band(88, -52.5, 52.5, 10.62, 2.44)],
        whip: line(24, -55, 55, 6),
        chaser: [...arc(20, -34, 0, 14, Math.PI * 0.15, Math.PI * 0.85), ...arc(20, 34, 0, 14, Math.PI * 0.15, Math.PI * 0.85), ...arc(16, 0, -2, 7, 0, (Math.PI * 2 * 15) / 16)],
        fan: line(12, -50, 50, 1),
        flower: line(6, -45, 45, -6),
        geyser: line(10, -54, 54, -11),
      };
      const doc = (parts, selections) => ({ id: 't', name: 't', scale: 'garden', water: { kind: 'infinite' }, parts, selections });
      const row = { kind: 'line', group: 'g', fixture: 'grid', count: 5, from: [0, 0], to: [4, 0] };
      const t = (v, target) => v.selections.find((s) => s.target === target)?.name;
      const two = buildVenue(doc([{ ...row, name: 'A' }, { ...row, name: 'B', from: [0, 2], to: [4, 2] }, { ...row, group: 'h', name: 'C' }], [{ name: 'B', target: 'g[0-1]' }]));
      const slant = buildVenue(doc([{ kind: 'band', group: 'g', fixture: 'grid', count: 3, from: [0, 0], to: [3, 4], pitch: 2 }])).groups[0].positions;
      let mixed = false;
      try { buildVenue(doc([row, { ...row, fixture: 'whip' }])); } catch { mixed = true; }
      return {
        lagoonSame: Object.entries(hand).every(([g, pos]) => exact(LAGOON.groups.find((x) => x.name === g).positions, pos)) && LAGOON.groups.map((g) => g.name).join() === Object.keys(hand).join(),
        lagoonOnce: VENUES.lagoon === LAGOON,
        skip: JSON.stringify(buildVenue(doc([{ ...row, skip: [1, 3] }])).groups[0].positions.map((p) => p[0])) === '[0,2,4]',
        nudge: JSON.stringify(buildVenue(doc([{ ...row, nudge: [{ i: 2, by: [0.5, -1] }] }])).groups[0].positions[2]) === '[2.5,0,-1]',
        autoName: t(two, 'g[0-4]') === 'A' && t(two, 'g[5-9]') === undefined && t(two, 'h') === 'C' && t(two, 'g[0-1]') === 'B',
        slant: Math.abs(Math.hypot(slant[1][0] - 1.5, slant[1][2] - 2) - 1) < 1e-12 && slant[1][2] < 2,
        mixed,
      };
    })(),
    rules: await (async () => {
      const { buildVenue, VENUE_DOCS } = await import('/src/venues/index.ts');
      const { checkVenue } = await import('/src/venues/rules.ts');
      const rect = { kind: 'rect', width: 40, depth: 20 };
      const seats = { kind: 'seats', from: [-20, 12], to: [20, 12] };
      const run = (parts, water = rect, scale = 'plaza') => {
        const doc = { id: 't', name: 't', scale, water, parts };
        return checkVenue(doc, buildVenue(doc)).map((f) => `${f.level}:${f.rule}`);
      };
      const has = (list, x) => list.includes(x);
      const g = (from, to, count, more = {}) => ({ kind: 'line', group: 'grid', fixture: 'grid', count, from, to, ...more });
      const lagoon = VENUE_DOCS.find((d) => d.id === 'lagoon');
      const lag = checkVenue(lagoon, buildVenue(lagoon));
      return {
        clean: run([seats, g([-3, 0], [3, 0], 6)], { kind: 'rect', width: 60, depth: 40 }).length === 0,
        outside: has(run([seats, g([10, 0], [30, 0], 11)]), 'stop:outside'),
        singleOutside: has(run([seats, { kind: 'single', group: 'grid', fixture: 'grid', at: [25, 0] }]), 'stop:outside'),
        ground: has(run([seats, { kind: 'pyro', site: 'a', on: 'land', tubes: 3, from: [-2, -5], to: [2, -5], height: 1 }]), 'stop:ground')
          && has(run([seats, { kind: 'pyro', site: 'b', on: 'barge', tubes: 3, from: [-2, -50], to: [2, -50], height: 1 }]), 'stop:ground'),
        overlap: has(run([seats, g([-2, 0], [2, 0], 9)]), 'stop:overlap'),
        samespot: has(run([seats, { kind: 'single', group: 'grid', fixture: 'grid', at: [0, 0] }, { kind: 'single', group: 'whip', fixture: 'whip', at: [0.05, 0] }]), 'stop:samespot'),
        close: has(run([seats, { kind: 'single', group: 'grid', fixture: 'grid', at: [0, 0] }, { kind: 'single', group: 'whip', fixture: 'whip', at: [0.3, 0] }]), 'note:close'),
        pyroSafety: has(run([seats, { kind: 'pyro', site: 'c', on: 'barge', tubes: 3, from: [-2, -5], to: [2, -5], height: 1 }]), 'danger:pyroSafety'),
        burst: has(run([{ kind: 'seats', from: [-20, 400], to: [20, 400] }, { kind: 'screen', fixture: 'screen', center: [0, -5], width: 30, height: 120 }, { kind: 'pyro', site: 'd', on: 'barge', tubes: 1, from: [0, -5], to: [0, -5], height: 1 }], { kind: 'infinite' }), 'danger:burst'),
        spray: has(run([seats, { kind: 'single', group: 'whip', fixture: 'whip', at: [0, 0] }], { kind: 'infinite' }), 'danger:spray'),
        spill: has(run([seats, g([-3, -8], [3, -8], 6)], { kind: 'rect', width: 10, depth: 20 }), 'note:spill'),
        pump: has(run([seats, g([-3, 0], [3, 0], 6)], rect, 'garden'), 'note:pump'),
        noSeats: has(run([g([-3, 0], [3, 0], 6)]), 'note:noSeats'),
        lagoonStops: lag.filter((f) => f.level === 'stop').length,
        lagoonList: lag.map((f) => `${f.level}:${f.rule}`).join(' '),
      };
    })(),
  };
});
let bad = 0;
const ok = (c, msg) => (console.log(`${c ? 'ok  ' : 'FAIL'}  ${msg}`), c || bad++);
ok(res.frontSame, `'@前列' compiles to the same fixture moves as 'grid[0-87]' (${res.frontCount} fixtures)`);
ok(res.frontCount === 88, 'front row is 88 fixtures');
ok(res.listSame, "'@前列,whip' = 'grid[0-87],whip'");
ok(res.nestedSame, 'a selection naming another resolves through it');
ok(res.loopStops, 'a selection naming itself stops (empty)');
ok(res.tooDeep === 0, 'nesting deeper than 4 stops (empty)');
ok(res.unknownEmpty, 'an unknown name resolves to nothing');
ok(res.everyPreset, 'every lagoon selection matches its plain target');
ok(res.editorLane === 2, `the editor puts an '@左アーク' cue in the chaser lane (lane ${res.editorLane})`);
ok(res.defaultVenue, 'missing / unknown venue ids give the lagoon');
ok(res.parts.lagoonSame, 'the lagoon written as parts places every fixture where the hand-written lagoon did (bit for bit)');
ok(res.parts.lagoonOnce, 'VENUES.lagoon is LAGOON (built once)');
ok(res.parts.skip, '外す: skipped fixtures are gone and the rest renumber');
ok(res.parts.nudge, 'ずらす: one fixture moves by [dx, dz]');
ok(res.parts.autoName, "a part's name becomes a selection unless its name is taken; a whole-group part names the group");
ok(res.parts.slant, 'a slanted band staggers square to its row, behind it');
ok(res.parts.mixed, 'two kinds in one group stop with a message');
const R = res.rules;
ok(R.clean, 'rules: a small grid well inside the water, seats in front: no warnings');
ok(R.outside && R.singleOutside, 'rules: 水の外 stops a row and a single fixture outside the water');
ok(R.ground, 'rules: 置き場の違い stops land tubes on the water and barge tubes off it');
ok(R.overlap, 'rules: 重なり stops grids closer than 1.2 m');
ok(R.samespot, 'rules: 同じ場所 stops two kinds on one spot');
ok(R.close, 'rules: 近すぎ notes two kinds 0.3 m apart');
ok(R.pyroSafety, 'rules: 花火の保安距離 is red for a barge 17 m from the seats');
ok(R.burst, 'rules: 花火が水幕にかかる is red for a 120 m screen over the tube');
ok(R.spray, 'rules: 水が客席に届く is red for a whip 12 m from the seats');
ok(R.spill, 'rules: 水盤の外に落ちる notes 12 m grids 2 m from the rim');
ok(R.pump, 'rules: ポンプの合計 notes lagoon grids in a garden');
ok(R.noSeats, 'rules: 客席が無い notes a venue without seats');
ok(R.lagoonStops === 0, `rules: the lagoon has no 止める (${R.lagoonList})`);

// --- sample venues (B6) and 動かないキュー (B4, src/venues/cues.ts)
const S = await page.evaluate(async () => {
  const { VENUE_DOCS, VENUES, LAGOON, buildVenue } = await import('/src/venues/index.ts');
  const { checkVenue } = await import('/src/venues/rules.ts');
  const { cueReach } = await import('/src/venues/cues.ts');
  const { buildShow } = await import('/src/show/choreography.ts');
  const samples = ['desk', 'garden', 'plaza'].map((id) => {
    const d = VENUE_DOCS.find((x) => x.id === id);
    const f = d ? checkVenue(d, VENUES[id]) : null;
    return { id, scale: d?.scale, found: !!d, warn: f ? f.map((x) => x.rule).join() : 'missing' };
  });
  const show = buildShow();
  const hanabi = buildShow(undefined, 'hanabi');
  const same = cueReach(show, LAGOON, buildVenue(VENUE_DOCS.find((x) => x.id === 'lagoon')));
  const desk = cueReach(show, LAGOON, VENUES.desk);
  const deskPyro = cueReach(hanabi, LAGOON, VENUES.desk);
  const plaza = cueReach(show, LAGOON, VENUES.plaza);
  // 外す one grid of the back row: cues on its last index find one fewer
  const doc = structuredClone(VENUE_DOCS.find((x) => x.id === 'lagoon'));
  doc.parts[2].skip = [87];
  const skipped = cueReach(show, LAGOON, buildVenue(doc));
  const why = (r, t) => r.reasons.find((x) => x.target === t)?.why;
  return {
    samples,
    order: VENUE_DOCS.map((d) => d.id).join(),
    same: same.none + same.part,
    all: same.all,
    desk: [desk.none, desk.part, desk.all],
    deskWhip: why(desk, 'whip'),
    deskRange: why(desk, 'grid[88-175]'),
    deskPyro: deskPyro.reasons.filter((r) => r.why === '花火の台が無い').reduce((a, r) => a + r.n, 0),
    hanabiTubes: hanabi.cues.filter((c) => c.fire).length,
    plazaNone: plaza.none,
    skipped: [skipped.none, skipped.part],
  };
});
for (const x of S.samples) ok(x.found && x.warn === '', `sample venue ${x.id} (${x.scale}) builds with no warnings (${x.warn || 'none'})`);
// 2026-11-12: + desk-8 (the real desk fountain's first build, docs/desk-build.md)
ok(S.order === 'desk-8,desk,garden,plaza,lagoon', `built-in venues list smallest first (${S.order})`);
ok(S.same === 0 && S.all > 400, `動かないキュー: Night Lagoon in the lagoon has none (${S.all} cues)`);
ok(S.desk[0] > 0 && S.desk[1] > 0 && S.desk[0] + S.desk[1] <= S.desk[2], `動かないキュー: the desk tank counts ${S.desk[0]} none / ${S.desk[1]} part of ${S.desk[2]}`);
ok(S.deskWhip === 'グループが無い' && S.deskRange === '番号が範囲の外（18台）', `reasons: whip → ${S.deskWhip}, grid[88-175] → ${S.deskRange}`);
ok(S.deskPyro === S.hanabiTubes && S.hanabiTubes > 0, `花火版 in the desk tank: every fireworks cue has no tubes (${S.deskPyro}/${S.hanabiTubes})`);
ok(S.plazaNone < S.desk[0], `the plaza (whips, 36 grids) loses fewer cues than the desk (${S.plazaNone} < ${S.desk[0]})`);
ok(S.skipped[0] === 0 && S.skipped[1] > 0, `外す one grid: no cue stops, ${S.skipped[1]} move only part of their fixtures`);
await browser.close();
process.exit(bad ? 1 : 0);
