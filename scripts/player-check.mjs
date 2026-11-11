/** End-to-end player check: music renders, start button plays, clock follows audio, seek works. */
import { chromium } from 'playwright';
const launchArgs = ['--use-gl=angle', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
// Playwright's own Chromium can be missing after an upgrade; fall back to the installed Chrome
const b = await chromium
  .launch({ args: launchArgs })
  .catch(() => chromium.launch({ channel: 'chrome', headless: true, args: launchArgs }));
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://localhost:5199/play.html');
const t0 = Date.now();
await p.waitForFunction(() => !document.getElementById('go').disabled, null, { timeout: 60000 });
console.log('music ready in', Date.now() - t0, 'ms:', await p.textContent('#start-status'));
await p.click('#go');
await p.waitForTimeout(3000);
const a = await p.evaluate(() => ({ t: window.__clock.time(), music: window.__clock.hasMusic, playing: window.__clock.playing }));
console.log('after 3 s:', a);
await p.evaluate(() => window.__clock.seek(126));
await p.waitForTimeout(2500);
console.log('seek 126 + 2.5 s ->', await p.evaluate(() => window.__clock.time()));
await p.screenshot({ path: 'shots/player.png' });
await p.keyboard.press('Space');
const paused = await p.evaluate(() => window.__clock.playing);
console.log('after Space playing =', paused);
console.log(errors.length ? 'errors: ' + errors.join(' | ') : 'no console errors');
await b.close();
