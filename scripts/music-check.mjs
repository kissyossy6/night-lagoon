/**
 * Own music per project (docs/music-plan.md), end to end, without sound:
 * a test project gets a click track made here (60 s, 128 BPM), the editor
 * picks it (length, sections, cues after the end, undo/redo, the autosave),
 * the player plays it at its length, and the project goes to the trash.
 *
 *   node scripts/music-check.mjs        (needs the dev server on :5199)
 */
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:5199';
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
};

/** A click track: a short tick on every beat (higher on the bar), a quiet hum under it. */
function clickWav(bpm, seconds, first) {
  // mono at 22.05 kHz keeps the file small (each run leaves one in projects/.trash)
  const sr = 22050;
  const n = Math.round(sr * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  const beat = 60 / bpm;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0.05 * Math.sin(2 * Math.PI * 110 * t);
    if (t >= first) {
      const k = (t - first) % beat;
      const b = Math.floor((t - first) / beat);
      if (k < 0.06) v += 0.6 * Math.sin(2 * Math.PI * (b % 4 ? 880 : 1760) * k) * Math.exp(-k * 60);
    }
    const s = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
    buf.writeInt16LE(s, 44 + i * 2);
  }
  return buf;
}

const dir = mkdtempSync(join(tmpdir(), 'music-check-'));
const wav = join(dir, 'click-128.wav');
writeFileSync(wav, clickWav(128, 60, 0.5));

const api = async (path, init) => {
  const r = await fetch(`${BASE}/__projects${path}`, init);
  return r.json();
};
const proj = await api('/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '曲のテスト（music-check）', generate: 'empty' }) });
console.log(`test project ${proj.id}`);

const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
let newId = null;
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'warning' && /editor|music/.test(m.text()) && console.log(`  (console: ${m.text().slice(0, 160)})`));

try {
  await page.goto(`${BASE}/edit.html?project=${proj.id}`);
  await page.waitForFunction(() => window.__editor?.state, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 90000 });
  // one cue at 100 s: after the end of a 60 s song
  await page.evaluate(() => {
    const s = window.__editor.state;
    s.mutate((f) => {
      f.cues.push({ t: 100, target: 'grid[0-3]', set: { pressure: 0.5 } });
      // the wide screen up and the projector on from 2 s, no clip chosen
      f.cues.push({ t: 2, target: 'screen', set: { pressure: 1 }, dur: 1 });
      f.cues.push({ t: 2, target: 'projector', set: { intensity: 1 }, dur: 1 });
    }, { structural: true });
    s.setSelection([], -1);
  });
  const before = await page.evaluate(() => ({ dur: window.__editor.state.file.duration, sec: document.querySelector('.sects')?.textContent ?? '' }));
  ok(await page.locator('text=共通の曲（Rhapsody in Blue）').isVisible(), 'ショー設定の「曲」は共通の曲');

  await page.locator('#inspector input[type=file]').setInputFiles(wav);
  await page.waitForFunction(() => window.__editor.state.file.music && window.__editor.transport.music === 'ready' && window.__editor.transport.musicName === 'click-128.wav', null, { timeout: 60000 });
  const after = await page.evaluate(() => {
    const e = window.__editor;
    return {
      music: e.state.file.music,
      dur: e.state.file.duration,
      tDur: e.transport.duration,
      audio: e.transport.audio?.duration,
      past: e.checks().filter((c) => c.kind === 'past').length,
      sects: [...document.querySelectorAll('.sects input[type=text]')].map((i) => i.value),
    };
  });
  ok(Math.abs(after.dur - 60) < 0.05 && Math.abs(after.tDur - 60) < 0.05, `長さが曲の長さに：${after.dur} 秒（前 ${before.dur}）`);
  ok(Math.abs(after.audio - 60) < 0.05, `エディタが入れた曲を読んだ（${after.audio?.toFixed(2)} 秒）`);
  ok(/^music-[0-9a-f]{12}\.wav$/.test(after.music.file) && after.music.name === 'click-128.wav', `ファイルはプロジェクトのフォルダに：${after.music.file}`);
  ok(after.past === 1, `曲の後ろのキューは消さずに警告：${after.past}`);
  ok(after.sects.join() === '全体', `区間は「全体」1つ：${after.sects.join('・')}`);

  // the projector's lane: no picture strips while nothing is chosen to show (the screen is black)
  await page.waitForTimeout(800);
  const shown = await page.evaluate(() => {
    const pm = window.__editor.timeline.picture;
    return pm ? pm.zones.reduce((n, row) => n + row.filter((v) => v !== 0).length, 0) : -1;
  });
  ok(shown === 0, `黒の間は水幕の行に「映っている」線を出さない：${shown}`);

  // the onsets (音の頭) under the ruler, and snapping to them (the grid is still 120 BPM from 0 s here,
  // so the click track's beats at 0.5 + k × 0.46875 s fall between its beats)
  const snap = await page.evaluate(() => {
    const tl = window.__editor.timeline;
    tl.pps = 60; // 8 px = 0.13 s
    const beat = (k) => 0.5 + k * (60 / 128);
    return {
      marks: tl.onsets.length,
      near: tl.snap(beat(20) + 0.04, false), // 9.875 + 0.04: the onset (the nearest beat 10.0 is farther)
      wantNear: beat(20),
      grid: tl.snap(beat(21) + 0.2, false), // 0.2 s off: too far from the onset, the beat grid
      alt: tl.snap(beat(20) + 0.04, true),
    };
  });
  ok(snap.marks >= 100 && snap.marks <= 140, `音の頭の印：${snap.marks}（作った曲は 60 秒に 128 拍）`);
  ok(Math.abs(snap.near - snap.wantNear) < 0.02, `近くの音の頭にスナップ：${snap.near}（音の頭 ${snap.wantNear.toFixed(3)}）`);
  ok(Math.abs(snap.grid - Math.round(snap.grid * 2) / 2) < 1e-9, `音の頭から遠いと拍のグリッドへ：${snap.grid}`);
  ok(Math.abs(snap.alt - (snap.wantNear + 0.04)) < 1e-9, `Alt ではスナップしない：${snap.alt.toFixed(3)}`);

  // the beat measured in the music: a hint, put in by a button
  await page.waitForSelector('#inspector :text("拍の目安")', { timeout: 30000 });
  const hint = await page.locator('#inspector :text("拍の目安")').innerText();
  const [, bpm, first] = hint.match(/([\d.]+) BPM・最初の拍 ([\d.]+)/) ?? [];
  ok(Math.abs(Number(bpm) - 128) <= 1 && Math.abs(Number(first) - 0.5) < 0.04, `拍の目安：${hint}（作った曲は 128 BPM・0.5 秒）`);
  await page.click('#inspector button:has-text("入れる")');
  const grid = await page.evaluate(() => ({ bpm: window.__editor.state.file.bpm, offset: window.__editor.state.file.offset }));
  ok(grid.bpm === Number(bpm) && Math.abs(grid.offset - Number(first)) < 0.006, `「入れる」で BPM ${grid.bpm}・オフセット ${grid.offset}`);
  await page.keyboard.press('Meta+z');

  await page.keyboard.press('Meta+z');
  await page.waitForFunction(() => !window.__editor.state.file.music && window.__editor.transport.music === 'ready', null, { timeout: 60000 });
  const undone = await page.evaluate(() => ({ dur: window.__editor.state.file.duration, audio: window.__editor.transport.audio?.duration, name: window.__editor.transport.musicName }));
  ok(undone.dur === before.dur && /^background\./.test(undone.name), `⌘Z で共通の曲に戻る：${undone.dur} 秒・${undone.name}`);
  await page.keyboard.press('Meta+Shift+z');
  await page.waitForFunction(() => window.__editor.state.file.music && window.__editor.transport.musicName === 'click-128.wav', null, { timeout: 60000 });
  ok(true, '⇧⌘Z でまた入れた曲に');

  await page.evaluate(() => window.__editor.saveNow());
  const saved = await api(`/get?id=${proj.id}`);
  ok(saved.show?.music?.file === after.music.file && saved.show.duration === after.dur, 'project.json に曲が残る');

  // the player: its length and its music
  await page.goto(`${BASE}/play.html?project=${proj.id}`);
  await page.waitForFunction(() => window.__clock && !document.querySelector('#go')?.disabled, null, { timeout: 90000 });
  const play = await page.evaluate(() => ({ dur: window.__clock.duration, music: window.__clock.music?.duration, max: document.getElementById('seek').max, status: document.getElementById('start-status')?.textContent }));
  ok(Math.abs(play.dur - 60) < 0.05 && play.max === String(after.dur), `本番再生の長さ ${play.dur} 秒・シークバー ${play.max}`);
  ok(Math.abs((play.music ?? 0) - 60) < 0.05 && /click-128\.wav/.test(play.status ?? ''), `本番再生がその曲を読んだ：${play.status}`);
  await page.click('#go');
  await page.evaluate(() => window.__clock.seek(58.5));
  await page.waitForTimeout(2500);
  const end = await page.evaluate(() => ({ t: window.__clock.time(), playing: window.__clock.playing }));
  ok(!end.playing && Math.abs(end.t - 60) < 0.1, `曲の終わり（60 秒）で止まる：${end.t.toFixed(2)}`);
  // the screen is up but no scene was chosen: no Rhapsody story on it
  await page.evaluate(() => window.__clock.seek(20));
  await page.waitForTimeout(1500);
  const pic = await page.evaluate(() => ({ up: window.__rt.mistAt(window.__rt.screens[0].unit.index, 20), avg: window.__rt.screen.averageColor() }));
  ok(pic.up > 0.5 && pic.avg.every((v) => v < 0.002), `場面を選んでいない水幕は黒：霧 ${pic.up.toFixed(2)}・平均の色 ${pic.avg.map((v) => v.toFixed(3)).join(', ')}`);
  // the same moment drawn as before (the story at the show time) is not black: the check can tell
  const story = await page.evaluate(() => {
    // the screen draws every other call and reads its average colour every few draws
    for (let i = 0; i < 16; i++) window.__rt.screen.render({ t: 20 });
    return window.__rt.screen.averageColor();
  });
  ok(story.some((v) => v > 0.002), `比べ：前の描き方（時刻どおりの物語）なら色がある：${story.map((v) => v.toFixed(3)).join(', ')}`);

  // back to the shared music from the editor
  await page.goto(`${BASE}/edit.html?project=${proj.id}`);
  await page.waitForFunction(() => window.__editor?.transport.musicName === 'click-128.wav', null, { timeout: 90000 });
  await page.click('#inspector button:has-text("共通の曲に戻す")');
  await page.waitForFunction(() => !window.__editor.state.file.music && /^background\./.test(window.__editor.transport.musicName), null, { timeout: 60000 });
  const back = await page.evaluate(() => window.__editor.state.file.duration);
  ok(back === 217, `「共通の曲に戻す」で 217 秒：${back}`);
  await page.waitForTimeout(800);
  const shownShared = await page.evaluate(() => window.__editor.timeline.picture.zones.reduce((n, row) => n + row.filter((v) => v !== 0).length, 0));
  ok(shownShared > 0, `比べ：共通の曲（物語が流れる）なら同じキューで線が出る：${shownShared}`);
  // a new empty show started on a picked music, from the list's 新規
  await page.goto(`${BASE}/#projects`);
  await page.click('#new-btn');
  await page.fill('#dlg-body input[type=text]', '曲のテスト（新規・music-check）');
  await page.setInputFiles('#dlg-body input[type=file]', wav);
  await page.click('#dlg-actions button:has-text("作ってエディタで開く")');
  await page.waitForURL(/edit\.html\?project=/, { timeout: 30000 });
  newId = new URL(page.url()).searchParams.get('project');
  await page.waitForFunction(() => window.__editor?.transport.musicName === 'click-128.wav' && !/draft/.test(location.search), null, { timeout: 90000 });
  const fresh = await page.evaluate(() => ({ dur: window.__editor.state.file.duration, bpm: window.__editor.state.file.bpm, offset: window.__editor.state.file.offset, cues: window.__editor.state.file.cues.length }));
  ok(Math.abs(fresh.dur - 60) < 0.05 && Math.abs(fresh.bpm - 128) <= 1 && Math.abs(fresh.offset - 0.5) < 0.04, `新規で曲を選ぶと、その長さ・拍で始まる：${fresh.dur} 秒・${fresh.bpm} BPM・${fresh.offset} 秒`);
  ok(fresh.cues > 10 && !/draft/.test(page.url()), `「下書きを作る」（初めから入）で、曲から作った下書きが入る：${fresh.cues} キュー`);
  ok(errors.length === 0, `ページのエラーなし${errors.length ? `：${errors.join(' / ')}` : ''}`);
} finally {
  await browser.close();
  await api(`/trash?id=${proj.id}`, { method: 'POST' });
  if (newId) await api(`/trash?id=${newId}`, { method: 'POST' });
}
console.log(failed ? `\n${failed} failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
