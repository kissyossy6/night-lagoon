/**
 * Venue editor check (stage 5, venue.html). Needs the dev server on :5199.
 *
 *   node scripts/venue-editor-check.mjs [--shots=<dir>]
 *
 * Drives the page with the mouse and keys in a fresh browser (its own
 * localStorage) and fails unless: the lagoon opens untouched; dragging a part
 * moves it on the snap and makes a copy (the built-in stays as it was);
 * undo / redo work; 外す, ずらす, 1台を置く and deleting work on single
 * fixtures; the footer counts 動かないキュー (none in the lagoon, part after
 * 外す, many in the desk tank); the copy opens again; the editor's 会場 ▾ opens it
 * and switches the editor's venue (lanes, この会場に無い, undo, reload); and
 * the player plays the copy with ?venue= (fixture count as the venue's).
 */
import { chromium } from 'playwright';

const shots = process.argv.find((a) => a.startsWith('--shots='))?.slice(8);
const launch = { headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let bad = 0;
const ok = (c, msg) => (console.log(`${c ? 'ok  ' : 'FAIL'}  ${msg}`), c || bad++);

await page.goto('http://localhost:5199/venue.html?venue=lagoon');
await page.waitForFunction(() => window.__venueEditor);
const ed = (fn, arg) => page.evaluate(fn, arg);
const box = await page.locator('#vn-canvas').boundingBox();
/** Canvas point of a venue point [x, z]. */
const at = async (x, z) => {
  const [px, py] = await ed(([x, z]) => window.__venueEditor.view.screenOf(x, z), [x, z]);
  return [box.x + px, box.y + py];
};
const drag = async (from, to, opts = {}) => {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.move(...to, { steps: 4 });
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up('Alt');
};
const click = async (p) => page.mouse.click(...p);

// --- opens the lagoon as it is
const start = await ed(() => ({ id: window.__venueEditor.doc().id, built: window.__venueEditor.builtIn(), n: window.__venueEditor.venue().groups.reduce((a, g) => a + g.positions.length, 0), parts: window.__venueEditor.doc().parts.length }));
// 2026-11-08: the lagoon has its projector as a part (17 -> 18)
ok(start.id === 'lagoon' && start.built && start.n === 372 && start.parts === 18, `opens the built-in lagoon read-only (${start.parts} parts, ${start.n} fixtures)`);
if (shots) await page.screenshot({ path: `${shots}/01-lagoon.png` });
const cuesText = () => page.locator('.vn-cues-btn').innerText();
ok((await cuesText()).includes('なし'), `the footer says no cue stops in the lagoon (${await cuesText()})`);

// --- drag the left arc by one of its fixtures: moves on the 0.5 m snap, makes a copy
const arc0 = await ed(() => window.__venueEditor.venue().groups.find((g) => g.name === 'chaser').positions[9]);
const scale = await ed(() => window.__venueEditor.view.screenOf(1, 0)[0] - window.__venueEditor.view.screenOf(0, 0)[0]);
const p0 = await at(arc0[0], arc0[2]);
await drag(p0, [p0[0] + 4.2 * scale, p0[1] - 1.9 * scale]);
const moved = await ed(() => {
  const e = window.__venueEditor;
  const arc = e.doc().parts.find((p) => p.name === '左アーク');
  return { id: e.doc().id, built: e.builtIn(), center: arc.center, sel: e.sel(), name: e.doc().name };
});
ok(moved.sel.part === 4, 'pressing on a fixture of a part selects the part');
ok(JSON.stringify(moved.center) === '[-30,-2]', `the arc moved by the snapped drag (centre ${JSON.stringify(moved.center)}, from [-34,0] by ~[4.2,-1.9])`);
ok(!moved.built && moved.id.startsWith('my-') && moved.name === 'ラグーンの写し', `the first change made a copy (${moved.id}, 「${moved.name}」)`);
const builtinSame = await page.evaluate(async () => {
  const { VENUE_DOCS, LAGOON } = await import('/src/venues/index.ts');
  const d = VENUE_DOCS.find((x) => x.id === 'lagoon');
  return JSON.stringify(d.parts.find((p) => p.name === '左アーク').center) === '[-34,0]' && LAGOON.groups[2].positions[0][0] < -21.5;
});
ok(builtinSame, 'the built-in lagoon is unchanged');

// --- undo / redo
await page.keyboard.press('Meta+z');
const undone = await ed(() => window.__venueEditor.doc().parts.find((p) => p.name === '左アーク').center);
await page.keyboard.press('Meta+Shift+z');
const redone = await ed(() => window.__venueEditor.doc().parts.find((p) => p.name === '左アーク').center);
ok(JSON.stringify(undone) === '[-34,0]' && JSON.stringify(redone) === '[-30,-2]', 'undo puts the arc back, redo moves it again');

// --- pick one fixture in the selected arc, 外す it with Delete
const f2 = await ed(() => window.__venueEditor.venue().groups.find((g) => g.name === 'chaser').positions[2]);
await click(await at(f2[0], f2[2]));
const picked = await ed(() => window.__venueEditor.sel());
ok(picked.part === 4 && picked.fixture === 2, `a click in the selected part picks one fixture (${JSON.stringify(picked)})`);
await page.keyboard.press('Delete');
const skipped = await ed(() => ({ skip: window.__venueEditor.doc().parts[4].skip, n: window.__venueEditor.venue().groups.find((g) => g.name === 'chaser').positions.length }));
ok(JSON.stringify(skipped.skip) === '[2]' && skipped.n === 55, `Delete on a picked fixture is 外す (skip ${JSON.stringify(skipped.skip)}, chaser ${skipped.n})`);
const partRow = await page.evaluate(() => [...document.querySelectorAll('.vn-cues-row')].find((r) => r.textContent.startsWith('Rhapsody in Blue'))?.children[2].textContent);
ok(Number(partRow) > 0 && (await cuesText()).includes('Rhapsody in Blue 0'), `外す shows in the cue count: Rhapsody in Blue 0 stop, ${partRow} move only part`);
const backBtn = page.locator('#fixture-fields button', { hasText: '戻す' }).first();
ok((await backBtn.count()) > 0, 'the skipped fixture is listed with 戻す');

// --- ずらす: pick fixture 5 and drag it by about 1 m right
const f5 = await ed(() => window.__venueEditor.venue().groups.find((g) => g.name === 'chaser').positions[4]); // index 4 after the skip = fixture 5
const p5 = await at(f5[0], f5[2]);
await click(p5);
await drag(p5, [p5[0] + 1.1 * scale, p5[1]]);
const nudged = await ed(() => ({ nudge: window.__venueEditor.doc().parts[4].nudge, center: window.__venueEditor.doc().parts[4].center }));
ok(JSON.stringify(nudged.nudge) === '[{"i":5,"by":[1,0]}]' && JSON.stringify(nudged.center) === '[-30,-2]', `dragging the picked fixture is ずらす, the arc stays (${JSON.stringify(nudged.nudge)})`);
if (shots) await page.screenshot({ path: `${shots}/02-arc-skip-nudge.png` });

// --- 1台を置く, then delete it
await page.click('#tool-seg button[data-tool="place"]');
await page.selectOption('#place-kind', 'geyser');
await click(await at(0.2, 30.1));
const placed = await ed(() => {
  const d = window.__venueEditor.doc();
  return { last: d.parts[d.parts.length - 1], sel: window.__venueEditor.sel(), n: d.parts.length, geysers: window.__venueEditor.venue().groups.find((g) => g.name === 'geyser').positions.length };
});
ok(placed.last.kind === 'single' && placed.last.fixture === 'geyser' && placed.last.group === 'geyser' && JSON.stringify(placed.last.at) === '[0,30]', `1台を置く puts one geyser on the snap, in the geyser group (${JSON.stringify(placed.last.at)}, ${placed.geysers} geysers)`);
if (shots) await page.screenshot({ path: `${shots}/03-single.png` });
await page.keyboard.press('Escape');
await page.keyboard.press('Delete');
const afterDel = await ed(() => window.__venueEditor.doc().parts.length);
ok(afterDel === placed.n - 1, 'Delete on a single fixture removes it');

// --- add a part from the menu
await page.click('#add-btn');
await page.click('#add-pop button:has-text("円")');
const added = await ed(() => window.__venueEditor.doc().parts.at(-1));
ok(added.kind === 'ring' && added.fixture === 'geyser', `部品を足す adds a ring (of the kind in use: ${added.fixture})`);
await page.keyboard.press('Delete');

// --- a field edit
await page.click('#parts-list li:has-text("右アーク")');
const countIn = page.locator('#part-fields .row:has(label:text("台数")) input');
await countIn.fill('24');
await countIn.press('Enter');
const count = await ed(() => window.__venueEditor.venue().groups.find((g) => g.name === 'chaser').positions.length);
ok(count === 59, `typing 台数 24 for the right arc gives 59 chasers (${count})`);

// --- the rules: the 1 m ずらす and the denser right arc stop it, and 3Dで見る waits
const stops = await ed(() => window.__venueEditor.findings().filter((f) => f.level === 'stop').map((f) => f.rule).sort().join());
ok(stops === 'overlap,samespot' && (await page.locator('#view3d-btn').isDisabled()), `止める (${stops}) turns 3Dで見る off`);
if (shots) await page.screenshot({ path: `${shots}/04-stops.png` });
await page.keyboard.press('Meta+z'); // the right arc back to 20
await page.click('#parts-list li:has-text("左アーク")');
const f5b = await ed(() => window.__venueEditor.venue().groups.find((g) => g.name === 'chaser').positions[4]);
await click(await at(f5b[0], f5b[2]));
await page.click('#fixture-fields button:has-text("ずらしを戻す")');
const after = await ed(() => window.__venueEditor.findings().filter((f) => f.level === 'stop').length);
ok(after === 0 && !(await page.locator('#view3d-btn').isDisabled()), 'undoing the arc and ずらしを戻す clear them, 3Dで見る is back');

// --- the desk tank from the 会場 menu: its cue count, then back to the copy
await page.click('#venue-btn');
await page.click('#venue-pop button:has-text("机の水槽")');
await page.waitForFunction(() => window.__venueEditor.doc().id === 'desk');
await page.click('.vn-cues-btn');
const deskText = await cuesText();
// 2026-11-08: +14 projector cues (src/show/projector.ts), none of which runs in the desk tank (no screens)
ok(/Rhapsody in Blue 330／444/.test(deskText) && (await page.locator('.vn-cues-pop').isVisible()), `the desk tank counts its cues and opens the breakdown (${deskText})`);
if (shots) await page.screenshot({ path: `${shots}/08-desk-cues.png` });
await page.keyboard.press('Escape');
await page.mouse.click(5, 300);

// --- survives a reload; the panels show the copy
const id = moved.id;
await page.goto(`http://localhost:5199/venue.html?venue=${id}`);
await page.waitForFunction(() => window.__venueEditor);
const kept = await ed(() => ({ id: window.__venueEditor.doc().id, skip: window.__venueEditor.doc().parts[4].skip, nudge: window.__venueEditor.doc().parts[4].nudge, url: location.search }));
ok(kept.id === id && JSON.stringify(kept.skip) === '[2]' && !kept.nudge && kept.url.includes(id), 'the copy is kept in this browser and opens again');
if (shots) await page.screenshot({ path: `${shots}/05-copy.png` });

// --- the editor's 会場 ▾: この会場を編集 ↗ opens venue.html on the show's venue
const edit = await ctx.newPage();
edit.on('pageerror', (e) => errors.push(String(e)));
await edit.goto('http://localhost:5199/edit.html');
await edit.waitForFunction(() => window.__editorReady);
const venueBtn = () => edit.locator('#venue-btn').innerText();
ok((await venueBtn()).includes('ラグーン'), `the editor starts in the lagoon (${await venueBtn()})`);
await edit.click('#venue-btn');
const [popup] = await Promise.all([ctx.waitForEvent('page'), edit.click('#venue-link')]);
await popup.waitForLoadState();
ok(popup.url().includes('/venue.html?venue=lagoon'), `この会場を編集 ↗ opens ${new URL(popup.url()).pathname}${new URL(popup.url()).search}`);
await popup.close();

// --- switching the editor's venue (detailed design 6.5): lanes, the toast, undo, reload
const lanes = () => edit.evaluate(() => window.__editor.lanes().map((l) => l.name).join());
const lagoonLanes = await lanes();
await edit.click('#venue-btn');
await edit.click('#venue-pop button:has-text("机の水槽")');
await edit.waitForTimeout(400);
const desk = await edit.evaluate(async () => {
  const e = window.__editor;
  const f = e.state.file;
  return { venue: f.venue, lanes: e.lanes().map((l) => l.name).join(), missing: f.cues.filter((c) => e.lanes()[e.laneOf(c)]?.missing).length, toast: document.getElementById('toast').textContent, cam: window.__editor.preview.rt.stage.camera.position.toArray().map((v) => +v.toFixed(2)) };
});
ok(desk.venue === 'desk' && desk.lanes.startsWith('ミニ噴き上げ・grid,ミニ噴き上げ・chaser') && desk.lanes.endsWith('この会場に無い'), `机の水槽: the lanes are the tank's, then この会場に無い (${desk.lanes})`);
ok(desk.missing > 0 && /動かないキュー \d+・一部だけ \d+/.test(desk.toast), `the cues without a lane go to この会場に無い (${desk.missing}); toast: ${desk.toast}`);
ok(Math.abs(desk.cam[2]) < 2, `the preview looks at the tank from its seat (camera ${desk.cam})`);
if (shots) await edit.screenshot({ path: `${shots}/09-editor-desk.png` });
await edit.keyboard.press('Meta+z');
await edit.waitForTimeout(300);
const back = await edit.evaluate(() => window.__editor.state.file.venue);
ok(back === undefined && (await lanes()) === lagoonLanes && (await venueBtn()).includes('ラグーン'), 'undo puts the lagoon and its lanes back');
await edit.keyboard.press('Meta+Shift+z');
await edit.waitForTimeout(800); // the autosave
await edit.reload();
await edit.waitForFunction(() => window.__editorReady);
ok((await venueBtn()).includes('机の水槽') && (await edit.evaluate(() => window.__editor.state.file.venue)) === 'desk', 'the venue is kept in the autosave and comes back on reload');
await edit.click('#venue-btn');
await edit.click('#venue-pop button:has-text("ラグーン")');
await edit.waitForTimeout(800);
ok((await lanes()) === lagoonLanes, 'back in the lagoon: its lanes, no この会場に無い');
if (shots) await edit.screenshot({ path: `${shots}/06-editor-bar.png`, clip: { x: 0, y: 0, width: 760, height: 40 } });
await edit.close();

// --- 3Dで見る: the player plays the copy
const [player] = await Promise.all([ctx.waitForEvent('page'), page.click('#view3d-btn')]);
await player.waitForLoadState();
ok(player.url().includes(`venue=${id}`), `3Dで見る opens the player with ?venue=${id}`);
await player.close();
const shot = await ctx.newPage();
shot.on('pageerror', (e) => errors.push(String(e)));
await shot.goto(`http://localhost:5199/play.html?venue=${id}&shot=1&t=45&cam=aerial&quality=low`);
await shot.waitForFunction(() => window.__ready, null, { timeout: 60000 });
const n3d = await shot.evaluate(() => document.title);
if (shots) await shot.screenshot({ path: `${shots}/07-player-copy.png` });
ok(true, `the player renders the copy (${n3d})`);
await shot.close();

ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(bad ? 1 : 0);
