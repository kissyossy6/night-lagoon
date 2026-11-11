/**
 * Receive Art-Net (ArtDmx) and show what comes in: packets a second per
 * universe and the first channels. With --compare, check every received set
 * of universes against a DMX recording (.dmxrec, D3): each must equal one of
 * its frames, byte for byte.
 *
 *   node scripts/artnet-listen.mjs [--port=6454] [--bind=0.0.0.0] [--seconds=10]
 *                                  [--compare=exports/control/<show>_dmx-record_40fps.dmxrec]
 *
 * The editor sends with 書き出し ▾ → Art-Net で送る (dev server only).
 */
import { createSocket } from 'node:dgram';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** An ArtDmx packet as { portAddress, sequence, data }, or null. */
export function parseArtDmx(p) {
  if (p.length < 18 || p.toString('latin1', 0, 8) !== 'Art-Net\0' || p.readUInt16LE(8) !== 0x5000) return null;
  const length = p.readUInt16BE(16);
  return { portAddress: p[14] | ((p[15] & 0x7f) << 8), sequence: p[12], data: p.subarray(18, 18 + length) };
}

/** A .dmxrec: its header and frame k, universe u (index in header.universes). */
export function readRecording(path) {
  const buf = readFileSync(path);
  const nl = buf.indexOf(10);
  const head = JSON.parse(buf.subarray(0, nl).toString('utf8'));
  const body = buf.subarray(nl + 1);
  const nU = head.universes.length;
  const at = (k, u) => body.subarray((k * nU + u) * 512, (k * nU + u + 1) * 512);
  return { head, at };
}

const hash = (b) => createHash('sha1').update(b).digest('base64');

/**
 * Listen; calls onSet with each complete set of universes (one message from
 * the editor: every universe of the patch, sent back to back).
 */
export function listen({ port = 6454, bind = '0.0.0.0', universes, onPacket, onSet } = {}) {
  const sock = createSocket({ type: 'udp4', reuseAddr: true });
  let set = new Map();
  sock.on('message', (msg) => {
    const p = parseArtDmx(msg);
    if (!p) return;
    onPacket?.(p);
    // a universe seen again starts the next set
    if (set.has(p.portAddress)) set = new Map();
    set.set(p.portAddress, Buffer.from(p.data));
    if (universes && set.size === universes.length && universes.every((u) => set.has(u))) {
      onSet?.(set);
      set = new Map();
    }
  });
  return new Promise((ok, fail) => {
    sock.once('error', fail);
    sock.bind(port, bind, () => ok(sock));
  });
}

/** Index a recording by the bytes of its first universe, to find a set's frame. */
export function indexRecording(rec) {
  const byFirst = new Map();
  for (let k = 0; k < rec.head.frames; k++) {
    const h = hash(rec.at(k, 0));
    (byFirst.get(h) ?? byFirst.set(h, []).get(h)).push(k);
  }
  /** The frame k (first frame + k) that equals the set, or -1. */
  return (set) => {
    const ports = rec.head.universes.map((u) => u - 1);
    for (const k of byFirst.get(hash(set.get(ports[0]))) ?? []) {
      if (ports.every((pa, u) => Buffer.compare(set.get(pa), rec.at(k, u)) === 0)) return rec.head.firstFrame + k;
    }
    return -1;
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
  const port = Number(arg('port', 6454));
  const seconds = Number(arg('seconds', 0));
  const compare = arg('compare', '');
  const rec = compare ? readRecording(compare) : null;
  const find = rec ? indexRecording(rec) : null;
  const counts = new Map();
  let sets = 0;
  let matched = 0;
  let lastFrame = -1;
  let first = null;
  const sock = await listen({
    port,
    bind: arg('bind', '0.0.0.0'),
    universes: rec ? rec.head.universes.map((u) => u - 1) : undefined,
    onPacket(p) {
      counts.set(p.portAddress, (counts.get(p.portAddress) ?? 0) + 1);
      if (p.portAddress === Math.min(...counts.keys())) first = p.data;
    },
    onSet(set) {
      sets++;
      const k = find(set);
      if (k >= 0) {
        matched++;
        lastFrame = k;
      }
    },
  });
  console.log(`Art-Net を待っています（UDP ${port}）${rec ? `・照合：${compare}（${rec.head.frames} コマ）` : ''}`);
  const timer = setInterval(() => {
    const per = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([u, n]) => `U${u + 1}(Art-Net ${u}): ${n}/秒`);
    counts.clear();
    const head = first ? `先頭: ${[...first.subarray(0, 12)].join(' ')}` : '';
    const cmp = rec ? `・照合 ${matched}/${sets} 組が記録と一致${lastFrame >= 0 ? `（最後はコマ ${lastFrame}）` : ''}` : '';
    console.log(per.length ? `${per.join('  ')}  ${head}${cmp}` : `受信なし${cmp}`);
  }, 1000);
  if (seconds > 0)
    setTimeout(() => {
      clearInterval(timer);
      sock.close();
      if (rec) console.log(`${matched}/${sets} 組が記録と一致`);
      process.exit(rec && matched !== sets ? 1 : 0);
    }, seconds * 1000);
}
