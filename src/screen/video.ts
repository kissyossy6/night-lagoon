/**
 * Video files for the water screen, kept in step with the show clock.
 *
 * The show only hands over a time per frame, so the deck works out whether
 * that time is running (playback: let the video play, correct drift) or
 * jumping / standing still (seek, scrub, pause: seek the video there).
 * Videos are muted; the show has its own music.
 */

/** A paused video this far off is sought; a playing one only past DRIFT_PLAY. */
const DRIFT_STILL = 0.02;
const DRIFT_PLAY = 0.25;

export class VideoDeck {
  private readonly videos = new Map<string, HTMLVideoElement>();
  private active: HTMLVideoElement | null = null;
  private lastT = NaN;
  /** A seek landed or data arrived: an on-demand renderer (the editor) should draw again. */
  onFrame: (() => void) | null = null;

  private get(src: string): HTMLVideoElement {
    let v = this.videos.get(src);
    if (!v) {
      v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = src;
      for (const ev of ['loadeddata', 'seeked']) v.addEventListener(ev, () => this.onFrame?.());
      v.addEventListener('error', () => console.warn(`[screen] video ${src} failed to load`));
      this.videos.set(src, v);
    }
    return v;
  }

  private use(v: HTMLVideoElement) {
    if (this.active && this.active !== v) this.active.pause();
    this.active = v;
  }

  /** Bring the video to time t; returns it when it has a frame of t to draw, else null (black). */
  sync(src: string, t: number): HTMLVideoElement | null {
    const v = this.get(src);
    const jumped = v !== this.active;
    this.use(v);
    const dt = t - this.lastT;
    this.lastT = t;
    const running = !jumped && dt > 0 && dt < DRIFT_PLAY;
    const ended = Number.isFinite(v.duration) && t >= v.duration;
    if (t < 0 || ended) {
      if (!v.paused) v.pause();
      return null;
    }
    if (v.readyState >= HTMLMediaElement.HAVE_METADATA) {
      const drift = Math.abs(v.currentTime - t);
      if (running) {
        if (v.paused) v.play().catch(() => {});
        if (drift > DRIFT_PLAY && !v.seeking) v.currentTime = t;
      } else {
        if (!v.paused) v.pause();
        if (drift > DRIFT_STILL && !v.seeking) v.currentTime = t;
      }
    }
    return v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? v : null;
  }

  /** Seek to exactly t and wait for that frame (offline export). */
  async seekExact(src: string, t: number): Promise<void> {
    const v = this.get(src);
    this.use(v);
    this.lastT = NaN;
    v.pause();
    if (v.readyState < HTMLMediaElement.HAVE_METADATA) await event(v, 'loadedmetadata');
    if (t < 0 || t >= v.duration) return;
    if (Math.abs(v.currentTime - t) > 1e-3 || v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      v.currentTime = t;
      await event(v, 'seeked');
    }
  }

  /** Nothing to show: stop the running video. */
  stop() {
    this.active?.pause();
    this.active = null;
    this.lastT = NaN;
  }
}

function event(v: HTMLVideoElement, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      v.removeEventListener(name, done);
      v.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      v.removeEventListener(name, done);
      v.removeEventListener('error', fail);
      reject(new Error(`動画を読み込めません: ${v.src}`));
    };
    v.addEventListener(name, done);
    v.addEventListener('error', fail);
  });
}
