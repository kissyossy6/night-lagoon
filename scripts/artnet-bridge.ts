import { createHash } from 'node:crypto';
import { createSocket, type Socket as Udp } from 'node:dgram';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';

/**
 * Dev-server side of Art-Net (エディタ: 書き出し ▾ → Art-Net で送る). A
 * browser cannot send UDP, so the page sends its DMX here over a WebSocket
 * and this sends it on as ArtDmx packets (docs/detailed-design.md 5.7).
 *
 *   ws://<dev server>/__artnet
 *   page → here, text:   {"host":"127.0.0.1","port":6454}   where to send (default as shown)
 *   page → here, binary: [port-address (2 bytes, big-endian)][512 bytes] … one or more universes
 *   here → page, text:   {"host","port","packets","error"?}  after a setting and every second
 *
 * The port-address is Art-Net's universe number, counted from 0 (the patch's
 * universe 1 is 0). Only under `npm run dev`.
 */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** One ArtDmx packet (Art-Net 4): header, OpCode 0x5000, ProtVer 14, then the data. */
export function artDmx(portAddress: number, sequence: number, data: Uint8Array): Buffer {
  const p = Buffer.alloc(18 + 512);
  p.write('Art-Net\0', 0, 'latin1');
  p.writeUInt16LE(0x5000, 8); // OpCode, low byte first
  p.writeUInt16BE(14, 10); // ProtVer, high byte first
  p[12] = sequence; // 1..255, 0 = not used
  p[13] = 0; // Physical
  p[14] = portAddress & 0xff; // SubUni: sub-net and universe
  p[15] = (portAddress >> 8) & 0x7f; // Net
  p.writeUInt16BE(512, 16); // Length, high byte first
  Buffer.from(data.buffer, data.byteOffset, Math.min(512, data.length)).copy(p, 18);
  return p;
}

export function artnetBridge(): Plugin {
  return {
    name: 'artnet-bridge',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (new URL(req.url ?? '', 'http://x').pathname !== '/__artnet') return;
        accept(req, socket, head);
      });
    },
  };
}

function accept(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string') return socket.destroy();
  const hash = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${hash}`, '', ''].join('\r\n'));
  const udp: Udp = createSocket('udp4');
  const target = { host: '127.0.0.1', port: 6454 };
  const seq = new Map<number, number>();
  let packets = 0;
  let error: string | undefined;
  udp.on('error', (e) => (error = e.message));
  const tell = () => sendText(socket, JSON.stringify({ ...target, packets, error }));
  const timer = setInterval(tell, 1000);

  const onMessage = (op: number, data: Buffer) => {
    if (op === 1) {
      try {
        const m = JSON.parse(data.toString('utf8'));
        if (typeof m.host === 'string' && m.host.trim()) target.host = m.host.trim();
        if (Number.isInteger(m.port) && m.port > 0 && m.port < 65536) target.port = m.port;
        error = undefined;
      } catch {
        error = 'bad setting';
      }
      tell();
    } else if (op === 2) {
      for (let o = 0; o + 514 <= data.length; o += 514) {
        const pa = data.readUInt16BE(o);
        const s = ((seq.get(pa) ?? 0) % 255) + 1;
        seq.set(pa, s);
        udp.send(artDmx(pa, s, data.subarray(o + 2, o + 514)), target.port, target.host, (e) => {
          if (e) error = e.message;
          else packets++;
        });
      }
    }
  };

  let buf = head.length ? Buffer.from(head) : Buffer.alloc(0);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    udp.close();
    socket.destroy();
  };
  socket.on('data', (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    // whole frames only; the page sends small unfragmented messages
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 0x0f;
      const masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        at = 10;
      }
      const mask = masked ? buf.subarray(at, at + 4) : null;
      if (masked) at += 4;
      if (buf.length < at + len) return;
      const payload = Buffer.from(buf.subarray(at, at + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(at + len);
      if (op === 8) return close();
      if (op === 9) socket.write(frame(10, payload));
      else onMessage(op, payload);
    }
  });
  socket.on('close', close);
  socket.on('error', close);
}

function frame(op: number, payload: Buffer): Buffer {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : Buffer.from([0x80 | op, 126, n >> 8, n & 255]);
  return Buffer.concat([head, payload]);
}

function sendText(socket: Duplex, text: string) {
  if (!socket.destroyed) socket.write(frame(1, Buffer.from(text, 'utf8')));
}
