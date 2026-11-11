/**
 * Light and shade of a show: how much lit water is up (sum of pressure x
 * height x light over every jet) against how loud the music is, per window.
 * Long stretches of big water while the music eases off are where the show
 * lacks 緩急.
 *
 *   node scripts/density-check.mjs [--show=lagoon|fantasia] [--step=2] [--from=0] [--to=210.5]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.join('=') || '1'];
  }),
);
const variant = args.show ?? 'fantasia';
const step = Number(args.step ?? 2);
const from = Number(args.from ?? 0);
const to = Number(args.to ?? 210.5);

const launchArgs = ['--use-gl=angle', '--ignore-gpu-blocklist'];
const b = await chromium
  .launch({ args: launchArgs })
  .catch(() => chromium.launch({ channel: 'chrome', headless: true, args: launchArgs }));
const p = await b.newPage();
await p.goto('http://localhost:5199/lab.html?shot=1');
const rows = await p.evaluate(
  async ({ variant, step, from, to }) => {
    const { buildShow } = await import('/src/show/choreography.ts');
    const { loadBackground } = await import('/src/audio/background.ts');
    const { analyseMusic } = await import('/src/audio/analysis.ts');
    const { buildLayout } = await import('/src/show/layout.ts');
    const { compileShow, evaluate, CH } = await import('/src/show/cues.ts');
    const { SHOW_DURATION } = await import('/src/show/song.ts');
    const m = await loadBackground(new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 44100 }), SHOW_DURATION);
    const music = m ? analyseMusic(m.buffer) : undefined;
    const layout = buildLayout(undefined, 'low');
    const show = compileShow(buildShow(music, variant), layout);
    const buf = m.buffer.getChannelData(0);
    const sr = m.buffer.sampleRate;
    const fixtures = layout.fixtures.filter((f) => f.type !== 'mist');
    const out = [];
    for (let t = from; t < to; t += step) {
      let water = 0;
      let groups = new Set();
      for (let s = 0; s < 4; s++) {
        const tt = t + (s / 4) * step;
        for (const f of fixtures) {
          const pr = evaluate(show, f.index, CH.pressure, tt);
          if (pr < 0.05) continue;
          const lit = Math.min(evaluate(show, f.index, CH.intensity, tt), 1.5);
          water += (pr * f.spec.height * lit) / 4;
          if (pr * lit > 0.2) groups.add(f.group);
        }
      }
      let e = 0;
      const a = Math.floor(t * sr);
      const n = Math.floor(step * sr);
      for (let i = 0; i < n; i += 4) e += buf[a + i] ** 2;
      out.push({ t, water: Math.round(water), db: +(10 * Math.log10(e / (n / 4) + 1e-12)).toFixed(1), groups: [...groups].sort().join(',') });
    }
    return out;
  },
  { variant, step, from, to },
);
await b.close();
const maxW = Math.max(...rows.map((r) => r.water));
for (const r of rows) {
  const w = Math.round((r.water / maxW) * 30);
  const m = Math.max(0, Math.round((r.db + 40) * 0.9));
  console.log(`${r.t.toFixed(1).padStart(6)}  水 ${'█'.repeat(w).padEnd(30)} 音 ${'▒'.repeat(m).padEnd(30)} ${r.groups}`);
}
