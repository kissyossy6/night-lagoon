import * as THREE from 'three';
import type { ScreenContent } from '../show/runtime';
import { ProjectionContent } from './projection';
import { VideoDeck } from './video';

/**
 * The water-screen projection as a ShowRuntime ScreenContent.
 *
 * Copying a canvas into WebGL is the expensive part, so by default the
 * projector runs at half the frame rate and its average colour (a GPU
 * readback) is sampled every few frames; both are far below what the eye
 * notices on mist. `every: 1` renders every call (still frames, the editor).
 *
 * A screen cue can switch the projector to a video file (show/types.ts Clip);
 * its frames are drawn into the same canvas, so the mist, the light on the
 * water and the export treat it like the drawn scenes.
 */
export function projectionScreen(
  opts: { width?: number; height?: number; every?: number } = {},
): ScreenContent & { every: number; onVideoFrame: (() => void) | null; resize(width: number, height: number): void } {
  let projection = new ProjectionContent(opts.width ?? 1536, opts.height ?? 288);
  const deck = new VideoDeck();
  const texture = new THREE.CanvasTexture(projection.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  let frame = 0;
  let avg: [number, number, number] = [0, 0, 0];
  return {
    texture,
    /** Render every n-th call; 1 for frames that must be complete (video export). */
    every: opts.every ?? 2,
    get onVideoFrame() {
      return deck.onFrame;
    },
    set onVideoFrame(fn) {
      deck.onFrame = fn;
    },
    render(f) {
      // the video follows the clock on every call, drawn or not
      const v = f.video ? deck.sync(f.video.src, f.t) : (deck.stop(), null);
      const every = this.every;
      if (frame++ % every !== 0) return;
      if (f.video) projection.image(v, v?.videoWidth ?? 0, v?.videoHeight ?? 0, f.video.fit);
      else projection.render(f.t, f.only);
      // the light the picture throws on the water is read before the
      // projector's zones dim it (as the screens' brightness did)
      if (every === 1 || frame % (every * 4) === 1) avg = projection.averageColor();
      if (f.mask) projection.dim(f.mask);
      texture.needsUpdate = true;
    },
    /** A sharper (or lighter) projector picture: the 180° export draws the screen far larger. */
    resize(width, height) {
      if (projection.canvas.width === width && projection.canvas.height === height) return;
      projection = new ProjectionContent(width, height);
      // a texture of a new size has to be allocated again
      texture.dispose();
      texture.image = projection.canvas;
      texture.needsUpdate = true;
      frame = 0;
    },
    idle: () => deck.stop(),
    async prepare(f) {
      if (f.video) await deck.seekExact(f.video.src, f.t);
    },
    averageColor: () => avg,
  };
}
