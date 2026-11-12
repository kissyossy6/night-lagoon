/**
 * The draft from your own music (src/show/draft.ts), on a real piece, without
 * sound: the composed score (?music=original, 120 BPM, 180 s) is rendered in
 * the page, kept as a test project's music, and the editor makes the draft
 * (the list's 新規 path, ?draft=1). Checked: the structure (a quiet start, the
 * first and main peaks, the hold before the main one), the warnings, the same
 * draft on the desk (only its groups), and stills along the show with their
 * brightness (shots/draft/). The project goes to the trash.
 *
 *   node scripts/draft-check.mjs [--keep]    (needs the dev server on :5199)
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:5199';
const keep = process.argv.includes('--keep');
const OUT = 'shots/draft';
mkdirSync(OUT, { recursive: true });
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
};
const api = async (path, init) => (await fetch(`${BASE}/__projects${path}`, init)).json();

const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--mute-audio'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const proj = await api('/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '下書きのテスト（draft-check）', generate: 'empty' }) });
console.log(`test project ${proj.id}`);
try {
  // the score as a WAV in the project's folder, the show set on it (as the 新規 dialog does)
  await page.goto(`${BASE}/play.html?shot=1&t=0`);
  const made = await page.evaluate(async (id) => {
    const { renderScore } = await import('/src/audio/original-score.ts');
    const an = await import('/src/audio/analysis.ts');
    const buf = await renderScore(22050);
    const ch = buf.getChannelData(0);
    const n = ch.length;
    const wav = new DataView(new ArrayBuffer(44 + n * 2));
    const str = (o, s) => [...s].forEach((c, i) => wav.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    wav.setUint32(4, 36 + n * 2, true);
    str(8, 'WAVEfmt ');
    wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true);
    wav.setUint16(22, 1, true);
    wav.setUint32(24, 22050, true);
    wav.setUint32(28, 44100, true);
    wav.setUint16(32, 2, true);
    wav.setUint16(34, 16, true);
    str(36, 'data');
    wav.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, ch[i])) * 32767, true);
    const r = await fetch(`/__projects/music?id=${id}&name=original-score.wav`, { method: 'POST', body: wav.buffer });
    const { file } = await r.json();
    const tempo = an.estimateTempo(an.analyseMusic(buf).onsets);
    const doc = await (await fetch(`/__projects/get?id=${id}`)).json();
    const duration = Math.round(buf.duration * 100) / 100;
    doc.show = { title: doc.name, bpm: tempo?.bpm ?? 120, beatsPerBar: 4, offset: tempo?.offset ?? 0, duration, cues: [], music: { file, name: 'original-score.wav', duration } };
    delete doc.generate;
    await fetch(`/__projects/save?id=${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
    return { duration, bpm: doc.show.bpm };
  }, proj.id);
  console.log(`music ${made.duration} s, ${made.bpm} BPM`);

  await page.goto(`${BASE}/edit.html?project=${proj.id}&draft=1`);
  await page.waitForFunction(() => window.__editor?.state.file.cues.length > 0, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const e = window.__editor;
    const an = await import('/src/audio/analysis.ts');
    const dr = await import('/src/show/draft.ts');
    const { buildLayout } = await import('/src/show/layout.ts');
    const { getVenue } = await import('/src/venues/index.ts');
    const music = an.analyseMusic(e.transport.audio);
    const scenes = dr.draftScenes({ music, file: e.state.file, groups: e.lanes ? buildLayout(getVenue('lagoon')).groups : {} });
    const desk = buildLayout(getVenue('desk'));
    const deskCues = dr.buildDraft({ music, file: e.state.file, groups: desk.groups });
    const deskGroups = new Set(Object.keys(desk.groups).filter((g) => desk.groups[g].length));
    const kinds = {};
    for (const c of e.checks()) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
    return {
      cues: e.state.file.cues.length,
      url: location.search,
      scenes: scenes.map((s) => ({ from: s.from, to: s.to, d: s.density, role: s.role, color: s.color, e: +s.energy.toFixed(2) })),
      kinds,
      deskCues: deskCues.length,
      deskOutside: deskCues.filter((c) => !deskGroups.has(c.target.replace(/\[.*$/, ''))).length,
    };
  });
  console.log('scenes:');
  for (const s of r.scenes) console.log(`  ${s.from.toFixed(1)}-${s.to.toFixed(1)}  密度 ${s.d}  ${s.role.padEnd(10)} ${s.color}  音量 ${s.e}`);
  console.log('warnings:', JSON.stringify(r.kinds));
  ok(r.cues > 50 && !/draft/.test(r.url), `下書き：${r.cues} キュー（?draft=1 は消える）`);
  const main = r.scenes.find((s) => s.role === 'main-peak');
  ok(main && main.from / made.duration > 0.45, `主山場は後半：${main?.from.toFixed(1)} 秒〜`);
  ok(r.scenes[0].d <= 2, `静かに始まる：最初の場面の密度 ${r.scenes[0].d}`);
  const iMain = r.scenes.indexOf(main);
  ok(iMain === 0 || r.scenes[iMain - 1].d <= 3, `主山場の前は溜める：${iMain > 0 ? r.scenes[iMain - 1].role : '—'}`);
  ok(!r.kinds.past && !r.kinds.missing, `曲の後ろ・この会場で動かないキューなし`);
  ok((r.kinds.head ?? 0) + (r.kinds.water ?? 0) <= 10, `書いたとおりに動かない所は少ない：首振り ${r.kinds.head ?? 0}・水 ${r.kinds.water ?? 0}`);
  ok(r.deskCues > 20 && r.deskOutside === 0, `机の会場でも、その会場の機材だけで作れる：${r.deskCues} キュー`);

  // stills: the middle of each scene, the moment before the main peak, the last hit and the end
  const times = [...r.scenes.map((s) => +((s.from + s.to) / 2).toFixed(1)), +(main.from - 1).toFixed(1), +(main.to - 4).toFixed(1), +(made.duration - 0.5).toFixed(1)].sort((a, b) => a - b);
  const files = [];
  const bright = [];
  for (const t of times) {
    await page.goto(`${BASE}/play.html?project=${proj.id}&shot=1&t=${t}&quality=high`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    const f = `${OUT}/t${t}.jpg`;
    await page.screenshot({ path: f, type: 'jpeg', quality: 85 });
    files.push(`${t}秒=${f}`);
    bright.push(
      await page.evaluate(() => {
        const c = document.querySelector('#stage canvas');
        const g = document.createElement('canvas');
        g.width = 160;
        g.height = 90;
        const x = g.getContext('2d');
        x.drawImage(c, 0, 0, 160, 90);
        const d = x.getImageData(0, 0, 160, 90).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        return +(s / (d.length / 4)).toFixed(1);
      }),
    );
  }
  console.log('brightness:', times.map((t, i) => `${t}s ${bright[i]}`).join('  '));
  execFileSync('python3', ['scripts/montage.py', `${OUT}/sheet.jpg`, '4', ...files]);
  console.log(`sheet: ${OUT}/sheet.jpg`);
  ok(errors.length === 0, `ページのエラーなし${errors.length ? `：${errors.slice(0, 3).join(' / ')}` : ''}`);
} finally {
  await browser.close();
  if (!keep) await api(`/trash?id=${proj.id}`, { method: 'POST' });
}
console.log(failed ? `\n${failed} failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
