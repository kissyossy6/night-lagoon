/**
 * The fireworks sound, before and after a change (src/audio/pyro.ts against
 * a backup's), over a stretch of the 花火版: the fireworks alone, and mixed
 * with the music and the water as the player plays them (levels 1).
 *   node scripts/pyro-sound-ab.mjs --before=backups/2026-11-03-pre-sound [--from=156] [--to=212] [--out=shots/stage3/sound]
 *     [--strong='{"weight":7,...}']   also render the current code with these PyroFeel values ('strong')
 * Writes <out>/{before,after[,strong]}_{pyro,mix}.wav; turn them into m4a with ffmpeg.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const before = arg('before', 'backups/2026-11-03-pre-sound');
const from = Number(arg('from', '156'));
const to = Number(arg('to', '212'));
const out = arg('out', 'shots/stage3/sound');
const strongArg = process.argv.find((a) => a.startsWith('--strong='));
const strong = strongArg ? JSON.parse(strongArg.slice('--strong='.length)) : null;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle'] }).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5199/play.html?show=hanabi&shot=1&t=0');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const r = await page.evaluate(
  async ({ before, from, to, strong }) => {
    const { SHOW_DURATION } = await import('/src/show/song.ts');
    const { loadBackground } = await import('/src/audio/background.ts');
    const { analyseMusic } = await import('/src/audio/analysis.ts');
    const { renderSplash } = await import('/src/audio/splash.ts');
    const now = await import(`/${before}/src/audio/pyro.ts`);
    const next = await import('/src/audio/pyro.ts');
    const rt = window.__rt;
    const m = await loadBackground(new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 48000 }), SHOW_DURATION);
    const music = m.buffer;
    const sr = music.sampleRate;
    const water = renderSplash(rt.show, rt.layout, SHOW_DURATION, sr, analyseMusic(music).curves.level);
    const seat = rt.venue.seats.find((s) => s.id === 'audience').pos;
    const i0 = Math.round(from * sr);
    const n = Math.round((to - from) * sr);
    const wav = (chs) => {
      const v = new DataView(new ArrayBuffer(44 + n * 4));
      const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
      for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) v.setInt16(44 + i * 4 + c * 2, Math.max(-1, Math.min(1, chs[c](i0 + i))) * 32767, true);
      // base64: a plain array of this many numbers is too big to hand back
      const u = new Uint8Array(v.buffer);
      let bin = '';
      for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(bin);
    };
    const res = {};
    const runs = [['before', now], ['after', next]];
    if (strong) runs.push(['strong', next, { ...next.PYRO_FEEL, ...strong }]);
    for (const [name, mod, feel] of runs) {
      const t0 = performance.now();
      const p = feel ? mod.renderPyro(rt.show.bursts, seat, SHOW_DURATION, sr, feel) : mod.renderPyro(rt.show.bursts, seat, SHOW_DURATION, sr);
      const ms = performance.now() - t0;
      const ch = (b, c) => b.getChannelData(Math.min(c, b.numberOfChannels - 1));
      const P = [ch(p, 0), ch(p, 1)];
      const M = [ch(music, 0), ch(music, 1)];
      const W = [ch(water, 0), ch(water, 1)];
      let peak = 0;
      let rms = 0;
      for (let i = i0; i < i0 + n; i++) {
        peak = Math.max(peak, Math.abs(P[0][i]));
        rms += P[0][i] * P[0][i];
      }
      res[name] = {
        ms: Math.round(ms),
        peak: +peak.toFixed(3),
        rms: +Math.sqrt(rms / n).toFixed(4),
        pyro: wav([(i) => P[0][i], (i) => P[1][i]]),
        mix: wav([(i) => M[0][i] + W[0][i] + P[0][i], (i) => M[1][i] + W[1][i] + P[1][i]]),
      };
    }
    return res;
  },
  { before, from, to, strong },
);
for (const name of Object.keys(r)) {
  writeFileSync(`${out}/${name}_pyro.wav`, Buffer.from(r[name].pyro, 'base64'));
  writeFileSync(`${out}/${name}_mix.wav`, Buffer.from(r[name].mix, 'base64'));
  console.log(name, JSON.stringify({ ms: r[name].ms, peak: r[name].peak, rms: r[name].rms }));
}
console.log(errors.length ? `errors: ${errors.join('\n')}` : 'no page errors');
await browser.close();
