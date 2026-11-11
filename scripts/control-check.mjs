/**
 * Exports for real equipment, read back (docs/detailed-design.md 5.8): drive
 * the editor's 書き出し dialog, read the file it wrote to exports/control/,
 * and compare it with evaluate() in the same page.
 *
 *   node scripts/control-check.mjs [--show=lagoon|fantasia|hanabi] [--format=channels-csv,dmx-patch,cue-sheet,pyro-csv,dmx-record,artnet]
 *                                  [--range=0-30] [--fps=40] [--tc=00:00:00:00] [--rows=400]
 *
 * channels-csv: header, one row per frame on the k / fps grid, the timecode
 *   of every row, and the values of --rows sampled rows (every row of a
 *   short range) within 0.001.
 * dmx-patch: one row per channel of the layout, footprints as the profiles,
 *   nothing straddling 512, no overlaps.
 * cue-sheet: one row per cue of the file in the range, in time order, with
 *   its time, timecode and section.
 * pyro-csv: one row per shell (no 千輪 children), by launch time; launch,
 *   burst and timecode as the bursts drawn.
 * dmx-record: the header, the size, and every byte of --rows sampled frames
 *   against evaluate() clipped to the profile's range (within 1/255; 16-bit
 *   within 1/65535).
 * artnet (after dmx-record): listen on UDP 6454, send with 書き出し ▾ →
 *   Art-Net で送る, step the editor to sampled frames and play a few seconds;
 *   every set of universes received must equal a frame of the recording.
 * Needs the dev server (npm run dev, port 5199).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { indexRecording, listen, readRecording } from './artnet-listen.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const show = arg('show', 'lagoon');
const formats = arg('format', 'channels-csv,dmx-patch,cue-sheet,pyro-csv,dmx-record,artnet').split(',');
const range = arg('range', '');
const fps = Number(arg('fps', 40));
const tc = arg('tc', '00:00:00:00');
const sampleRows = Number(arg('rows', 400));

const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5199/edit.html?quality=low');
await page.waitForFunction(() => window.__editorReady, null, { timeout: 60000 });
// the editor rebuilds its show once the music is analysed: wait for that
// (the dialog's 書き出す comes on), then load the version to check
await page.evaluate(() => {
  document.getElementById('cx-btn').click();
  document.querySelector('#cx-pop button').click();
});
await page.waitForFunction(() => {
  document.getElementById('cx-form').dispatchEvent(new Event('input'));
  return !document.getElementById('cx-go').disabled;
}, null, { timeout: 120000, polling: 500 });
await page.evaluate(() => document.getElementById('cx-cancel').click());
await page.evaluate((v) => {
  document.getElementById('file-btn').click();
  document.querySelector(`#file-pop [data-variant="${v}"]`).click();
}, show);
const title = await page.evaluate(() => window.__editor.preview.rt.show.file.title);
console.log(`show: ${title}`);

let failed = 0;
const fail = (msg) => {
  failed++;
  console.log(`  ✗ ${msg}`);
};

let recording = null;
for (const format of formats) {
  if (format === 'artnet') {
    if (!recording) fail('artnet: needs dmx-record first (--format=dmx-record,artnet)');
    else await checkArtnet(recording, { fps, range });
    continue;
  }
  // open the dialog the way a person does, and wait until it may export
  await page.evaluate((id) => {
    window.__controlExport = undefined;
    document.getElementById('cx-btn').click();
    document.querySelector(`#cx-pop [data-id="${id}"]`).click();
  }, format);
  await page.evaluate(
    ({ fps, tc, range }) => {
      document.getElementById('cx-fps').value = String(fps);
      document.getElementById('cx-tc').value = tc;
      const part = !!range;
      document.querySelector(`input[name=cx-range][value=${part ? 'part' : 'all'}]`).checked = true;
      if (part) {
        const [a, b] = range.split('-');
        document.getElementById('cx-from').value = a;
        document.getElementById('cx-to').value = b;
      }
      document.getElementById('cx-form').dispatchEvent(new Event('input'));
    },
    { fps, tc, range },
  );
  // the music is analysed before a show with 'follow' cues may export
  await page.waitForFunction(() => {
    document.getElementById('cx-form').dispatchEvent(new Event('input'));
    return !document.getElementById('cx-go').disabled;
  }, null, { timeout: 120000, polling: 500 });
  const t0 = Date.now();
  await page.evaluate(() => document.getElementById('cx-form').requestSubmit());
  await page.waitForFunction(() => window.__controlExport, null, { timeout: 600000 });
  const r = await page.evaluate(() => window.__controlExport);
  await page.evaluate(() => document.getElementById('cx-cancel').click());
  if (r.error) {
    fail(`${format}: ${r.error}`);
    continue;
  }
  console.log(`${format}: ${r.output} ${(r.bytes / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (format === 'dmx-record') {
    recording = r.output;
    await checkRecord(readFileSync(r.output), r.options);
    continue;
  }
  const text = readFileSync(r.output, 'utf8');
  if (format === 'channels-csv') await checkChannels(text, r.options);
  else if (format === 'dmx-patch') await checkPatch(text);
  else if (format === 'cue-sheet') await checkCues(text, r.options);
  else if (format === 'pyro-csv') await checkPyro(text, r.options);
}

async function checkChannels(text, opts) {
  const lines = text.split('\r\n');
  if (lines.at(-1) === '') lines.pop();
  const head = lines[0].split(',');
  // columns: every channel of a fixture, a screen's pressure, a projector zone's brightness (2026-11-08)
  const info = await page.evaluate(async () => {
    const { csvColumns } = await import('/src/export/control/channels-csv.ts');
    const rt = window.__editor.preview.rt;
    return { cols: csvColumns(rt.layout).map((c) => c.name), screens: rt.layout.screens.length, zones: rt.layout.projector.length, duration: rt.show.file.duration };
  });
  const want = ['time_s', 'timecode', ...info.cols];
  const odd = info.cols.filter((c) => /^(screen|mound)\[\d+\]\.(?!pressure)/.test(c) || /^projector\[\d+\]\.(?!intensity)/.test(c));
  if (head.join(',') !== want.join(',')) fail(`header differs (${head.length} columns, expected ${want.length})`);
  else if (odd.length) fail(`screen or projector columns other than pressure / brightness: ${odd.join(' ')}`);
  else console.log(`  ✓ header: ${head.length} columns (screens ${info.screens} × pressure, projector zones ${info.zones} × brightness)`);
  // frames on the k / fps grid
  const [from, to] = opts.range ?? [0, info.duration];
  const k0 = Math.ceil(from * opts.fps - 1e-6);
  const k1 = Math.floor(Math.min(to, info.duration) * opts.fps + 1e-6);
  const rows = lines.length - 1;
  if (rows !== k1 - k0 + 1) fail(`rows ${rows}, expected ${k1 - k0 + 1}`);
  else console.log(`  ✓ rows: ${rows} (frames ${k0}..${k1} at ${opts.fps} fps)`);
  // timecode: independent of the exporter's code
  const [h, m, s, f] = opts.timecodeStart.split(':').map(Number);
  const start = ((h * 60 + m) * 60 + s) * opts.fps + f;
  const tcOf = (k) => {
    const n = (start + k) % (24 * 3600 * opts.fps);
    const p = (v) => String(v).padStart(2, '0');
    const sec = Math.floor(n / opts.fps);
    return `${p(Math.floor(sec / 3600))}:${p(Math.floor(sec / 60) % 60)}:${p(sec % 60)}:${p(n % opts.fps)}`;
  };
  let badTime = 0;
  for (let i = 1; i <= rows; i++) {
    const k = k0 + i - 1;
    const c = lines[i].indexOf(',');
    const c2 = lines[i].indexOf(',', c + 1);
    const t = Number(lines[i].slice(0, c));
    if (Math.abs(t - k / opts.fps) > 0.0005 || lines[i].slice(c + 1, c2) !== tcOf(k)) badTime++;
  }
  if (badTime) fail(`${badTime} rows with a wrong time or timecode`);
  else console.log(`  ✓ time and timecode of every row (first ${tcOf(k0)}, last ${tcOf(k1)})`);
  // values: sampled rows against evaluate() in the page
  const pick = rows <= sampleRows ? [...Array(rows).keys()] : [0, rows - 1, ...Array.from({ length: sampleRows - 2 }, () => Math.floor(Math.random() * rows))];
  const times = pick.map((i) => (k0 + i) / opts.fps);
  const expected = await page.evaluate(async (times) => {
    const { channelValue, csvColumns } = await import('/src/export/control/channels-csv.ts');
    const rt = window.__editor.preview.rt;
    const cols = csvColumns(rt.layout);
    return times.map((t) => cols.map((c) => channelValue(rt.show, c.fixture, c.channel, t)));
  }, times);
  let worst = 0;
  let bad = 0;
  let where = '';
  pick.forEach((i, j) => {
    const cells = lines[i + 1].split(',');
    expected[j].forEach((v, n) => {
      const d = Math.abs(Number(cells[n + 2]) - v);
      if (d > worst) {
        worst = d;
        where = `${head[n + 2]} at ${times[j]} s`;
      }
      if (!(d <= 0.0005 + 1e-9)) bad++;
    });
  });
  const values = pick.length * expected[0].length;
  if (bad) fail(`${bad} of ${values.toLocaleString()} values off by more than 0.001 (worst ${worst} at ${where})`);
  else console.log(`  ✓ values: ${values.toLocaleString()} in ${pick.length} rows match evaluate() (largest difference ${worst.toFixed(6)}, the 3-decimal rounding)`);
}

async function checkPatch(text) {
  const lines = text.replace(/^﻿/, '').split('\r\n').filter(Boolean);
  const head = lines[0];
  if (head !== 'fixture,group,index,type,universe,artnet_universe,address,footprint,channels') fail(`header: ${head}`);
  const rows = lines.slice(1).map((l) => l.split(','));
  const info = await page.evaluate(async () => {
    const profiles = await import('/src/export/control/profiles.ts');
    const { PROFILES, footprint } = profiles;
    const { channelNames } = await import('/src/export/control/common.ts');
    const rt = window.__editor.preview.rt;
    const kinds = Object.fromEntries(Object.keys(PROFILES).map((k) => [k, footprint(k)]));
    // the kinds as the export names them (2026-11-08: the projector's zones follow the screens)
    const kindOf = Array.from({ length: rt.layout.channels }, (_, i) => profiles.kindOf(rt.layout, i));
    return { names: channelNames(rt.layout), kinds, kindOf };
  });
  if (rows.length !== info.names.length) fail(`${rows.length} rows, expected ${info.names.length}`);
  const used = new Map();
  let bad = 0;
  rows.forEach((r, i) => {
    const [name, , , type, u, au, a, fp] = r;
    const uni = Number(u);
    const addr = Number(a);
    const n = Number(fp);
    if (name !== info.names[i] || type !== info.kindOf[i] || n !== info.kinds[type] || Number(au) !== uni - 1 || addr < 1 || addr + n - 1 > 512) {
      bad++;
      if (bad < 4) console.log(`    row ${i + 1}: ${r.join(',')}`);
    }
    const set = used.get(uni) ?? used.set(uni, new Uint8Array(513)).get(uni);
    for (let k = addr; k < addr + n; k++) if (set[k]++) bad++;
  });
  if (bad) fail(`${bad} problems in the patch`);
  else {
    const per = [...used.entries()].map(([u, s]) => `U${u}: ${s.reduce((a, b) => a + (b ? 1 : 0), 0)}`).join(', ');
    console.log(`  ✓ patch: ${rows.length} fixtures, footprints as the profiles, none straddles 512, no overlaps (${per})`);
  }
}

/** RFC 4180 rows (quoted cells may hold commas, quotes and line breaks). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') row.push(cell), (cell = '');
    else if (c === '\r' && t[i + 1] === '\n') {
      row.push(cell), rows.push(row), (row = []), (cell = ''), i++;
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

function tcFor(opts) {
  const [h, m, s, f] = opts.timecodeStart.split(':').map(Number);
  const start = ((h * 60 + m) * 60 + s) * opts.fps + f;
  const p = (v) => String(v).padStart(2, '0');
  return (t) => {
    const n = (start + Math.round(t * opts.fps)) % (24 * 3600 * opts.fps);
    const sec = Math.floor(n / opts.fps);
    return `${p(Math.floor(sec / 3600))}:${p(Math.floor(sec / 60) % 60)}:${p(sec % 60)}:${p(n % opts.fps)}`;
  };
}

async function checkCues(text, opts) {
  const [head, ...rows] = parseCsv(text);
  if (head.join(',') !== 'time_s,timecode,section,target,what,media_server,label') fail(`header: ${head.join(',')}`);
  const want = await page.evaluate(async (range) => {
    const { cueTime } = await import('/src/show/cues.ts');
    const { sectionSpans, spanAt } = await import('/src/show/sections.ts');
    const file = window.__editor.preview.rt.show.file;
    const spans = sectionSpans(file, file.duration);
    const [a, b] = range ?? [-Infinity, Infinity];
    return file.cues
      .map((c, i) => ({ t: cueTime(c.t, file), i, label: c.label ?? '', clip: !!c.clip }))
      .filter((r) => Number.isFinite(r.t) && r.t >= a - 1e-9 && r.t <= b + 1e-9)
      .sort((x, y) => x.t - y.t || x.i - y.i)
      .map((r) => ({ ...r, section: spanAt(spans, r.t)?.name ?? '' }));
  }, opts.range);
  if (rows.length !== want.length) return fail(`${rows.length} cue rows, expected ${want.length}`);
  const tc = tcFor(opts);
  let bad = 0;
  rows.forEach((r, i) => {
    const w = want[i];
    // media_server: filled exactly for the cues that switch the picture
    if (Math.abs(Number(r[0]) - w.t) > 0.0005 || r[1] !== tc(w.t) || r[2] !== w.section || !r[3] || !r[4] || !!r[5] !== w.clip || r[6] !== w.label) {
      if (bad++ < 3) console.log(`    row ${i + 1}: ${r.join(' | ')}`);
    }
  });
  if (bad) fail(`${bad} cue rows differ`);
  else console.log(`  ✓ cue sheet: ${rows.length} cues in time order, time, timecode, section, media server (${want.filter((w) => w.clip).length} clips) and label as the file`);
}

async function checkPyro(text, opts) {
  const [head, ...rows] = parseCsv(text);
  if (head.join(',') !== 'event,launch_s,launch_tc,burst_s,site,tube,x,y,z,angle,tilt,shell,size_gou,colors,warning') fail(`header: ${head.join(',')}`);
  const want = await page.evaluate((range) => {
    const { show, layout } = window.__editor.preview.rt;
    const [a, b] = range ?? [-Infinity, Infinity];
    return show.bursts
      .filter((x) => x.parent === undefined && x.tLaunch >= a - 1e-9 && x.tLaunch <= b + 1e-9)
      .sort((x, y) => x.tLaunch - y.tLaunch || x.tube - y.tube || x.id - y.id)
      .map((x) => ({ launch: x.tLaunch, burst: x.tBurst, site: layout.tubes[x.tube].site, shell: x.shell, size: x.size }));
  }, opts.range);
  if (rows.length !== want.length) return fail(`${rows.length} shell rows, expected ${want.length}`);
  const tc = tcFor(opts);
  let bad = 0;
  rows.forEach((r, i) => {
    const w = want[i];
    const ok = Number(r[0]) === i + 1 && Math.abs(Number(r[1]) - w.launch) <= 0.0005 && r[2] === tc(w.launch) && Math.abs(Number(r[3]) - w.burst) <= 0.0005 && r[4] === w.site && r[11] === w.shell && Number(r[12]) === w.size && Number(r[3]) > Number(r[1]);
    if (!ok && bad++ < 3) console.log(`    row ${i + 1}: ${r.join(' | ')}`);
  });
  const warned = rows.filter((r) => r[14]).length;
  if (bad) fail(`${bad} shell rows differ`);
  else console.log(`  ✓ firing table: ${rows.length} shells by launch time, launch / burst / timecode as drawn${warned ? ` (${warned} with a warning)` : ''}`);
}

async function checkRecord(buf, opts) {
  const nl = buf.indexOf(10);
  const head = JSON.parse(buf.subarray(0, nl).toString('utf8'));
  const body = buf.subarray(nl + 1);
  const nU = head.universes.length;
  const [from, to] = opts.range ?? [0, Infinity];
  const dur = await page.evaluate(() => window.__editor.preview.rt.show.file.duration);
  const k0 = Math.ceil(from * opts.fps - 1e-6);
  const k1 = Math.floor(Math.min(to, dur) * opts.fps + 1e-6);
  if (head.format !== 'dmxrec' || head.fps !== opts.fps || head.timecodeStart !== opts.timecodeStart || head.firstFrame !== k0 || head.frames !== k1 - k0 + 1) fail(`header ${JSON.stringify(head)}`);
  if (body.length !== head.frames * nU * 512) return fail(`body ${body.length} bytes, expected ${head.frames * nU * 512}`);
  console.log(`  ✓ header and size: ${head.frames} frames × ${nU} universes (${head.universes.join(',')}) × 512`);
  const pick = head.frames <= sampleRows ? [...Array(head.frames).keys()] : [0, head.frames - 1, ...Array.from({ length: sampleRows - 2 }, () => Math.floor(Math.random() * head.frames))];
  // per sampled frame: [universe, address (1-based), bits, value 0..1 clipped, clipped?]
  const want = await page.evaluate(
    async ({ times }) => {
      const { evaluate } = await import('/src/show/cues.ts');
      const { PROFILES, buildPatch } = await import('/src/export/control/profiles.ts');
      const { show, layout } = window.__editor.preview.rt;
      const patch = buildPatch(layout);
      return times.map((t) => {
        const out = [];
        for (const e of patch.entries) {
          let at = e.address;
          for (const s of PROFILES[e.kind]) {
            let v = evaluate(show, e.channel, s.channel, t);
            if (s.deg) v = (v * 180) / Math.PI;
            const u = (v - s.min) / (s.max - s.min);
            out.push([e.universe, at, s.bits, Math.min(1, Math.max(0, u)), u > 1 + 1e-6 || u < -1e-6 ? 1 : 0]);
            at += s.bits / 8;
          }
        }
        return out;
      });
    },
    { times: pick.map((j) => (k0 + j) / opts.fps) },
  );
  const slot = new Map(head.universes.map((u, k) => [u, k]));
  let worst8 = 0;
  let worst16 = 0;
  let bad = 0;
  let clipped = 0;
  let checked = 0;
  pick.forEach((j, n) => {
    for (const [u, a, bits, v, c] of want[n]) {
      const o = (j * nU + slot.get(u)) * 512 + a - 1;
      const got = bits === 8 ? body[o] / 255 : (body[o] * 256 + body[o + 1]) / 65535;
      const d = Math.abs(got - v);
      if (bits === 8) worst8 = Math.max(worst8, d);
      else worst16 = Math.max(worst16, d);
      if (d > (bits === 8 ? 0.5 / 255 : 0.5 / 65535) + 1e-9) bad++;
      clipped += c;
      checked++;
    }
  });
  if (bad) fail(`${bad} of ${checked} DMX values off (worst 8-bit ${(worst8 * 255).toFixed(2)}/255, 16-bit ${(worst16 * 65535).toFixed(2)}/65535)`);
  else console.log(`  ✓ values: ${checked.toLocaleString()} DMX values in ${pick.length} frames match evaluate() (8-bit within ${(worst8 * 255).toFixed(2)}/255, 16-bit within ${(worst16 * 65535).toFixed(2)}/65535; ${clipped} clipped at the profile's range)`);
}

async function checkArtnet(path, opts) {
  const rec = readRecording(path);
  const find = indexRecording(rec);
  const ports = rec.head.universes.map((u) => u - 1);
  const sets = [];
  const raw = [];
  const sock = await listen({
    port: 6454,
    bind: '127.0.0.1',
    universes: ports,
    onSet: (s) => {
      sets.push(find(s));
      raw.push(s);
    },
  });
  // frames can repeat (a still stretch): compare with frame k itself
  const equals = (s, k) => ports.every((pa, u) => Buffer.compare(s.get(pa), rec.at(k - rec.head.firstFrame, u)) === 0);
  try {
    await page.evaluate(() => {
      document.getElementById('cx-btn').click();
      document.querySelector('#cx-pop [data-act="artnet"]').click();
      document.getElementById('an-host').value = '127.0.0.1';
      document.getElementById('an-port').value = '6454';
      document.getElementById('an-form').requestSubmit();
    });
    await page.waitForFunction(() => !document.getElementById('an-chip').hidden, null, { timeout: 10000 });
    // paused: each sampled frame must arrive exactly
    const k0 = rec.head.firstFrame;
    const ks = [k0, k0 + rec.head.frames - 1, ...Array.from({ length: 18 }, () => k0 + Math.floor(Math.random() * rec.head.frames))];
    let hit = 0;
    for (const k of ks) {
      await page.evaluate((t) => window.__editor.transport.seek(t), k / opts.fps);
      raw.length = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 2000 && !raw.some((x) => equals(x, k))) await new Promise((r) => setTimeout(r, 20));
      if (raw.some((x) => equals(x, k))) hit++;
      else console.log(`    frame ${k}: received ${[...new Set(sets)].slice(0, 5).join(',') || 'nothing'}`);
    }
    if (hit !== ks.length) fail(`artnet: ${hit} of ${ks.length} stepped frames arrived as recorded`);
    else console.log(`  ✓ Art-Net, paused: ${ks.length} frames stepped to, each received equal to the recording`);
    // playing: everything received is a frame of the recording
    await page.evaluate((t) => window.__editor.transport.seek(t), (k0 + rec.head.frames * 0.3) / opts.fps);
    sets.length = 0;
    await page.evaluate(() => window.__editor.transport.play());
    await new Promise((r) => setTimeout(r, 3000));
    await page.evaluate(() => window.__editor.transport.pause());
    const got = sets.length;
    const ok = sets.filter((k) => k >= 0).length;
    if (!got || ok !== got) fail(`artnet: playing, ${ok} of ${got} sets equal a frame of the recording`);
    else console.log(`  ✓ Art-Net, playing 3 s: ${got} sets received (${(got / 3).toFixed(1)} a second), all equal to frames of the recording`);
    await page.evaluate(() => document.getElementById('an-stop').click());
    await page.waitForFunction(() => document.getElementById('an-chip').hidden, null, { timeout: 5000 });
  } finally {
    sock.close();
  }
}

console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
