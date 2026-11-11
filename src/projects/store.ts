import type { ShowFile } from '../show/types';
import { sampleDoc, sampleSummaries } from './samples';
import type { ProjectDoc, ProjectSummary } from './types';

/**
 * Where the projects live. With the dev server (npm run dev): the projects/
 * folder on disk, through scripts/project-store.ts. Without it (a static
 * build): this browser's storage, and the page says so.
 * Samples come from src/projects/samples.ts either way and are read-only.
 */
export interface ProjectStore {
  readonly kind: 'disk' | 'browser';
  list(): Promise<ProjectSummary[]>;
  get(id: string): Promise<ProjectDoc>;
  create(init: { name: string; show?: ShowFile | null; generate?: ProjectDoc['generate']; from?: string }): Promise<ProjectDoc>;
  save(doc: ProjectDoc): Promise<void>;
  saveThumb(id: string, jpeg: Blob): Promise<void>;
  duplicate(id: string, name: string): Promise<ProjectDoc>;
  promote(id: string, name: string): Promise<string>;
  trash(id: string): Promise<void>;
  reveal?(id: string): Promise<void>;
}

export const isSampleId = (id: string) => id.startsWith('sample-');

// ------------------------------------------------------------------ disk

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/__projects${path}`, init);
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const disk: ProjectStore = {
  kind: 'disk',
  list: () => call('/list'),
  async get(id) {
    return sampleDoc(id) ?? call(`/get?id=${encodeURIComponent(id)}`);
  },
  create: (init) => call('/create', post({ show: null, ...init })),
  async save(doc) {
    await call(`/save?id=${encodeURIComponent(doc.id)}`, post(doc));
  },
  async saveThumb(id, jpeg) {
    await call(`/thumb?id=${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg });
  },
  duplicate: (id, name) => call(`/duplicate?id=${encodeURIComponent(id)}`, post({ name })),
  async promote(id, name) {
    return (await call<{ id: string }>(`/promote?id=${encodeURIComponent(id)}`, post({ name }))).id;
  },
  async trash(id) {
    await call(`/trash?id=${encodeURIComponent(id)}`, { method: 'POST' });
  },
  async reveal(id) {
    await call(`/reveal?id=${encodeURIComponent(id)}`, { method: 'POST' });
  },
};

// --------------------------------------------------------------- browser

const KEY = 'water-show-projects:v1';
type Kept = ProjectDoc & { thumbData?: string };

function readAll(): Record<string, Kept> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Kept>;
  } catch {
    return {};
  }
}
function writeAll(all: Record<string, Kept>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    throw new Error('ブラウザの保存領域がいっぱいです。JSON を書き出して残してください');
  }
}
function browserId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
const blobToData = (b: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(b);
  });

const browser: ProjectStore = {
  kind: 'browser',
  async list() {
    return Object.values(readAll())
      .map((p) => ({ id: p.id, name: p.name, created: p.created, updated: p.updated, from: p.from, generate: p.generate, venue: p.show?.venue, duration: p.show?.duration, cues: p.show?.cues.length, thumb: p.thumbData }))
      .sort((a, b) => (a.updated < b.updated ? 1 : -1));
  },
  async get(id) {
    const s = sampleDoc(id);
    if (s) return s;
    const p = readAll()[id];
    if (!p) throw new Error('プロジェクトが見つかりません');
    const { thumbData: _drop, ...doc } = p;
    return doc;
  },
  async create(init) {
    const now = new Date().toISOString();
    const doc: Kept = { show: null, ...init, format: 1, id: browserId(), created: now, updated: now };
    const from = init.from ? sampleSummaries().find((s) => s.id === init.from) : undefined;
    if (from?.thumb) doc.thumbData = from.thumb;
    writeAll({ ...readAll(), [doc.id]: doc });
    return doc;
  },
  async save(doc) {
    const all = readAll();
    if (!all[doc.id]) throw new Error('プロジェクトが見つかりません');
    all[doc.id] = { ...doc, thumbData: all[doc.id].thumbData, updated: new Date().toISOString() };
    writeAll(all);
  },
  async saveThumb(id, jpeg) {
    const all = readAll();
    if (!all[id]) return;
    all[id].thumbData = await blobToData(jpeg);
    writeAll(all);
  },
  async duplicate(id, name) {
    const src = await this.get(id);
    const now = new Date().toISOString();
    const doc: Kept = { ...src, id: browserId(), name, created: now, updated: now, sample: undefined, description: undefined, from: isSampleId(id) ? id : src.from };
    const all = readAll();
    if (all[id]?.thumbData) doc.thumbData = all[id].thumbData;
    writeAll({ ...all, [doc.id]: doc });
    return doc;
  },
  async promote() {
    throw new Error('見本にするには開発サーバー（npm run dev）で開いてください');
  },
  async trash(id) {
    const all = readAll();
    delete all[id];
    writeAll(all);
  },
};

// ----------------------------------------------------------------- pick

let picked: Promise<ProjectStore> | null = null;
/** The disk store when the dev server answers, else the browser's. */
export function projectStore(): Promise<ProjectStore> {
  picked ??= fetch('/__projects/list')
    .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? disk : browser))
    .catch(() => browser);
  return picked;
}

// ------------------------------------------------------- last opened, move-in

const LAST_KEY = 'water-show-last-project';
export function lastProject(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
export function setLastProject(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* a convenience only */
  }
}

/** The editor's single autosave from before projects (src/editor/main.ts kept it here). */
const OLD_AUTOSAVE = 'water-show-editor:v1';
const MOVED_KEY = 'water-show-editor:v1-moved';
/**
 * Once: the old autosave becomes a project 「エディタの演出（引っ越し）」.
 * The old entry stays where it was. Returns the new project's id, if one was made.
 */
export async function moveInOldAutosave(store: ProjectStore): Promise<string | null> {
  try {
    if (localStorage.getItem(MOVED_KEY)) return null;
    const raw = localStorage.getItem(OLD_AUTOSAVE);
    if (!raw) {
      localStorage.setItem(MOVED_KEY, 'nothing');
      return null;
    }
    const show = JSON.parse(raw) as ShowFile;
    const doc = await store.create({ name: 'エディタの演出（引っ越し）', show });
    localStorage.setItem(MOVED_KEY, doc.id);
    return doc.id;
  } catch {
    return null;
  }
}
