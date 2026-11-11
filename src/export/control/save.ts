import type { CompiledShow } from '../../show/cues';
import type { Layout } from '../../show/layout';
import type { Chunk, ControlExporter, ExportOptions } from './types';

/**
 * Run an export and keep the result: under `npm run dev` the pieces are
 * appended to exports/control/ by the dev server (scripts/control-store.ts),
 * so nothing big sits in the page; a built page downloads the file instead.
 */

export interface SaveResult {
  /** exports/control/<name> under the dev server; the downloaded name otherwise. */
  output: string;
  bytes: number;
  /** Dev-server job, for 'Finder で表示'. */
  id?: string;
}

export interface SaveOptions {
  onProgress?(bytes: number, estimate: number): void;
  signal?: AbortSignal;
}

/** Bytes per request to the dev server. */
const BATCH = 4 << 20;

export function exportName(title: string, exporter: ControlExporter, opts: ExportOptions): string {
  const stem = (title || 'show').normalize('NFC').replace(/[\s\\/:*?"<>|#%&+]+/g, '_');
  const range = exporter.timed && opts.range ? `_${fmtS(opts.range[0])}-${fmtS(opts.range[1])}s` : '';
  const fps = exporter.timed ? `_${opts.fps}fps` : '';
  return `${stem}_${exporter.id}${fps}${range}.${exporter.ext}`;
}

const fmtS = (s: number) => String(Math.round(s * 10) / 10).replace('.', 'p');

export async function saveExport(exporter: ControlExporter, show: CompiledShow, layout: Layout, opts: ExportOptions, so: SaveOptions = {}): Promise<SaveResult> {
  const name = exportName(show.file.title, exporter, opts);
  const estimate = exporter.estimate(show, layout, opts);
  const enc = new TextEncoder();
  const bytesOf = (c: Chunk) => (typeof c === 'string' ? enc.encode(c) : c);
  if (!import.meta.env.DEV) {
    const parts: BlobPart[] = [];
    let bytes = 0;
    for await (const c of exporter.run(show, layout, opts)) {
      if (so.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      const b = bytesOf(c);
      parts.push(b as BlobPart);
      bytes += b.length;
      so.onProgress?.(bytes, estimate);
    }
    download(new Blob(parts, { type: exporter.mime }), name);
    return { output: name, bytes };
  }
  const { id } = await post(`/__control/start?name=${encodeURIComponent(name)}`);
  try {
    let pending: Uint8Array[] = [];
    let size = 0;
    let bytes = 0;
    const flush = async () => {
      if (!size) return;
      await post(`/__control/append?id=${id}`, new Blob(pending as BlobPart[]));
      bytes += size;
      pending = [];
      size = 0;
      so.onProgress?.(bytes, estimate);
    };
    for await (const c of exporter.run(show, layout, opts)) {
      if (so.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      const b = bytesOf(c);
      pending.push(b);
      size += b.length;
      if (size >= BATCH) await flush();
    }
    await flush();
    const r = await post(`/__control/end?id=${id}`);
    return { output: r.output, bytes: r.bytes, id };
  } catch (e) {
    await post(`/__control/cancel?id=${id}`).catch(() => undefined);
    throw e;
  }
}

export function reveal(id: string) {
  void post(`/__control/reveal?id=${id}`).catch(() => undefined);
}

async function post(url: string, body?: Blob) {
  const r = await fetch(url, { method: 'POST', body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `${r.status}`);
  return j;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
