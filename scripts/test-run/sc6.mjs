import { open, scenario, openPlayer, wait } from './lib.mjs';
import { execFileSync } from 'node:child_process';
const SCR = process.argv[2];
const S = scenario(6, '音量を変えて動画を書き出す');
const { browser, page, errors } = await open({ w: 1280, h: 720 });
page.on('console', (m) => /export|エラー|failed/i.test(m.text()) && console.log('console:', m.text().slice(0, 200)));
const FROM = 205, TO = 215;
async function run(label, pyroLevel) {
  await openPlayer(page, `show=hanabi&t=${FROM}`);
  await page.click('#go'); await wait(500);
  await page.evaluate(() => window.__clock.pause());
  await page.click('#vol-open');
  await page.$eval('#vol input[aria-label="花火の音量"]', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input')); }, pyroLevel);
  await page.mouse.click(600, 300);
  await page.click('#export-open');
  const dlg = {
    title: await page.textContent('#export h2'),
    legends: await page.$$eval('#export legend', (ls) => ls.map((l) => l.textContent.trim())),
    hasHqBox: (await page.locator('#export').innerText()).includes('書き出し用の高画質'),
  };
  await page.check('input[name=format][value=flat]');
  await page.check('input[name=camera][value=fixed]');
  await page.selectOption('#export-angle', 'audience').catch(() => {});
  await page.check('input[name=range][value=part]');
  await page.fill('#export-from', String(FROM)); await page.fill('#export-to', String(TO));
  await page.selectOption('#export-size', '1280x720'); await page.selectOption('#export-fps', '30');
  await page.dispatchEvent('#export-form', 'input');
  const note = await page.textContent('#export-note');
  const shotDlg = await S.shot(page, `dialog-${label}`);
  const t0 = Date.now();
  const dl = page.waitForEvent('download', { timeout: 900000 });
  await page.click('#export-go');
  await wait(4000);
  const state1 = await page.textContent('#export-state');
  const shotRun = await S.shot(page, `running-${label}`);
  const d = await dl;
  const secs = (Date.now() - t0) / 1000;
  const file = `${SCR}/${label}.mp4`;
  await d.saveAs(file);
  await wait(500);
  const fin = await page.textContent('#export-state');
  const err = await page.evaluate(() => document.getElementById('export-error').hidden ? '' : document.getElementById('export-error').textContent);
  const rec = await page.evaluate(() => window.__export);
  return { dlg, note, state1, fin, err, secs, file, name: d.suggestedFilename(), shotDlg, shotRun, rec };
}
const A = await run('pyro0', 0);
S.rec('6.1', A.dlg.title === '動画を書き出す' && !A.dlg.hasHqBox ? 'pass' : 'fail', `画面「${A.dlg.title}」、見出し ${A.dlg.legends.join('・')}。「書き出し用の高画質」の箱は ${A.dlg.hasHqBox ? '有る' : '無い'}。説明文「${A.note}」`, '', [A.shotDlg]);
console.log('A', A.name, A.secs, A.err, A.fin);
const B = await run('pyro100', 1);
for (const R of [A, B]) {}
// file analysis
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString());
const info = {};
for (const [k, R] of [['pyro0', A], ['pyro100', B]]) {
  const j = probe(R.file);
  const v = j.streams.find((s) => s.codec_type === 'video'), a = j.streams.find((s) => s.codec_type === 'audio');
  info[k] = { dur: Number(j.format.duration), size: Number(j.format.size), w: v?.width, h: v?.height, fps: v?.r_frame_rate, nb: v?.nb_frames, vcodec: v?.codec_name, acodec: a?.codec_name, adur: a ? Number(a.duration) : null };
}
const ok = (i) => i.w === 1280 && i.h === 720 && Math.abs(i.dur - 10) < 0.4 && i.acodec;
S.rec('6.2', ok(info.pyro0) && ok(info.pyro100) && !A.err && !B.err ? 'pass' : 'fail',
  `書き出しは最後まで進み、mp4 が2つ保存された。1つ目 ${info.pyro0.w}×${info.pyro0.h}・${info.pyro0.fps}・${info.pyro0.nb ?? '?'} コマ・長さ ${info.pyro0.dur.toFixed(2)} 秒・${(info.pyro0.size / 1e6).toFixed(1)} MB（${info.pyro0.vcodec}＋${info.pyro0.acodec}）／2つ目 ${info.pyro100.nb ?? '?'} コマ・長さ ${info.pyro100.dur.toFixed(2)} 秒・${(info.pyro100.size / 1e6).toFixed(1)} MB。名前 ${A.name}`, A.err || B.err ? `エラー表示: ${A.err} ${B.err}` : '', [A.shotRun]);
S.rec('6.6', !A.err && !B.err ? 'pass' : 'fail', `10 秒の範囲を書き出すのに ${A.secs.toFixed(0)} 秒・${B.secs.toFixed(0)} 秒かかった（記録の目安は約 2.5 分）。途中の表示「${A.state1}」、終わりの表示「${A.fin}」。赤いエラー文字は ${A.err || B.err ? '出た' : '出なかった'}`);
// audio analysis: decode mono 44.1k, compare low-band energy around the 205.99 chord (0.99 s into the clip)
execFileSync('python3', ['-c', `
import subprocess, numpy as np, json, sys
def load(f):
    raw = subprocess.run(['ffmpeg','-v','error','-i',f,'-f','f32le','-ac','1','-ar','44100','-'],capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)
def band(x, sr, lo, hi, t0, t1):
    seg = x[int(t0*sr):int(t1*sr)]
    F = np.abs(np.fft.rfft(seg*np.hanning(len(seg))))**2
    fr = np.fft.rfftfreq(len(seg), 1/sr)
    return float(F[(fr>=lo)&(fr<hi)].sum())
out = {}
for k in ['pyro0','pyro100']:
    x = load('${SCR}/'+k+'.mp4')
    out[k] = {'rms_all': float(np.sqrt((x**2).mean())), 'peak': float(np.abs(x).max()),
              'low_0_1': band(x,44100,40,400,0.0,0.9), 'low_1_3': band(x,44100,40,400,1.0,3.0),
              'dur': len(x)/44100}
json.dump(out, open('${SCR}/audio.json','w'))
`]);
const au = JSON.parse((await import('node:fs')).readFileSync(`${SCR}/audio.json`, 'utf8'));
const ratio = au.pyro100.low_1_3 / Math.max(1e-12, au.pyro0.low_1_3);
const pre = au.pyro100.low_0_1 / Math.max(1e-12, au.pyro0.low_0_1);
S.rec('6.3', ratio > 1.5 && pre > 0.7 && pre < 1.4 ? 'pass' : 'fail', `動画の音の測定（40〜400 Hz のエネルギー）：花火が開く 206 秒の少し後（動画の 1〜3 秒）は 花火100% が 花火0% の ${ratio.toFixed(1)} 倍、花火の前（0〜0.9 秒）は ${pre.toFixed(2)} 倍（ほぼ同じなら音楽と水音は同じ）。ピーク 0%: ${au.pyro0.peak.toFixed(2)}／100%: ${au.pyro100.peak.toFixed(2)}`, '聞いた印象はあなた（🔊）');
// frame: brightness vs player screenshot
const frames = {};
for (const k of ['pyro0', 'pyro100']) { execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '1.2', '-i', `${SCR}/${k}.mp4`, '-frames:v', '1', `${SCR}/${k}-f.png`]); }
execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '1.2', '-i', `${SCR}/pyro100.mp4`, '-frames:v', '1', '-q:v', '4', `${S.dir}/video-frame-1.2s.jpg`]);
await page.goto(`${(await import('./lib.mjs')).BASE}/play.html?show=hanabi&t=${FROM + 1.2}&shot=1`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const playerShot = await S.shot(page, 'player-1280x720-t206.2');
const lum = (f) => Number(execFileSync('python3', ['-c', `
import subprocess, numpy as np
raw = subprocess.run(['ffmpeg','-v','error','-i','${f}','-f','rawvideo','-pix_fmt','gray','-'],capture_output=True).stdout
print(float(np.frombuffer(raw,dtype=np.uint8).mean()))`]).toString());
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `${S.dir}/player-1280x720-t206.2.jpg`, `${SCR}/player.png`]);
const Lv = lum(`${SCR}/pyro100-f.png`), Lp = lum(`${SCR}/player.png`);
S.rec('6.5', Math.abs(Lv - Lp) / Lp < 0.2 ? 'pass' : 'fail', `206.2 秒の1コマの平均の明るさ：動画 ${Lv.toFixed(1)}／本番画面 ${Lp.toFixed(1)}（0〜255。差 ${(Math.abs(Lv - Lp) / Lp * 100).toFixed(0)}%。20% 以内なら合格）`, '', [`shots/test-run/6/video-frame-1.2s.jpg`, playerShot]);
S.rec('6.4', 'user', '動画の1コマ（上）と本番画面を見比べて、動画のほうが水の粒・映り込みが細かいか、動きのぶれが自然か（動画のぶれは1コマでは分からない。保存した動画を再生して見る必要がある）', '', ['shots/test-run/6/video-frame-1.2s.jpg', playerShot]);
S.rec('6.3-耳', 'user', '🔊 2つの動画の音を聞き比べる（花火0%の動画に花火の音が無く、100%には有ること）。測定は上の通り');
S.rec('6.7', 'skip', 'Vision Pro 形式（180° 立体）は、この確認では書き出していない（ファイルが大きく、時間もかかる。「範囲は 10〜15 秒」の決まりでも、片目 4096 で 3 秒の書き出しになる）');
S.rec('6.コンソール', errors.length ? 'fail' : 'pass', errors.length ? errors.slice(0, 3).join(' | ') : 'コンソールのエラー 0');
S.save({ info, au, secs: [A.secs, B.secs] });
await browser.close();
