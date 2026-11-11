import { EXPORTERS, loadTiming, reveal, saveExport, saveTiming, type Chunk, type ControlExporter, type ExportOptions } from '../export/control';
import { parseTimecode } from '../export/control/common';
import { FPS_CHOICES } from '../export/control/types';
import { ArtnetSender, loadTarget, saveTarget, type ArtnetStatus } from '../export/control/artnet';
import type { CompiledShow } from '../show/cues';
import type { Layout } from '../show/layout';

/**
 * 書き出し ▾ → 実機向けに書き出す: one dialog for every export for real
 * equipment (src/export/control/). The show and layout are the preview's,
 * so the files hold the values the picture is drawn from.
 */

export interface ControlExportHost {
  /** The compiled show on screen now, or null while it is being prepared. */
  show(): { show: CompiledShow; layout: Layout } | null;
  /** Why not yet (music still loading…), or null when ready. */
  busy(): string | null;
  /** Show time now (s), for Art-Net. */
  now(): number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function setupControlExport(host: ControlExportHost) {
  const pop = $('cx-pop');
  const dialog = $('cx');
  const form = $<HTMLFormElement>('cx-form');
  const fps = $<HTMLSelectElement>('cx-fps');
  const tc = $<HTMLInputElement>('cx-tc');
  const from = $<HTMLInputElement>('cx-from');
  const to = $<HTMLInputElement>('cx-to');
  const note = $('cx-note');
  const err = $('cx-error');
  let current: ControlExporter = EXPORTERS[0];
  let running: AbortController | null = null;
  let lastId: string | undefined;

  for (const f of FPS_CHOICES) fps.append(new Option(`${f} fps`, String(f)));
  for (const e of EXPORTERS) {
    const b = document.createElement('button');
    b.textContent = `${e.label}…`;
    b.dataset.id = e.id;
    pop.append(b);
    const l = document.createElement('label');
    l.innerHTML = `<input type="radio" name="cx-format" value="${e.id}" /> ${e.label}（.${e.ext}）`;
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = e.hint;
    $('cx-formats').append(l, hint);
  }

  pop.append(document.createElement('hr'));
  const anItem = document.createElement('button');
  anItem.textContent = 'Art-Net で送る…';
  anItem.dataset.act = 'artnet';
  pop.append(anItem);
  const artnet = setupArtnet(host);

  $('cx-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
  });
  document.addEventListener('click', () => (pop.hidden = true));
  pop.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).dataset.id;
    pop.hidden = true;
    e.stopPropagation();
    if (id) open(id);
    else if ((e.target as HTMLElement).dataset.act === 'artnet') artnet.open();
  });

  function open(id: string) {
    current = EXPORTERS.find((e) => e.id === id) ?? EXPORTERS[0];
    const t = loadTiming();
    fps.value = String(t.fps);
    tc.value = t.timecodeStart;
    for (const r of form.querySelectorAll<HTMLInputElement>('input[name=cx-format]')) r.checked = r.value === current.id;
    $('cx-settings').hidden = false;
    $('cx-run').hidden = true;
    err.hidden = true;
    $<HTMLButtonElement>('cx-go').hidden = false;
    $('cx-cancel').textContent = '閉じる';
    const s = host.show();
    if (s) {
      const d = s.show.file.duration;
      $('cx-all').textContent = clock(d);
      from.max = to.max = String(d);
    }
    dialog.hidden = false;
    refresh();
  }

  /** The options as entered, or an error message. */
  function options(): ExportOptions | string {
    const f = Number(fps.value);
    try {
      parseTimecode(tc.value, f);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    const part = form.querySelector<HTMLInputElement>('input[name=cx-range]:checked')?.value === 'part';
    const a = Number(from.value);
    const b = Number(to.value);
    if (part && !(b > a && a >= 0)) return '範囲は「開始 < 終了」で指定してください';
    return { fps: f, timecodeStart: tc.value.trim(), range: part ? [a, b] : undefined };
  }

  function refresh() {
    form.classList.toggle('untimed', !current.timed);
    const busy = host.busy();
    const o = options();
    tc.classList.toggle('bad', typeof o === 'string' && o.includes('タイムコード'));
    const s = host.show();
    $<HTMLButtonElement>('cx-go').disabled = !!busy || typeof o === 'string' || !s;
    if (busy || !s) {
      note.textContent = busy ?? '準備中…';
      return;
    }
    if (typeof o === 'string') {
      note.textContent = o;
      return;
    }
    const size = current.estimate(s.show, s.layout, o);
    const where = import.meta.env.DEV ? 'exports/control/ に保存' : 'ブラウザでダウンロード';
    // each format counts in its own unit: cues, shells, frames, fixtures
    note.textContent = `${current.amount(s.show, s.layout, o)}・約 ${mb(size)}（${where}）`;
    for (const n of current.notes?.(s.show, s.layout, o) ?? []) {
      const line = document.createElement('span');
      line.className = 'caution';
      line.textContent = n;
      note.append(document.createElement('br'), line);
    }
  }

  form.addEventListener('input', () => {
    const r = form.querySelector<HTMLInputElement>('input[name=cx-format]:checked');
    current = EXPORTERS.find((e) => e.id === r?.value) ?? current;
    refresh();
  });

  $('cx-cancel').addEventListener('click', () => {
    if (running) running.abort();
    else dialog.hidden = true;
  });
  $('cx-reveal').addEventListener('click', () => lastId && reveal(lastId));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const o = options();
    const s = host.show();
    if (typeof o === 'string' || !s || running) return;
    saveTiming(o);
    running = new AbortController();
    $('cx-settings').hidden = true;
    $('cx-run').hidden = false;
    $('cx-done').hidden = true;
    $('cx-peek').hidden = true;
    $<HTMLButtonElement>('cx-go').hidden = true;
    $('cx-cancel').textContent = 'やめる';
    err.hidden = true;
    const progress = $<HTMLProgressElement>('cx-progress');
    const state = $('cx-state');
    const t0 = performance.now();
    // the first lines of the file, shown when it is done
    const peek = new Peek();
    const exporter: ControlExporter = { ...current, run: (a, b, c) => peek.tap(current.run(a, b, c)) };
    try {
      const r = await saveExport(exporter, s.show, s.layout, o, {
        signal: running.signal,
        onProgress(bytes, estimate) {
          progress.value = Math.min(0.99, bytes / Math.max(1, estimate));
          state.textContent = `書き出し中… ${mb(bytes)}`;
        },
      });
      progress.value = 1;
      lastId = r.id;
      state.textContent = `書き出しました：${r.output}（${mb(r.bytes)}・${((performance.now() - t0) / 1000).toFixed(1)} 秒）`;
      $('cx-done').hidden = !r.id;
      const p = $('cx-peek');
      p.textContent = peek.text();
      p.hidden = false;
      window.__controlExport = { ...r, id: current.id, options: o };
    } catch (x) {
      const cancelled = x instanceof DOMException && x.name === 'AbortError';
      state.textContent = cancelled ? 'やめました（途中のファイルは消しました）' : '';
      if (!cancelled) {
        err.textContent = `書き出せませんでした：${x instanceof Error ? x.message : String(x)}`;
        err.hidden = false;
      }
      window.__controlExport = { error: String(x), id: current.id, options: o };
    } finally {
      running = null;
      $('cx-cancel').textContent = '閉じる';
    }
  });

  return { open, artnet };
}

/** 書き出し ▾ → Art-Net で送る: the destination, start and stop, and how it is going. */
function setupArtnet(host: ControlExportHost) {
  const dialog = $('an');
  const hostIn = $<HTMLInputElement>('an-host');
  const portIn = $<HTMLInputElement>('an-port');
  const state = $('an-state');
  const chip = $<HTMLButtonElement>('an-chip');
  const sender = new ArtnetSender();
  let last = 0;
  let lastAt = performance.now();
  let rate = 0;

  const show = (s: ArtnetStatus) => {
    const now = performance.now();
    if (now - lastAt > 900) {
      rate = ((s.packets - last) * 1000) / (now - lastAt) / Math.max(1, s.universes.length);
      last = s.packets;
      lastAt = now;
    }
    chip.hidden = s.state !== 'on';
    $<HTMLButtonElement>('an-stop').disabled = s.state === 'off';
    const t = loadTarget();
    state.innerHTML = '';
    const line = document.createElement('span');
    if (s.state === 'on') {
      line.className = 'on';
      line.textContent = `送信中 → ${t.host}:${t.port}・ユニバース ${s.universes.map((u) => u + 1).join(',')}（Art-Net の番号 ${s.universes.join(',')}）・毎秒約 ${Math.round(rate)} 回・送った数 ${s.packets.toLocaleString()}`;
    } else if (s.state === 'connecting') line.textContent = 'つないでいます…';
    else if (s.state === 'error') line.textContent = '';
    else line.textContent = '止まっています';
    state.append(line);
    if (s.error) {
      const e = document.createElement('span');
      e.className = 'bad';
      e.textContent = ` ${s.error}`;
      state.append(document.createElement('br'), e);
    }
  };
  sender.onStatus = show;

  const open = () => {
    const t = loadTarget();
    hostIn.value = t.host;
    portIn.value = String(t.port);
    $('an-fps').textContent = `${loadTiming().fps} fps`;
    show(sender.status);
    dialog.hidden = false;
  };
  chip.addEventListener('click', open);
  $('an-close').addEventListener('click', () => (dialog.hidden = true));
  $('an-stop').addEventListener('click', () => sender.stop());
  $<HTMLFormElement>('an-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const busy = host.busy();
    if (busy) {
      state.textContent = busy;
      return;
    }
    const t = { host: hostIn.value.trim() || '127.0.0.1', port: Math.round(Number(portIn.value)) || 6454 };
    saveTarget(t);
    sender.start(() => host.show(), () => host.now(), loadTiming().fps, t);
  });
  return { open, sender };
}

/** Keeps the first few lines that pass through, each cut to a readable width. */
class Peek {
  private lines: string[] = [];
  private partial = '';
  private cols = 1;
  private binary = false;
  constructor(
    private max = 6,
    private width = 150,
  ) {}
  async *tap(src: AsyncIterable<Chunk>): AsyncIterable<Chunk> {
    for await (const c of src) {
      if (typeof c !== 'string') this.binary = true;
      else if (this.lines.length < this.max) this.take(c);
      yield c;
    }
  }
  private take(s: string) {
    let at = 0;
    while (this.lines.length < this.max) {
      const nl = s.indexOf('\n', at);
      const piece = s.slice(at, nl < 0 ? s.length : nl);
      if (this.partial.length < this.width) this.partial += piece.slice(0, this.width);
      for (let i = piece.indexOf(','); i >= 0; i = piece.indexOf(',', i + 1)) this.cols++;
      if (nl < 0) return;
      const l = this.partial.replace(/^\ufeff/, '').replace(/\r$/, '');
      this.lines.push(this.cols > 12 && l.length >= this.width ? `${l.slice(0, this.width)} …（${this.cols} 列）` : l);
      this.partial = '';
      this.cols = 1;
      at = nl + 1;
    }
  }
  text() {
    return this.lines.length ? this.lines.join('\n') : this.binary ? '（中身はバイナリです）' : '';
  }
}

const mb = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

declare global {
  interface Window {
    __controlExport?: { output?: string; bytes?: number; id: string; options: ExportOptions; error?: string };
  }
}
