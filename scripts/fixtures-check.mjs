/**
 * The fixture table move (stage 5, editor-architecture 6b): record what the
 * editor's inspector shows and what the show file saves as, so a capture
 * before and after the move can be compared with `diff -r`.
 *
 *   node scripts/fixtures-check.mjs --out=shots/stage5/fixtures/before
 *
 * For each built-in version (lagoon, fantasia, hanabi): the saved show file
 * (show.json, as 保存 writes it), and for a sample of cues (the first plain,
 * macro, clip and fire cue of every lane, plus one of every macro) the
 * inspector as a list of rows: labels, input values, placeholders, the
 * options of every select and the hints (inspector-<n>.json). Also the
 * inspector with no cue selected (show settings). Needs the dev server.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const out = arg('out', 'shots/stage5/fixtures/now');
const versions = arg('show', 'lagoon,fantasia,hanabi').split(',');

const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5199/edit.html?quality=low&fresh');
await page.waitForFunction(() => window.__editorReady, null, { timeout: 60000 });
// the editor rebuilds its show once the music is analysed; wait for that
await page.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 120000, polling: 500 });
await page.waitForTimeout(500);

for (const v of versions) {
  const dir = `${out}/${v}`;
  mkdirSync(dir, { recursive: true });
  await page.evaluate((v) => {
    document.getElementById('file-btn').click();
    document.querySelector(`#file-pop [data-variant="${v}"]`).click();
  }, v);
  await page.waitForTimeout(400);
  const file = await page.evaluate(() => JSON.stringify(window.__editor.state.file, null, 1));
  writeFileSync(`${dir}/show.json`, file);
  // the cues to look at
  const picks = await page.evaluate(async () => {
    const { laneOf } = await import('/src/editor/model.ts');
    const cues = window.__editor.state.file.cues;
    const seen = new Map();
    cues.forEach((c, i) => {
      const kind = c.fire ? 'fire' : c.clip ? 'clip' : c.macro ? 'macro' : 'set';
      for (const key of [`${laneOf(c)}:${kind}`, c.macro ? `macro:${c.macro}` : '']) if (key && !seen.has(key)) seen.set(key, i);
    });
    return [...new Set(seen.values())].sort((a, b) => a - b);
  });
  const dump = () =>
    page.evaluate(() => {
      const host = document.getElementById('inspector');
      const rows = [];
      const walk = (el) => {
        if (el.style && el.style.display === 'none') return rows.push(`[hidden ${el.className}]`);
        const tag = el.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea') return rows.push(`${tag}.${el.className}(${el.type}) value=${JSON.stringify(el.value)}${el.checked ? " checked" : ""} ph=${JSON.stringify(el.placeholder ?? '')}${el.step ? ' step=' + el.step : ''}${el.disabled ? ' disabled' : ''}`);
        if (tag === 'select') return rows.push(`select.${el.className} value=${JSON.stringify(el.value)} [${[...el.options].map((o) => `${o.value}=${o.textContent}`).join(' | ')}]`);
        if (tag === 'datalist') return rows.push(`datalist [${[...el.options].map((o) => `${o.value}=${o.label}`).join(' | ')}]`);
        if (!el.children.length) return rows.push(`${tag}.${el.className} ${JSON.stringify(el.textContent)}${tag === 'span' && el.style.background ? ' bg=' + el.style.background : ''}${el.style.color ? ' color=' + el.style.color : ''}`);
        rows.push(`<${tag}.${el.className}>`);
        for (const k of el.children) walk(k);
        rows.push(`</${tag}>`);
      };
      for (const k of host.children) walk(k);
      return rows;
    });
  await page.evaluate(() => window.__editor.state.setSelection([]));
  writeFileSync(`${dir}/inspector-none.json`, JSON.stringify(await dump(), null, 1));
  for (const i of picks) {
    await page.evaluate((i) => window.__editor.state.setSelection([i], i), i);
    await page.waitForTimeout(30);
    writeFileSync(`${dir}/inspector-${i}.json`, JSON.stringify(await dump(), null, 1));
  }
  console.log(`${v}: show.json + ${picks.length} cues`);
}
if (errors.length) console.log('errors\n' + errors.join('\n'));
await browser.close();
process.exit(errors.length ? 1 : 0);
