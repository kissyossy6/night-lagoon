/**
 * What the editor's selection outline (src/editor/outline.ts) costs per frame
 * of the 3D preview, at quality 高. Needs the dev server on :5199.
 *
 *   node scripts/outline-cost.mjs [--t=170] [--n=60]
 *
 * Frames are drawn back to back with the GPU finished each time (gl.finish),
 * with nothing selected and with one whole cue selected; the median ms each.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const t = Number(args.t ?? 170);
const n = Number(args.n ?? 60);
const launch = { headless: true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://localhost:5199/edit.html?fresh&quality=high&t=${t}`);
await page.waitForFunction(() => window.__editorReady === true, null, { timeout: 60000 });
await page.waitForFunction(() => window.__editor.transport.music !== 'loading', null, { timeout: 90000 }).catch(() => {});
const r = await page.evaluate(
  async ({ t, n }) => {
    const { buildShow } = await import('/src/show/choreography.ts');
    const ed = window.__editor;
    ed.state.load(buildShow(undefined, 'hanabi'));
    ed.transport.seek(t);
    await new Promise((res) => setTimeout(res, 1500));
    const gl = ed.preview.rt.stage.renderer.getContext();
    const time = () => {
      const ms = [];
      for (let k = 0; k < n; k++) {
        ed.preview.invalidate();
        const a = performance.now();
        ed.preview.frame(t + k * 1e-4);
        gl.finish();
        ms.push(performance.now() - a);
      }
      ms.sort((x, y) => x - y);
      return ms[Math.floor(ms.length / 2)];
    };
    // the whole cue that drives the whips at t (whip, fan and chaser in the 花火版 at 170 s)
    const i = ed.state.file.cues.findIndex((c) => c.target.replace(/\s/g, '').startsWith('whip,fan,ch'));
    const none = [];
    const sel = [];
    // alternate, so drift of the machine falls on both
    for (let round = 0; round < 6; round++) {
      ed.state.setSelection([], -1);
      time();
      none.push(time());
      ed.state.setSelection([i], i);
      time();
      sel.push(time());
    }
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const s = ed.preview.outline.sel;
    return { none: med(none), sel: med(sel), none2: Math.max(...none), selected: i, count: s.active.length + s.others.length };
  },
  { t, n },
);
console.log(`quality 高, t=${t}, median of ${n} frames (gl.finish each)`);
console.log(`  nothing selected : ${r.none.toFixed(2)} ms`);
console.log(`  cue #${r.selected} selected : ${r.sel.toFixed(2)} ms  (+${(r.sel - r.none).toFixed(2)})`);
console.log(`  (fixtures outlined: ${r.count}; medians of 6 alternating rounds)`);
await browser.close();
