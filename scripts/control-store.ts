import { spawn } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, extname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Dev-server side of the exports for real equipment (エディタ: 書き出し ▾).
 * A big table or DMX recording is made in the browser piece by piece and
 * appended here, so the whole file never has to sit in the page's memory
 * (the lagoon's channel CSV is about 150 MB).
 *
 *   POST /__control/start?name=a.csv  → { id }
 *   POST /__control/append?id=        body is the next piece
 *   POST /__control/end?id=           → { output, bytes }
 *   POST /__control/cancel?id=        stop and delete the file
 *   POST /__control/reveal?id=        show the file in the Finder
 *
 * Files land in exports/control/ (written as .<name>.part until the end).
 */

interface Job {
  part: string;
  output: string;
  out: WriteStream;
  bytes: number;
  done: boolean;
}

const EXT = /^\.(csv|dmxrec|txt|json)$/;

export function controlStore(root: string): Plugin {
  const outDir = resolve(root, 'exports/control');
  const jobs = new Map<string, Job>();

  async function start(q: URLSearchParams) {
    const name = safeName(q.get('name') ?? '');
    if (!name) throw new Error('bad name');
    await mkdir(outDir, { recursive: true });
    // never overwrite: a second "a.csv" becomes "a-2.csv"
    const ext = extname(name);
    let output = join(outDir, name);
    for (let k = 2; await stat(output).then(() => true, () => false); k++) output = join(outDir, `${basename(name, ext)}-${k}${ext}`);
    const part = join(outDir, `.${basename(output)}.part`);
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    jobs.set(id, { part, output, out: createWriteStream(part), bytes: 0, done: false });
    return { id };
  }

  /** Append the request body, keeping the pieces in order (one request at a time per job). */
  function append(job: Job, req: IncomingMessage) {
    return new Promise<void>((ok, fail) => {
      req.on('data', (d: Buffer) => {
        job.bytes += d.length;
        if (!job.out.write(d)) {
          req.pause();
          job.out.once('drain', () => req.resume());
        }
      });
      req.on('end', ok);
      req.on('error', fail);
    });
  }

  async function handle(path: string, q: URLSearchParams, req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    if (path === '/start') return send(res, 200, await start(q));
    const job = jobs.get(q.get('id') ?? '');
    if (!job) return send(res, 404, { error: 'no such export' });
    switch (path) {
      case '/append':
        if (job.done) return send(res, 400, { error: 'already ended' });
        await append(job, req);
        return send(res, 200, { bytes: job.bytes });
      case '/end':
        job.done = true;
        await new Promise<void>((ok, fail) => job.out.end((e?: Error | null) => (e ? fail(e) : ok())));
        await rename(job.part, job.output);
        return send(res, 200, { output: `exports/control/${basename(job.output)}`, bytes: job.bytes });
      case '/cancel':
        job.done = true;
        job.out.destroy();
        await rm(job.part, { force: true });
        jobs.delete(q.get('id') ?? '');
        return send(res, 200, { ok: true });
      case '/reveal':
        spawn('open', ['-R', job.output]);
        return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'unknown' });
  }

  return {
    name: 'control-store',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__control', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        handle(url.pathname, url.searchParams, req, res).catch((e) => send(res, 500, { error: String(e instanceof Error ? e.message : e) }));
      });
    },
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function safeName(raw: string): string | null {
  const ext = extname(raw).toLowerCase();
  if (!EXT.test(ext)) return null;
  const stem = basename(raw, extname(raw))
    .normalize('NFC')
    .replace(/[\s\\/:*?"<>|#%&+]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 100);
  return stem ? `${stem}${ext}` : null;
}
