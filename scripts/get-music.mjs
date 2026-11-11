#!/usr/bin/env node
/**
 * ショーの背景音楽（public/music/background.mp3）を、元の録音から作る。
 *
 *   npm run music              … 録音を Wikimedia Commons から取ってきて作る
 *   npm run music -- --source <file.oga>   … 手元の録音から作る
 *   npm run music -- --force   … すでにあっても作り直す
 *
 * 曲は GitHub に入れていない（README の「音楽」）。そのかわり、作り方を
 * ここに残す：米国海兵隊バンドの「ラプソディー・イン・ブルー」
 * （パブリックドメイン）の冒頭 2.6〜179.1 秒と、最後の 1046 秒〜最後の和音を
 * つなぎ、scripts/music/gain.json の音量を掛け、最後の和音に残響を足す。
 * 元の手順は scripts/splice-ending.py（Python 版）。こちらは ffmpeg だけあれば動く。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/music/background.mp3');
const CACHE = resolve(ROOT, '.cache/music/US_Marine_Band_Rhapsody_in_Blue.oga');
const SOURCE_URL = 'https://upload.wikimedia.org/wikipedia/commons/c/cd/US_Marine_Band_Rhapsody_in_Blue.oga';
const SOURCE_PAGE = 'https://commons.wikimedia.org/wiki/File:US_Marine_Band_Rhapsody_in_Blue.oga';
const SOURCE_SHA1 = '9ed20c3d979af7a0198b70f368274677690694a0';

const SR = 44100;
const A_FROM = 2.6; // 録音の冒頭から（ショーの 0 秒）
const CUT = 176.5; // ショーのこの秒で、曲の最後へつなぐ
const B_FROM = 1046.0; // つなぐ先（録音の秒）
const END = 1076.3; // 最後の和音のあと、拍手の前（録音の秒）
const CHORD = 1075.49; // 最後の和音（録音の秒）
const XF = 0.04; // つなぎ目のクロスフェード（秒）
const TAIL = 0.45; // 最後のフェード（秒）
const RT60 = 5.0; // 足す残響の長さ（秒）

const args = process.argv.slice(2);
const force = args.includes('--force');
const sourceArg = args.includes('--source') ? args[args.indexOf('--source') + 1] : null;

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (existsSync(OUT) && !force) {
  console.log(`もうあります：public/music/background.mp3（作り直すときは npm run music -- --force）`);
  process.exit(0);
}
if (spawnSync('ffmpeg', ['-version']).status !== 0) {
  fail('ffmpeg が見つかりません。入れてからもう一度実行してください（Mac：brew install ffmpeg ／ Windows：winget install ffmpeg）。\n  曲がなくてもショーは無音で動きます。');
}

const sha1 = (file) => createHash('sha1').update(readFileSync(file)).digest('hex');

async function getSource() {
  if (sourceArg) {
    if (!existsSync(sourceArg)) fail(`ファイルがありません：${sourceArg}`);
    return resolve(sourceArg);
  }
  if (existsSync(CACHE) && sha1(CACHE) === SOURCE_SHA1) return CACHE;
  console.log(`元の録音を取ってきます（約 52 MB、パブリックドメイン）\n  ${SOURCE_PAGE}`);
  const res = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'water-show-setup/1.0' } });
  if (!res.ok) fail(`ダウンロードに失敗しました（${res.status}）。上のページから .oga を保存して、npm run music -- --source <ファイル> で作れます。`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, buf);
  if (sha1(CACHE) !== SOURCE_SHA1) fail('取ってきたファイルが、予定の録音と違います（中身の確認に失敗）。');
  return CACHE;
}

/** 録音の [from, from+dur) 秒を、44.1 kHz ステレオの float で読む。 */
function decode(file, from, dur) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(from), '-t', String(dur), '-i', file, '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-'], {
    maxBuffer: 1 << 30,
  });
  if (r.status !== 0) fail(`録音を読めませんでした：${r.stderr}`);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice();
}

/** その場で計算する FFT（長さは 2 の累乗）。 */
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
}

/** 決まった種の乱数（毎回同じ残響になる）。 */
function gaussian(seed) {
  let s = seed >>> 0;
  const u = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) + 1) / 4294967297;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

const source = await getSource();
console.log('曲を作っています…');
const { hop, gain } = JSON.parse(readFileSync(resolve(ROOT, 'scripts/music/gain.json'), 'utf8'));
const gainAt = (t) => {
  const x = t / hop;
  const i = Math.min(Math.floor(x), gain.length - 2);
  const f = Math.min(Math.max(x - i, 0), 1);
  return gain[i] * (1 - f) + gain[i + 1] * f;
};
const i = (t) => Math.round(t * SR);

// 冒頭（A）と曲の最後（B）を読み、音量を掛けてつなぐ
const a = decode(source, A_FROM, CUT + XF);
const b = decode(source, B_FROM, END + TAIL - B_FROM);
const nA = a.length / 2;
const nB = b.length / 2;
const nX = i(XF);
const start = nA - nX; // B が始まる位置（ショーの CUT 秒）
const n0 = start + nB;
const irN = i(RT60 * 1.4);
const y = new Float32Array((n0 + irN) * 2);
for (let k = 0; k < nA; k++) {
  const g = gainAt(k / SR) * (k >= start ? Math.cos(((k - start) / nX) * (Math.PI / 2)) : 1);
  y[2 * k] = a[2 * k] * g;
  y[2 * k + 1] = a[2 * k + 1] * g;
}
for (let k = 0; k < nB; k++) {
  const g = gainAt((start + k) / SR) * (k < nX ? Math.sin((k / nX) * (Math.PI / 2)) : 1);
  y[2 * (start + k)] += b[2 * k] * g;
  y[2 * (start + k) + 1] += b[2 * k + 1] * g;
}
const nT = i(TAIL);
for (let k = 0; k < nT; k++) {
  const f = (1 - k / (nT - 1)) ** 2;
  const at = n0 - nT + k;
  y[2 * at] *= f;
  y[2 * at + 1] *= f;
}

// 最後の和音に残響を足す（暗くなりながら消えるノイズを畳み込む）
const c0 = start + i(CHORD - B_FROM);
const segN = n0 - c0;
const L = segN + irN;
let F = 1;
while (F < L) F <<= 1;
const rnd = gaussian(1924);
const wet = [new Float64Array(L), new Float64Array(L)];
for (let ch = 0; ch < 2; ch++) {
  const ir = new Float64Array(irN);
  let z = 0;
  for (let k = 0; k < irN; k++) {
    const t = k / SR;
    const x = rnd() * Math.exp((-6.9 * t) / RT60);
    const al = Math.exp((-2 * Math.PI * (6000 * Math.exp(-t / 1.2) + 800)) / SR);
    z = (1 - al) * x + al * z;
    ir[k] = k < i(0.02) ? 0 : z;
  }
  const sr = new Float64Array(F);
  const si = new Float64Array(F);
  const hr = new Float64Array(F);
  const hi = new Float64Array(F);
  for (let k = 0; k < segN; k++) sr[k] = y[2 * (c0 + k) + ch];
  hr.set(ir);
  fft(sr, si, false);
  fft(hr, hi, false);
  for (let k = 0; k < F; k++) {
    const r = sr[k] * hr[k] - si[k] * hi[k];
    si[k] = sr[k] * hi[k] + si[k] * hr[k];
    sr[k] = r;
  }
  fft(sr, si, true);
  wet[ch].set(sr.subarray(0, L));
}
const rms = (get, from, to) => {
  let s = 0;
  for (let k = from; k < to; k++) s += get(k, 0) ** 2 + get(k, 1) ** 2;
  return Math.sqrt(s / (2 * (to - from)));
};
const dry = rms((k, ch) => y[2 * (c0 + k) + ch], 0, i(0.4));
const wetR = rms((k, ch) => wet[ch][k], i(0.4), i(0.8));
const scale = (dry * 0.7) / wetR; // 残響は和音より約 3 dB 小さく始まる
for (let k = 0; k < L; k++) {
  y[2 * (c0 + k)] += wet[0][k] * scale;
  y[2 * (c0 + k) + 1] += wet[1][k] * scale;
}
const total = y.length / 2;
const nE = i(0.5);
for (let k = total - nE; k < total; k++) {
  const f = (total - k) / nE;
  y[2 * k] *= f;
  y[2 * k + 1] *= f;
}

// mp3 にする（ピークだけ抑える）
mkdirSync(dirname(OUT), { recursive: true });
await new Promise((ok) => {
  const p = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', '-', '-af', 'alimiter=limit=0.95:level=disabled:attack=2:release=80', '-b:a', '192k', OUT], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  p.on('close', (code) => (code === 0 ? ok() : fail('mp3 にできませんでした')));
  p.stdin.end(Buffer.from(y.buffer));
});
console.log(`できました：public/music/background.mp3（${(total / SR).toFixed(1)} 秒）`);
console.log('注：演奏しているグローフェの1924年版の編曲は、米国外では著作権が残っている国があります。個人で楽しむ範囲で使ってください。');
