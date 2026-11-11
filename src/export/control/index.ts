import { channelsCsv } from './channels-csv';
import { dmxPatch } from './dmx-patch';
import { cueSheet } from './cue-sheet';
import { pyroCsv } from './pyro-csv';
import { dmxRecord } from './dmx-record';
import { FPS_CHOICES, type ControlExporter, type ExportOptions } from './types';
import { parseTimecode } from './common';

export type * from './types';
export { saveExport, reveal, exportName } from './save';

/** The exports for real equipment, in menu order (docs/detailed-design.md 5). */
export const EXPORTERS: ControlExporter[] = [channelsCsv, dmxPatch, cueSheet, pyroCsv, dmxRecord];

/**
 * The timecode setting (D7), the one shared by every export: frames per
 * second and the timecode of show time 0. Kept per browser.
 */
const KEY = 'water-show-export-timecode';
export const DEFAULT_TIMING: Pick<ExportOptions, 'fps' | 'timecodeStart'> = { fps: 40, timecodeStart: '00:00:00:00' };

export function loadTiming(): Pick<ExportOptions, 'fps' | 'timecodeStart'> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && (FPS_CHOICES as readonly number[]).includes(v.fps)) {
      parseTimecode(v.timecodeStart, v.fps);
      return { fps: v.fps, timecodeStart: v.timecodeStart };
    }
  } catch {
    /* a bad or unreadable setting falls back to the default */
  }
  return { ...DEFAULT_TIMING };
}

export function saveTiming(t: Pick<ExportOptions, 'fps' | 'timecodeStart'>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ fps: t.fps, timecodeStart: t.timecodeStart }));
  } catch {
    /* private window: the setting lasts for this page only */
  }
}
