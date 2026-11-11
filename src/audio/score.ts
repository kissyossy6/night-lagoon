/**
 * Score for the night fountain show: an arrangement after George Gershwin's
 * Rhapsody in Blue (1924; the composition is in the public domain in Japan and
 * the US), played on sampled instruments.
 *
 * Melodic material is taken from Gershwin's own piano score (1927 solo
 * edition, first page): the clarinet's trill and rising run into a
 * glissando, and the opening theme that follows. Everything else (the 3-minute
 * form, harmonisation, orchestration, the variations in the story, build and
 * finale) is arranged for this show; no Grofé orchestration is used.
 *
 * Samples: FluidR3 GM by Frank Wen, CC BY 3.0, via gleitz/midi-js-soundfonts
 * (public/samples/fluidr3, every third semitone; notes in between are pitched
 * from the nearest sample). Drums and cymbals are synthesised.
 *
 * Timing follows src/show/song.ts (120 BPM, 4/4, bar = 2 s, 180 s), so the
 * choreography's sections and big hits keep their places:
 *
 *   intro      1–9   clarinet trill, run and glissando; the theme, slow (♩ = 80)
 *   awakening  9–25  piano takes the theme over stride bass; trumpet answers;
 *                    rhythm section from bar 17; the trill motif climbs to F7
 *   theme     25–41  full orchestra, hit + crash on 25; development; theme in
 *                    E♭ on the crash at 33; cadence, cut at bar 40 beat 3
 *   story     41–57  the theme as a slow nocturne in E♭: clarinet, then strings
 *   build     57–65  the trill motif as an ostinato climbing a semitone at a time,
 *                    timpani and snare rolls; everything stops on bar 64 beat 4
 *   finale    65–81  the theme grandioso; hits on 65, 69, 73; a breath at 75:3
 *                    where the clarinet's run and glissando return, hit on 77
 *   coda      81–91  piano alone, the trill again, final B♭ chord on bar 85
 *
 * Rendering is deterministic: the piece is rendered as several
 * OfflineAudioContexts in parallel (one per 16 s window plus tails) and summed,
 * then limited and normalised.
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
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, u: number): number => a + (b - a) * clamp(u, 0, 1);

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

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "Bb5" → 82. */
function n(name: string): number {
  const m = /^([A-G])(b|#)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + (PC[m[1] as string] as number) + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0);
}

// ---------------------------------------------------------------------------------------
// Harmony
// ---------------------------------------------------------------------------------------

const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7],
  '6': [0, 4, 7, 9],
  '69': [0, 4, 7, 9, 14],
  m: [0, 3, 7],
  m6: [0, 3, 7, 9],
  m7: [0, 3, 7, 10],
  '7': [0, 4, 7, 10],
  '9': [0, 4, 7, 10, 14],
  maj7: [0, 4, 7, 11],
  dim7: [0, 3, 6, 9],
};

interface Chord {
  name: string;
  root: number;
  bass: number;
  iv: number[];
}

function parseChord(name: string): Chord {
  const m = /^([A-G])(b|#)?([a-z0-9]*)(?:\/([A-G])(b|#)?)?$/.exec(name);
  if (!m) throw new Error(`bad chord ${name}`);
  const pc = (l: string, a: string | undefined) => ((PC[l] as number) + (a === 'b' ? -1 : a === '#' ? 1 : 0) + 12) % 12;
  const iv = QUALITY[m[3] ?? ''];
  if (!iv) throw new Error(`bad chord quality ${name}`);
  const root = pc(m[1] as string, m[2]);
  return { name, root, bass: m[4] ? pc(m[4], m[5]) : root, iv };
}

/** Lowest midi >= lo with the given pitch class. */
const place = (pc: number, lo: number): number => lo + ((((pc - lo) % 12) + 12) % 12);

/** Chord tones from 'lo' upward, root first, one of each. */
function voicing(ch: Chord, lo: number): number[] {
  const out = ch.iv.map((iv) => place((ch.root + iv) % 12, lo));
  return out.sort((a, b) => a - b);
}

/** Transpose a chord name by semitones (sharps for black keys only where flats read worse). */
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
function transposeChord(name: string, semis: number): string {
  return name.replace(/([A-G])(b|#)?/g, (_, l: string, a: string | undefined) => {
    const pc = ((PC[l] as number) + (a === 'b' ? -1 : a === '#' ? 1 : 0) + semis + 24) % 12;
    return NAMES[pc] as string;
  });
}

// ---------------------------------------------------------------------------------------
// Material from Gershwin
// ---------------------------------------------------------------------------------------

/** [note, start beat, length in beats] in the score's own beats (♩ = 80 in the original). */
type Line = [string, number, number][];

/**
 * The opening theme, as it follows the clarinet's glissando (concert pitch,
 * B♭ major): the held B♭ with its blue triplets, the descending phrase with
 * the flattened sevenths and thirds, and the trill motif on F – B♭.
 */
const THEME: Line = [
  // the note the glissando lands on, then two triplets
  ['Bb5', 0, 2],
  ['Ab5', 2, 1 / 3],
  ['F5', 2 + 1 / 3, 1 / 3],
  ['Ab5', 2 + 2 / 3, 1 / 3],
  ['Bb5', 3, 1 / 3],
  ['G5', 3 + 1 / 3, 1 / 3],
  ['F5', 3 + 2 / 3, 1 / 3],
  // descending, chromatic back up
  ['F5', 4, 0.5],
  ['Eb5', 4.5, 0.5],
  ['Db5', 5, 0.5],
  ['Db5', 5.5, 0.5],
  ['Eb5', 6, 0.5],
  ['E5', 6.5, 0.5],
  ['F5', 7, 1],
  // the fall to F
  ['F5', 8, 0.5],
  ['D5', 8.5, 0.25],
  ['Bb4', 8.75, 0.25],
  ['Ab4', 9, 0.5],
  ['Gb4', 9.5, 0.5],
  ['F4', 10, 0.5],
  ['F4', 10.5, 1.5],
  // held F, then the trill motif
  ['F4', 12, 1.5],
  ['Bb4', 13.5, 0.5],
  ['F4', 14, 0.5],
  ['Bb4', 14.5, 0.5],
  ['F4', 15, 0.5],
  ['Bb4', 15.5, 0.5],
];
const THEME_BEATS = 16;
/** Harmony under THEME: [chord, start beat, beats]. */
const THEME_HARM: [string, number, number][] = [
  ['Bb7', 0, 4],
  ['Eb7', 4, 4],
  ['Bb7', 8, 2],
  ['Gb7', 10, 2],
  ['F7', 12, 4],
];

// ---------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------

type Sampled = 'piano' | 'clarinet' | 'strings' | 'bass' | 'trumpet' | 'trombone' | 'horn' | 'timpani';
type Synth = 'kick' | 'snare' | 'brush' | 'crash' | 'boom' | 'swell' | 'ride';
type Inst = Sampled | Synth;

interface Ev {
  i: Inst;
  t: number;
  d: number;
  m: number;
  v: number;
  /** Pitch slide: to midi, starting at 'at' (absolute s), lasting 'dur'. */
  bend?: { to: number; at: number; dur: number };
}

const SAMPLE_DIR: Record<Sampled, string> = {
  piano: 'acoustic_grand_piano',
  clarinet: 'clarinet',
  strings: 'string_ensemble_1',
  bass: 'contrabass',
  trumpet: 'trumpet',
  trombone: 'trombone',
  horn: 'french_horn',
  timpani: 'timpani',
};
const SAMPLED = Object.keys(SAMPLE_DIR) as Sampled[];
const isSampled = (i: Inst): i is Sampled => i in SAMPLE_DIR;

function compose() {
  const events: Ev[] = [];
  const accents: Accent[] = [];
  const melody: MelodyNote[] = [];
  const chords: ChordSpan[] = [];

  const note = (i: Inst, t: number, d: number, m: number, v: number, bend?: Ev['bend']) => events.push({ i, t, d, m, v, bend });
  const accent = (t: number, kind: AccentKind) => accents.push({ t, kind });

  /** Play a line: score beat b starts at t0 + b * k * BEAT. */
  const line = (l: Line, t0: number, k: number, i: Sampled, opts: { tr?: number; v?: number; legato?: number; from?: number; to?: number; mel?: boolean; oct?: number } = {}) => {
    const { tr = 0, v = 0.7, legato = 0.92, from = 0, to = Infinity, mel = false, oct = 0 } = opts;
    for (const [nm, b, d] of l) {
      if (b < from || b >= to) continue;
      const t = t0 + (b - from) * k * BEAT;
      const m = n(nm) + tr;
      // gentle phrase shape: longer notes a little louder
      const vel = v * (0.85 + 0.15 * Math.min(1, d));
      note(i, t, d * k * BEAT * legato, m, vel);
      if (oct) note(i, t, d * k * BEAT * legato, m + oct, vel * 0.8);
      if (mel) melody.push({ t, dur: d * k * BEAT, midi: m });
    }
  };

  /** Harmony spans: [chord, start beat, beats] at k seconds-per-score-beat factor. */
  const harm = (h: [string, number, number][], t0: number, k: number, tr = 0, from = 0, to = Infinity) =>
    h
      .filter(([, b]) => b >= from && b < to)
      .map(([c, b, d]) => {
        const name = tr ? transposeChord(c, tr) : c;
        const span = { t: t0 + (b - from) * k * BEAT, d: Math.min(d, to - b) * k * BEAT, ch: parseChord(name) };
        chords.push({ t: span.t, dur: span.d, name });
        return span;
      });

  type Span = ReturnType<typeof harm>[number];
  const spansOf = (list: [string, number][], t0: number, beats = 4): Span[] =>
    list.map(([c, b]) => {
      const span = { t: t0 + b * BEAT, d: beats * BEAT, ch: parseChord(c) };
      chords.push({ t: span.t, dur: span.d, name: c });
      return span;
    });

  // accompaniment patterns ---------------------------------------------------------
  const pad = (sp: Span[], v: number, lo = 55) => {
    for (const s of sp) for (const m of voicing(s.ch, lo)) note('strings', s.t, s.d * 0.98, m, v);
  };
  const bassRoots = (sp: Span[], v: number, every = 2) => {
    for (const s of sp)
      for (let b = 0; b < s.d / BEAT - 0.01; b += every) note('bass', s.t + b * BEAT, every * BEAT * 0.9, place(s.ch.bass, 34), v);
  };
  const walking = (sp: Span[], v: number) => {
    for (const s of sp) {
      const r = place(s.ch.bass, 34);
      const steps = [r, r + (s.ch.iv[1] ?? 4), r + (s.ch.iv[2] ?? 7), r + 12 - 2];
      for (let b = 0; b < Math.round(s.d / BEAT); b++) note('bass', s.t + b * BEAT, BEAT * 0.85, steps[b % 4] as number, v * (b % 2 ? 0.8 : 1));
    }
  };
  const stride = (sp: Span[], v: number) => {
    for (const s of sp)
      for (let b = 0; b < Math.round(s.d / BEAT); b++) {
        const t = s.t + b * BEAT;
        if (b % 2 === 0) {
          const r = place(s.ch.bass, 36);
          note('piano', t, BEAT * 0.8, r, v);
          note('piano', t, BEAT * 0.8, r + 12, v * 0.6);
        } else for (const m of voicing(s.ch, 55).slice(0, 4)) note('piano', t, BEAT * 0.6, m, v * 0.7);
      }
  };
  const arpeggio = (sp: Span[], v: number, lo = 51) => {
    for (const s of sp) {
      const tones = voicing(s.ch, lo);
      const up = [...tones, ...tones.map((m) => m + 12)].slice(0, 6);
      const seq = [...up, ...up.slice(1, -1).reverse()];
      for (let k = 0; k < Math.round(s.d / (BEAT / 2)); k++) note('piano', s.t + (k * BEAT) / 2, BEAT * 0.9, seq[k % seq.length] as number, v * (k % 4 === 0 ? 1 : 0.75));
    }
  };
  const brassChord = (sp: Span[], v: number, rhythm: number[] = [0], len = 0.9) => {
    for (const s of sp)
      for (const b of rhythm) {
        if (b * BEAT >= s.d) continue;
        const vs = voicing(s.ch, 50);
        vs.slice(0, 3).forEach((m) => note('trombone', s.t + b * BEAT, len * BEAT, m, v));
        voicing(s.ch, 60)
          .slice(0, 3)
          .forEach((m) => note('horn', s.t + b * BEAT, len * BEAT, m, v * 0.9));
      }
  };
  const trill = (i: Sampled, t: number, d: number, a: number, b: number, v0: number, v1: number, rate = 11) => {
    const k = Math.floor(d * rate);
    for (let j = 0; j < k; j++) note(i, t + j / rate, 1.6 / rate, j % 2 ? b : a, lerp(v0, v1, j / k));
  };
  const roll = (i: 'timpani' | 'snare', t: number, d: number, m: number, v0: number, v1: number, rate = 14) => {
    const k = Math.floor(d * rate);
    for (let j = 0; j < k; j++) note(i, t + j / rate, 0.3, m, lerp(v0, v1, Math.pow(j / k, 1.6)));
  };
  const drums = (t0: number, bars: number, v: number, fill = false) => {
    for (let b = 0; b < bars; b++) {
      const t = t0 + b * SECONDS_PER_BAR;
      note('kick', t, 0.3, 0, v);
      note('kick', t + 2 * BEAT, 0.3, 0, v * 0.85);
      note('brush', t + BEAT, 0.2, 0, v * 0.7);
      note('brush', t + 3 * BEAT, 0.2, 0, v * 0.7);
      for (let q = 0; q < 4; q++) note('ride', t + q * BEAT, 0.2, 0, v * 0.35);
      for (let q = 0; q < 4; q++) note('ride', t + (q + 0.66) * BEAT, 0.2, 0, v * 0.2);
    }
    if (fill) for (let k = 0; k < 8; k++) note('snare', t0 + bars * SECONDS_PER_BAR - (8 - k) * (BEAT / 4) * 2, 0.2, 0, v * lerp(0.5, 1, k / 7));
  };
  const hit = (t: number, chord: string, v = 1) => {
    note('boom', t, 1, 0, v);
    note('crash', t, 3, 0, v * 0.9);
    note('timpani', t, 1.5, place(parseChord(chord).root, 36), v);
    const ch = parseChord(chord);
    voicing(ch, 46).forEach((m) => note('trombone', t, 1.2, m, v * 0.9));
    voicing(ch, 58).forEach((m) => note('horn', t, 1.2, m, v * 0.8));
    voicing(ch, 65)
      .slice(0, 3)
      .forEach((m) => note('trumpet', t, 1.0, m, v * 0.85));
    note('bass', t, 1.5, place(ch.bass, 34), v);
  };

  /** The clarinet opening: trill on F3, a rising run, the glissando onto B♭5 at 'land'. */
  const opening = (t0: number, land: number, v = 0.75) => {
    const runAt = land - 0.95;
    trill('clarinet', t0, runAt - t0, n('F3'), n('G3'), v * 0.55, v * 0.85, 12);
    const run = ['F3', 'G3', 'A3', 'Bb3', 'C4', 'D4', 'Eb4', 'F4', 'G4', 'A4'].map(n);
    const step = 0.055;
    run.forEach((m, j) => note('clarinet', runAt + j * step, step * 1.6, m, lerp(v * 0.8, v, j / run.length)));
    // the wail: one held note sliding from A4 up to B♭5
    const gl = runAt + run.length * step;
    note('clarinet', gl, land - gl + 0.02, n('A4'), v, { to: n('Bb5'), at: gl, dur: land - gl });
  };

  // ------------------------------------------------------------------ intro 1–8
  accent(bt(1), 'downbeat');
  opening(0.15, bt(3), 0.8);
  accent(bt(3), 'soft');
  // the theme at the score's own pace (♩ = 80 → 1.5 show beats a score beat)
  {
    const k = 1.5;
    const t0 = bt(3);
    // the first B♭ is the glissando's landing note: hold it on
    note('clarinet', t0, 2 * k * BEAT * 0.95, n('Bb5'), 0.78);
    melody.push({ t: t0, dur: 2 * k * BEAT, midi: n('Bb5') });
    line(THEME, t0 + 2 * k * BEAT, k, 'clarinet', { from: 2, v: 0.72, mel: true });
    const sp = harm(THEME_HARM, t0, k);
    pad(sp, 0.32);
    bassRoots(sp, 0.45, 4);
    for (const s of sp) accent(s.t, 'soft');
  }

  // ------------------------------------------------------------------ awakening 9–24
  accent(bt(9), 'downbeat');
  {
    // piano takes the theme over a stride left hand
    const sp = harm(THEME_HARM, bt(9), 1);
    line(THEME, bt(9), 1, 'piano', { v: 0.7, mel: true, oct: 12 });
    stride(sp, 0.5);
    pad(sp, 0.18, 60);
  }
  {
    // the trumpet answers with the head of the theme, the piano with the trill
    const sp = harm(THEME_HARM, bt(13), 1);
    line(THEME, bt(13), 1, 'trumpet', { to: 8, v: 0.55, mel: true });
    line(THEME, bt(15), 1, 'piano', { from: 8, v: 0.6, oct: 12 });
    stride(sp, 0.42);
    pad(sp, 0.22, 55);
  }
  // rhythm section in: clarinet has the theme again, walking bass, brushes
  accent(bt(17), 'downbeat');
  {
    const sp = harm(THEME_HARM, bt(17), 1);
    line(THEME, bt(17), 1, 'clarinet', { v: 0.72, mel: true });
    walking(sp, 0.6);
    pad(sp, 0.26, 55);
    drums(bt(17), 4, 0.45);
  }
  {
    // the trill motif climbs: B♭ – C – D, then F7 into the theme
    const sp = spansOf(
      [
        ['Bb', 0],
        ['Cm7', 4],
        ['Dm7', 8],
        ['F7', 12],
      ],
      bt(21),
    );
    const motif = (t: number, a: number, b: number, v: number) => {
      for (let k = 0; k < 8; k++) note('piano', t + (k * BEAT) / 2, BEAT * 0.45, k % 2 ? b : a, v);
      for (let k = 0; k < 8; k++) note('strings', t + (k * BEAT) / 2, BEAT * 0.48, (k % 2 ? b : a) + 12, v * 0.5);
    };
    motif(bt(21), n('F4'), n('Bb4'), 0.55);
    motif(bt(22), n('G4'), n('C5'), 0.6);
    motif(bt(23), n('A4'), n('D5'), 0.66);
    walking(sp, 0.62);
    pad(sp, 0.28, 55);
    drums(bt(21), 4, 0.5, true);
    // rising brass to the dominant
    for (const [m, b] of [
      ['F4', 1],
      ['A4', 2],
      ['C5', 3],
      ['Eb5', 3.5],
    ] as [string, number][])
      note('trumpet', bt(24, b), BEAT * 0.9, n(m), 0.7);
    brassChord([sp[3] as Span], 0.7, [2, 3]);
    roll('timpani', bt(24), SECONDS_PER_BAR, n('F2'), 0.3, 0.9);
  }

  // ------------------------------------------------------------------ theme 25–40
  accent(bt(25), 'downbeat');
  accent(bt(25), 'hit');
  accent(bt(25), 'crash');
  hit(bt(25), 'Bb7', 1);
  {
    // tutti: trumpets and clarinet on the theme, strings an octave below
    const sp = harm(THEME_HARM, bt(25), 1);
    line(THEME, bt(25), 1, 'trumpet', { v: 0.85, mel: true });
    line(THEME, bt(25), 1, 'clarinet', { v: 0.6 });
    line(THEME, bt(25), 1, 'strings', { tr: -12, v: 0.7 });
    brassChord(sp, 0.6, [0, 1.5, 2.5]);
    walking(sp, 0.75);
    drums(bt(25), 4, 0.7);
  }
  {
    // development: the head of the theme in sequence, strings on the trill
    const sp = spansOf(
      [
        ['Bb7', 0],
        ['C7', 4],
        ['D7', 8],
        ['F7', 12],
      ],
      bt(29),
    );
    for (let j = 0; j < 3; j++) {
      const tr = [0, 2, 4][j] as number;
      line(THEME, bt(29 + j), 1, 'trumpet', { to: 4, tr, v: 0.78, mel: true });
      line(THEME, bt(29 + j), 1, 'horn', { to: 4, tr: tr - 12, v: 0.6 });
      for (let k = 0; k < 8; k++) note('strings', bt(29 + j) + (k * BEAT) / 2, BEAT * 0.48, (k % 2 ? n('Bb4') : n('F4')) + tr, 0.45);
    }
    for (const [m, b] of [
      ['C5', 1],
      ['Eb5', 2],
      ['F5', 3],
      ['A5', 4],
    ] as [string, number][])
      note('trumpet', bt(32, b), BEAT * 0.9, n(m), 0.8);
    brassChord(sp, 0.6, [0, 2]);
    walking(sp, 0.72);
    drums(bt(29), 4, 0.68, true);
  }
  accent(bt(33), 'crash');
  note('crash', bt(33), 3, 0, 0.85);
  note('boom', bt(33), 1, 0, 0.7);
  {
    // the theme up a fourth, in E♭
    const sp = harm(THEME_HARM, bt(33), 1, 5);
    line(THEME, bt(33), 1, 'trumpet', { tr: 5, v: 0.85, mel: true });
    line(THEME, bt(33), 1, 'strings', { tr: -7, v: 0.7 });
    line(THEME, bt(33), 1, 'clarinet', { tr: -7, v: 0.55 });
    brassChord(sp, 0.6, [0, 1.5, 2.5]);
    walking(sp, 0.75);
    drums(bt(33), 4, 0.7);
  }
  {
    // cadence back home, cut on bar 40 beat 3 for the blackout
    const sp = harm(THEME_HARM, bt(37), 1, 0, 8, 16);
    line(THEME, bt(37), 1, 'trumpet', { from: 8, to: 12, v: 0.85, mel: true });
    line(THEME, bt(37), 1, 'strings', { from: 8, to: 12, tr: -12, v: 0.7 });
    walking(sp.slice(0, 2), 0.72);
    brassChord(sp, 0.6, [0, 2]);
    drums(bt(37), 2, 0.7);
    const f7 = spansOf([['F7', 0]], bt(39));
    brassChord(f7, 0.8, [0, 1, 2, 3], 0.8);
    roll('timpani', bt(39), SECONDS_PER_BAR, n('F2'), 0.4, 0.9);
    roll('snare', bt(39, 3), BEAT * 2, 0, 0.3, 0.8);
    const end = parseChord('Bb69');
    voicing(end, 46).forEach((m) => note('trombone', bt(40), BEAT * 1.8, m, 0.85));
    voicing(end, 58).forEach((m) => note('horn', bt(40), BEAT * 1.8, m, 0.75));
    voicing(end, 65).forEach((m) => note('strings', bt(40), BEAT * 1.9, m, 0.6));
    note('trumpet', bt(40), BEAT * 1.8, n('Bb5'), 0.85);
    note('bass', bt(40), BEAT * 1.8, n('Bb1'), 0.85);
    note('timpani', bt(40), BEAT * 1.5, n('Bb2'), 0.9);
    note('crash', bt(40), 1.2, 0, 0.6);
    chords.push({ t: bt(40), dur: BEAT * 2, name: 'Bb69' });
  }

  // ------------------------------------------------------------------ story 41–56
  // a slow nocturne on the theme, in E♭ (one score beat = two show beats)
  accent(bt(41), 'downbeat');
  {
    const sp = harm(THEME_HARM, bt(41), 2, 5);
    line(THEME, bt(41), 2, 'clarinet', { tr: -7, v: 0.6, mel: true });
    arpeggio(sp, 0.36, 46);
    pad(sp, 0.2, 51);
    bassRoots(sp, 0.35, 4);
    for (const b of [41, 45]) accent(bt(b), 'soft');
  }
  {
    const sp = harm(THEME_HARM, bt(49), 2, 5);
    line(THEME, bt(49), 2, 'strings', { tr: 5 - 12, v: 0.62, mel: true });
    // the horn sings the chord's third underneath
    for (const s of sp) note('horn', s.t, s.d * 0.95, place((s.ch.root + (s.ch.iv[1] ?? 4)) % 12, 55), 0.42);
    arpeggio(sp, 0.34, 46);
    bassRoots(sp, 0.35, 4);
    for (const b of [49, 53]) accent(bt(b), 'soft');
  }

  // ------------------------------------------------------------------ build 57–64
  accent(bt(57), 'downbeat');
  {
    // the trill motif as an ostinato, a step higher every bar or half bar
    const steps: [number, number, string][] = [
      [57, 0, 'Bb'],
      [58, 0, 'Bb'],
      [59, 2, 'Cm'],
      [60, 2, 'Cm'],
      [61, 3, 'Db'],
      [62, 4, 'D7'],
      [63, 5, 'Eb'],
      [63.5, 6, 'E7'],
      [64, 7, 'F7'],
    ];
    for (const [bar, tr, ch] of steps) {
      const whole = Math.floor(bar);
      const t = bt(whole, bar % 1 ? 3 : 1);
      const len = bar === 64 ? 3 : bar === 63 || bar === 63.5 ? 2 : 4;
      const sp = spansOf([[ch, 0]], t, len);
      for (let k = 0; k < len * 2; k++) {
        const m = (k % 2 ? n('Bb4') : n('F4')) + tr;
        note('piano', t + (k * BEAT) / 2, BEAT * 0.45, m, 0.55 + 0.04 * (whole - 57));
        note('piano', t + (k * BEAT) / 2, BEAT * 0.45, m - 12, 0.4);
      }
      const r = place(sp[0]!.ch.bass, 34);
      for (let b = 0; b < len; b++) note('bass', t + b * BEAT, BEAT * 0.9, r, 0.6 + 0.04 * (whole - 57));
      // strings tremolo from bar 61
      if (whole >= 61)
        for (let k = 0; k < len * 4; k++)
          for (const m of voicing(sp[0]!.ch, 58).slice(0, 3)) note('strings', t + (k * BEAT) / 4, BEAT * 0.3, m, lerp(0.25, 0.6, (t - bt(61)) / (bt(64, 4) - bt(61))));
      if (whole >= 59) brassChord(sp, 0.5 + 0.05 * (whole - 59), [0], 0.6);
    }
    roll('timpani', bt(61), bt(64, 4) - bt(61), n('F2'), 0.2, 1);
    roll('snare', bt(62), bt(64, 4) - bt(62), 0, 0.15, 0.95, 16);
    note('swell', bt(63), bt(64, 4) - bt(63), 0, 0.7);
    accent(bt(64, 4), 'riser-end');
  }

  // ------------------------------------------------------------------ finale 65–80
  accent(bt(65), 'downbeat');
  accent(bt(65), 'hit');
  accent(bt(65), 'crash');
  hit(bt(65), 'Bb', 1);
  {
    // grandioso: the theme broadened, brass and strings in octaves
    const k = 1.5;
    const sp = harm(THEME_HARM, bt(65), k);
    line(THEME, bt(65), k, 'trumpet', { v: 0.95, mel: true });
    line(THEME, bt(65), k, 'strings', { tr: -12, v: 0.85, oct: 12 });
    line(THEME, bt(65), k, 'horn', { tr: -12, v: 0.7 });
    brassChord(sp, 0.7, [0, 1, 2, 3], 0.85);
    bassRoots(sp, 0.85, 1);
    for (const s of sp) note('timpani', s.t, 1.2, place(s.ch.root, 36), 0.7);
    drums(bt(65), 6, 0.8);
  }
  accent(bt(69), 'hit');
  note('boom', bt(69), 1, 0, 0.85);
  note('crash', bt(69), 2.5, 0, 0.8);
  {
    // the descending phrase in E♭, then the fall home
    const sp = harm(THEME_HARM, bt(71), 1, 5, 4, 8);
    line(THEME, bt(71), 1, 'trumpet', { from: 4, to: 8, tr: 5, v: 0.9, mel: true });
    line(THEME, bt(71), 1, 'strings', { from: 4, to: 8, tr: -7, v: 0.8, oct: 12 });
    brassChord(sp, 0.7, [0, 2]);
    walking(sp, 0.8);
    drums(bt(71), 2, 0.75);
    // the two brass stabs before bar 73
    for (const b of [3, 4]) brassChord(spansOf([['F7', 0]], bt(72, b), 1), 0.9, [0], 0.4);
  }
  accent(bt(73), 'hit');
  accent(bt(73), 'crash');
  hit(bt(73), 'Bb7', 0.95);
  {
    const sp = harm(THEME_HARM, bt(73), 1, 0, 8, 16);
    line(THEME, bt(73), 1, 'trumpet', { from: 8, to: 12, v: 0.9, mel: true });
    line(THEME, bt(73), 1, 'strings', { from: 8, to: 12, tr: -12, v: 0.8, oct: 12 });
    walking(sp.slice(0, 2), 0.8);
    brassChord(sp, 0.7, [0, 2]);
    drums(bt(73), 2, 0.75);
    brassChord(spansOf([['F7', 0]], bt(75), 2), 0.85, [0, 1], 0.9);
  }
  // the breath: only the clarinet, its trill, run and glissando, onto bar 77
  opening(bt(75, 3), bt(77), 0.85);
  accent(bt(77), 'hit');
  accent(bt(77), 'crash');
  hit(bt(77), 'Bb7', 1);
  {
    const sp = harm(THEME_HARM, bt(77), 1, 0, 0, 8);
    note('clarinet', bt(77), 2 * BEAT * 0.95, n('Bb5'), 0.85);
    line(THEME, bt(77), 1, 'trumpet', { to: 8, v: 0.95, mel: true });
    line(THEME, bt(77), 1, 'strings', { to: 8, tr: -12, v: 0.85, oct: 12 });
    brassChord(sp, 0.75, [0, 1.5, 2.5]);
    walking(sp, 0.85);
    drums(bt(77), 2, 0.8);
    const cad = spansOf(
      [
        ['Eb', 0],
        ['Ebm6', 2],
      ],
      bt(79),
      2,
    );
    brassChord(cad, 0.8, [0, 1], 0.9);
    for (const s of cad) for (const m of voicing(s.ch, 60)) note('strings', s.t, s.d, m, 0.7);
    walking(cad, 0.8);
    roll('timpani', bt(79), SECONDS_PER_BAR, n('F2'), 0.4, 0.9);
  }
  accent(bt(80), 'crash');
  {
    const ch = 'Bb/F';
    note('crash', bt(80), 3, 0, 0.8);
    note('boom', bt(80), 1, 0, 0.7);
    const c = parseChord(ch);
    voicing(c, 46).forEach((m) => note('trombone', bt(80), BEAT * 2.5, m, 0.75));
    voicing(c, 58).forEach((m) => note('horn', bt(80), BEAT * 3, m, 0.65));
    voicing(c, 62).forEach((m) => note('strings', bt(80), BEAT * 3.5, m, 0.6));
    note('bass', bt(80), BEAT * 3, n('F1'), 0.75);
    chords.push({ t: bt(80), dur: SECONDS_PER_BAR, name: ch });
  }

  // ------------------------------------------------------------------ coda 81–90
  accent(bt(81), 'downbeat');
  {
    // the piano alone recalls the opening phrase, softly
    const k = 1.5;
    line(THEME, bt(81), k, 'piano', { to: 4, v: 0.5, mel: true });
    const sp = spansOf([['Bb', 0]], bt(81), 6);
    arpeggio(sp, 0.25, 46);
    pad(spansOf([['Bb6', 0]], bt(81), 8), 0.22, 55);
    // the trill once more, growing, with the timpani
    trill('clarinet', bt(83), bt(85) - bt(83) - 0.05, n('F4'), n('G4'), 0.4, 0.85, 11);
    roll('timpani', bt(83, 3), bt(85) - bt(83, 3), n('F2'), 0.2, 1);
    note('swell', bt(84), SECONDS_PER_BAR, 0, 0.6);
  }
  accent(bt(85), 'hit');
  accent(bt(85), 'crash');
  {
    const t = bt(85);
    const ch = parseChord('Bb69');
    note('boom', t, 1, 0, 1);
    note('crash', t, 4, 0, 1);
    note('timpani', t, 3, n('Bb2'), 1);
    voicing(ch, 46).forEach((m) => note('trombone', t, 5, m, 0.85));
    voicing(ch, 58).forEach((m) => note('horn', t, 6, m, 0.8));
    voicing(ch, 62).forEach((m) => note('strings', t, 8, m, 0.75));
    voicing(ch, 74)
      .slice(0, 3)
      .forEach((m) => note('strings', t, 8, m, 0.6));
    note('trumpet', t, 4, n('Bb5'), 0.9);
    note('trumpet', t, 4, n('F5'), 0.75);
    note('clarinet', t, 5, n('D6'), 0.6);
    note('bass', t, 6, n('Bb1'), 0.9);
    [n('Bb1'), n('F2'), n('Bb2'), n('D3'), n('F3'), n('Bb3'), n('D4'), n('F4'), n('Bb4')].forEach((m, j) => note('piano', t + 0.6 + j * 0.06, 3, m, 0.55));
    chords.push({ t, dur: 10, name: 'Bb69' });
  }

  events.sort((a, b) => a.t - b.t);
  const ORDER: AccentKind[] = ['hit', 'crash', 'riser-end', 'downbeat', 'soft'];
  accents.sort((a, b) => a.t - b.t || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  melody.sort((a, b) => a.t - b.t);
  chords.sort((a, b) => a.t - b.t);
  return { events, accents, melody, chords };
}

const SCORE = compose();

/**
 * Musically important moments, sorted by time. Several kinds may share one time
 * (e.g. bar 65 = 'hit' + 'crash' + 'downbeat'); filter by kind rather than firing on every entry.
 *  - hit:       big orchestral hit (bass drum, timpani, brass chord)
 *  - crash:     crash cymbal
 *  - downbeat:  section start
 *  - riser-end: the build's rolls stop dead (bar 64 beat 4); the finale hits half a beat later
 *  - soft:      gentle cues (intro harmony, story phrase starts)
 */
export const ACCENTS: Accent[] = SCORE.accents;

/** Top melody line. */
export const MELODY: MelodyNote[] = SCORE.melody;

/** Chord changes over the whole show (B♭ → E♭ story → B♭). */
export const CHORDS: ChordSpan[] = SCORE.chords;

// ---------------------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------------------

interface Sample {
  m: number;
  buf: AudioBuffer;
  /** Seconds of encoder silence before the attack. */
  off: number;
}
type Bank = Record<Sampled, Sample[]>;

const SAMPLE_ROOT = `${import.meta.env.BASE_URL}samples/fluidr3/`;
const banks = new Map<number, Promise<Bank>>();

/** Load and decode every sample once per sample rate. */
function loadBank(sr: number): Promise<Bank> {
  let p = banks.get(sr);
  if (!p) {
    p = (async () => {
      const index = (await (await fetch(`${SAMPLE_ROOT}index.json`)).json()) as Record<string, number[]>;
      const dec = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: sr });
      const bank = {} as Bank;
      await Promise.all(
        SAMPLED.map(async (inst) => {
          const notes = index[SAMPLE_DIR[inst]] ?? [];
          bank[inst] = await Promise.all(
            notes.map(async (m) => {
              const data = await (await fetch(`${SAMPLE_ROOT}${SAMPLE_DIR[inst]}/${m}.mp3`)).arrayBuffer();
              const buf = await dec.decodeAudioData(data);
              return { m, buf, off: leadingSilence(buf) };
            }),
          );
        }),
      );
      return bank;
    })();
    banks.set(sr, p);
  }
  return p;
}

function leadingSilence(buf: AudioBuffer): number {
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i] as number));
  const th = peak * 0.02;
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i] as number) > th) return Math.max(0, i - 32) / buf.sampleRate;
  return 0;
}

function nearest(list: Sample[], m: number): Sample {
  let best = list[0] as Sample;
  for (const s of list) if (Math.abs(s.m - m) < Math.abs(best.m - m)) best = s;
  return best;
}

/** Per instrument: level, pan, reverb send, attack and release (s), whether it may loop. */
const VOICE: Record<Sampled, { gain: number; pan: number; rev: number; atk: number; rel: number; sustain: boolean }> = {
  piano: { gain: 0.75, pan: 0.05, rev: 0.32, atk: 0.003, rel: 0.35, sustain: false },
  clarinet: { gain: 0.9, pan: -0.15, rev: 0.4, atk: 0.015, rel: 0.12, sustain: true },
  strings: { gain: 0.42, pan: 0.25, rev: 0.5, atk: 0.09, rel: 0.45, sustain: true },
  bass: { gain: 0.85, pan: 0, rev: 0.15, atk: 0.008, rel: 0.15, sustain: true },
  trumpet: { gain: 0.6, pan: 0.3, rev: 0.36, atk: 0.012, rel: 0.15, sustain: true },
  trombone: { gain: 0.45, pan: -0.35, rev: 0.36, atk: 0.015, rel: 0.18, sustain: true },
  horn: { gain: 0.45, pan: -0.1, rev: 0.45, atk: 0.03, rel: 0.25, sustain: true },
  timpani: { gain: 0.9, pan: 0, rev: 0.4, atk: 0.002, rel: 1.2, sustain: false },
};

// ---------------------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------------------

interface Shared {
  noise: AudioBuffer;
  ir: AudioBuffer;
  bank: Bank;
}

function makeShared(sr: number, bank: Bank): Shared {
  const rng = mulberry32(0xc0ffee);
  const nLen = sr * 3;
  const noise = new AudioBuffer({ length: nLen, numberOfChannels: 1, sampleRate: sr });
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nLen; i++) nd[i] = rng() * 2 - 1;
  // concert hall: pre-delay, exponentially decaying noise that darkens over time
  const sec = 2.8;
  const iLen = Math.floor(sr * sec);
  const ir = new AudioBuffer({ length: iLen, numberOfChannels: 2, sampleRate: sr });
  const pre = Math.floor(sr * 0.025);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    const r = mulberry32(0xbeef + ch * 7919);
    let lp = 0;
    for (let i = pre; i < iLen; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.9 * t) / (sec - 0.03)) * Math.min(1, t / 0.015);
      const coef = 0.3 + 0.65 * Math.min(1, t / 2.0);
      lp = lp * coef + (r() * 2 - 1) * (1 - coef);
      d[i] = lp * env;
    }
  }
  return { noise, ir, bank };
}

function perc(p: AudioParam, s: number, lvl: number, tau: number, atk = 0.002): void {
  p.setValueAtTime(0, s);
  p.linearRampToValueAtTime(lvl, s + atk);
  p.setTargetAtTime(0, s + atk, tau);
}

/** Extra seconds a sound rings after its written length (before reverb). */
const RING: Partial<Record<Inst, number>> = { crash: 4, boom: 2.5, timpani: 1.5, piano: 1, swell: 0.1 };

class Segment {
  private readonly master: GainNode;
  private readonly revIn: GainNode;
  private readonly bus: Record<Sampled, GainNode>;
  private readonly drumBus: GainNode;
  private readonly cymBus: GainNode;

  constructor(
    private readonly c: OfflineAudioContext,
    private readonly t0: number,
    private readonly sh: Shared,
  ) {
    const g = (v: number) => new GainNode(c, { gain: v });
    this.master = g(1);
    this.master.connect(c.destination);
    this.revIn = g(1);
    const conv = new ConvolverNode(c, { buffer: sh.ir });
    this.revIn.connect(new BiquadFilterNode(c, { type: 'highpass', frequency: 160 })).connect(conv).connect(g(0.7)).connect(this.master);

    this.bus = {} as Record<Sampled, GainNode>;
    for (const inst of SAMPLED) {
      const v = VOICE[inst];
      const b = g(v.gain);
      const p = new StereoPannerNode(c, { pan: v.pan });
      b.connect(p).connect(this.master);
      p.connect(g(v.rev)).connect(this.revIn);
      this.bus[inst] = b;
    }
    this.drumBus = g(0.8);
    this.drumBus.connect(this.master);
    this.drumBus.connect(g(0.15)).connect(this.revIn);
    this.cymBus = g(0.5);
    const hp = new BiquadFilterNode(c, { type: 'highpass', frequency: 3200 });
    this.cymBus.connect(hp).connect(this.master);
    hp.connect(g(0.35)).connect(this.revIn);
  }

  private noiseSrc(s: number, dur: number, seedOffset: number): AudioBufferSourceNode {
    const src = new AudioBufferSourceNode(this.c, { buffer: this.sh.noise, loop: true });
    src.start(s, (seedOffset * 0.37) % 2.5);
    src.stop(s + dur);
    return src;
  }

  play(e: Ev, idx: number): void {
    const c = this.c;
    const s = Math.max(0, e.t - this.t0);
    if (isSampled(e.i)) {
      const v = VOICE[e.i];
      const smp = nearest(this.sh.bank[e.i], e.m);
      const src = new AudioBufferSourceNode(c, { buffer: smp.buf });
      const rate = Math.pow(2, (e.m - smp.m) / 12);
      src.playbackRate.setValueAtTime(rate, s);
      if (e.bend) {
        const at = Math.max(0, e.bend.at - this.t0);
        src.playbackRate.setValueAtTime(rate, at);
        src.playbackRate.exponentialRampToValueAtTime(rate * Math.pow(2, (e.bend.to - e.m) / 12), at + e.bend.dur);
      }
      const len = (smp.buf.duration - smp.off) / rate;
      const need = e.d + v.rel;
      if (v.sustain && need > len * 0.9) {
        src.loop = true;
        src.loopStart = smp.off + (smp.buf.duration - smp.off) * 0.45;
        src.loopEnd = smp.off + (smp.buf.duration - smp.off) * 0.85;
      }
      const gn = new GainNode(c, { gain: 0 });
      const lvl = Math.pow(clamp(e.v, 0, 1.2), 1.5);
      gn.gain.setValueAtTime(0, s);
      gn.gain.linearRampToValueAtTime(lvl, s + v.atk);
      // percussive instruments ring on; held ones are released at the note's end
      const end = v.sustain ? s + e.d : s + e.d + (RING[e.i] ?? 0.3);
      gn.gain.setValueAtTime(lvl, Math.max(s + v.atk, end));
      gn.gain.setTargetAtTime(0, Math.max(s + v.atk, end), v.rel / 3);
      src.connect(gn).connect(this.bus[e.i]);
      src.start(s, smp.off);
      src.stop(end + v.rel * 2 + 0.05);
      return;
    }
    switch (e.i) {
      case 'kick': {
        const o = new OscillatorNode(c, { frequency: 110 });
        o.frequency.setValueAtTime(110, s);
        o.frequency.exponentialRampToValueAtTime(48, s + 0.12);
        const gn = new GainNode(c, { gain: 0 });
        perc(gn.gain, s, e.v * 0.55, 0.12);
        o.connect(gn).connect(this.drumBus);
        o.start(s);
        o.stop(s + 0.7);
        break;
      }
      case 'boom': {
        // orchestral bass drum: low thud plus a felt-beater noise burst
        const o = new OscillatorNode(c, { frequency: 70 });
        o.frequency.setValueAtTime(70, s);
        o.frequency.exponentialRampToValueAtTime(38, s + 0.6);
        const gn = new GainNode(c, { gain: 0 });
        perc(gn.gain, s, e.v * 0.9, 0.5, 0.004);
        o.connect(gn).connect(this.drumBus);
        o.start(s);
        o.stop(s + 3);
        const src = this.noiseSrc(s, 0.6, idx);
        const lp = new BiquadFilterNode(c, { type: 'lowpass', frequency: 500 });
        const g2 = new GainNode(c, { gain: 0 });
        perc(g2.gain, s, e.v * 0.6, 0.08, 0.001);
        src.connect(lp).connect(g2).connect(this.drumBus);
        break;
      }
      case 'snare': {
        const src = this.noiseSrc(s, 0.35, idx);
        const bp = new BiquadFilterNode(c, { type: 'bandpass', frequency: 2500, Q: 0.7 });
        const gn = new GainNode(c, { gain: 0 });
        perc(gn.gain, s, e.v * 0.38, 0.05, 0.001);
        src.connect(bp).connect(gn).connect(this.drumBus);
        break;
      }
      case 'brush': {
        const src = this.noiseSrc(s, 0.3, idx);
        const bp = new BiquadFilterNode(c, { type: 'bandpass', frequency: 4000, Q: 0.6 });
        const gn = new GainNode(c, { gain: 0 });
        perc(gn.gain, s, e.v * 0.16, 0.07, 0.01);
        src.connect(bp).connect(gn).connect(this.drumBus);
        break;
      }
      case 'ride': {
        const src = this.noiseSrc(s, 0.5, idx);
        const gn = new GainNode(c, { gain: 0 });
        perc(gn.gain, s, e.v * 0.12, 0.12, 0.001);
        src.connect(gn).connect(this.cymBus);
        break;
      }
      case 'crash': {
        const src = this.noiseSrc(s, e.d + 3, idx);
        const gn = new GainNode(c, { gain: 0 });
        perc(gn.gain, s, e.v * 0.5, 1.1, 0.003);
        src.connect(gn).connect(this.cymBus);
        break;
      }
      case 'swell': {
        // suspended cymbal roll
        const src = this.noiseSrc(s, e.d + 0.02, idx);
        const gn = new GainNode(c, { gain: 0 });
        gn.gain.setValueAtTime(0.0005, s);
        gn.gain.exponentialRampToValueAtTime(e.v * 0.4, s + e.d - 0.005);
        gn.gain.linearRampToValueAtTime(0, s + e.d);
        src.connect(gn).connect(this.cymBus);
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
  const len = L.length;
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i] as number), Math.abs(R[i] as number));
  if (peak <= 0) return;
  const pre = 1 / peak;
  const th = 0.55; // limit the top ~5 dB of transients
  const B = 32;
  const nb = Math.ceil(len / B);
  const g = new Float32Array(nb);
  for (let b = 0; b < nb; b++) {
    let pk = 0;
    const e = Math.min(len, (b + 1) * B);
    for (let i = b * B; i < e; i++) pk = Math.max(pk, Math.abs(L[i] as number), Math.abs(R[i] as number));
    pk *= pre;
    g[b] = pk > th ? th / pk : 1;
  }
  const blk = B / sr;
  const atkStep = blk / 0.004;
  const relStep = blk / 0.25;
  for (let b = nb - 2; b >= 0; b--) g[b] = Math.min(g[b] as number, (g[b + 1] as number) + atkStep);
  for (let b = 1; b < nb; b++) g[b] = Math.min(g[b] as number, (g[b - 1] as number) + relStep);
  for (let i = 0; i < len; i++) {
    const b = Math.floor(i / B);
    const u = (i % B) / B;
    const g0 = g[b] as number;
    const g1 = b + 1 < nb ? (g[b + 1] as number) : g0;
    const k = pre * Math.min(g0, g0 + (g1 - g0) * u);
    L[i] = (L[i] as number) * k;
    R[i] = (R[i] as number) * k;
  }
  let p2 = 0;
  for (let i = 0; i < len; i++) p2 = Math.max(p2, Math.abs(L[i] as number), Math.abs(R[i] as number));
  const k = ceiling / p2;
  // 0.4 s fade at the very end so the show closes on true silence
  const fade = Math.floor(sr * 0.4);
  for (let i = 0; i < len; i++) {
    const f = i >= len - fade ? (len - i) / fade : 1;
    L[i] = (L[i] as number) * k * f;
    R[i] = (R[i] as number) * k * f;
  }
}

// ---------------------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------------------

/** Window size for parallel offline rendering (seconds). */
const SEGMENT = 16;
/** Reverb tail rendered past each window's last note. */
const TAIL = 3.5;
/** Output peak (-1.4 dBFS). */
const CEILING = 0.85;

export async function renderScore(sampleRate = 44100): Promise<AudioBuffer> {
  const sh = makeShared(sampleRate, await loadBank(sampleRate));
  const total = Math.round(SCORE_DURATION * sampleRate);
  const jobs: Promise<{ off: number; buf: AudioBuffer }>[] = [];

  for (let t0 = 0; t0 < SCORE_DURATION; t0 += SEGMENT) {
    const t1 = Math.min(SCORE_DURATION, t0 + SEGMENT);
    const evs = SCORE.events.map((e, i) => [e, i] as const).filter(([e]) => e.t >= t0 && e.t < t1);
    let end = t1;
    for (const [e] of evs) end = Math.max(end, e.t + e.d + (RING[e.i] ?? 0.5));
    end = Math.min(SCORE_DURATION, end + TAIL);
    const off = Math.round(t0 * sampleRate);
    const length = Math.min(total - off, Math.ceil((end - t0) * sampleRate));
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
    const seg = new Segment(ctx, t0, sh);
    for (const [e, i] of evs) seg.play(e, i);
    jobs.push(ctx.startRendering().then((buf) => ({ off, buf })));
  }

  const parts = await Promise.all(jobs);
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  for (const { off, buf } of parts) {
    const l = buf.getChannelData(0);
    const r = buf.getChannelData(1);
    const len = Math.min(buf.length, total - off);
    for (let i = 0; i < len; i++) {
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
