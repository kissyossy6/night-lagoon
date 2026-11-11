import type { Folder } from '../fixtures';
import { FOLDER_NAMES, KINDS } from '../fixtures';
import type { Cue, ShowFile } from '../show/types';
import { LANES, laneOf } from './model';

/**
 * How the timeline page is looked at (docs/editor-architecture.md 4.1):
 * the work-area tabs (全体・水・光・水幕・花火) and, per tab, which folders
 * are open, S (solo: only this folder, in the timeline and the 3D) and M
 * (mute: dimmed in the timeline, left out of the 3D) and the 3D camera.
 *
 * None of this is in the show file; it is kept in this browser
 * (localStorage), per tab. Folding never changes the show; S and M change
 * only what the editor's 3D draws, never the saved show, the player or the
 * exports.
 */

export type TabId = 'all' | 'water' | 'light' | 'screen' | 'pyro';

export interface TabDef {
  id: TabId;
  name: string;
  /** Folders open when the tab is first used. */
  open: Folder[];
  /** The tab is shown only when the venue has this folder. */
  needs?: Folder;
  /** Camera to start from when the tab has none of its own: a venue seat id. */
  seat?: string;
  /** Water and screen cues that do not touch the light are drawn faint (光). */
  lightOnly?: boolean;
}

export const TABS: TabDef[] = [
  { id: 'all', name: '全体', open: [] },
  { id: 'water', name: '水', open: ['water'], needs: 'water' },
  { id: 'light', name: '光', open: ['water', 'screen'], lightOnly: true },
  { id: 'screen', name: '水幕', open: ['screen'], needs: 'screen' },
  { id: 'pyro', name: '花火', open: ['pyro'], needs: 'pyro', seat: 'pyro' },
];

export interface Camera {
  pos: [number, number, number];
  target: [number, number, number];
}

interface TabView {
  open: Partial<Record<Folder, boolean>>;
  solo: Folder | null;
  mute: Folder[];
  /** By venue id: a venue's camera means nothing in another. */
  cams: Record<string, Camera>;
}

const STORE_KEY = 'water-show-editor-view:v1';

export type ViewChange = 'tab' | 'fold' | 'filter';

export class EditorView {
  tab: TabId = 'all';
  private tabs = {} as Record<TabId, TabView>;
  private listeners: ((c: ViewChange) => void)[] = [];

  constructor() {
    for (const t of TABS) this.tabs[t.id] = fresh(t);
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const saved = raw ? (JSON.parse(raw) as { tab?: TabId; tabs?: Partial<Record<TabId, TabView>> }) : null;
      if (saved) {
        if (saved.tab && TABS.some((t) => t.id === saved.tab)) this.tab = saved.tab;
        for (const t of TABS) {
          const v = saved.tabs?.[t.id];
          if (v) this.tabs[t.id] = { open: { ...v.open }, solo: v.solo ?? null, mute: [...(v.mute ?? [])], cams: { ...(v.cams ?? {}) } };
        }
      }
    } catch {
      /* a broken store: start from the defaults */
    }
  }

  on(fn: (c: ViewChange) => void) {
    this.listeners.push(fn);
  }

  private changed(c: ViewChange) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ tab: this.tab, tabs: this.tabs }));
    } catch {
      /* not saved; the view still works */
    }
    for (const fn of this.listeners) fn(c);
  }

  private get cur(): TabView {
    return this.tabs[this.tab];
  }
  get def(): TabDef {
    return TABS.find((t) => t.id === this.tab)!;
  }

  setTab(id: TabId) {
    if (id === this.tab) return;
    this.tab = id;
    this.changed('tab');
  }

  /** Back to the tab's first state (folders, S/M, camera). */
  resetTab() {
    this.tabs[this.tab] = fresh(this.def);
    this.changed('tab');
  }

  isOpen(f: Folder): boolean {
    return !!this.cur.open[f];
  }
  setOpen(f: Folder, open: boolean) {
    if (this.isOpen(f) === open) return;
    this.cur.open[f] = open;
    this.changed('fold');
  }

  solo(): Folder | null {
    return this.cur.solo;
  }
  muted(f: Folder): boolean {
    return this.cur.mute.includes(f);
  }
  toggleSolo(f: Folder) {
    this.cur.solo = this.cur.solo === f ? null : f;
    this.changed('filter');
  }
  toggleMute(f: Folder) {
    const m = this.cur.mute;
    this.cur.mute = m.includes(f) ? m.filter((x) => x !== f) : [...m, f];
    this.changed('filter');
  }

  /** Whether the 3D draws this folder's cues (S and M). */
  shown(f: Folder): boolean {
    const s = this.cur.solo;
    return s ? s === f : !this.cur.mute.includes(f);
  }
  /** Some folder is left out of the 3D. */
  get filtering(): boolean {
    return !!this.cur.solo || this.cur.mute.length > 0;
  }

  cam(venue: string): Camera | undefined {
    return this.cur.cams[venue];
  }
  saveCam(venue: string, cam: Camera) {
    this.cur.cams[venue] = cam;
    // a camera move is not worth telling the timeline about
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ tab: this.tab, tabs: this.tabs }));
    } catch {
      /* not saved */
    }
  }

  /** The show the 3D draws: without the cues of folders S/M leave out. */
  filter(file: ShowFile): ShowFile {
    if (!this.filtering) return file;
    return { ...file, cues: file.cues.filter((c) => this.shownCue(c)) };
  }

  shownCue(c: Cue): boolean {
    const f = folderOfCue(c);
    return !f || this.shown(f);
  }

  /** What the 3D leaves out, for the preview's tag; '' when nothing. */
  filterLabel(): string {
    const s = this.cur.solo;
    if (s) return `3D：${FOLDER_NAMES[s]}だけ`;
    if (this.cur.mute.length) return `3D：${this.cur.mute.map((f) => FOLDER_NAMES[f]).join('・')}を消している`;
    return '';
  }
}

function fresh(t: TabDef): TabView {
  return { open: Object.fromEntries(t.open.map((f) => [f, true])), solo: null, mute: [], cams: {} };
}

/** The folder of a lane (none for the この会場に無い lane). */
export function folderOfLane(l: number): Folder | null {
  const lane = LANES[l];
  if (!lane || lane.missing) return null;
  return KINDS[lane.kind]?.folder ?? null;
}

export function folderOfCue(c: Cue): Folder | null {
  return folderOfLane(laneOf(c));
}

/** Cues the 光 tab draws in full: they set a colour or a brightness. */
export function touchesLight(c: Cue): boolean {
  if (c.fire) return true;
  if (c.set && (c.set.color !== undefined || c.set.intensity !== undefined)) return true;
  if (c.macro === 'rainbow') return true;
  const p = c.args?.param;
  return p === 'intensity' || p === 'color';
}
