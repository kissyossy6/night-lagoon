/**
 * Check that the big fountain hits (geyser bursts) land on attacks of the music:
 * the nearest onset the waveform analysis found (src/audio/analysis.ts), and
 * the hand-measured landmark (MUSIC in src/show/song.ts) they belong to.
 */
import { chromium } from 'playwright';
const launchArgs = ['--use-gl=angle', '--ignore-gpu-blocklist'];
// Playwright's own Chromium can be missing after an upgrade; fall back to the installed Chrome
const b = await chromium
  .launch({ args: launchArgs })
  .catch(() => chromium.launch({ channel: 'chrome', headless: true, args: launchArgs }));
const p = await b.newPage();
await p.goto('http://localhost:5199/lab.html?shot=1');
const r = await p.evaluate(async () => {
  const { buildShow } = await import('/src/show/choreography.ts');
  const { loadBackground } = await import('/src/audio/background.ts');
  const { analyseMusic } = await import('/src/audio/analysis.ts');
  // the show the player builds: following the analysed background music
  const { SHOW_DURATION } = await import('/src/show/song.ts');
  const m = await loadBackground(new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 44100 }), SHOW_DURATION);
  const music = m ? analyseMusic(m.buffer) : undefined;
  const { buildLayout } = await import('/src/show/layout.ts');
  const { compileShow, CH } = await import('/src/show/cues.ts');
  const { MUSIC } = await import('/src/show/song.ts');
  const layout = buildLayout(undefined, 'low');
  const show = compileShow(buildShow(music), layout);
  const geysers = new Set(layout.groups.geyser);
  const starts = [...new Set(show.plain.filter((c) => geysers.has(c.fixture) && c.channel === CH.pressure && c.to >= 0.5).map((c) => +c.start.toFixed(2)))].sort((a, b) => a - b);
  const marks = Object.values(MUSIC);
  const attacks = music ? music.onsets.map((o) => o.t) : marks;
  const nearest = (list, t) => list.reduce((m, a) => (Math.abs(a - t) < Math.abs(m - t) ? a : m), 1e9);
  const firstOf = starts.filter((t, i) => i === 0 || t - starts[i - 1] > 0.6);
  return firstOf.map((t) => {
    const on = nearest(attacks, t);
    return { geyser: t, onset: +on.toFixed(3), offOnset: +(t - on).toFixed(3), landmark: nearest(marks, t) };
  });
});
console.table(r);
await b.close();
