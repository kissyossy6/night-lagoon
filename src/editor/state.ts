import type { ShowFile } from '../show/types';
import { clone } from './model';

/**
 * The editor's document: the show file being edited, the cue selection and
 * an undo/redo history of whole-file snapshots (JSON strings).
 *
 * Every change goes through mutate(). Consecutive mutations with the same
 * coalescing key (a drag gesture, a slider being dragged) share one undo step.
 */

export interface ChangeEvent {
  kind: 'file' | 'selection';
  /** Who made the change, so a view can skip rebuilding itself. */
  source?: string;
  /** A continuous gesture (drag, slider): apply to the preview debounced. */
  live?: boolean;
  /** Cue indices changed meaning (add, delete, load, undo). */
  structural?: boolean;
}

export interface MutateOptions {
  key?: string;
  source?: string;
  live?: boolean;
  structural?: boolean;
}

/** Undo steps kept; older ones are dropped (and the editor says so when you reach the end). */
export const MAX_HISTORY = 300;
const COALESCE_MS = 1500;

export class EditorState {
  file: ShowFile;
  /** Selected cue indices. */
  selection = new Set<number>();
  /** The cue shown in the inspector (last clicked). -1 = none. */
  primary = -1;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** Undo steps dropped for MAX_HISTORY: the oldest kept step is then not where editing began. */
  dropped = 0;
  private lastKey = '';
  private lastTime = 0;
  private listeners: ((e: ChangeEvent) => void)[] = [];

  constructor(file: ShowFile) {
    this.file = clone(file);
  }

  on(fn: (e: ChangeEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: ChangeEvent) {
    for (const fn of this.listeners) fn(e);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  /** Change the file in place. Records an undo step unless coalesced. */
  mutate(fn: (f: ShowFile) => void, opts: MutateOptions = {}): boolean {
    const before = JSON.stringify(this.file);
    fn(this.file);
    const after = JSON.stringify(this.file);
    if (before === after) return false;
    const now = performance.now();
    const coalesce = !!opts.key && opts.key === this.lastKey && now - this.lastTime < COALESCE_MS;
    if (!coalesce) {
      this.undoStack.push(before);
      if (this.undoStack.length > MAX_HISTORY) {
        this.undoStack.shift();
        this.dropped++;
      }
    }
    this.lastKey = opts.key ?? '';
    this.lastTime = now;
    this.redoStack = [];
    if (opts.structural) this.pruneSelection();
    this.emit({ kind: 'file', source: opts.source, live: opts.live, structural: opts.structural });
    return true;
  }

  /** Replace the whole document (new / load / import). Undoable. */
  load(file: ShowFile) {
    this.mutate(
      (f) => {
        // replace, not merge: a key the new file lacks (its own sections, a venue)
        // must not stay from the file open before
        const next = clone(file);
        for (const k of Object.keys(f) as (keyof ShowFile)[]) if (!(k in next)) delete f[k];
        Object.assign(f, next);
      },
      { structural: true },
    );
    this.setSelection([], -1);
  }

  /** End a coalescing run so the next mutation starts a new undo step. */
  seal() {
    this.lastKey = '';
  }

  undo() {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(JSON.stringify(this.file));
    this.restore(prev);
  }

  redo() {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(JSON.stringify(this.file));
    this.restore(next);
  }

  private restore(json: string) {
    this.file = JSON.parse(json) as ShowFile;
    this.lastKey = '';
    this.pruneSelection();
    this.emit({ kind: 'file', structural: true });
  }

  private pruneSelection() {
    const n = this.file.cues.length;
    for (const i of [...this.selection]) if (i >= n) this.selection.delete(i);
    if (this.primary >= n) this.primary = this.selection.size ? Math.max(...this.selection) : -1;
  }

  setSelection(indices: Iterable<number>, primary?: number) {
    this.selection = new Set(indices);
    this.primary = primary ?? (this.selection.size ? [...this.selection][this.selection.size - 1] : -1);
    if (this.primary >= 0 && !this.selection.has(this.primary)) this.selection.add(this.primary);
    this.emit({ kind: 'selection' });
  }

  /** Selected indices, primary first. */
  selected(): number[] {
    const rest = [...this.selection].filter((i) => i !== this.primary).sort((a, b) => a - b);
    return this.primary >= 0 ? [this.primary, ...rest] : rest;
  }

  /** Delete cues by index; selection is cleared. */
  remove(indices: number[]) {
    if (!indices.length) return;
    const kill = new Set(indices);
    this.selection.clear();
    this.primary = -1;
    this.mutate((f) => (f.cues = f.cues.filter((_, i) => !kill.has(i))), { structural: true });
    this.emit({ kind: 'selection' });
  }
}
