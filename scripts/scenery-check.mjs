/**
 * The venue's scenery (岸・手すり・客, 2026-11-12): its parts, its rules and
 * what the 3D builds. Needs the dev server on :5199.
 *
 *   node scripts/scenery-check.mjs
 *
 * - a venue file without scenery parts builds as before (no venue.scenery)
 * - the built-in venues: banks, rails and people where meant, no warnings
 *   but the lagoon's own (1 赤・2 黄, as before the scenery)
 * - each scenery rule fires on a venue made to break it
 * - people stand on the bank's height, never over the water; the same file
 *   gives the same people
 * - the 3D builds for every built-in venue (people, rail boxes) and hides
 */
import { chromium } from 'playwright';

const launch = { headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage();
await page.goto('http://localhost:5199/lab.html');
const R = await page.evaluate(async () => {
  const { buildVenue, VENUE_DOCS, VENUES } = await import('/src/venues/index.ts');
  const { checkVenue } = await import('/src/venues/rules.ts');
  const L = await import('/src/venues/landscape.ts');
  const run = (parts, water = { kind: 'rect', width: 40, depth: 20 }, scale = 'lagoon', more = {}) => {
    const doc = { id: 't', name: 't', scale, water, parts, ...more };
    return checkVenue(doc, buildVenue(doc)).map((f) => `${f.level}:${f.rule}`);
  };
  const has = (list, x) => list.includes(x);
  const seats = { kind: 'seats', from: [-20, 12], to: [20, 12] };
  const grid = { kind: 'line', group: 'grid', fixture: 'grid', count: 6, from: [-3, 0], to: [3, 0] };
  const rim = { kind: 'shore', height: 0.8, width: 4 };
  const crowd = (from, to, more = {}) => ({ kind: 'crowd', from, to, depth: 6, density: 2, pose: 'stand', ...more });
  const rail = (z) => ({ kind: 'rail', from: [-20, z], to: [20, z], height: 1.1, spacing: 2 });
  const old = buildVenue({ id: 'o', name: 'o', scale: 'garden', water: { kind: 'circle', radius: 1.5 }, parts: [grid] });
  // people on a rim bank stand on its top; over the water none
  const bank = buildVenue({ id: 'b', name: 'b', scale: 'lagoon', water: { kind: 'rect', width: 40, depth: 20 }, parts: [rim, crowd([-30, 12], [30, 12])] });
  const ppl = L.venuePeople(bank.scenery, bank.water, [0, 0]);
  const again = L.venuePeople(buildVenue({ id: 'b', name: 'b', scale: 'lagoon', water: { kind: 'rect', width: 40, depth: 20 }, parts: [rim, crowd([-30, 12], [30, 12])] }).scenery, bank.water, [0, 0]);
  const wet = buildVenue({ id: 'w', name: 'w', scale: 'lagoon', water: { kind: 'rect', width: 40, depth: 20 }, parts: [rim, crowd([-30, 6], [30, 6])] });
  const builtIn = Object.fromEntries(
    VENUE_DOCS.map((d) => {
      const v = VENUES[d.id];
      const sc = v.scenery;
      return [d.id, { shores: sc?.shores.length ?? 0, rails: sc?.rails.length ?? 0, people: L.venuePeople(sc, v.water, [0, 0]).length, warn: checkVenue(d, v).map((f) => `${f.level}:${f.rule}`).join(' ') }];
    }),
  );
  return {
    oldNone: old.scenery === undefined,
    onBank: ppl.length > 0 && ppl.every((p) => Math.abs(p.y - 0.8) < 1e-9),
    same: JSON.stringify(ppl) === JSON.stringify(again),
    density: ppl.length,
    wetLeft: L.venuePeople(wet.scenery, wet.water, [0, 0]).every((p) => L.sdWater(wet.water, p.x, p.z) > 0),
    railBase: bank.scenery && buildVenue({ id: 'r', name: 'r', scale: 'lagoon', water: { kind: 'rect', width: 40, depth: 20 }, parts: [rim, rail(10.5)] }).scenery.rails[0].base === 0.8,
    rules: {
      clean: run([seats, grid, rim, rail(10.3), crowd([-20, 12.5], [20, 12.5])]).filter((x) => !x.startsWith('note:spill')).join(' '),
      rim: has(run([seats, grid, rim], { kind: 'infinite' }), 'stop:rim'),
      crowdWater: has(run([seats, grid, rim, crowd([-20, 5], [20, 5])]), 'stop:crowdWater'),
      crowdFixture: has(run([seats, crowd([-5, -2], [5, -2]), rim, { kind: 'single', group: 'g', fixture: 'grid', at: [0, 1] }], { kind: 'infinite' }, 'lagoon').concat(run([seats, rim, crowd([-5, 11], [5, 11]), { kind: 'single', group: 'g', fixture: 'grid', at: [0, 13] }])), 'stop:crowdFixture'),
      crowdPyro: has(run([seats, rim, crowd([-20, 12.5], [20, 12.5]), { kind: 'pyro', site: 'p', on: 'land', tubes: 2, from: [-1, 30], to: [1, 30], height: 1 }]), 'danger:crowdPyro'),
      noRail: has(run([seats, grid, rim, crowd([-20, 12.5], [20, 12.5])]), 'note:noRail'),
      noShore: has(run([seats, grid, crowd([-20, 12.5], [20, 12.5])], undefined, 'plaza'), 'note:noShore'),
      railWater: has(run([seats, grid, rim, { kind: 'rail', from: [-5, 3], to: [5, 3], height: 1.1, spacing: 2 }]), 'note:railWater'),
      seatGround: has(run([seats, grid, rim], undefined, 'lagoon', { cameras: [{ id: 'eye', label: '目線', pos: [0, 0.3, 15], target: [0, 5, 0], fov: 50 }] }), 'note:seatGround'),
      // cameras made from the seats stand on the bank, not in it
      autoLifted: buildVenue({ id: 'a', name: 'a', scale: 'lagoon', water: { kind: 'rect', width: 40, depth: 20 }, parts: [seats, grid, rim] }).seats.every((c) => (L.groundAt(bank.scenery, bank.water, c.pos[0], c.pos[2]) ?? -1) < c.pos[1]),
      spray: has(run([rim, { kind: 'single', group: 'whip', fixture: 'whip', at: [0, 0] }, crowd([-5, 11], [5, 11])]), 'danger:spray'),
    },
    builtIn,
  };
});

// the 3D: builds, people drawn, hides
const D = await page.evaluate(async () => {
  const { ShowRuntime } = await import('/src/show/runtime.ts');
  const { projectionScreen } = await import('/src/screen/screen.ts');
  const { VENUES } = await import('/src/venues/index.ts');
  const out = {};
  document.body.innerHTML = '<div id="st" style="position:fixed;inset:0"></div>';
  const rt = new ShowRuntime(document.getElementById('st'), projectionScreen({ width: 256, height: 64, every: 2 }), 'low', 1);
  for (const id of Object.keys(VENUES)) {
    rt.setShow({ title: 't', bpm: 120, beatsPerBar: 4, offset: 0, duration: 10, cues: [], venue: id });
    rt.render(1);
    out[id] = { people: rt.scenery.people, boxes: rt.scenery.posts, parts: rt.scenery.object.children.length + rt.scenery.unreflected.children.length - 1 };
  }
  rt.setScenery(false);
  out.hidden = !rt.scenery.object.visible && !rt.sceneryShown;
  return out;
});
await browser.close();

let bad = 0;
const ok = (c, msg) => (console.log(`${c ? 'ok  ' : 'FAIL'}  ${msg}`), c || bad++);
ok(R.oldNone, 'a venue file without scenery parts has no scenery (old projects open as before)');
ok(R.onBank, `people stand on the bank's top (0.8 m): ${R.density} people`);
ok(R.same, 'the same file gives the same people');
ok(R.wetLeft, 'people over the water are left out');
ok(R.railBase, 'a rail stands on the bank under it');
const rl = R.rules;
ok(rl.clean === '', `rules: bank, rail, crowd behind the seats, nothing else: no scenery warnings (${rl.clean || 'none'})`);
ok(rl.rim, 'rules: a bank round the rim of infinite water stops (縁の無い水面)');
ok(rl.crowdWater, 'rules: people over the water stop (客が水の上)');
ok(rl.crowdFixture, 'rules: a fixture inside a crowd stops (客が機材の上)');
ok(rl.crowdPyro, 'rules: people inside a tube’s safety distance are red (客が保安距離の内側)');
ok(rl.spray, 'rules: a whip whose water reaches the crowd is red (水が客席に届く)');
ok(rl.noRail, 'rules: a crowd at a 0.8 m waterside without a rail is yellow (手すりの無い水際)');
ok(rl.noShore, 'rules: people outside the water with no bank are yellow (岸が無い)');
ok(rl.railWater, 'rules: a rail over the water is yellow (手すりが水の上)');
ok(rl.seatGround, 'rules: a camera under the bank top is yellow (カメラが地面の中)');
ok(rl.autoLifted, 'cameras made from the seats stand on a bank, not inside it');
const B = R.builtIn;
const lagoonOwn = 'danger:spray note:close note:close';
for (const [id, b] of Object.entries(B)) {
  // the lagoon's and desk-8's own warnings were there before the scenery
  const want = id === 'lagoon' ? lagoonOwn : id === 'desk-8' ? 'note:spill' : '';
  ok(b.shores >= 1 && b.warn === want, `built-in ${id}: ${b.shores} bank, ${b.rails} rail, ${b.people} people; warnings: ${b.warn || 'none'}`);
}
ok(B.desk.people === 0 && B['desk-8'].people === 0, 'the desks have no people (their seat is the one person at the desk)');
ok(B.lagoon.people > 2000 && B.lagoon.rails === 1, `the lagoon: ${B.lagoon.people} people behind a rail`);
for (const [id, d] of Object.entries(D)) if (id !== 'hidden') ok(d.parts >= 1, `3D ${id}: ${d.parts} meshes, ${d.people} people, ${d.boxes} rail boxes`);
ok(D.hidden, '3D: setScenery(false) hides it');
process.exit(bad ? 1 : 0);
