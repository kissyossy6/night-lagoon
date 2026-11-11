import { DEFAULT_LEVELS, OUTPUT_CEILING, gainOf, type SoundLayer } from '../audio/levels';

/**
 * The show clock is the music's playback position (design doc: 音楽同期).
 * Frames sample it, so a dropped frame never puts picture and sound out of
 * step. Without music it falls back to performance.now().
 *
 *   showTime = AudioContext.currentTime - startAt - outputLatency
 */
export class ShowClock {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  /** Each sound's own level (src/audio/levels.ts), under the master gain. */
  private musicGain: GainNode | null = null;
  private pyroGain: GainNode | null = null;
  private levels: Record<SoundLayer, number> = { ...DEFAULT_LEVELS };
  /** A second track played in step with the music (the water sound). */
  private layer: AudioBuffer | null = null;
  private layerSrc: AudioBufferSourceNode | null = null;
  private layerGain: GainNode | null = null;
  /** The 水音 button: 1 on, 0 off (times the water's level). */
  private layerLevel = 1;
  /** The fireworks' sound (src/audio/pyro.ts): its own track, always on, not ducked. */
  private pyro: AudioBuffer | null = null;
  private pyroSrc: AudioBufferSourceNode | null = null;
  private startAt = 0;
  private pausedAt = 0;
  private perfStart = 0;
  /** Manual offset (s) for displays whose latency the browser misreports. */
  offset = 0;
  playing = false;
  onEnd: (() => void) | null = null;

  /** The show's length (s): its file's duration, set again when the show changes. */
  constructor(public duration: number) {}

  get hasMusic() {
    return this.buffer !== null;
  }

  /** The music being played, for the video export. */
  get music(): AudioBuffer | null {
    return this.buffer;
  }

  setBuffer(buffer: AudioBuffer, ctx: AudioContext) {
    const t = this.time();
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.ctx = ctx;
    this.buffer = buffer;
    this.gain = ctx.createGain();
    // the sum through a limiter: the fireworks at 150% over the music would clip
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = 20 * Math.log10(OUTPUT_CEILING) - 1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    this.gain.connect(limiter);
    limiter.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = gainOf('music', this.levels.music);
    this.musicGain.connect(this.gain);
    this.layerGain = ctx.createGain();
    this.layerGain.gain.value = this.layerLevel * gainOf('water', this.levels.water);
    this.layerGain.connect(this.gain);
    this.pyroGain = ctx.createGain();
    this.pyroGain.gain.value = gainOf('pyro', this.levels.pyro);
    this.pyroGain.connect(this.gain);
    this.pausedAt = t;
    if (wasPlaying) void this.play();
  }

  /** Set (or clear) the track played with the music. Needs the music first. */
  setLayer(buffer: AudioBuffer | null) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.layer = buffer;
    if (wasPlaying) void this.play();
  }

  get layerBuffer(): AudioBuffer | null {
    return this.layer;
  }

  /** Set (or clear) the fireworks track. Needs the music first. */
  setPyro(buffer: AudioBuffer | null) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.pyro = buffer;
    if (wasPlaying) void this.play();
  }

  get pyroBuffer(): AudioBuffer | null {
    return this.pyro;
  }

  /** Fade the layer in or out (0..1) without a click. */
  setLayerLevel(v: number) {
    this.layerLevel = v;
    this.ramp(this.layerGain, v * gainOf('water', this.levels.water));
  }

  /** One sound's slider (1 = 100% = its MIX gain, src/audio/levels.ts), changed without a click. */
  setLevel(layer: SoundLayer, v: number) {
    this.levels[layer] = v;
    if (layer === 'music') this.ramp(this.musicGain, gainOf('music', v));
    else if (layer === 'water') this.ramp(this.layerGain, this.layerLevel * gainOf('water', v));
    else this.ramp(this.pyroGain, gainOf('pyro', v));
  }

  /** The slider (1 = 100%). */
  level(layer: SoundLayer): number {
    return this.levels[layer];
  }

  /** The gain the sound plays at (MIX x slider), for the video export. */
  gainOf(layer: SoundLayer): number {
    return gainOf(layer, this.levels[layer]);
  }

  private ramp(g: GainNode | null, v: number) {
    if (g && this.ctx) g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }

  setVolume(v: number) {
    if (this.gain) this.gain.gain.value = v;
  }

  private latency() {
    const c = this.ctx;
    if (!c) return 0;
    return (c.outputLatency || c.baseLatency || 0) + this.offset;
  }

  async play() {
    if (this.playing) return;
    if (this.pausedAt >= this.duration) this.pausedAt = 0;
    if (this.ctx && this.buffer && this.musicGain) {
      await this.ctx.resume();
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.connect(this.musicGain);
      // both tracks start on the same render quantum
      const when = this.ctx.currentTime + 0.01;
      src.start(when, this.pausedAt);
      if (this.layer && this.layerGain && this.pausedAt < this.layer.duration) {
        const l = this.ctx.createBufferSource();
        l.buffer = this.layer;
        l.connect(this.layerGain);
        l.start(when, this.pausedAt);
        this.layerSrc = l;
      }
      if (this.pyro && this.pyroGain && this.pausedAt < this.pyro.duration) {
        const p = this.ctx.createBufferSource();
        p.buffer = this.pyro;
        p.connect(this.pyroGain);
        p.start(when, this.pausedAt);
        this.pyroSrc = p;
      }
      this.startAt = when - this.pausedAt;
      this.src = src;
    } else {
      this.perfStart = performance.now() - this.pausedAt * 1000;
    }
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    // the raw position, not time(): time() pauses at the end and would call back here
    this.pausedAt = Math.min(Math.max(0, this.elapsed()), this.duration);
    this.src?.stop();
    this.src?.disconnect();
    this.src = null;
    this.layerSrc?.stop();
    this.layerSrc?.disconnect();
    this.layerSrc = null;
    this.pyroSrc?.stop();
    this.pyroSrc?.disconnect();
    this.pyroSrc = null;
    this.playing = false;
  }

  seek(t: number) {
    const was = this.playing;
    this.pause();
    this.pausedAt = Math.min(Math.max(t, 0), this.duration);
    if (was) void this.play();
  }

  /** Where playback is now, unclamped (only while playing). */
  private elapsed(): number {
    return this.ctx && this.src ? this.ctx.currentTime - this.startAt - this.latency() : (performance.now() - this.perfStart) / 1000;
  }

  time(): number {
    if (!this.playing) return this.pausedAt;
    const t = this.elapsed();
    if (t >= this.duration) {
      this.pause();
      this.pausedAt = this.duration;
      this.onEnd?.();
      return this.duration;
    }
    return Math.max(0, t);
  }
}
