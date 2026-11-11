import { breathe, frameSpan } from './common';
import { buildPatch, clipNotes, dmxFrame } from './profiles';
import type { ControlExporter } from './types';

/**
 * D3 DMX の記録 (.dmxrec): every universe's 512 DMX values at every frame
 * (docs/detailed-design.md 5.6). Our own format, described in its first line:
 *
 *   {"format":"dmxrec","version":1,"fps":40,"universes":[1,2,3,4],
 *    "timecodeStart":"00:00:00:00","firstFrame":0,"frames":8681,…}\n
 *   then frames × universes × 512 bytes: frame firstFrame (show time
 *   firstFrame / fps), its universes in the order listed, then the next frame.
 *
 * The values are the patch's (profiles.ts): what Art-Net sends (D4).
 */

/** Frames per chunk (10 s at 40 fps). */
const FRAMES = 400;

export const dmxRecord: ControlExporter = {
  id: 'dmx-record',
  label: 'DMX の記録',
  hint: 'コマごとに、ユニバースごとの DMX の値 512 個（割り当て表のとおり）',
  ext: 'dmxrec',
  mime: 'application/octet-stream',
  timed: true,
  estimate(show, layout, opts) {
    const { k0, k1 } = frameSpan(show, opts);
    return (k1 - k0 + 1) * buildPatch(layout).universes.length * 512;
  },
  amount(show, layout, opts) {
    const { k0, k1 } = frameSpan(show, opts);
    return `${(k1 - k0 + 1).toLocaleString()} コマ・${layout.channels} 台`;
  },
  notes: (show, layout, opts) => clipNotes(show, layout, buildPatch(layout), opts.range),
  async *run(show, layout, opts) {
    const patch = buildPatch(layout);
    const { k0, k1 } = frameSpan(show, opts);
    const head = {
      format: 'dmxrec',
      version: 1,
      fps: opts.fps,
      universes: patch.universes,
      timecodeStart: opts.timecodeStart,
      firstFrame: k0,
      frames: k1 - k0 + 1,
      show: show.file.title,
      layout: 'frames × universes × 512 bytes; frame k is show time k / fps; patch: the DMX の割り当て表',
    };
    yield `${JSON.stringify(head)}\n`;
    const nU = patch.universes.length;
    for (let a = k0; a <= k1; a += FRAMES) {
      const n = Math.min(k1, a + FRAMES - 1) - a + 1;
      const buf = new Uint8Array(n * nU * 512);
      for (let j = 0; j < n; j++) {
        const frames = Array.from({ length: nU }, (_, u) => buf.subarray((j * nU + u) * 512, (j * nU + u + 1) * 512));
        dmxFrame(show, patch, (a + j) / opts.fps, frames);
      }
      yield buf;
      await breathe();
    }
  },
};
