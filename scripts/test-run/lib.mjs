/**
 * Helpers for the scenario run (docs/test-scenarios.md). Needs the dev server on :5199.
 * Audio is off: headless Chromium with --mute-audio, and a fresh profile (its own
 * localStorage), so the user's browser settings are never touched.
 *
 * Results go to shots/test-run/results/<n>.json; scripts/test-run/report.mjs builds the HTML.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

export const BASE = 'http://localhost:5200';
export const ROOT = new URL('../../', import.meta.url).pathname;

export async function open({ w = 1280, h = 720 } = {}) {
  const launch = { headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--mute-audio'] };
  const browser = process.env.CHROME ? await chromium.launch({ ...launch, channel: 'chrome' }) : await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { browser, ctx, page, errors };
}

/** one scenario's record */
export function scenario(n, title) {
  const rows = [];
  const dir = `${ROOT}shots/test-run/${n}`;
  mkdirSync(dir, { recursive: true });
  return {
    n, title, rows, dir,
    /** status: pass | fail | user (user judges) | skip (could not try) | info */
    rec(id, status, text, note = '', shots = []) {
      rows.push({ id, status, text, note, shots });
      console.log(`${n}.${id} [${status}] ${text}${note ? ' — ' + note : ''}`);
    },
    async shot(page, name, opts = {}) {
      const file = `${dir}/${name}.jpg`;
      await page.screenshot({ path: file, type: 'jpeg', quality: 72, ...opts });
      return `shots/test-run/${n}/${name}.jpg`;
    },
    save(extra = {}, part = '') {
      writeFileSync(`${ROOT}shots/test-run/results/${n}${part}.json`, JSON.stringify({ n, title, rows, ...extra }, null, 1));
    },
  };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** player: open a url, wait until it is ready for the start button */
export async function openPlayer(page, qs = '') {
  await page.goto(`${BASE}/play.html?${qs}`);
  await page.waitForFunction(() => document.getElementById('go') && !document.getElementById('go').disabled, null, { timeout: 90000 });
}
export async function startShow(page) {
  await page.click('#go');
  await wait(600);
}

/** editor: open fresh, load a version through ファイル ▾, wait for the music analysis */
export async function openEditor(page, qs = 'fresh', variant = null) {
  await page.goto(`${BASE}/edit.html?${qs}`);
  await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 120000 }).catch(() => {});
  if (variant) {
    await page.click('#file-btn');
    await page.click(`#file-pop [data-act="variant"][data-variant="${variant}"]`);
    await wait(1500);
  }
}
/** the input of an inspector row by its label */
export const inspRow = (page, label) => page.locator('#inspector .row', { has: page.locator('label', { hasText: new RegExp('^' + label + '$') }) });

export async function openVenue(page, qs = 'venue=lagoon') {
  await page.goto(`${BASE}/venue.html?${qs}`);
  await page.waitForFunction(() => window.__venueEditor, null, { timeout: 60000 });
  await wait(500);
}
/** a labelled input inside a venue-screen section */
export const vrow = (page, scope, label) => page.locator(`${scope} .row`, { has: page.locator('label', { hasText: new RegExp('^' + label + '$') }) });
export async function vfill(page, scope, label, v, nth = 0) {
  const el = vrow(page, scope, label).locator('input').nth(nth);
  await el.fill(String(v)); await el.press('Enter'); await wait(250);
}

import { execFileSync } from 'node:child_process';
/** mean brightness (0-255) and the share of near-white / near-black pixels of an image */
export function imgStats(file) {
  const out = execFileSync('python3', ['-I', '-c', `
import sys, json
from PIL import Image
import numpy as np
a = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(float)
g = a.mean(axis=2)
print(json.dumps({'mean': float(g.mean()), 'white': float((a.min(axis=2) >= 245).mean()), 'dark': float((g < 20).mean())}))`, file]).toString();
  return JSON.parse(out);
}

/** player: the bar hides itself while playing; bring it back */
export async function wake(pp) {
  await pp.mouse.move(640, 690); await pp.mouse.move(650, 695);
  await pp.evaluate(() => document.getElementById('bar')?.classList.remove('idle'));
}
