/**
 * Our shells framed like the reference photos (shots/stage2/real/): a single
 * 10号 from about 500 m on the ground (Omagari), and a row of gold 10号 over
 * the water (Nagaoka's 尺玉 100 shots). Draws a show of its own in the page.
 *   node scripts/pyro-real-compare.mjs [--out=shots/stage2/real]
 */
import { chromium } from 'playwright';
const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=shots/stage2/real').slice(6);
const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const shots = [
  {
    name: 'ours_single_10go',
    size: [640, 960],
    cues: [{ t: 5, target: 'pyro:奥の陸[3-3]', fire: { shell: 'kiku', size: 10, colors: ['#ff3050', '#ffffff'] } }],
    t: 6.3,
    view: { pos: [0, 1.5, 240], target: [0, 190, -260], fov: 62 },
  },
  {
    name: 'ours_row_10go',
    size: [1280, 738],
    cues: [{ t: 5, target: 'pyro:奥の陸', fire: { shell: 'kiku', size: 10, colors: ['#ffb050'] } }],
    t: 6.4,
    view: { pos: [180, 2, 520], target: [-20, 230, -260], fov: 55 },
  },
];
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.size[0], height: s.size[1] } });
  await page.goto('http://localhost:5199/play.html?show=pyrotest&shot=1&t=0');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const info = await page.evaluate((s) => {
    const rt = window.__rt;
    rt.setShow({ title: 'compare', bpm: 120, beatsPerBar: 4, offset: 0, duration: 30, cues: s.cues });
    const cam = rt.stage.camera;
    cam.position.set(...s.view.pos);
    cam.lookAt(...s.view.target);
    cam.fov = s.view.fov;
    cam.updateProjectionMatrix();
    // let the smoke of the run settle in, frame by frame, then the frame itself
    for (let k = 60; k >= 0; k--) rt.render(s.t - k / 30);
    const b = rt.show.bursts[0];
    return { center: b.center, radius: b.radius };
  }, s);
  await page.screenshot({ path: `${out}/${s.name}.png` });
  console.log(s.name, JSON.stringify(info));
  await page.close();
}
await browser.close();
