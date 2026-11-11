import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Plugin } from 'vite';

/**
 * Dev-server store for the water-screen videos (editor: 動画を取り込む).
 *
 *   GET  /__videos             → [{ src: "videos/boat.mp4", size }]
 *   POST /__videos?name=a.mp4  → body is the file; → { src }
 *   GET  /videos/<name>        → the file, with Range support for seeking
 *
 * Files land in public/videos/, so shows refer to them by a relative path
 * that works in the player, in the editor and in a build alike. /videos/ is
 * served here too because Vite only learns about new public files when its
 * watcher catches up, which can be after the editor asks for the video.
 */

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

export function videoStore(root: string): Plugin {
  const dir = resolve(root, 'public/videos');
  return {
    name: 'video-store',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__videos', (req, res) => {
        const run = req.method === 'POST' ? upload(dir, req, res) : list(dir, res);
        run.catch((e) => send(res, 500, { error: String(e instanceof Error ? e.message : e) }));
      });
      server.middlewares.use('/videos/', (req, res, next) => {
        serve(dir, req, res).then((ok) => ok || next(), next);
      });
    },
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function list(dir: string, res: ServerResponse) {
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: { src: string; size: number }[] = [];
  for (const n of names.sort()) {
    if (!TYPES[extname(n).toLowerCase()]) continue;
    out.push({ src: `videos/${n}`, size: (await stat(join(dir, n))).size });
  }
  send(res, 200, out);
}

/** A file name that is safe on disk and in a URL, keeping letters of any script. */
function safeName(raw: string): string | null {
  const ext = extname(raw).toLowerCase();
  if (!TYPES[ext]) return null;
  const stem = basename(raw, extname(raw))
    .normalize('NFC')
    .replace(/[\s\\/:*?"<>|#%&+?]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 80);
  return `${stem || 'video'}${ext}`;
}

async function upload(dir: string, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '', 'http://x');
  const name = safeName(url.searchParams.get('name') ?? '');
  if (!name) return send(res, 400, { error: `対応していない形式です (${Object.keys(TYPES).join(' ')})` });
  await mkdir(dir, { recursive: true });
  // never overwrite: a second "boat.mp4" becomes "boat-2.mp4"
  const ext = extname(name);
  let final = name;
  for (let k = 2; await stat(join(dir, final)).then(() => true, () => false); k++) final = `${basename(name, ext)}-${k}${ext}`;
  // write elsewhere first so the folder only ever sees whole files
  const tmp = join(tmpdir(), `water-show-upload-${process.pid}-${Date.now()}${ext}`);
  try {
    await pipeline(req, createWriteStream(tmp));
    await rename(tmp, join(dir, final)).catch(async () => {
      await copyFile(tmp, join(dir, final));
      await unlink(tmp);
    });
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
  send(res, 200, { src: `videos/${final}` });
}

async function serve(dir: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const name = decodeURIComponent(new URL(req.url ?? '', 'http://x').pathname.replace(/^\//, ''));
  const type = TYPES[extname(name).toLowerCase()];
  if (!type || name !== basename(name)) return false;
  const file = join(dir, name);
  const st = await stat(file).catch(() => null);
  if (!st?.isFile()) return false;
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  let start = 0;
  let end = st.size - 1;
  if (m && (m[1] || m[2])) {
    if (m[1]) {
      start = Number(m[1]);
      if (m[2]) end = Math.min(end, Number(m[2]));
    } else {
      start = Math.max(0, st.size - Number(m[2]));
    }
    if (start > end) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${st.size}`);
      res.end();
      return true;
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
  }
  res.setHeader('Content-Length', String(end - start + 1));
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  // players drop range requests mid-way all the time (seeking): not an error
  await pipeline(createReadStream(file, { start, end }), res).catch(() => res.destroy());
  return true;
}
