/**
 * A look-ahead limiter on rendered sound: it turns the level down where the
 * channels would pass the ceiling, never bends the wave (bending it, as the
 * fireworks track first did, fills the highs with distortion). The gain
 * needed at each sample falls at most 20 dB per 5 ms ahead of a peak and
 * rises back at most 6 dB per 100 ms after it.
 */
export function limit(channels: Float32Array[], sampleRate: number, ceiling: number) {
  const len = Math.min(...channels.map((c) => c.length));
  const g = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let peak = 1e-9;
    for (const c of channels) peak = Math.max(peak, Math.abs(c[i]));
    g[i] = Math.min(1, ceiling / peak);
  }
  const ahead = Math.pow(10, 20 / 20 / (0.005 * sampleRate));
  const back = Math.pow(10, 6 / 20 / (0.1 * sampleRate));
  for (let i = len - 2; i >= 0; i--) g[i] = Math.min(g[i], g[i + 1] * ahead);
  for (let i = 1; i < len; i++) g[i] = Math.min(g[i], g[i - 1] * back);
  for (const c of channels) for (let i = 0; i < len; i++) c[i] *= g[i];
}
