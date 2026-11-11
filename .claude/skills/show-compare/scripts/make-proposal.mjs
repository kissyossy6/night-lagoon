/**
 * Build a proposal show file without touching the project's code.
 * It builds a version WITH the music analysed (as the player does), then
 * runs your edit on it, and writes the ShowFile JSON for capture.mjs.
 *
 *   node .claude/skills/show-compare/scripts/make-proposal.mjs \
 *     --base=lagoon|fantasia|hanabi --edit=shots/<topic>/edit.mjs --out=shots/<topic>/proposal.json
 *
 * edit.mjs runs IN THE BROWSER PAGE (it may import project modules by URL):
 *   export default async function (show, { music, MUSIC, C, imp }) {
 *     // show.cues is the cue list; return the changed show
 *     show.cues = show.cues.filter((c) => !(c.t >= 92 && c.t < 96 && c.target.startsWith('whip')));
 *     show.cues.push({ t: 92.1, target: 'whip', set: { pressure: 0.8, color: C.gold }, dur: 1.2 });
 *     return show;
 *   }
 *   imp('/src/show/cues.ts') imports any project module.
 * Without --edit it writes the version as it is (a "now" file).
 * Needs the dev server on http://localhost:5199.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const base = arg('base', 'lagoon');
const editPath = arg('edit', '');
const out = arg('out', '');
if (!out) {
  console.error('--out=<file.json> is required');
  process.exit(2);
}
const editSrc = editPath ? readFileSync(resolve(editPath), 'utf8') : '';

const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
});
await page.goto('http://localhost:5199/lab.html?shot=1');
const result = await page.evaluate(
  async ({ base, editSrc }) => {
    const imp = (p) => import(/* @vite-ignore */ p);
    const chor = await imp('/src/show/choreography.ts');
    const { buildShow } = chor;
    // the show's colours: choreography.ts keeps them in a private const C (copied here)
    const C = chor.C ?? { cyan: '#00b4ff', blue: '#1e3cff', deep: '#0a1aff', green: '#3cff5a', purple: '#c03cff', magenta: '#ff2fb0', red: '#ff3000', orange: '#ff7a00', gold: '#ffb000', white: '#ffffff', pink: '#ff4fd0' };
    const { loadBackground } = await imp('/src/audio/background.ts');
    const { analyseMusic } = await imp('/src/audio/analysis.ts');
    const { SHOW_DURATION, MUSIC } = await imp('/src/show/song.ts');
    const { compileShow } = await imp('/src/show/cues.ts');
    const { buildLayout } = await imp('/src/show/layout.ts');
    const { getVenue } = await imp('/src/venues/index.ts');
    const m = await loadBackground(new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 44100 }), SHOW_DURATION);
    const music = m ? analyseMusic(m.buffer) : undefined;
    let show = buildShow(music, base);
    const before = show.cues.length;
    if (editSrc) {
      const url = URL.createObjectURL(new Blob([editSrc], { type: 'text/javascript' }));
      const mod = await import(/* @vite-ignore */ url);
      show = (await mod.default(structuredClone(show), { music, MUSIC, C, imp })) ?? show;
    }
    // ?show=edited swaps in the built-in ending when the file is shorter than the music
    if (!(show.duration >= SHOW_DURATION)) show.duration = SHOW_DURATION;
    let limited = [];
    try {
      limited = compileShow(show, buildLayout(getVenue(show.venue), 'low')).limited ?? [];
    } catch (e) {
      limited = [`compile failed: ${e}`];
    }
    return { show, before, after: show.cues.length, music: !!music, limited: limited.length, limitedSample: limited.slice(0, 5) };
  },
  { base, editSrc },
);
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(out, JSON.stringify(result.show));
console.log(`${out}: base=${base} cues ${result.before} -> ${result.after}, music analysed: ${result.music}`);
console.log(`head-speed-limited cues: ${result.limited}`, result.limited ? JSON.stringify(result.limitedSample) : '');
if (errors.length) console.log('page errors/warnings:\n' + errors.join('\n'));
await browser.close();
