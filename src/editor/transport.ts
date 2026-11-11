/**
 * Playback clock. With the rendered score it runs on the AudioContext clock
 * (showTime = ctx.currentTime - startAt) so picture and music stay locked;
 * without it, on performance.now().
 */

export type MusicState = 'loading' | 'ready' | 'none';

/** Min/max of the mono mix per bucket of samples, for the waveform. */
export interface Peaks {
  min: Float32Array;
  max: Float32Array;
  /** Buckets per second. */
  rate: number;
  /** Largest absolute sample. */
  peak: number;
}

const BUCKET = 128;

export class Transport {
  playing = false;
  music: MusicState = 'loading';
  peaks: Peaks | null = null;
  private time = 0;
  private buffer: AudioBuffer | null = null;
  /** The loaded music, if any. */
  get audio(): AudioBuffer | null {
    return this.buffer;
  }
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startAt = 0;
  private perfStart = 0;
  private muted = false;
  private listeners: (() => void)[] = [];

  constructor(public duration: number) {}

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** Current show time in seconds. */
  now(): number {
    if (!this.playing) return this.time;
    if (this.src && this.ctx) return this.ctx.currentTime - this.startAt;
    return (performance.now() - this.perfStart) / 1000;
  }

  play() {
    if (this.playing) return;
    if (this.time >= this.duration - 0.01) this.time = 0;
    this.playing = true;
    this.startClock(this.time);
    this.emit();
  }

  pause() {
    if (!this.playing) return;
    this.time = Math.min(this.duration, this.now());
    this.playing = false;
    this.stopSource();
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    const tt = Math.max(0, Math.min(this.duration, t));
    if (this.playing) {
      this.stopSource();
      this.startClock(tt);
    } else {
      this.time = tt;
    }
    this.emit();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.gain) this.gain.gain.value = m ? 0 : 1;
  }

  private startClock(t: number) {
    this.perfStart = performance.now() - t * 1000;
    if (!this.buffer) return;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.gain = this.ctx.createGain();
        this.gain.gain.value = this.muted ? 0 : 1;
        this.gain.connect(this.ctx.destination);
      }
      void this.ctx.resume();
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.connect(this.gain!);
      // schedule slightly ahead so the clock and the sound start together
      const when = this.ctx.currentTime + 0.03;
      src.start(when, Math.min(t, this.buffer.duration));
      this.startAt = when - t;
      this.src = src;
    } catch {
      this.src = null; // fall back to the performance clock
    }
  }

  private stopSource() {
    if (this.src) {
      try {
        this.src.stop();
      } catch {
        /* already stopped */
      }
      this.src.disconnect();
      this.src = null;
    }
  }

  /**
   * Load the background music (public/music/background.*); without it run
   * silent. ?music=score generates the composed score instead.
   */
  async loadMusic(): Promise<MusicState> {
    try {
      let buf: AudioBuffer;
      if (new URLSearchParams(location.search).get('music') === 'score') {
        const mod = await import('../audio/score');
        buf = await mod.renderScore();
      } else {
        const { loadBackground } = await import('../audio/background');
        const m = await loadBackground(new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 44100 }), this.duration);
        if (!m) throw new Error('no background music in public/music');
        buf = m.buffer;
      }
      this.buffer = buf;
      this.peaks = computePeaks(buf);
      this.music = 'ready';
      // if already playing on the fallback clock, hand over to the audio clock
      if (this.playing) {
        const t = this.now();
        this.startClock(t);
      }
    } catch (e) {
      console.warn('[editor] music unavailable:', e);
      this.music = 'none';
    }
    this.emit();
    return this.music;
  }
}

function computePeaks(buf: AudioBuffer): Peaks {
  const n = Math.ceil(buf.length / BUCKET);
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const k = 1 / chans.length;
  for (let b = 0; b < n; b++) {
    let lo = 0;
    let hi = 0;
    const end = Math.min(buf.length, (b + 1) * BUCKET);
    for (let i = b * BUCKET; i < end; i++) {
      let v = 0;
      for (const ch of chans) v += ch[i];
      v *= k;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  let peak = 1e-4;
  for (let b = 0; b < n; b++) peak = Math.max(peak, max[b], -min[b]);
  return { min, max, rate: buf.sampleRate / BUCKET, peak };
}
