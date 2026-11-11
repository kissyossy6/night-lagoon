/**
 * Capture what the editor and the player look like, to prove a change left
 * them untouched (compare two captures with scripts/pixel-diff.py, and the
 * *.json files with diff). Needs the dev server on :5199.
 *
 *   node scripts/look-capture.mjs --out=shots/stage1/before-1 [--autosave=shots/stage1/autosave.json]
 *
 * Writes
 *   editor.png / editor-timeline.png        fresh editor at t=50 (page, timeline canvas)
 *   editor-sel.png / editor-sel-timeline.png  same with a cue selected (inspector filled)
 *   editor-styles.json / editor-sel-styles.json  computed style of every element
 *   editor-autosave*.{png,json}             editor opened on the given autosave
 *   player.png / player-scope.png / player-overview.png / player-styles.json
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  }),
);
const out = args.out ?? 'shots/look';
mkdirSync(out, { recursive: true });
const launch = { headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const errors = [];

async function open(url, viewport, init) {
  const ctx = await browser.newContext({ viewport });
  if (init) await ctx.addInitScript(init.fn, init.arg);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  return page;
}

/** Every element's computed style, keyed by its path in the document. */
const dumpStyles = (page) =>
  page.evaluate(() => {
    const rows = {};
    const path = (el) => {
      const parts = [];
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const i = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0;
        parts.unshift(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}:${i}`);
      }
      return parts.join('>');
    };
    for (const el of [document.documentElement, ...document.querySelectorAll('*')]) {
      if (el.closest('svg') && el.tagName !== 'svg') continue;
      const cs = getComputedStyle(el);
      const o = {};
      for (let i = 0; i < cs.length; i++) {
        const k = cs[i];
        // custom properties are renamed by the token move; their uses are what matters
        if (k.startsWith('--')) continue;
        o[k] = cs.getPropertyValue(k);
      }
      rows[path(el)] = o;
    }
    return rows;
  });

const canvasPng = async (page, expr, file) => {
  const url = await page.evaluate(expr);
  if (url) writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
};

async function editorShots(page, tag) {
  await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(600);
  const tl = () => document.querySelector('#timeline canvas')?.toDataURL('image/png');
  await page.screenshot({ path: `${out}/${tag}.png` });
  await canvasPng(page, tl, `${out}/${tag}-timeline.png`);
  writeFileSync(`${out}/${tag}-styles.json`, JSON.stringify(await dumpStyles(page), null, 1));
}

// ------------------------------------------------------------------ editor
{
  const page = await open('http://localhost:5199/edit.html?fresh&t=50', { width: 1440, height: 900 });
  await editorShots(page, 'editor');
  // select the first plain fan cue so the inspector shows its fields
  await page.evaluate(() => {
    const { state, timeline } = window.__editor;
    const i = state.file.cues.findIndex((c) => c.target === 'fan' && !c.macro && c.set?.pressure !== undefined);
    state.setSelection([i], i);
    timeline.reveal(i);
    timeline.draw();
  });
  await editorShots(page, 'editor-sel');
  await page.context().close();
}
if (args.autosave) {
  const saved = readFileSync(args.autosave, 'utf8');
  const page = await open('http://localhost:5199/edit.html?t=50', { width: 1440, height: 900 }, {
    fn: (s) => localStorage.setItem('water-show-editor:v1', s),
    arg: saved,
  });
  await editorShots(page, 'editor-autosave');
  const file = await page.evaluate(() => window.__editor.state.file);
  writeFileSync(`${out}/editor-autosave-file.json`, JSON.stringify(file, null, 1));
  await page.context().close();
}

// ------------------------------------------------------------------ player
{
  const page = await open('http://localhost:5199/play.html?t=50', { width: 1280, height: 720 }, {
    fn: () => localStorage.setItem('water-show-scope', '1'),
  });
  await page.waitForFunction(() => !document.getElementById('go').disabled, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/player.png` });
  await canvasPng(page, () => document.getElementById('scope').toDataURL('image/png'), `${out}/player-scope.png`);
  await canvasPng(page, () => document.getElementById('overview').toDataURL('image/png'), `${out}/player-overview.png`);
  writeFileSync(`${out}/player-styles.json`, JSON.stringify(await dumpStyles(page), null, 1));
  await page.context().close();
}

console.log(errors.length ? 'errors: ' + errors.join(' | ').slice(0, 1500) : 'no console errors');
await browser.close();
