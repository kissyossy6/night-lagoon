/**
 * What the venue's scenery (src/show/scenery.ts: banks, rails, people) costs
 * per frame at quality 高. Needs the dev server on :5199.
 *
 *   node scripts/scenery-cost.mjs [--t=10,63,178.6] [--show=lagoon] [--venue=plaza] [--rounds=12] [--size=1280x720] [--cam=audience]
 *
 * One page, one ShowRuntime (as the player builds it): at each time it draws
 * 10 frames with the scenery shown, 10 hidden, and again, for several rounds,
 * so a busy machine weighs on both alike (page loads alone vary by ±2 ms).
 * Each frame waits for the GPU (a pixel read). Prints the medians and the
 * difference, and what is drawn (people, rail boxes).
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const times = String(args.t ?? '10,63,178.6').split(',').map(Number);
const rounds = Number(args.rounds ?? 12);
const [w, h] = String(args.size ?? '1280x720').split('x').map(Number);
const launch = { headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: w, height: h } });
await page.goto('http://localhost:5199/lab.html');
const res = await page.evaluate(
  async ({ times, rounds, show, venue, cam }) => {
    const { ShowRuntime } = await import('/src/show/runtime.ts');
    const { projectionScreen } = await import('/src/screen/screen.ts');
    const { buildShow, variantOf } = await import('/src/show/choreography.ts');
    const { getVenue } = await import('/src/venues/index.ts');
    const { ANGLES, applyView, useVenueAngles } = await import('/src/show/cameras.ts');
    document.body.innerHTML = '<div id="st" style="position:fixed;inset:0"></div>';
    const v = getVenue(venue || undefined);
    const rt = new ShowRuntime(document.getElementById('st'), projectionScreen({ width: 1536, height: 288, every: 2 }), 'high', 1, v);
    const file = buildShow(undefined, variantOf(show));
    rt.setShow(venue ? { ...file, venue } : file);
    if (venue) useVenueAngles(rt.venue);
    applyView(rt.stage.camera, ANGLES[cam]);
    const gl = rt.stage.renderer.getContext();
    const px = new Uint8Array(4);
    const run = (t0, n) => {
      let t = t0;
      const a = performance.now();
      for (let i = 0; i < n; i++) {
        t += 1 / 60;
        rt.render(t);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      return (performance.now() - a) / n;
    };
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const out = [];
    for (const t of times) {
      rt.setScenery(true);
      run(t, 20);
      rt.setScenery(false);
      run(t, 20);
      const on = [];
      const off = [];
      for (let r = 0; r < rounds; r++) {
        rt.setScenery(true);
        on.push(run(t, 10));
        rt.setScenery(false);
        off.push(run(t, 10));
      }
      out.push({ t, on: med(on), off: med(off) });
    }
    return { out, people: rt.scenery.people, boxes: rt.scenery.posts };
  },
  { times, rounds, show: args.show ?? 'lagoon', venue: args.venue ?? '', cam: args.cam ?? 'audience' },
);
console.log(`quality 高, ${w}x${h}, show=${args.show ?? 'lagoon'}${args.venue ? ` venue=${args.venue}` : ''}, cam=${args.cam ?? 'audience'}, median of ${rounds} rounds (10 frames each); people ${res.people}, rail boxes ${res.boxes}`);
for (const { t, on, off } of res.out) console.log(`  t=${t}: 景色あり ${on.toFixed(2)} ms / なし ${off.toFixed(2)} ms  (${on - off >= 0 ? '+' : ''}${(on - off).toFixed(2)})`);
await browser.close();
