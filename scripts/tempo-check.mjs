/**
 * The beat hint (src/audio/analysis.ts estimateTempo) on real pieces, without sound:
 * the two composed scores are strict 120 BPM, the recording (Rhapsody in Blue)
 * is played freely and has no steady beat to find.
 *
 *   node scripts/tempo-check.mjs        (needs the dev server on :5199)
 */
import { chromium } from 'playwright';
const launch = { args: ['--mute-audio'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage();
await page.goto('http://localhost:5199/play.html?shot=1&t=0');
const out = await page.evaluate(async () => {
  const an = await import('/src/audio/analysis.ts');
  const bg = await import('/src/audio/background.ts');
  const res = {};
  const run = (name, buf) => {
    const f = an.analyseMusic(buf);
    const whole = an.estimateTempo(f.onsets);
    // the same on 30 s windows: does it hold through the piece?
    const parts = [];
    for (let a = 0; a + 30 <= buf.duration; a += 30) {
      const os = f.onsets.filter((o) => o.t >= a && o.t < a + 30).map((o) => ({ ...o, t: o.t - a }));
      const t = an.estimateTempo(os);
      parts.push(t ? `${a}s:${t.bpm}(${t.confidence.toFixed(2)})` : `${a}s:-`);
    }
    res[name] = { whole, onsets: f.onsets.length, parts: parts.join(' ') };
  };
  for (const [name, mod] of [['score', '/src/audio/score.ts'], ['original', '/src/audio/original-score.ts']]) {
    const m = await import(mod);
    run(name, await m.renderScore());
  }
  const r = await bg.loadBackground(new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 44100 }), 217);
  if (r) run('recording', r.buffer);
  return res;
});
await browser.close();
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
};
for (const k of ['score', 'original']) {
  const w = out[k].whole;
  ok(w && Math.abs(w.bpm - 120) <= 0.5, `${k}（120 BPM で作った曲）：${w ? `${w.bpm} BPM・最初の拍 ${w.offset} 秒・揃い ${w.confidence.toFixed(2)}` : '見つからない'}／30 秒ごと ${out[k].parts}`);
}
ok(out.recording && out.recording.whole === null, `録音（テンポが揺れる演奏）：目安を出さない／30 秒ごと ${out.recording?.parts}`);
console.log(failed ? `\n${failed} failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
