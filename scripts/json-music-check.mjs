/**
 * The project's own music inside a show's JSON (src/projects/music-json.ts):
 * a test project on its own music (the composed score as a WAV) is written
 * out from the editor (ファイル ▾ JSON を書き出す); the JSON carries the music;
 * read into another project in the editor (JSON を読み込む…) and from the list
 * (JSON を読み込む), the music lands in that project's folder and plays.
 * A JSON without music still reads as before. No sound; the test projects go
 * to the trash.
 *
 *   node scripts/json-music-check.mjs    (needs the dev server on :5199)
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:5199';
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
};
const api = async (path, init) => (await fetch(`${BASE}/__projects${path}`, init)).json();
const create = (name) => api('/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, generate: 'empty' }) });
const dir = mkdtempSync(join(tmpdir(), 'json-music-'));
const made = [];

const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--mute-audio'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  // A: a show on its own music (a short WAV of the composed score)
  const a = await create('曲つき JSON のテスト A（json-music-check）');
  made.push(a.id);
  await page.goto(`${BASE}/play.html?shot=1&t=0`);
  const music = await page.evaluate(async (id) => {
    const { renderScore } = await import('/src/audio/original-score.ts');
    const full = await renderScore(22050);
    const n = Math.min(full.length, 22050 * 20);
    const ch = full.getChannelData(0);
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
    const { file } = await (await fetch(`/__projects/music?id=${id}&name=score-20s.wav`, { method: 'POST', body: wav.buffer })).json();
    const doc = await (await fetch(`/__projects/get?id=${id}`)).json();
    doc.show = { title: doc.name, bpm: 120, beatsPerBar: 4, offset: 0, duration: 20, cues: [{ t: 1, target: 'grid', set: { pressure: 0.6 } }, { t: 4, target: 'whip', macro: 'sway', args: { amp: 30 } }], music: { file, name: 'score-20s.wav', duration: 20 } };
    delete doc.generate;
    await fetch(`/__projects/save?id=${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
    return { file, bytes: n * 2 + 44 };
  }, a.id);
  console.log(`A ${a.id}: ${music.file} (${(music.bytes / 1024).toFixed(0)} KB)`);

  // write A out from the editor
  await page.goto(`${BASE}/edit.html?project=${a.id}`);
  await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 90000 }).catch(() => {});
  await page.click('#file-btn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#file-pop button[data-act="export"]')]);
  const jsonPath = join(dir, 'a.json');
  await dl.saveAs(jsonPath);
  const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
  await page.waitForTimeout(200);
  const toastA = await page.textContent('#toast');
  ok(typeof json.music?.data === 'string' && json.music.data.startsWith('data:audio/'), `書き出した JSON に曲が入る（${(json.music?.data?.length / 1024).toFixed(0)} KB、${toastA.trim()}）`);
  ok(json.cues.length === 2 && json.music.file === music.file, '演出と曲の名前もそのまま');

  // B: read it in the editor of another project
  const b = await create('曲つき JSON のテスト B（json-music-check）');
  made.push(b.id);
  await page.goto(`${BASE}/edit.html?project=${b.id}`);
  await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 90000 }).catch(() => {});
  await page.setInputFiles('#import-input', jsonPath);
  await page.waitForFunction((f) => window.__editor.state.file.music?.file === f, music.file, { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(500);
  const inB = await page.evaluate(() => ({ music: window.__editor.state.file.music, cues: window.__editor.state.file.cues.length, state: window.__editor.transport.music, toast: document.getElementById('toast').textContent }));
  const servedB = await fetch(`${BASE}/__projects/music?id=${b.id}&file=${music.file}`);
  ok(inB.music?.file === music.file && inB.cues === 2 && servedB.ok, `エディタで読み込むと、曲が B のフォルダに入る（${inB.toast.trim()}）`);
  ok(inB.state !== 'none' && inB.state !== 'missing', `B で曲が読める（${inB.state}）`);
  ok(!('data' in (inB.music ?? {})), '演出ファイルには曲の中身を残さない（名前だけ）');

  // C: read it from the list, a new project with the music
  await page.goto(`${BASE}/#projects`);
  await page.waitForSelector('#import-btn', { timeout: 30000 });
  const before = new Set((await api('/list')).map((p) => p.id));
  await page.setInputFiles('#import-input', jsonPath);
  await page.waitForFunction(() => /読み込みました|読み込めません/.test(document.getElementById('toast')?.textContent ?? ''), null, { timeout: 30000 });
  const toastC = await page.textContent('#toast');
  const c = (await api('/list')).find((p) => !before.has(p.id));
  if (c) made.push(c.id);
  const docC = c ? await api(`/get?id=${c.id}`) : null;
  const servedC = c ? await fetch(`${BASE}/__projects/music?id=${c.id}&file=${docC.show?.music?.file}`) : null;
  ok(docC?.show?.music?.file === music.file && servedC?.ok, `一覧で読み込むと、新しいプロジェクトに曲も入る（${toastC.trim()}）`);

  // a JSON without music reads as before
  const plain = { ...json };
  delete plain.music;
  const plainPath = join(dir, 'plain.json');
  writeFileSync(plainPath, JSON.stringify(plain));
  await page.goto(`${BASE}/edit.html?project=${b.id}`);
  await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 90000 });
  await page.setInputFiles('#import-input', plainPath);
  await page.waitForTimeout(800);
  const inPlain = await page.evaluate(() => ({ music: window.__editor.state.file.music, cues: window.__editor.state.file.cues.length }));
  ok(!inPlain.music && inPlain.cues === 2, '曲の入っていない JSON は今までどおり（共通の曲で再生）');
  ok(errors.length === 0, `ページのエラーなし${errors.length ? '：' + errors.slice(0, 2).join(' / ') : ''}`);
} finally {
  await browser.close();
  for (const id of made) await api(`/trash?id=${id}`, { method: 'POST' });
}
console.log(failed ? `\n${failed} failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
