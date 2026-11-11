import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Dev-server side of the projects (docs/projects-plan.md). One folder a project:
 *
 *   projects/<id>/project.json   name, dates, the show (src/projects/types.ts)
 *   projects/<id>/thumb.jpg      the list's picture (taken from the editor's 3D)
 *   projects/<id>/music-<hash>.<ext>  the project's own music (docs/music-plan.md);
 *                                the show names the one it plays (ShowFile.music).
 *                                Old ones stay, so undoing a change of music finds its file
 *
 * Folders named sample-* are the samples: tracked by git (.gitignore keeps
 * every other project out), read-only here, listed by the page itself
 * (src/projects/samples.ts). Deleting moves a folder to projects/.trash/.
 *
 *   GET  /__projects/list             → summaries of your projects (no samples)
 *   GET  /__projects/get?id=          → project.json
 *   GET  /__projects/thumb?id=        → thumb.jpg (samples too)
 *   GET  /__projects/music?id=&file=  → that music file
 *   POST /__projects/create           body { name, generate?, from?, show? } → project
 *   POST /__projects/save?id=         body project.json (the id must match)
 *   POST /__projects/thumb?id=        body image/jpeg
 *   POST /__projects/music?id=&name=  body the audio file → { file } (its name in the folder)
 *   POST /__projects/duplicate?id=    body { name } → project (from a sample too)
 *   POST /__projects/promote?id=      body { name } → the new sample's id
 *   POST /__projects/trash?id=
 *   POST /__projects/reveal?id=       show the folder in the Finder
 */

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A stored music file's name: music-<hash>.<ext>. */
const MUSIC_FILE = /^music-[0-9a-f]{12}\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/;
const MUSIC_TYPE: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm' };
const isSample = (id: string) => id.startsWith('sample-');

interface Project {
  format: 1;
  id: string;
  name: string;
  created: string;
  updated: string;
  [k: string]: unknown;
}

export function projectStore(root: string): Plugin {
  const dir = resolve(root, 'projects');
  const folder = (id: string) => join(dir, id);
  const exists = (p: string) => stat(p).then(() => true, () => false);
  /** Copy what a project keeps beside its project.json: the picture and the music. */
  async function copyMedia(from: string, to: string) {
    for (const name of await readdir(folder(from)).catch(() => [] as string[])) {
      if (name === 'thumb.jpg' || MUSIC_FILE.test(name)) await cp(join(folder(from), name), join(folder(to), name));
    }
  }

  function checkId(id: string | null, { sample = true } = {}): string {
    if (!id || !ID.test(id)) throw new HttpError(400, 'bad id');
    if (!sample && isSample(id)) throw new HttpError(403, '見本は書き換えられません（複製してから編集します）');
    return id;
  }

  async function read(id: string): Promise<Project> {
    try {
      return JSON.parse(await readFile(join(folder(id), 'project.json'), 'utf8')) as Project;
    } catch {
      throw new HttpError(404, 'no such project');
    }
  }

  /** Write via a temporary file, so a crash never leaves half a project.json. */
  async function write(p: Project) {
    await mkdir(folder(p.id), { recursive: true });
    const file = join(folder(p.id), 'project.json');
    await writeFile(`${file}.tmp`, JSON.stringify(p, null, 1));
    await rename(`${file}.tmp`, file);
  }

  async function newId(prefix = 'p'): Promise<string> {
    const d = new Date();
    const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    for (;;) {
      const id = `${prefix}-${day}-${Math.random().toString(36).slice(2, 6)}`;
      if (!(await exists(folder(id)))) return id;
    }
  }

  async function list() {
    await mkdir(dir, { recursive: true });
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || !ID.test(e.name) || isSample(e.name)) continue;
      try {
        const p = await read(e.name);
        const show = p.show as { venue?: string; duration?: number; cues?: unknown[] } | null | undefined;
        out.push({
          id: p.id,
          name: p.name,
          created: p.created,
          updated: p.updated,
          from: p.from,
          generate: p.generate,
          venue: show?.venue,
          duration: show?.duration,
          cues: show?.cues?.length,
          // the picture's own time in the URL, so a new one is not hidden by the cache
          thumb: await stat(join(folder(e.name), 'thumb.jpg')).then((st) => `/__projects/thumb?id=${p.id}&v=${Math.round(st.mtimeMs)}`, () => undefined),
        });
      } catch {
        /* a folder without a readable project.json is skipped */
      }
    }
    return out.sort((a, b) => (a.updated < b.updated ? 1 : -1));
  }

  async function handle(path: string, q: URLSearchParams, req: IncomingMessage, res: ServerResponse) {
    const now = new Date().toISOString();
    if (req.method === 'GET') {
      if (path === '/list') return send(res, 200, await list());
      if (path === '/get') return send(res, 200, await read(checkId(q.get('id'))));
      if (path === '/thumb') {
        try {
          const img = await readFile(join(folder(checkId(q.get('id'))), 'thumb.jpg'));
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'no-cache');
          return res.end(img);
        } catch {
          return send(res, 404, { error: 'no thumbnail' });
        }
      }
      if (path === '/music') {
        const file = q.get('file') ?? '';
        if (!MUSIC_FILE.test(file)) throw new HttpError(400, 'bad file');
        try {
          const data = await readFile(join(folder(checkId(q.get('id'))), file));
          res.setHeader('Content-Type', MUSIC_TYPE[file.split('.').pop()!]);
          // the name is its content's hash: it never changes
          res.setHeader('Cache-Control', 'max-age=31536000, immutable');
          return res.end(data);
        } catch {
          return send(res, 404, { error: 'no such music' });
        }
      }
      return send(res, 404, { error: 'unknown' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST' });
    switch (path) {
      case '/create': {
        const body = (await json(req)) as Record<string, unknown>;
        const p: Project = { ...body, format: 1, id: await newId(), name: String(body.name || '新しいプロジェクト'), created: now, updated: now };
        await write(p);
        // a project made from a sample starts with the sample's picture
        const from = typeof body.from === 'string' && ID.test(body.from) ? body.from : null;
        if (from && (await exists(join(folder(from), 'thumb.jpg')))) await cp(join(folder(from), 'thumb.jpg'), join(folder(p.id), 'thumb.jpg'));
        return send(res, 200, p);
      }
      case '/save': {
        const id = checkId(q.get('id'), { sample: false });
        const body = (await json(req)) as Project;
        if (body.id !== id) throw new HttpError(400, 'id mismatch');
        const before = await read(id);
        const p: Project = { ...body, format: 1, created: before.created, updated: now };
        await write(p);
        return send(res, 200, { updated: p.updated });
      }
      case '/thumb': {
        const id = checkId(q.get('id'), { sample: false });
        if (!(await exists(folder(id)))) throw new HttpError(404, 'no such project');
        await writeFile(join(folder(id), 'thumb.jpg'), await raw(req));
        return send(res, 200, { ok: true });
      }
      case '/music': {
        const id = checkId(q.get('id'), { sample: false });
        if (!(await exists(folder(id)))) throw new HttpError(404, 'no such project');
        const ext = (q.get('name') ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
        if (!MUSIC_TYPE[ext]) throw new HttpError(400, `この形式の曲は入れられません（${Object.keys(MUSIC_TYPE).join('・')}）`);
        const data = await raw(req, 200e6);
        if (!data.length) throw new HttpError(400, 'empty file');
        const file = `music-${createHash('sha1').update(data).digest('hex').slice(0, 12)}.${ext}`;
        if (!(await exists(join(folder(id), file)))) await writeFile(join(folder(id), file), data);
        return send(res, 200, { file });
      }
      case '/duplicate': {
        const src = checkId(q.get('id'));
        const body = (await json(req)) as { name?: string };
        const from = await read(src);
        const p: Project = { ...from, id: await newId(), name: body.name || `${from.name} のコピー`, created: now, updated: now };
        if (isSample(src)) {
          p.from = src;
          delete p.sample;
          delete p.description;
        }
        await write(p);
        await copyMedia(src, p.id);
        return send(res, 200, p);
      }
      case '/promote': {
        // 見本にする: a copy of one of your projects becomes a sample (git keeps it)
        const src = checkId(q.get('id'), { sample: false });
        const body = (await json(req)) as { name?: string };
        const from = await read(src);
        const id = await newId('sample');
        const p: Project = { ...from, id, name: body.name || from.name, created: now, updated: now, sample: true };
        delete p.from;
        await write(p);
        await copyMedia(src, id);
        return send(res, 200, { id });
      }
      case '/trash': {
        const id = checkId(q.get('id'), { sample: false });
        if (!(await exists(folder(id)))) throw new HttpError(404, 'no such project');
        await mkdir(join(dir, '.trash'), { recursive: true });
        await rename(folder(id), join(dir, '.trash', `${id}--${now.replace(/[:.]/g, '-')}`));
        return send(res, 200, { ok: true });
      }
      case '/reveal': {
        const id = checkId(q.get('id'));
        spawn('open', [folder(id)]);
        return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { error: 'unknown' });
  }

  return {
    name: 'project-store',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__projects', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        handle(url.pathname, url.searchParams, req, res).catch((e) =>
          send(res, e instanceof HttpError ? e.status : 500, { error: String(e instanceof Error ? e.message : e) }),
        );
      });
    },
  };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    msg: string,
  ) {
    super(msg);
  }
}

function raw(req: IncomingMessage, limit = 50e6): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = [];
    let n = 0;
    req.on('data', (d: Buffer) => {
      n += d.length;
      if (n > limit) fail(new HttpError(413, 'too large'));
      else parts.push(d);
    });
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', fail);
  });
}

async function json(req: IncomingMessage): Promise<unknown> {
  try {
    return JSON.parse((await raw(req)).toString('utf8'));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'bad JSON');
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
