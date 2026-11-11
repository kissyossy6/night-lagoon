/**
 * Audio check page logic (tools/audio-check.html): renders the score, measures it and
 * publishes the numbers on window.__audioReport. A Play button lets a human listen.
 */
import { renderScore, ACCENTS, MELODY } from './score';
import { SCORE_SECTIONS as SECTIONS, SECONDS_PER_BAR } from '../show/song';

interface SectionStat {
  name: string;
  from: number;
  to: number;
  rms: number;
  rmsDb: number;
  peak: number;
}

interface AudioReport {
  renderMs: number;
  renderMs2: number;
  /** Chrome sums fan-in connections in a non-fixed order, so two renders can differ by a few float ULPs (~1e-7). */
  maxDiffBetweenRenders: number;
  deterministic: boolean;
  sampleRate: number;
  duration: number;
  peak: number;
  peakDb: number;
  clippedSamples: number;
  sections: SectionStat[];
  accents: number;
  melodyNotes: number;
  /** Onset strength at 'hit' accents: RMS(t..t+60ms) / RMS(t-150ms..t). */
  hitOnsets: { t: number; ratio: number }[];
  /** RMS just after vs just before the riser end (should drop). */
  riserEndDrop: number;
  error?: string;
}

declare global {
  interface Window {
    __audioReport?: AudioReport | { error: string };
  }
}

const db = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);

function rms(buf: AudioBuffer, t0: number, t1: number): number {
  const a = Math.max(0, Math.floor(t0 * buf.sampleRate));
  const b = Math.min(buf.length, Math.floor(t1 * buf.sampleRate));
  let s = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = a; i < b; i++) s += (d[i] as number) ** 2;
  }
  return Math.sqrt(s / Math.max(1, (b - a) * buf.numberOfChannels));
}

/** Largest sample difference between two renders. */
function maxDiff(a: AudioBuffer, b: AudioBuffer): number {
  let m = 0;
  for (let ch = 0; ch < a.numberOfChannels; ch++) {
    const x = a.getChannelData(ch);
    const y = b.getChannelData(ch);
    for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs((x[i] as number) - (y[i] as number)));
  }
  return m;
}

const out = document.getElementById('out') as HTMLPreElement;
const btn = document.getElementById('play') as HTMLButtonElement;

async function main(): Promise<void> {
  out.textContent = 'rendering…';
  const t0 = performance.now();
  const buf = await renderScore();
  const renderMs = performance.now() - t0;
  const t1 = performance.now();
  const buf2 = await renderScore();
  const renderMs2 = performance.now() - t1;

  let peak = 0;
  let clipped = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i] as number);
      if (v > peak) peak = v;
      if (v >= 1) clipped++;
    }
  }
  const sections: SectionStat[] = SECTIONS.map((s) => {
    const a = (s.from - 1) * SECONDS_PER_BAR;
    const b = Math.min(buf.duration, (s.to - 1) * SECONDS_PER_BAR);
    const r = rms(buf, a, b);
    let pk = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = Math.floor(a * buf.sampleRate); i < Math.floor(b * buf.sampleRate); i++) pk = Math.max(pk, Math.abs(d[i] as number));
    }
    return { name: s.name, from: a, to: b, rms: +r.toFixed(5), rmsDb: +db(r).toFixed(2), peak: +pk.toFixed(4) };
  });
  const hitOnsets = ACCENTS.filter((a) => a.kind === 'hit').map((a) => ({
    t: a.t,
    ratio: +(rms(buf, a.t, a.t + 0.06) / Math.max(1e-9, rms(buf, a.t - 0.15, a.t))).toFixed(2),
  }));
  const re = ACCENTS.find((a) => a.kind === 'riser-end');
  const riserEndDrop = re ? +(rms(buf, re.t + 0.05, re.t + 0.45) / rms(buf, re.t - 0.4, re.t)).toFixed(3) : NaN;

  const report: AudioReport = {
    renderMs: Math.round(renderMs),
    renderMs2: Math.round(renderMs2),
    maxDiffBetweenRenders: maxDiff(buf, buf2),
    deterministic: maxDiff(buf, buf2) < 1e-5,
    sampleRate: buf.sampleRate,
    duration: buf.duration,
    peak: +peak.toFixed(4),
    peakDb: +db(peak).toFixed(2),
    clippedSamples: clipped,
    sections,
    accents: ACCENTS.length,
    melodyNotes: MELODY.length,
    hitOnsets,
    riserEndDrop,
  };
  window.__audioReport = report;
  out.textContent = JSON.stringify(report, null, 2);

  let ctx: AudioContext | null = null;
  let src: AudioBufferSourceNode | null = null;
  btn.disabled = false;
  btn.onclick = () => {
    if (src) {
      src.stop();
      src = null;
      btn.textContent = 'Play';
      return;
    }
    ctx ??= new AudioContext({ sampleRate: buf.sampleRate });
    src = new AudioBufferSourceNode(ctx, { buffer: buf });
    src.connect(ctx.destination);
    src.start();
    btn.textContent = 'Stop';
  };
}

main().catch((e: unknown) => {
  window.__audioReport = { error: String(e) };
  out.textContent = String(e);
});
