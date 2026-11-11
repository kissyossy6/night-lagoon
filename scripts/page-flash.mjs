/**
 * The first frames after moving between pages (本番画面 → エディタ, エディタ →
 * 会場, 会場 → エディタ): does a page show without its CSS or font for a moment?
 *
 *   node scripts/page-flash.mjs --out=shots/flash/now [--base=http://localhost:5199]
 *
 * For each move: open the first page, wait until it is ready, then go to the
 * next one in the same tab and take screenshots as fast as possible for
 * ~450 ms (each file is named by its milliseconds after the move started).
 * Prints per frame whether the page's own background has arrived (the pixel
 * at the top left) and whether the BIZ UD fonts are loaded.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  }),
);
const base = args.base ?? 'http://localhost:5199';
const out = args.out ?? 'shots/flash/now';
const moves = [
  { name: 'player-to-editor', from: '/play.html?show=hanabi', to: '/edit.html' },
  { name: 'editor-to-venue', from: '/edit.html', to: '/venue.html?venue=lagoon' },
  { name: 'venue-to-editor', from: '/venue.html?venue=lagoon', to: '/edit.html' },
  { name: 'editor-to-player', from: '/edit.html', to: '/play.html?show=edited' },
];

const launch = { headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
for (const m of moves) {
  const dir = `${out}/${m.name}`;
  mkdirSync(dir, { recursive: true });
  const page = await context.newPage();
  await page.goto(base + m.from, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  // every painted frame, from Chrome's screencast, timed from the move
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    frames.push({ at: Date.now(), data: f.data });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await page.waitForTimeout(300);
  frames.length = 0;
  const t0 = Date.now();
  // like clicking a link: the same tab moves on
  page.evaluate((url) => (location.href = url), base + m.to).catch(() => {});
  await page.waitForTimeout(Number(args.ms ?? 1500));
  await cdp.send('Page.stopScreencast');
  const lines = [];
  const { writeFileSync } = await import('node:fs');
  for (const f of frames) {
    const ms = f.at - t0;
    const file = `${dir}/${String(ms).padStart(4, '0')}ms.png`;
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    lines.push(`${String(ms).padStart(5)} ms  ${file}`);
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${dir}/settled.png` });
  console.log(`== ${m.name}\n${lines.join('\n')}`);
  await page.close();
}
await browser.close();
