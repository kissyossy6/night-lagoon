export {};
/**
 * Export ceilings of this browser and GPU (tools/limits.html): WebGL buffer
 * sizes, and which video codecs WebCodecs really encodes at which frame size.
 * isConfigSupported is optimistic, so each size also encodes two frames.
 */

const out = document.getElementById('out')!;
const lines: string[] = [];
const log = (s: string) => {
  lines.push(s);
  out.textContent = lines.join('\n');
};

const gl = document.createElement('canvas').getContext('webgl2')!;
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const webgl = {
  renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  maxRenderbuffer: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
  maxViewport: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array),
  halfFloat: !!gl.getExtension('EXT_color_buffer_float'),
};
log(`WebGL: ${JSON.stringify(webgl)}`);
log(`UA: ${navigator.userAgent}`);

const CODECS: Record<string, string[]> = {
  h264: ['avc1.640034', 'avc1.640033', 'avc1.64003e', 'avc1.640040'],
  hevc: ['hvc1.1.6.L186.B0', 'hvc1.1.6.L183.B0', 'hvc1.1.6.L180.B0', 'hvc1.1.6.L156.B0', 'hvc1.1.6.L153.B0', 'hvc1.2.4.L186.B0'],
  av1: ['av01.0.19M.08', 'av01.0.16M.08', 'av01.0.13M.08'],
  vp9: ['vp09.00.62.08', 'vp09.00.61.08', 'vp09.00.51.08'],
};
const SIZES: [number, number][] = [
  [3840, 2160],
  [4096, 2160],
  [4096, 4096],
  [5760, 2880],
  [5760, 5760],
  [6144, 6144],
  [7680, 3840],
  [7680, 4320],
  [8192, 4096],
  [8192, 4320],
  [8192, 8192],
  [11520, 5760],
  [16384, 8192],
];

async function tryEncode(codec: string, width: number, height: number, hardware: HardwareAcceleration): Promise<string> {
  const config: VideoEncoderConfig = { codec, width, height, bitrate: 50_000_000, framerate: 30, hardwareAcceleration: hardware };
  if (codec.startsWith('avc')) config.avc = { format: 'avc' };
  let s;
  try {
    s = await VideoEncoder.isConfigSupported(config);
  } catch (e) {
    return `throws ${e}`;
  }
  if (!s.supported) return 'no';
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  let chunks = 0;
  let err: string | null = null;
  const enc = new VideoEncoder({ output: () => chunks++, error: (e) => (err = String(e)) });
  try {
    enc.configure(config);
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = `hsl(${i * 90}, 80%, 50%)`;
      ctx.fillRect(0, 0, width, height);
      const f = new VideoFrame(canvas, { timestamp: i * 33333 });
      enc.encode(f, { keyFrame: i === 0 });
      f.close();
    }
    await enc.flush();
    enc.close();
  } catch (e) {
    err ??= String(e);
  }
  return err ? `fails (${String(err).slice(0, 80)})` : chunks === 2 ? 'OK' : `chunks=${chunks}`;
}

const result: Record<string, Record<string, string>> = {};
for (const [name, list] of Object.entries(CODECS)) {
  for (const hw of ['prefer-hardware', 'prefer-software'] as HardwareAcceleration[]) {
    const key = `${name}/${hw.replace('prefer-', '')}`;
    result[key] = {};
    for (const [w, h] of SIZES) {
      let r = 'no';
      for (const codec of list) {
        const x = await tryEncode(codec, w, h, hw);
        if (x === 'OK') {
          r = `OK ${codec}`;
          break;
        }
        if (r === 'no' && x !== 'no') r = x;
      }
      result[key][`${w}x${h}`] = r;
      log(`${key.padEnd(18)} ${`${w}x${h}`.padEnd(12)} ${r}`);
    }
  }
}

// largest square WebGL render target (half float) that can actually be cleared and read
const r2 = document.createElement('canvas').getContext('webgl2')!;
r2.getExtension('EXT_color_buffer_float');
const rtMax: Record<string, string> = {};
for (const n of [4096, 8192, 12288, 16384]) {
  const tex = r2.createTexture();
  r2.bindTexture(r2.TEXTURE_2D, tex);
  r2.texStorage2D(r2.TEXTURE_2D, 1, r2.RGBA16F, n, n);
  const fb = r2.createFramebuffer();
  r2.bindFramebuffer(r2.FRAMEBUFFER, fb);
  r2.framebufferTexture2D(r2.FRAMEBUFFER, r2.COLOR_ATTACHMENT0, r2.TEXTURE_2D, tex, 0);
  const st = r2.checkFramebufferStatus(r2.FRAMEBUFFER);
  r2.clearColor(0.5, 0.25, 0.125, 1);
  r2.clear(r2.COLOR_BUFFER_BIT);
  const px = new Float32Array(4);
  r2.readPixels(n - 1, n - 1, 1, 1, r2.RGBA, r2.FLOAT, px);
  rtMax[n] = `${st === r2.FRAMEBUFFER_COMPLETE ? 'complete' : 'incomplete'} err=${r2.getError()} px=${px[0].toFixed(2)}`;
  log(`RGBA16F ${n}²: ${rtMax[n]}`);
  r2.deleteFramebuffer(fb);
  r2.deleteTexture(tex);
}

declare global {
  interface Window {
    __limits?: unknown;
  }
}
window.__limits = { webgl, encode: result, rtMax };
log('done');
