import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Plugin } from 'vite';

/**
 * Dev-server side of the Vision Pro export (player: 動画を書き出す → Vision Pro).
 *
 * The browser renders the show in short pieces of HEVC and uploads each one;
 * tools/apmp/join runs alongside, turns the pieces into one MV-HEVC movie
 * with Apple Projected Media Profile signalling, and deletes each piece once
 * it is in. So the intermediate files never sit on disk all at once (a whole
 * show at 7680 per eye would be over 10 GB of them).
 *
 *   POST /__vr180/start?name=a.mov&fps=30&quality=0.85 → { id, free }
 *   POST /__vr180/file?id=&name=audio.mp4|0000_sbs.mp4|0000_L0.mp4… body is the file
 *   POST /__vr180/ready?id=&k=0      piece k is complete
 *   POST /__vr180/end?id=            no more pieces
 *   GET  /__vr180/status?id=         → { state, frames, output, bytes, free, error }
 *   POST /__vr180/cancel?id=         stop and delete everything
 *   POST /__vr180/reveal?id=         show the movie in the Finder
 *
 * Movies land in exports/visionpro/.
 */

interface Job {
  dir: string;
  output: string;
  proc: ChildProcess;
  state: 'running' | 'done' | 'error' | 'cancelled';
  frames: number;
  log: string;
}

const PIECE = /^(audio|\d{4}_(sbs|L0|L1|R0|R1))\.mp4$/;

export function vr180Store(root: string): Plugin {
  const outDir = resolve(root, 'exports/visionpro');
  const swift = resolve(root, 'tools/apmp/join.swift');
  const bin = resolve(root, 'tools/apmp/join');
  const jobs = new Map<string, Job>();
  let building: Promise<void> | null = null;

  /** Rebuild the join tool when its source is newer than the binary. */
  async function ensureJoin() {
    const [src, exe] = await Promise.all([stat(swift), stat(bin).catch(() => null)]);
    if (exe && exe.mtimeMs >= src.mtimeMs) return;
    building ??= run('swiftc', ['-O', swift, '-o', bin]).finally(() => (building = null));
    await building;
  }

  const free = async () => {
    const s = await statfs(outDir);
    return s.bavail * s.bsize;
  };

  async function start(q: URLSearchParams) {
    const name = safeName(q.get('name') ?? '');
    const fps = Number(q.get('fps') ?? 30);
    const quality = Number(q.get('quality') ?? 0.85);
    if (!name || !(fps > 0 && fps <= 120) || !(quality > 0 && quality <= 1)) throw new Error('bad request');
    await mkdir(outDir, { recursive: true });
    await ensureJoin();
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const dir = join(outDir, `.work-${id}`);
    await mkdir(dir);
    // never overwrite: a second "a.mov" becomes "a-2.mov"
    let output = join(outDir, name);
    for (let k = 2; await stat(output).then(() => true, () => false); k++) output = join(outDir, name.replace(/\.mov$/, `-${k}.mov`));
    const proc = spawn(bin, [output, '--segments', dir, '--fps', String(fps), '--quality', String(quality)]);
    const job: Job = { dir, output, proc, state: 'running', frames: 0, log: '' };
    const read = (d: Buffer) => {
      job.log = (job.log + d.toString()).slice(-4000);
      const m = [...job.log.matchAll(/frames (\d+)/g)].at(-1);
      if (m) job.frames = Number(m[1]);
    };
    proc.stdout.on('data', read);
    proc.stderr.on('data', read);
    proc.on('close', (code) => {
      if (job.state === 'running') job.state = code === 0 ? 'done' : 'error';
      if (job.state !== 'error') void rm(dir, { recursive: true, force: true });
    });
    jobs.set(id, job);
    return { id, free: await free() };
  }

  async function handle(path: string, q: URLSearchParams, req: IncomingMessage, res: ServerResponse) {
    if (path === '/start' && req.method === 'POST') return send(res, 200, await start(q));
    const job = jobs.get(q.get('id') ?? '');
    if (!job) return send(res, 404, { error: 'no such export' });
    switch (path) {
      case '/file': {
        const name = q.get('name') ?? '';
        if (req.method !== 'POST' || !PIECE.test(name)) return send(res, 400, { error: 'bad piece' });
        // the join tool only looks at a piece after its .ready, but write whole files anyway
        const tmp = join(job.dir, `.${name}.part`);
        await pipeline(req, createWriteStream(tmp));
        await rename(tmp, join(job.dir, name));
        return send(res, 200, { ok: true });
      }
      case '/ready': {
        const k = Number(q.get('k'));
        if (!Number.isInteger(k) || k < 0) return send(res, 400, { error: 'bad k' });
        await writeFile(join(job.dir, `${String(k).padStart(4, '0')}.ready`), '');
        return send(res, 200, { ok: true });
      }
      case '/end':
        await writeFile(join(job.dir, 'end'), '');
        return send(res, 200, { ok: true });
      case '/status': {
        const bytes = await stat(job.output).then((s) => s.size, () => 0);
        const error = job.state === 'error' ? (job.log.match(/reason: '[^']*'|error: .*/)?.[0] ?? job.log.slice(-400)) : undefined;
        return send(res, 200, { state: job.state, frames: job.frames, output: `exports/visionpro/${basename(job.output)}`, bytes, free: await free(), error });
      }
      case '/cancel':
        job.state = 'cancelled';
        job.proc.kill();
        await rm(job.dir, { recursive: true, force: true });
        await rm(job.output, { force: true });
        return send(res, 200, { ok: true });
      case '/reveal':
        spawn('open', ['-R', job.output]);
        return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'unknown' });
  }

  return {
    name: 'vr180-store',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__vr180', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        handle(url.pathname, url.searchParams, req, res).catch((e) => send(res, 500, { error: String(e instanceof Error ? e.message : e) }));
      });
      // a dev server that stops mid-export leaves no converter behind
      server.httpServer?.on('close', () => {
        for (const job of jobs.values()) if (job.state === 'running') job.proc.kill();
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
  const stem = basename(raw, '.mov')
    .normalize('NFC')
    .replace(/[\s\\/:*?"<>|#%&+]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 100);
  return stem ? `${stem}.mov` : null;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    p.on('error', fail);
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} failed: ${err}`))));
  });
}
