import type { CompiledShow } from '../../show/cues';
import type { Layout } from '../../show/layout';
import { buildPatch, dmxFrame, type Patch } from './profiles';

/**
 * D4 Art-Net: while on, the DMX of the show time now goes to the dev server
 * (scripts/artnet-bridge.ts), which sends it on as ArtDmx. The time is held
 * to the frame grid of the timecode setting (fps), so what goes out is,
 * frame for frame, the DMX recording (D3). Only under `npm run dev`.
 */

export interface ArtnetTarget {
  host: string;
  port: number;
}

export interface ArtnetStatus {
  state: 'off' | 'connecting' | 'on' | 'error';
  /** Packets the dev server has sent. */
  packets: number;
  /** Art-Net port-addresses being sent (the patch's universes - 1). */
  universes: number[];
  error?: string;
}

const KEY = 'water-show-artnet-target';
export const DEFAULT_TARGET: ArtnetTarget = { host: '127.0.0.1', port: 6454 };

export function loadTarget(): ArtnetTarget {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v.host === 'string' && Number.isInteger(v.port)) return { host: v.host, port: v.port };
  } catch {
    /* falls back to the default */
  }
  return { ...DEFAULT_TARGET };
}

export function saveTarget(t: ArtnetTarget) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* private window */
  }
}

export class ArtnetSender {
  status: ArtnetStatus = { state: 'off', packets: 0, universes: [] };
  onStatus?: (s: ArtnetStatus) => void;
  private ws: WebSocket | null = null;
  private timer = 0;
  private patch: Patch | null = null;
  private frames: Uint8Array[] = [];
  private message = new Uint8Array(0);

  /**
   * Start sending: fps times a second, the DMX of now() (show time),
   * snapped to the fps frame grid.
   */
  start(source: () => { show: CompiledShow; layout: Layout } | null, now: () => number, fps: number, target: ArtnetTarget) {
    this.stop();
    if (!import.meta.env.DEV) return this.set({ state: 'error', error: 'Art-Net は npm run dev のときだけ使えます' });
    const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/__artnet`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.set({ state: 'connecting', packets: 0, error: undefined });
    ws.onopen = () => {
      ws.send(JSON.stringify(target));
      this.set({ state: 'on' });
      this.timer = window.setInterval(() => {
        const s = source();
        if (!s || ws.readyState !== WebSocket.OPEN) return;
        this.send(s.show, s.layout, Math.round(now() * fps) / fps);
      }, 1000 / fps);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      const m = JSON.parse(e.data);
      this.set({ packets: m.packets ?? 0, error: m.error });
    };
    ws.onerror = () => this.set({ state: 'error', error: '開発サーバーにつながりません' });
    ws.onclose = () => {
      clearInterval(this.timer);
      if (this.ws === ws && this.status.state !== 'error') this.set({ state: 'off' });
    };
  }

  stop() {
    clearInterval(this.timer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.set({ state: 'off' });
  }

  /** One message: [port-address][512 bytes] for each universe of the patch. */
  private send(show: CompiledShow, layout: Layout, t: number) {
    if (!this.patch || this.patch !== this.patchFor(layout)) {
      this.patch = this.patchFor(layout);
      this.message = new Uint8Array(this.patch.universes.length * 514);
      this.frames = this.patch.universes.map((u, k) => {
        new DataView(this.message.buffer).setUint16(k * 514, u - 1);
        return this.message.subarray(k * 514 + 2, (k + 1) * 514);
      });
      this.set({ universes: this.patch.universes.map((u) => u - 1) });
    }
    dmxFrame(show, this.patch, t, this.frames);
    this.ws?.send(this.message);
  }

  private cache = new WeakMap<Layout, Patch>();
  private patchFor(layout: Layout): Patch {
    let p = this.cache.get(layout);
    if (!p) this.cache.set(layout, (p = buildPatch(layout)));
    return p;
  }

  private set(s: Partial<ArtnetStatus>) {
    this.status = { ...this.status, ...s };
    this.onStatus?.(this.status);
  }
}
