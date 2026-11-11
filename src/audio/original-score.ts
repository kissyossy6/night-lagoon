/**
 * Original score for the night fountain show — 100 % procedural WebAudio synthesis.
 * No samples, no external melodies: every note below is composed for this show.
 *
 * Timing follows src/show/song.ts (120 BPM, 4/4, bar = 2 s, 180 s).
 *
 *   intro      1–9   D major, slow detuned-saw pads (Dadd9 · Bm7 · Gmaj7 · Asus4–A)
 *   awakening  9–25  plucked arpeggio enters (8ths, then 16ths), sub bass, light drums from bar 17
 *   theme     25–41  main theme on a saw lead, full drums, hit + crash on bar 25
 *   story     41–57  B minor, FM piano melody + left-hand broken chords, heartbeat kick from bar 49
 *   build     57–65  arpeggio filter opens, noise/pitch riser, snare roll; G A Bm G C D Bsus4 B
 *                    everything stops on bar 64 beat 4 (riser end), half-beat breath
 *   finale    65–81  lift to E major: theme doubled in octaves + bell shimmer, big hits on 65 and 73
 *   coda      81–91  Amaj7 · B/A · G#m7 C#m7 · F#m7 Bsus4 → final hit Emaj9 on bar 85 beat 1, long tail
 *
 * Rendering is deterministic (seeded PRNG only). For speed the piece is rendered as
 * several OfflineAudioContexts in parallel (one per 16 s window, each with enough tail
 * for its notes, delay and reverb) and summed — the graph is purely linear so the sum is
 * the same piece. A lookahead limiter + peak normalisation runs on the summed buffer.
 */
import { BPM, SECONDS_PER_BAR, SCORE_DURATION } from '../show/song';

// ---------------------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------------------

export type AccentKind = 'hit' | 'crash' | 'downbeat' | 'riser-end' | 'soft';
export interface Accent {
  t: number;
  kind: AccentKind;
}
export interface MelodyNote {
  t: number;
  dur: number;
  midi: number;
}
export interface ChordSpan {
  t: number;
  dur: number;
  name: string;
}

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

const BEAT = 60 / BPM;
/** Seconds of bar (1-based) and beat (1-based, fractional allowed). */
const bt = (bar: number, beat = 1): number => (bar - 1) * SECONDS_PER_BAR + (beat - 1) * BEAT;
const hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, u: number): number => a + (b - a) * clamp(u, 0, 1);

/** The half-beat of silence before the finale: bar 64 beat 4 → bar 65 beat 1. */
const BREATH_FROM = bt(64, 4);
const BREATH_TO = bt(65);
const FINAL_HIT = bt(85);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------
// Harmony
// ---------------------------------------------------------------------------------------

const NOTE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  maj9: [0, 4, 7, 11, 14],
};

interface Chord {
  name: string;
  root: number; // pitch class
  bass: number; // pitch class (slash bass or root)
  iv: number[]; // intervals above root
}

function pcOf(letter: string, acc: string | undefined): number {
  const base = NOTE_PC[letter];
  if (base === undefined) throw new Error(`bad note ${letter}`);
  return (base + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
}

function parseChord(name: string): Chord {
  const m = /^([A-G])([#b]?)([a-z0-9]*)(?:\/([A-G])([#b]?))?$/.exec(name);
  if (!m) throw new Error(`bad chord ${name}`);
  const iv = QUALITY[m[3] ?? ''];
  if (!iv) throw new Error(`bad chord quality ${name}`);
  const root = pcOf(m[1] ?? 'C', m[2]);
  const bass = m[4] ? pcOf(m[4], m[5]) : root;
  return { name, root, bass, iv };
}

/** Lowest midi >= lo with the given pitch class. */
const place = (pc: number, lo: number): number => lo + ((((pc - lo) % 12) + 12) % 12);

/** Pad voicing: root in A2–G#3, root again an octave up, other tones in C4–B4. */
function padVoicing(ch: Chord): number[] {
  const low = place(ch.root, 45);
  const out = [low, low + 12];
  for (const iv of ch.iv) {
    if (iv % 12 === 0) continue;
    out.push(place((ch.root + iv) % 12, 60));
  }
  return out.sort((a, b) => a - b);
}

/** Arpeggio: root/3rd/5th in D4–C#5, then the same an octave up (6 notes). */
function arpNotes(ch: Chord): number[] {
  const tri = ch.iv.slice(0, 3).map((iv) => place((ch.root + iv) % 12, 62));
  tri.sort((a, b) => a - b);
  return [...tri, ...tri.map((n) => n + 12)];
}

/** Sub bass: E1–D#2. */
const subOf = (ch: Chord): number => place(ch.bass, 28);

/** One entry per bar (1-based index = bar). Space-separated chords split the bar evenly. */
const BARS: string[] = [
  // intro 1–8
  'Dadd9', 'Dadd9', 'Bm7', 'Bm7', 'Gmaj7', 'Gmaj7', 'Asus4', 'A',
  // awakening 9–24
  'D', 'A/C#', 'Bm', 'G', 'D', 'A', 'Gmaj7', 'Asus4 A',
  'D', 'A/C#', 'Bm', 'G', 'Em7', 'D/F#', 'Gmaj7', 'Asus4 A',
  // theme 25–40
  'D', 'A/C#', 'Bm', 'G', 'D', 'A', 'G', 'A',
  'D', 'A/C#', 'Bm', 'G', 'Em', 'D/F#', 'Em7 A7', 'D',
  // story 41–56 (B minor)
  'Bm', 'G', 'D', 'A', 'Bm', 'G', 'Em', 'F#',
  'G', 'A', 'F#m', 'Bm', 'G', 'A', 'Bm', 'Asus4 A',
  // build 57–64
  'G', 'A', 'Bm', 'G', 'C', 'D', 'Bsus4', 'B',
  // finale 65–80 (E major)
  'E', 'B/D#', 'C#m', 'A', 'E', 'B', 'A', 'B',
  'E', 'B/D#', 'C#m', 'A', 'F#m', 'E/G#', 'F#m7 B7', 'E',
  // coda 81–90
  'Amaj7', 'B/A', 'G#m7 C#m7', 'F#m7 Bsus4', 'Emaj9', 'Emaj9', 'Emaj9', 'Emaj9', 'Emaj9', 'Emaj9',
];

// ---------------------------------------------------------------------------------------
// Melodies — [midi, beats] per bar, 0 = rest
// ---------------------------------------------------------------------------------------

type Phrase = [number, number][][];

/** Main theme, D major (bars 25–40). Transposed +2 for the finale. */
const THEME: Phrase = [
  [[69, 1], [74, 1.5], [76, 0.5], [78, 1]],
  [[76, 3], [73, 0.5], [74, 0.5]],
  [[71, 1], [74, 1], [78, 2]],
  [[79, 1.5], [78, 0.5], [76, 1], [74, 1]],
  [[69, 1], [74, 1.5], [76, 0.5], [78, 1]],
  [[81, 3], [79, 0.5], [78, 0.5]],
  [[76, 1.5], [74, 0.5], [71, 1], [74, 1]],
  [[76, 4]],
  [[69, 1], [74, 1.5], [76, 0.5], [78, 1]],
  [[76, 3], [73, 0.5], [74, 0.5]],
  [[71, 1], [74, 1], [78, 1], [83, 1]],
  [[81, 1.5], [79, 0.5], [78, 1], [76, 1]],
  [[79, 2], [78, 1], [76, 1]],
  [[78, 2], [74, 1], [76, 1]],
  [[79, 1], [78, 1], [76, 1.5], [73, 0.5]],
  [[74, 4]],
];

/** Story melody, B minor (bars 41–56), FM piano. */
const STORY: Phrase = [
  [[78, 2], [76, 1], [74, 1]],
  [[74, 1.5], [71, 0.5], [71, 2]],
  [[69, 1], [74, 1], [78, 1], [81, 1]],
  [[79, 2], [76, 2]],
  [[78, 2], [76, 1], [74, 1]],
  [[74, 1.5], [76, 0.5], [83, 2]],
  [[81, 1], [79, 1], [78, 1], [76, 1]],
  [[78, 2], [70, 2]],
  [[71, 1], [74, 1], [79, 2]],
  [[78, 1], [76, 1], [73, 2]],
  [[73, 1], [76, 1], [81, 2]],
  [[78, 3], [74, 1]],
  [[76, 1], [74, 1], [71, 1], [74, 1]],
  [[73, 1], [76, 1], [81, 2]],
  [[78, 2], [76, 1], [74, 1]],
  [[76, 4]],
];

/** Coda (bars 81–84), E major: the theme's opening motif, slowed and resolved. */
const CODA: Phrase = [
  [[71, 1], [76, 1.5], [78, 0.5], [80, 1]],
  [[78, 4]],
  [[75, 2], [76, 2]],
  [[81, 2], [78, 2]],
];

function walkPhrase(p: Phrase, startBar: number, fn: (t: number, beats: number, midi: number) => void): void {
  p.forEach((bar, i) => {
    let beat = 1;
    for (const [m, b] of bar) {
      if (m > 0) fn(bt(startBar + i, beat), b, m);
      beat += b;
    }
  });
}

// ---------------------------------------------------------------------------------------
// Composition → event list
// ---------------------------------------------------------------------------------------

type Inst =
  | 'pad' | 'arp' | 'bass' | 'lead' | 'leadLow' | 'piano' | 'bell'
  | 'kick' | 'snare' | 'clap' | 'hat' | 'ohat' | 'crash' | 'swell' | 'tom'
  | 'boom' | 'stab' | 'riser';

interface Ev {
  i: Inst;
  t: number; // start, s
  d: number; // held duration, s
  m: number; // midi
  v: number; // velocity 0..1
  a?: number; // attack, s
  r?: number; // release, s
  f?: number; // instrument-specific (cutoff Hz, saw mix…)
  n: number; // deterministic per-event random 0..1
}

interface Composition {
  events: Ev[];
  accents: Accent[];
  melody: MelodyNote[];
  chords: ChordSpan[];
}

function compose(): Composition {
  const rng = mulberry32(0x5eed2024);
  const events: Ev[] = [];
  const accents: Accent[] = [];
  const melody: MelodyNote[] = [];
  const add = (e: Omit<Ev, 'n'>): void => {
    events.push({ ...e, n: rng() });
  };
  const accent = (t: number, kind: AccentKind): void => {
    accents.push({ t, kind });
  };
  /** Shorten anything that would ring into the breath. */
  const clipD = (t: number, d: number): number => (t < BREATH_FROM && t + d > BREATH_FROM ? BREATH_FROM - t : d);

  // ---- chord timeline
  const spans: { t: number; d: number; ch: Chord }[] = [];
  BARS.forEach((s, i) => {
    const parts = s.split(' ');
    const d = SECONDS_PER_BAR / parts.length;
    parts.forEach((p, k) => spans.push({ t: bt(i + 1) + k * d, d, ch: parseChord(p) }));
  });
  const chordAt = (t: number): Chord => {
    for (let k = spans.length - 1; k >= 0; k--) {
      const s = spans[k];
      if (s && s.t <= t + 1e-9) return s.ch;
    }
    return (spans[0] as { ch: Chord }).ch;
  };
  const chords: ChordSpan[] = spans.map((s) => ({ t: s.t, dur: s.d, name: s.ch.name }));

  // ---- section downbeats
  for (const t of [0, bt(9), bt(17), bt(25), bt(41), bt(57), bt(65), bt(81)]) accent(t, 'downbeat');

  // ---- pads (merge repeated chords into one sustained chord)
  const merged: { t: number; d: number; ch: Chord }[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && last.ch.name === s.ch.name) last.d += s.d;
    else merged.push({ ...s });
  }
  for (const s of merged) {
    const t = s.t;
    let v: number, a: number, r: number, d = s.d;
    if (t < bt(9)) [v, a, r] = [0.95, t === 0 ? 5 : 2.2, 2.5];
    else if (t < bt(25)) [v, a, r] = [0.55, 0.35, 1.0];
    else if (t < bt(41)) [v, a, r] = [0.62, 0.25, 0.9];
    else if (t < bt(57)) [v, a, r] = [0.42, 0.8, 1.6];
    else if (t < bt(65)) [v, a, r] = [lerp(0.58, 0.85, (t - bt(57)) / 16), 0.25, 0.9];
    else if (t < bt(81)) [v, a, r] = [0.8, 0.12, 0.9];
    else if (t < FINAL_HIT) [v, a, r] = [0.66, 0.3, 1.0];
    else [v, a, r, d] = [0.95, 0.015, SCORE_DURATION - 0.6 - (t + 5), 5];
    if (t < BREATH_FROM && t + d > BREATH_FROM) {
      d = BREATH_FROM - t;
      r = 0.06;
    }
    for (const m of padVoicing(s.ch)) add({ i: 'pad', t, d, m, v, a, r });
  }
  // intro chord changes are gentle choreography cues
  for (const t of [bt(3), bt(5), bt(7)]) accent(t, 'soft');

  // ---- arpeggio
  const ARP_PAT = [0, 1, 2, 3, 4, 5, 4, 3, 2, 3, 4, 5, 4, 3, 2, 1];
  for (let bar = 9; bar <= 84; bar++) {
    if (bar >= 41 && bar <= 56) continue; // story: piano instead
    const sixteenth = bar >= 17 && bar <= 80;
    const steps = sixteenth ? 16 : 8;
    const stepDur = SECONDS_PER_BAR / steps;
    for (let k = 0; k < steps; k++) {
      const t = bt(bar) + k * stepDur;
      if (bar === 64 && t >= BREATH_FROM) continue;
      let v: number, f: number;
      if (bar < 17) [v, f] = [lerp(0.22, 0.42, (bar - 9) / 7), lerp(1100, 2000, (bar - 9) / 8)];
      else if (bar < 25) [v, f] = [0.44, lerp(2000, 3000, (bar - 17) / 8)];
      else if (bar < 41) [v, f] = [0.36, 3200];
      else if (bar < 65) [v, f] = [lerp(0.3, 0.7, (t - bt(57)) / 16), 1100 * Math.pow(7, (t - bt(57)) / 15.5)];
      else if (bar < 81) [v, f] = [0.46, 4600];
      else [v, f] = [lerp(0.34, 0.2, (bar - 81) / 3), 2400];
      const strong = k % (steps / 4) === 0;
      v *= strong ? 1.15 : k % 2 === 1 ? 0.85 : 1;
      const notes = arpNotes(chordAt(t));
      const idx = ARP_PAT[sixteenth ? k : k * 2] ?? 0;
      add({ i: 'arp', t, d: stepDur, m: notes[idx] ?? 62, v, f });
    }
  }

  // ---- bass
  for (const s of spans) {
    const t = s.t;
    const m = subOf(s.ch);
    if (t < bt(9)) continue;
    if (t < bt(17)) add({ i: 'bass', t, d: s.d, m, v: lerp(0.25, 0.42, (t - bt(9)) / 14), f: 0, r: 0.4 });
    else if (t < bt(25)) {
      for (let q = 0; q < s.d / BEAT - 1e-6; q++) add({ i: 'bass', t: t + q * BEAT, d: BEAT * 0.85, m, v: 0.52, f: 0.25 });
    } else if (t < bt(40)) {
      for (let q = 0; q < s.d / (BEAT / 2) - 1e-6; q++)
        add({ i: 'bass', t: t + (q * BEAT) / 2, d: 0.2, m, v: q % 4 === 0 ? 0.68 : 0.58, f: 0.55 });
    } else if (t < bt(57)) add({ i: 'bass', t, d: s.d, m, v: 0.4, f: 0, r: 0.5 });
    else if (t < bt(65)) {
      for (let q = 0; q < s.d / (BEAT / 2) - 1e-6; q++) {
        const tq = t + (q * BEAT) / 2;
        if (tq >= BREATH_FROM) continue;
        const u = (tq - bt(57)) / 16;
        add({ i: 'bass', t: tq, d: 0.2, m, v: lerp(0.55, 0.8, u), f: lerp(0.5, 0.9, u) });
      }
    } else if (t < bt(80)) {
      const OCT = [0, 0, 12, 0, 0, 12, 0, 12];
      for (let q = 0; q < s.d / (BEAT / 2) - 1e-6; q++)
        add({ i: 'bass', t: t + (q * BEAT) / 2, d: 0.2, m: m + (OCT[q % 8] ?? 0), v: q % 4 === 0 ? 0.82 : 0.72, f: 0.9 });
    } else if (t < bt(81)) add({ i: 'bass', t, d: s.d, m, v: 0.7, f: 0.4, r: 0.6 });
    else if (t < FINAL_HIT) add({ i: 'bass', t, d: s.d, m, v: 0.55, f: 0.25, r: 0.2 });
  }
  add({ i: 'bass', t: FINAL_HIT, d: 5, m: 28, v: 0.95, f: 0.35, r: 5 });

  // ---- lead: main theme (D major)
  walkPhrase(THEME, 25, (t, beats, m) => {
    const dur = beats * BEAT;
    const v = t < bt(33) ? 0.66 : 0.76;
    add({ i: 'lead', t, d: dur * 0.94, m, v, r: 0.3 });
    melody.push({ t, dur, midi: m });
  });

  // ---- story: FM piano melody + left hand (B minor)
  walkPhrase(STORY, 41, (t, beats, m) => {
    const dur = beats * BEAT;
    add({ i: 'piano', t, d: dur + 0.3, m, v: 0.62 });
    melody.push({ t, dur, midi: m });
  });
  for (let bar = 41; bar <= 56; bar++) {
    for (let k = 0; k < 8; k++) {
      const t = bt(bar) + (k * BEAT) / 2;
      const ch = chordAt(t);
      const r = place(ch.root, 38);
      const third = r + 12 + (ch.iv[1] ?? 4);
      const LH = [r, r + 7, r + 12, third, r + 19, third, r + 12, r + 7];
      add({ i: 'piano', t, d: 0.9, m: LH[k] ?? r, v: k === 0 ? 0.36 : 0.26 });
    }
  }
  for (const bar of [45, 49, 53]) accent(bt(bar), 'soft');

  // ---- build: rising long lead notes over the riser
  const BUILD_LEAD: [number, number, number][] = [
    [57, 76, 4],
    [59, 78, 4],
    [61, 79, 2],
    [62, 81, 2],
    [63, 83, 4],
  ];
  for (const [bar, m, sec] of BUILD_LEAD) {
    const t = bt(bar);
    const d = clipD(t, sec);
    const u = (t - bt(57)) / 16;
    add({ i: 'lead', t, d: d - 0.04, m, v: lerp(0.32, 0.6, u), a: 0.3, r: t + d >= BREATH_FROM - 1e-6 ? 0.04 : 0.25 });
    melody.push({ t, dur: d, midi: m });
  }

  // ---- finale: theme in E, octave doubled, bell shimmer
  walkPhrase(THEME, 65, (t, beats, m0) => {
    const m = m0 + 2;
    const dur = beats * BEAT;
    add({ i: 'lead', t, d: dur * 0.94, m, v: 0.9, r: 0.3 });
    add({ i: 'leadLow', t, d: dur * 0.94, m: m - 12, v: 0.62, r: 0.3 });
    add({ i: 'bell', t, d: 3, m: m + 12, v: 0.22 });
    melody.push({ t, dur, midi: m });
  });

  // ---- coda melody + final note
  walkPhrase(CODA, 81, (t, beats, m) => {
    const dur = beats * BEAT;
    add({ i: 'lead', t, d: dur * 0.94, m, v: 0.56, a: 0.08, r: 0.4 });
    melody.push({ t, dur, midi: m });
  });
  add({ i: 'lead', t: FINAL_HIT, d: 4.5, m: 76, v: 0.62, a: 0.02, r: 4 });
  add({ i: 'leadLow', t: FINAL_HIT, d: 4.5, m: 64, v: 0.5, a: 0.02, r: 4 });
  melody.push({ t: FINAL_HIT, dur: 6, midi: 76 });

  // ---- bells: awakening sparkle, coda after the final hit
  for (let bar = 13; bar <= 23; bar += 2) {
    const ch = chordAt(bt(bar));
    add({ i: 'bell', t: bt(bar), d: 3, m: place(ch.root, 81), v: 0.3 });
  }
  const SPARKLE = [88, 83, 80, 78, 76];
  SPARKLE.forEach((m, k) => {
    const t = bt(86) + k * 2 * BEAT;
    add({ i: 'bell', t, d: 4, m, v: lerp(0.4, 0.22, k / 4) });
    accent(t, 'soft');
  });

  // ---- drums & effects
  const kick = (t: number, v: number): void => add({ i: 'kick', t, d: 0.5, m: 0, v });
  const snare = (t: number, v: number): void => add({ i: 'snare', t, d: 0.3, m: 0, v });
  const clap = (t: number, v: number): void => add({ i: 'clap', t, d: 0.3, m: 0, v });
  const hat = (t: number, v: number, open = false): void =>
    add({ i: open ? 'ohat' : 'hat', t, d: 0.1, m: 0, v: v * (0.88 + 0.24 * rng()) });
  const tom = (t: number, m: number, v: number): void => add({ i: 'tom', t, d: 0.5, m, v });
  const crash = (t: number, v: number): void => {
    add({ i: 'crash', t, d: 4, m: 0, v });
    accent(t, 'crash');
  };
  const swell = (tEnd: number, d: number, v: number): void => add({ i: 'swell', t: tEnd - d, d, m: 0, v });
  const bigHit = (t: number, ch: number[], v: number, stabDur = 0.5): void => {
    add({ i: 'boom', t, d: 2, m: 0, v });
    kick(t, Math.min(1, v + 0.1));
    for (const m of ch) add({ i: 'stab', t, d: stabDur, m, v: v * 0.9 });
    accent(t, 'hit');
  };

  // awakening: light drums from bar 17
  for (let bar = 17; bar <= 24; bar++) {
    kick(bt(bar, 1), 0.5);
    kick(bt(bar, 3), 0.42);
    if (bar < 24) snare(bt(bar, 4), 0.2);
    for (let e = 0; e < 8; e++) hat(bt(bar, 1 + e / 2), e % 2 ? 0.26 : 0.16);
  }
  for (let k = 0; k < 8; k++) snare(bt(24, 3 + k / 4), lerp(0.18, 0.62, k / 7));
  swell(bt(25), 1.5, 0.55);

  // theme: full groove
  for (let bar = 25; bar <= 40; bar++) {
    if (bar === 40) {
      kick(bt(40), 0.7);
      crash(bt(40), 0.5);
      continue;
    }
    kick(bt(bar, 1), 0.85);
    kick(bt(bar, 2.5), 0.55);
    kick(bt(bar, 3), 0.78);
    if (bar === 32) {
      snare(bt(bar, 2), 0.72);
      [50, 50, 47, 47, 45, 45, 43, 43].forEach((m, k) => tom(bt(bar, 3 + k / 4), m, lerp(0.45, 0.75, k / 7)));
      continue;
    }
    snare(bt(bar, 2), 0.72);
    snare(bt(bar, 4), 0.74);
    for (let e = 0; e < 8; e++) {
      const open = e === 7 && bar % 2 === 0;
      hat(bt(bar, 1 + e / 2), open ? 0.3 : e % 2 ? 0.3 : 0.2, open);
    }
  }
  bigHit(bt(25), [50, 57, 62, 66, 69], 0.78);
  crash(bt(25), 0.9);
  crash(bt(33), 0.72);

  // story: heartbeat kick in the second half
  for (let bar = 49; bar <= 56; bar++) {
    kick(bt(bar, 1), 0.34);
    kick(bt(bar, 1.75), 0.22);
  }

  // build: four-on-the-floor, snare roll accelerating, riser, cut on bar 64 beat 4
  for (let bar = 57; bar <= 64; bar++) {
    for (let b = 1; b <= 4; b++) {
      const t = bt(bar, b);
      if (t >= BREATH_FROM) continue;
      kick(t, lerp(0.55, 0.88, (t - bt(57)) / 16));
    }
    if (bar <= 60) for (let e = 0; e < 8; e++) hat(bt(bar, 1 + e / 2), e % 2 ? 0.24 : 0.14);
  }
  const ROLL: [number, number][] = [
    [61, 1],
    [62, 2],
    [63, 4],
    [64, 8],
  ];
  for (const [bar, perBeat] of ROLL) {
    for (let k = 0; k < 4 * perBeat; k++) {
      const t = bt(bar) + (k * BEAT) / perBeat;
      if (t >= BREATH_FROM) continue;
      snare(t, lerp(0.22, 0.95, Math.pow((t - bt(61)) / (BREATH_FROM - bt(61)), 1.4)));
    }
  }
  add({ i: 'riser', t: bt(57), d: BREATH_FROM - bt(57), m: 38, v: 0.75 });
  accent(BREATH_FROM, 'riser-end');

  // finale
  for (let bar = 65; bar <= 80; bar++) {
    if (bar === 80) continue; // resolution bar: one hit, then let it ring
    kick(bt(bar, 1), 0.95);
    kick(bt(bar, 2.5), 0.62);
    kick(bt(bar, 3), 0.88);
    if (bar % 2 === 0) kick(bt(bar, 4.5), 0.5);
    const fill = bar === 72 || bar === 76;
    snare(bt(bar, 2), 0.88);
    clap(bt(bar, 2), 0.6);
    if (!fill) {
      snare(bt(bar, 4), 0.9);
      clap(bt(bar, 4), 0.62);
    }
    for (let e = 0; e < 16; e++) {
      if (fill && e >= 8) continue;
      const open = e === 14 && bar % 2 === 1;
      hat(bt(bar, 1 + e / 4), open ? 0.32 : e % 4 === 2 ? 0.3 : e % 2 ? 0.14 : 0.2, open);
    }
    if (bar === 76) [52, 52, 50, 50, 47, 47, 45, 43].forEach((m, k) => tom(bt(bar, 3 + k / 4), m, lerp(0.5, 0.85, k / 7)));
  }
  // bar 72: two stabs leading into the big hit on bar 73
  for (const b of [3, 4]) {
    const t = bt(72, b);
    tom(t, 43, 0.85);
    bigHit(t, [47, 59, 63, 66], 0.62, 0.25);
  }
  bigHit(bt(65), [52, 59, 64, 68, 71], 1.0, 0.7);
  crash(bt(65), 1.0);
  crash(bt(69), 0.8);
  bigHit(bt(73), [52, 59, 64, 68, 71], 0.95, 0.6);
  crash(bt(73), 0.95);
  crash(bt(77), 0.8);
  bigHit(bt(80), [52, 59, 64, 68, 71], 0.85, 0.8);
  crash(bt(80), 0.85);

  // coda: half-time pulse, tom roll into the final hit
  for (let bar = 81; bar <= 84; bar++) {
    kick(bt(bar, 1), 0.5);
    if (bar < 84) snare(bt(bar, 3), 0.32);
    for (let q = 1; q <= 4; q++) hat(bt(bar, q), 0.14);
  }
  for (let k = 0; k < 16; k++) tom(bt(84) + (k * BEAT) / 4, k < 8 ? 40 : 43, lerp(0.2, 0.85, k / 15));
  swell(FINAL_HIT, 2, 0.6);
  bigHit(FINAL_HIT, [40, 52, 59, 63, 66, 68, 71], 1.0, 1.4);
  crash(FINAL_HIT, 1.0);

  events.sort((a, b) => a.t - b.t);
  const ORDER: AccentKind[] = ['hit', 'crash', 'riser-end', 'downbeat', 'soft'];
  accents.sort((a, b) => a.t - b.t || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  melody.sort((a, b) => a.t - b.t);
  return { events, accents, melody, chords };
}

const SCORE = compose();

/**
 * Musically important moments, sorted by time. Several kinds may share one time
 * (e.g. bar 65 = 'hit' + 'crash' + 'downbeat'); filter by kind rather than firing on every entry.
 *  - hit:       big drum hit (low boom + kick + brass-like stab chord)
 *  - crash:     crash cymbal
 *  - downbeat:  section start (intro, awakening, drums-in bar 17, theme, story, build, finale, coda)
 *  - riser-end: riser + snare roll stop dead (bar 64 beat 4); the finale hits half a beat later
 *  - soft:      gentle cues (intro chord changes, story phrase starts, coda bell sparkles)
 */
export const ACCENTS: Accent[] = SCORE.accents;

/** Top melody line: theme (bars 25–40), story piano (41–56), build (57–64), finale theme in E (65–80), coda. */
export const MELODY: MelodyNote[] = SCORE.melody;

/** Chord changes over the whole show (D major → B minor story → E major finale). */
export const CHORDS: ChordSpan[] = SCORE.chords;

// ---------------------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------------------

interface Shared {
  noise: AudioBuffer;
  ir: AudioBuffer;
}

function makeShared(sr: number): Shared {
  const rng = mulberry32(0xc0ffee);
  const nLen = sr * 3;
  const noise = new AudioBuffer({ length: nLen, numberOfChannels: 1, sampleRate: sr });
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nLen; i++) nd[i] = rng() * 2 - 1;

  // Algorithmic hall: pre-delay, exponentially decaying noise that darkens over time.
  const sec = 3.4;
  const iLen = Math.floor(sr * sec);
  const ir = new AudioBuffer({ length: iLen, numberOfChannels: 2, sampleRate: sr });
  const pre = Math.floor(sr * 0.022);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    const r = mulberry32(0xbeef + ch * 7919);
    let lp = 0;
    for (let i = pre; i < iLen; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.9 * t) / (sec - 0.03)) * Math.min(1, t / 0.012);
      const coef = 0.25 + 0.7 * Math.min(1, t / 2.2); // heavier smoothing later = darker tail
      lp = lp * coef + (r() * 2 - 1) * (1 - coef);
      d[i] = lp * env;
    }
  }
  return { noise, ir };
}

function env(p: AudioParam, s: number, a: number, d: number, r: number, lvl: number): void {
  const aa = Math.max(0.002, Math.min(a, d));
  p.setValueAtTime(0, s);
  p.linearRampToValueAtTime(lvl, s + aa);
  if (d > aa) p.setValueAtTime(lvl, s + d);
  p.linearRampToValueAtTime(0, s + d + Math.max(0.01, r));
}

function perc(p: AudioParam, s: number, lvl: number, tau: number, atk = 0.002): void {
  p.setValueAtTime(0, s);
  p.linearRampToValueAtTime(lvl, s + atk);
  p.setTargetAtTime(0, s + atk, tau);
}

/** Pad filter cutoff over the show (absolute seconds, Hz), exponential between points. */
const PAD_CUTOFF: [number, number][] = [
  [0, 650],
  [14, 1500],
  [16, 1500],
  [46, 2100],
  [48, 2600],
  [78, 2700],
  [80, 1200],
  [110, 1500],
  [112, 1300],
  [BREATH_FROM, 6500],
  [BREATH_TO, 4200],
  [158, 4400],
  [160, 2800],
  [FINAL_HIT, 3600],
  [SCORE_DURATION, 600],
];

function cutoffAt(t: number): number {
  for (let k = 1; k < PAD_CUTOFF.length; k++) {
    const p0 = PAD_CUTOFF[k - 1] as [number, number];
    const p1 = PAD_CUTOFF[k] as [number, number];
    if (t <= p1[0]) {
      const u = (t - p0[0]) / Math.max(1e-6, p1[0] - p0[0]);
      return p0[1] * Math.pow(p1[1] / p0[1], clamp(u, 0, 1));
    }
  }
  return (PAD_CUTOFF[PAD_CUTOFF.length - 1] as [number, number])[1];
}

/** Extra seconds an instrument rings after d + r (before reverb). */
const RING: Partial<Record<Inst, number>> = { crash: 5, boom: 3, bell: 4, piano: 1.2, stab: 1.6, arp: 0.7, swell: 0.1 };

class Segment {
  readonly c: OfflineAudioContext;
  private readonly t0: number;
  private readonly sh: Shared;
  private readonly master: GainNode;
  private readonly revIn: GainNode;
  private readonly dlyIn: GainNode;
  private readonly padBus: GainNode[];
  private readonly arpBus: GainNode;
  private readonly bassBus: GainNode;
  private readonly bassSawBus: GainNode;
  private readonly leadBus: GainNode;
  private readonly vib: GainNode;
  private readonly pianoBus: GainNode;
  private readonly bellBus: GainNode;
  private readonly drumBus: GainNode;
  private readonly snareBus: GainNode;
  private readonly clapBus: GainNode;
  private readonly hatBus: GainNode;
  private readonly crashBus: GainNode;
  private readonly tomBus: GainNode;
  private readonly boomNoiseBus: GainNode;
  private readonly stabBus: GainNode;
  private readonly riserBus: GainNode;

  constructor(c: OfflineAudioContext, t0: number, sh: Shared) {
    this.c = c;
    this.t0 = t0;
    this.sh = sh;
    const g = (v: number): GainNode => new GainNode(c, { gain: v });
    const bq = (type: BiquadFilterType, f: number, Q = 0.707, gain = 0): BiquadFilterNode =>
      new BiquadFilterNode(c, { type, frequency: f, Q, gain });
    const pan = (p: number): StereoPannerNode => new StereoPannerNode(c, { pan: p });
    const send = (from: AudioNode, to: AudioNode, amt: number): void => {
      from.connect(g(amt)).connect(to);
    };

    this.master = g(1);
    this.master.connect(c.destination);

    // reverb
    this.revIn = g(1);
    const conv = new ConvolverNode(c, { buffer: sh.ir });
    this.revIn.connect(bq('highpass', 180)).connect(conv).connect(g(0.75)).connect(this.master);

    // ping-pong-ish stereo delay (dotted 8th left, quarter right)
    this.dlyIn = g(1);
    for (const [time, p] of [
      [BEAT * 0.75, -0.7],
      [BEAT, 0.7],
    ] as const) {
      const d = new DelayNode(c, { delayTime: time, maxDelayTime: 2 });
      const lp = bq('lowpass', 2600);
      const fb = g(0.32);
      this.dlyIn.connect(d);
      d.connect(lp).connect(fb).connect(d);
      const out = pan(p);
      lp.connect(out);
      out.connect(this.master);
      send(out, this.revIn, 0.35);
    }

    // pads: three detune layers panned L / C / R into one automated lowpass
    const padFilter = bq('lowpass', cutoffAt(t0), 0.6);
    const padOut = g(1);
    padFilter.connect(padOut).connect(this.master);
    send(padOut, this.revIn, 0.55);
    this.padBus = [-0.65, 0, 0.65].map((p) => {
      const b = g(1);
      b.connect(pan(p)).connect(padFilter);
      return b;
    });
    const fq = padFilter.frequency;
    fq.setValueAtTime(cutoffAt(t0), 0);
    for (const [t, v] of PAD_CUTOFF) if (t > t0) fq.exponentialRampToValueAtTime(v, t - t0);

    this.arpBus = g(1);
    const arpPan = pan(0.15);
    this.arpBus.connect(arpPan).connect(this.master);
    send(this.arpBus, this.dlyIn, 0.3);
    send(this.arpBus, this.revIn, 0.25);

    this.bassBus = g(1);
    this.bassBus.connect(bq('lowpass', 220)).connect(this.master);
    this.bassSawBus = g(1);
    this.bassSawBus.connect(bq('lowpass', 750, 0.9)).connect(this.master);

    this.leadBus = g(1);
    const leadF = bq('lowpass', 3400, 0.7);
    this.leadBus.connect(bq('highpass', 160)).connect(leadF).connect(this.master);
    send(leadF, this.revIn, 0.5);
    send(leadF, this.dlyIn, 0.1);
    const lfo = new OscillatorNode(c, { frequency: 5.1 });
    this.vib = g(9); // cents
    lfo.connect(this.vib);
    lfo.start(0);

    this.pianoBus = g(1);
    this.pianoBus.connect(this.master);
    send(this.pianoBus, this.revIn, 0.65);
    send(this.pianoBus, this.dlyIn, 0.08);

    this.bellBus = g(1);
    this.bellBus.connect(pan(-0.2)).connect(this.master);
    send(this.bellBus, this.revIn, 0.7);
    send(this.bellBus, this.dlyIn, 0.25);

    this.drumBus = g(1);
    this.drumBus.connect(this.master);
    send(this.drumBus, this.revIn, 0.08);

    this.snareBus = g(1);
    const snF = bq('highpass', 750);
    this.snareBus.connect(snF).connect(bq('peaking', 4200, 1, 3)).connect(this.master);
    send(snF, this.revIn, 0.3);

    this.clapBus = g(1);
    const clF = bq('bandpass', 1350, 0.9);
    this.clapBus.connect(clF).connect(this.master);
    send(clF, this.revIn, 0.4);

    this.hatBus = g(1);
    this.hatBus.connect(bq('highpass', 7200)).connect(pan(0.3)).connect(this.master);

    this.crashBus = g(1);
    const crF = bq('highpass', 3200);
    this.crashBus.connect(crF).connect(bq('peaking', 7500, 0.8, 4)).connect(this.master);
    send(crF, this.revIn, 0.35);

    this.tomBus = g(1);
    this.tomBus.connect(this.master);
    send(this.tomBus, this.revIn, 0.25);

    this.boomNoiseBus = g(1);
    this.boomNoiseBus.connect(bq('lowpass', 280)).connect(this.master);

    this.stabBus = g(1);
    const stF = bq('lowpass', 2800, 0.9);
    this.stabBus.connect(stF).connect(this.master);
    send(stF, this.revIn, 0.6);

    this.riserBus = g(1);
    this.riserBus.connect(this.master);
    send(this.riserBus, this.revIn, 0.45);
  }

  private noiseSrc(s: number, n: number, loop = false): AudioBufferSourceNode {
    const src = new AudioBufferSourceNode(this.c, { buffer: this.sh.noise, loop });
    src.start(s, n * 2.5);
    return src;
  }

  play(e: Ev): void {
    const c = this.c;
    const s = e.t - this.t0;
    switch (e.i) {
      case 'pad': {
        const r = e.r ?? 1;
        const lvl = e.v * 0.042;
        for (let k = 0; k < 3; k++) {
          const o = new OscillatorNode(c, { type: 'sawtooth', frequency: hz(e.m), detune: (k - 1) * 11 + (e.n - 0.5) * 6 });
          const gn = new GainNode(c, { gain: 0 });
          env(gn.gain, s, e.a ?? 0.3, e.d, r, lvl);
          o.connect(gn).connect(this.padBus[k] as GainNode);
          o.start(s);
          o.stop(s + e.d + r + 0.05);
        }
        break;
      }
      case 'arp': {
        const f = e.f ?? 2000;
        const o = new OscillatorNode(c, { type: 'sawtooth', frequency: hz(e.m) });
        const lp = new BiquadFilterNode(c, { type: 'lowpass', Q: 3.5, frequency: f });
        lp.frequency.setValueAtTime(f, s);
        lp.frequency.exponentialRampToValueAtTime(Math.max(220, f * 0.12), s + 0.25);
        const gn = new GainNode(c, { gain: 0 });
        perc(gn.gain, s, e.v * 0.16, 0.11);
        o.connect(lp).connect(gn).connect(this.arpBus);
        o.start(s);
        o.stop(s + 0.7);
        break;
      }
      case 'bass': {
        const r = e.r ?? 0.05;
        const o = new OscillatorNode(c, { type: 'sine', frequency: hz(e.m) });
        const gn = new GainNode(c, { gain: 0 });
        env(gn.gain, s, 0.008, e.d, r, e.v * 0.5);
        o.connect(gn).connect(this.bassBus);
        o.start(s);
        o.stop(s + e.d + r + 0.02);
        if (e.f) {
          const o2 = new OscillatorNode(c, { type: 'sawtooth', frequency: hz(e.m + 12) });
          const g2 = new GainNode(c, { gain: 0 });
          env(g2.gain, s, 0.006, e.d, r, e.v * e.f * 0.1);
          o2.connect(g2).connect(this.bassSawBus);
          o2.start(s);
          o2.stop(s + e.d + r + 0.02);
        }
        break;
      }
      case 'lead':
      case 'leadLow': {
        const r = e.r ?? 0.3;
        const gn = new GainNode(c, { gain: 0 });
        const lvl = e.v * (e.i === 'lead' ? 0.075 : 0.07);
        env(gn.gain, s, e.a ?? 0.045, e.d, r, lvl);
        gn.connect(this.leadBus);
        const types: OscillatorType[] = e.i === 'lead' ? ['sawtooth', 'sawtooth'] : ['sawtooth', 'triangle'];
        types.forEach((type, k) => {
          const o = new OscillatorNode(c, { type, frequency: hz(e.m), detune: k ? 8 : -8 });
          this.vib.connect(o.detune);
          o.connect(gn);
          o.start(s);
          o.stop(s + e.d + r + 0.02);
        });
        break;
      }
      case 'piano': {
        const f = hz(e.m);
        const car = new OscillatorNode(c, { frequency: f });
        const mod = new OscillatorNode(c, { frequency: f });
        const mg = new GainNode(c, { gain: 0 });
        mg.gain.setValueAtTime(f * (1.4 + 1.4 * e.v), s);
        mg.gain.setTargetAtTime(f * 0.2, s + 0.002, 0.28);
        mod.connect(mg).connect(car.frequency);
        const gn = new GainNode(c, { gain: 0 });
        const tau = clamp(1.9 - (e.m - 48) * 0.035, 0.45, 1.9);
        perc(gn.gain, s, e.v * 0.26, tau, 0.004);
        gn.gain.setTargetAtTime(0, s + e.d, 0.18);
        car.connect(gn).connect(this.pianoBus);
        car.start(s);
        mod.start(s);
        car.stop(s + e.d + 1.2);
        mod.stop(s + e.d + 1.2);
        break;
      }
      case 'bell': {
        const f = hz(e.m);
        const car = new OscillatorNode(c, { frequency: f });
        const mod = new OscillatorNode(c, { frequency: f * 3.5 });
        const mg = new GainNode(c, { gain: 0 });
        mg.gain.setValueAtTime(f * 3.5 * 1.1, s);
        mg.gain.setTargetAtTime(f * 0.3, s + 0.002, 0.45);
        mod.connect(mg).connect(car.frequency);
        const gn = new GainNode(c, { gain: 0 });
        perc(gn.gain, s, e.v * 0.2, 1.1);
        car.connect(gn).connect(this.bellBus);
        car.start(s);
        mod.start(s);
        car.stop(s + e.d + 4);
        mod.stop(s + e.d + 4);
        break;
      }
      case 'kick': {
        const o = new OscillatorNode(c, { frequency: 150 });
        o.frequency.setValueAtTime(150, s);
        o.frequency.exponentialRampToValueAtTime(52, s + 0.07);
        o.frequency.exponentialRampToValueAtTime(40, s + 0.4);
        const gn = new GainNode(c, { gain: 0 });
        perc(gn.gain, s, e.v * 0.9, 0.14);
        o.connect(gn).connect(this.drumBus);
        o.start(s);
        o.stop(s + 0.9);
        break;
      }
      case 'snare': {
        const src = this.noiseSrc(s, e.n);
        const gn = new GainNode(c, { gain: 0 });
        perc(gn.gain, s, e.v * 0.42, 0.055, 0.001);
        src.connect(gn).connect(this.snareBus);
        src.stop(s + 0.45);
        const o = new OscillatorNode(c, { type: 'triangle', frequency: 200 });
        o.frequency.setValueAtTime(205, s);
        o.frequency.exponentialRampToValueAtTime(165, s + 0.08);
        const g2 = new GainNode(c, { gain: 0 });
        perc(g2.gain, s, e.v * 0.32, 0.04, 0.001);
        o.connect(g2).connect(this.drumBus);
        o.start(s);
        o.stop(s + 0.3);
        break;
      }
      case 'clap': {
        const src = this.noiseSrc(s, e.n);
        const gn = new GainNode(c, { gain: 0 });
        const p = gn.gain;
        const l = e.v * 0.5;
        p.setValueAtTime(0, s);
        for (const o of [0, 0.011, 0.022]) {
          p.setValueAtTime(l, s + o);
          p.setTargetAtTime(0, s + o + 0.0005, 0.004);
        }
        p.setValueAtTime(l * 0.8, s + 0.033);
        p.setTargetAtTime(0, s + 0.0335, 0.07);
        src.connect(gn).connect(this.clapBus);
        src.stop(s + 0.5);
        break;
      }
      case 'hat':
      case 'ohat': {
        const src = this.noiseSrc(s, e.n);
        const gn = new GainNode(c, { gain: 0 });
        perc(gn.gain, s, e.v * 0.24, e.i === 'hat' ? 0.018 : 0.13, 0.001);
        src.connect(gn).connect(this.hatBus);
        src.stop(s + (e.i === 'hat' ? 0.15 : 0.8));
        break;
      }
      case 'crash': {
        const src = this.noiseSrc(s, e.n, true);
        const gn = new GainNode(c, { gain: 0 });
        perc(gn.gain, s, e.v * 0.34, 0.9, 0.002);
        src.connect(gn).connect(this.crashBus);
        src.stop(s + 5.5);
        break;
      }
      case 'swell': {
        const src = this.noiseSrc(s, e.n, true);
        const gn = new GainNode(c, { gain: 0 });
        gn.gain.setValueAtTime(0.0005, s);
        gn.gain.exponentialRampToValueAtTime(e.v * 0.3, s + e.d - 0.005);
        gn.gain.linearRampToValueAtTime(0, s + e.d);
        src.connect(gn).connect(this.crashBus);
        src.stop(s + e.d + 0.01);
        break;
      }
      case 'tom': {
        const f = hz(e.m);
        const o = new OscillatorNode(c, { frequency: f * 1.8 });
        o.frequency.setValueAtTime(f * 1.8, s);
        o.frequency.exponentialRampToValueAtTime(f, s + 0.06);
        const gn = new GainNode(c, { gain: 0 });
        perc(gn.gain, s, e.v * 0.55, 0.2);
        o.connect(gn).connect(this.tomBus);
        o.start(s);
        o.stop(s + 1.3);
        break;
      }
      case 'boom': {
        const o = new OscillatorNode(c, { frequency: 85 });
        o.frequency.setValueAtTime(85, s);
        o.frequency.exponentialRampToValueAtTime(31, s + 0.9);
        const gn = new GainNode(c, { gain: 0 });
        perc(gn.gain, s, e.v * 0.85, 0.55, 0.003);
        o.connect(gn).connect(this.drumBus);
        o.start(s);
        o.stop(s + 4);
        const src = this.noiseSrc(s, e.n);
        const g2 = new GainNode(c, { gain: 0 });
        perc(g2.gain, s, e.v * 0.9, 0.12, 0.001);
        src.connect(g2).connect(this.boomNoiseBus);
        src.stop(s + 1);
        break;
      }
      case 'stab': {
        const gn = new GainNode(c, { gain: 0 });
        const lvl = e.v * 0.055;
        const p = gn.gain;
        p.setValueAtTime(0, s);
        p.linearRampToValueAtTime(lvl, s + 0.008);
        p.setTargetAtTime(lvl * 0.3, s + 0.008, 0.16);
        p.setTargetAtTime(0, s + e.d, 0.28);
        gn.connect(this.stabBus);
        for (const det of [-10, 10]) {
          const o = new OscillatorNode(c, { type: 'sawtooth', frequency: hz(e.m), detune: det });
          o.connect(gn);
          o.start(s);
          o.stop(s + e.d + 1.6);
        }
        break;
      }
      case 'riser': {
        const end = s + e.d;
        const src = this.noiseSrc(s, e.n, true);
        const bp = new BiquadFilterNode(c, { type: 'bandpass', frequency: 250, Q: 2.5 });
        bp.frequency.setValueAtTime(250, s);
        bp.frequency.exponentialRampToValueAtTime(9000, end);
        const gn = new GainNode(c, { gain: 0 });
        gn.gain.setValueAtTime(0.0005, s);
        gn.gain.exponentialRampToValueAtTime(e.v * 0.55, end - 0.01);
        gn.gain.linearRampToValueAtTime(0, end);
        src.connect(bp).connect(gn).connect(this.riserBus);
        src.stop(end + 0.02);

        const o = new OscillatorNode(c, { type: 'sawtooth', frequency: hz(e.m) });
        o.frequency.setValueAtTime(hz(e.m), s);
        o.frequency.exponentialRampToValueAtTime(hz(e.m + 36), end);
        const lp = new BiquadFilterNode(c, { type: 'lowpass', frequency: 400, Q: 4 });
        lp.frequency.setValueAtTime(400, s);
        lp.frequency.exponentialRampToValueAtTime(7000, end);
        const g2 = new GainNode(c, { gain: 0 });
        g2.gain.setValueAtTime(0.0005, s);
        g2.gain.exponentialRampToValueAtTime(e.v * 0.08, end - 0.01);
        g2.gain.linearRampToValueAtTime(0, end);
        o.connect(lp).connect(g2).connect(this.riserBus);
        o.start(s);
        o.stop(end + 0.02);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------
// Master processing
// ---------------------------------------------------------------------------------------

/** Lookahead peak limiter (block-based) followed by peak normalisation to `ceiling`. */
function master(L: Float32Array, R: Float32Array, sr: number, ceiling: number): void {
  const n = L.length;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i] as number), Math.abs(R[i] as number));
  if (peak <= 0) return;
  const pre = 1 / peak;
  const th = 0.6; // limit the top ~4.4 dB of transients
  const B = 32;
  const nb = Math.ceil(n / B);
  const g = new Float32Array(nb);
  for (let b = 0; b < nb; b++) {
    let pk = 0;
    const e = Math.min(n, (b + 1) * B);
    for (let i = b * B; i < e; i++) pk = Math.max(pk, Math.abs(L[i] as number), Math.abs(R[i] as number));
    pk *= pre;
    g[b] = pk > th ? th / pk : 1;
  }
  const blk = B / sr;
  const atkStep = blk / 0.004; // reach full reduction within 4 ms ahead of the peak
  const relStep = blk / 0.25;
  for (let b = nb - 2; b >= 0; b--) g[b] = Math.min(g[b] as number, (g[b + 1] as number) + atkStep);
  for (let b = 1; b < nb; b++) g[b] = Math.min(g[b] as number, (g[b - 1] as number) + relStep);
  for (let i = 0; i < n; i++) {
    const b = Math.floor(i / B);
    const u = (i % B) / B;
    const g0 = g[b] as number;
    const g1 = b + 1 < nb ? (g[b + 1] as number) : g0;
    const k = pre * Math.min(g0, g0 + (g1 - g0) * u);
    L[i] = (L[i] as number) * k;
    R[i] = (R[i] as number) * k;
  }
  let p2 = 0;
  for (let i = 0; i < n; i++) p2 = Math.max(p2, Math.abs(L[i] as number), Math.abs(R[i] as number));
  const k = ceiling / p2;
  // 0.4 s fade at the very end so the show closes on true silence
  const fade = Math.floor(sr * 0.4);
  for (let i = 0; i < n; i++) {
    const f = i >= n - fade ? (n - i) / fade : 1;
    L[i] = (L[i] as number) * k * f;
    R[i] = (R[i] as number) * k * f;
  }
}

// ---------------------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------------------

/** Window size for parallel offline rendering (seconds). */
const SEGMENT = 16;
/** Reverb (3.4 s) + delay feedback tail rendered past each window's last note. */
const TAIL = 4.5;
/** Output peak (-1.4 dBFS). */
const CEILING = 0.85;

export async function renderScore(sampleRate = 44100): Promise<AudioBuffer> {
  const sh = makeShared(sampleRate);
  const total = Math.round(SCORE_DURATION * sampleRate);
  const jobs: Promise<{ off: number; buf: AudioBuffer }>[] = [];

  for (let t0 = 0; t0 < SCORE_DURATION; t0 += SEGMENT) {
    const t1 = Math.min(SCORE_DURATION, t0 + SEGMENT);
    const evs = SCORE.events.filter((e) => e.t >= t0 && e.t < t1);
    let end = t1;
    for (const e of evs) end = Math.max(end, e.t + e.d + (e.r ?? 0) + (RING[e.i] ?? 0.3));
    end = Math.min(SCORE_DURATION, end + TAIL);
    const off = Math.round(t0 * sampleRate);
    const length = Math.min(total - off, Math.ceil((end - t0) * sampleRate));
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
    const seg = new Segment(ctx, t0, sh);
    for (const e of evs) seg.play(e);
    jobs.push(ctx.startRendering().then((buf) => ({ off, buf })));
  }

  const parts = await Promise.all(jobs);
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  for (const { off, buf } of parts) {
    const l = buf.getChannelData(0);
    const r = buf.getChannelData(1);
    const n = Math.min(buf.length, total - off);
    for (let i = 0; i < n; i++) {
      L[off + i] = (L[off + i] as number) + (l[i] as number);
      R[off + i] = (R[off + i] as number) + (r[i] as number);
    }
  }
  master(L, R, sampleRate, CEILING);

  const out = new AudioBuffer({ length: total, numberOfChannels: 2, sampleRate });
  out.copyToChannel(L, 0);
  out.copyToChannel(R, 1);
  return out;
}
