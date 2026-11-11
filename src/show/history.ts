import * as THREE from 'three';
import { CH, evaluate, type CompiledShow } from './cues';

/**
 * Parameter history on the GPU.
 *
 * Water in the air left its nozzle up to ~9 s ago, and its trajectory depends
 * on the nozzle state at that moment. Each frame we write the newest samples
 * of every fixture into two ring-buffer textures (rows = time samples at
 * RATE Hz, columns = fixtures); shaders look the state up at a drop's birth
 * time.
 *
 *   A: pressure, pan (rad), tilt (rad), M = cumulative emission
 *   B: LED colour r, g, b (linear), intensity
 *
 * M(t) = integral of sqrt(pressure) dt counts how much water has left a
 * nozzle. Particle slots are spaced evenly in M instead of time, so a short
 * shot gets all of its fixture's slots and silence costs none.
 */

export const RATE = 40;
export const WINDOW = 512; // samples, 12.8 s

export class ParamHistory {
  readonly texA: THREE.DataTexture;
  readonly texB: THREE.DataTexture;
  private dataA: Float32Array;
  private dataB: Float32Array;
  private M: Float32Array = new Float32Array(0); // [fixture * nSamples + k]
  private nSamples = 0;
  private lastK = Number.NEGATIVE_INFINITY;
  private show!: CompiledShow;
  /** Latest sample index written (absolute). */
  kNow = 0;

  constructor(private readonly fixtures: number) {
    this.dataA = new Float32Array(fixtures * WINDOW * 4);
    this.dataB = new Float32Array(fixtures * WINDOW * 4);
    const mk = (d: Float32Array) => {
      const t = new THREE.DataTexture(d, fixtures, WINDOW, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.needsUpdate = true;
      return t;
    };
    this.texA = mk(this.dataA);
    this.texB = mk(this.dataB);
  }

  /** Load (or hot-reload) a compiled show. Recomputes the emission integral. */
  setShow(show: CompiledShow) {
    this.show = show;
    const n = Math.ceil((show.file.duration + 20) * RATE);
    this.nSamples = n;
    this.M = new Float32Array(this.fixtures * n);
    for (let f = 0; f < this.fixtures; f++) {
      let m = 0;
      const row = f * n;
      for (let k = 0; k < n; k++) {
        const p = evaluate(show, f, CH.pressure, k / RATE);
        m += (p > 0.02 ? Math.sqrt(p) : 0) / RATE;
        this.M[row + k] = m;
      }
    }
    this.lastK = Number.NEGATIVE_INFINITY; // force a full rewrite
  }

  private emission(f: number, k: number): number {
    if (k < 0) return 0;
    return this.M[f * this.nSamples + Math.min(k, this.nSamples - 1)];
  }

  private writeSample(k: number) {
    const row = ((k % WINDOW) + WINDOW) % WINDOW;
    const t = k / RATE;
    const s = this.show;
    let o = row * this.fixtures * 4;
    for (let f = 0; f < this.fixtures; f++, o += 4) {
      this.dataA[o] = evaluate(s, f, CH.pressure, t);
      this.dataA[o + 1] = evaluate(s, f, CH.pan, t);
      this.dataA[o + 2] = evaluate(s, f, CH.tilt, t);
      this.dataA[o + 3] = this.emission(f, k);
      this.dataB[o] = evaluate(s, f, CH.r, t);
      this.dataB[o + 1] = evaluate(s, f, CH.g, t);
      this.dataB[o + 2] = evaluate(s, f, CH.b, t);
      this.dataB[o + 3] = evaluate(s, f, CH.intensity, t);
    }
    const start = row * this.fixtures * 4;
    this.texA.addUpdateRange(start, this.fixtures * 4);
    this.texB.addUpdateRange(start, this.fixtures * 4);
  }

  /** Bring the window up to time t (one sample ahead, for interpolation). */
  update(t: number) {
    const k = Math.floor(t * RATE) + 1;
    if (k === this.lastK) return;
    let from = this.lastK + 1;
    if (k < this.lastK || k - this.lastK >= WINDOW) {
      from = k - WINDOW + 1; // seek: rewrite the whole window
      this.texA.clearUpdateRanges();
      this.texB.clearUpdateRanges();
    }
    for (let j = from; j <= k; j++) this.writeSample(j);
    // a full rewrite touches every row: upload it in one go
    if (k - from + 1 >= WINDOW) {
      this.texA.clearUpdateRanges();
      this.texB.clearUpdateRanges();
    }
    this.texA.needsUpdate = true;
    this.texB.needsUpdate = true;
    this.lastK = k;
    this.kNow = k;
  }

  /** Current value of a channel for every fixture (for CPU-side effects). */
  current(f: number, channel: number, t: number): number {
    return evaluate(this.show, f, channel, t);
  }
}

/** GLSL to read the history. Needs uHistA, uHistB, uHistRate, uKNow. */
export const HISTORY_GLSL = /* glsl */ `
uniform highp sampler2D uHistA;
uniform highp sampler2D uHistB;
uniform float uHistRate;
uniform float uKNow;
const int HIST_W = ${WINDOW};

int histRow(float k) { return int(mod(k, float(HIST_W))); }

// Linear interpolation between the two samples around time tt.
vec4 histAt(highp sampler2D tex, int f, float tt) {
  float x = clamp(tt * uHistRate, uKNow - float(HIST_W) + 1.0, uKNow);
  float k0 = floor(x);
  float fr = x - k0;
  vec4 a = texelFetch(tex, ivec2(f, histRow(k0)), 0);
  vec4 b = texelFetch(tex, ivec2(f, histRow(min(k0 + 1.0, uKNow))), 0);
  return mix(a, b, fr);
}

float emissionAt(int f, float k) { return texelFetch(uHistA, ivec2(f, histRow(k)), 0).w; }

// Time at which fixture f's cumulative emission reached m, or -1e9 if that
// is older than the window.
float birthTime(int f, float m) {
  float lo = uKNow - float(HIST_W) + 1.0;
  float hi = uKNow;
  if (emissionAt(f, lo) > m) return -1e9;
  // largest k with M(k) <= m
  for (int i = 0; i < 10; i++) {
    float mid = floor((lo + hi + 1.0) * 0.5);
    if (emissionAt(f, mid) <= m) lo = mid; else hi = mid - 1.0;
  }
  float m0 = emissionAt(f, lo);
  float m1 = emissionAt(f, min(lo + 1.0, uKNow));
  float fr = m1 > m0 ? clamp((m - m0) / (m1 - m0), 0.0, 1.0) : 0.0;
  return (lo + fr) / uHistRate;
}
`;
