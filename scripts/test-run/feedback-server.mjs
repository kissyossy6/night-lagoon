/**
 * 結果ページ（docs/reports/test-results.html）で「見て決める」項目に付けた
 * 判定とコメントを、docs/reports/test-feedback.json に保存する小さなサーバー。
 *
 *   node scripts/test-run/feedback-server.mjs        → http://localhost:5201/docs/reports/test-results.html
 *
 * - プロジェクトの中身をそのまま配るので、画像や書体も同じように出る（127.0.0.1 だけで待つ）。
 * - 1 項目ずつ保存する（別のタブで開いていても、他の項目は上書きしない）。
 * - 開発サーバー（5199）とは別。ここで保存しても 5199 のページは読み直されない
 *   （json は読み込みの対象外）。
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync, statSync, createReadStream } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const FILE = ROOT + 'docs/reports/test-feedback.json';
const PORT = Number(process.env.PORT ?? 5201);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const VERDICTS = ['good', 'warn', 'bad'];

const load = () => { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return { version: 1, items: {} }; } };
const save = (data) => { writeFileSync(FILE + '.tmp', JSON.stringify(data, null, 1)); renameSync(FILE + '.tmp', FILE); };
const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const body = (req) => new Promise((ok, ng) => { const a = []; req.on('data', (c) => a.push(c)); req.on('end', () => ok(Buffer.concat(a).toString('utf8'))); req.on('error', ng); });

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/feedback') {
      if (req.method === 'GET') return send(res, 200, load());
      if (req.method === 'PUT') {
        // { key, v: 'good'|'warn'|'bad'|'' , c: 'コメント', q: '何を見る項目か' }
        const p = JSON.parse(await body(req));
        if (!p.key || typeof p.key !== 'string') return send(res, 400, { error: 'key がありません' });
        if (p.v && !VERDICTS.includes(p.v)) return send(res, 400, { error: 'v は good / warn / bad' });
        const data = load();
        if (!p.v && !(p.c ?? '').trim()) delete data.items[p.key];
        else data.items[p.key] = { v: p.v || '', c: String(p.c ?? ''), q: String(p.q ?? ''), t: new Date().toISOString() };
        save(data);
        return send(res, 200, { ok: true, t: data.items[p.key]?.t ?? null });
      }
      return send(res, 405, { error: 'GET か PUT' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'GET のみ' });
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const hit = [ROOT, ROOT + 'public/'].map((b) => normalize(join(b, rel))).find((f) => f.startsWith(ROOT) && existsSync(f) && statSync(f).isFile());
    const hidden = hit && hit.slice(ROOT.length).split(sep).some((s) => s.startsWith('.') || s === 'node_modules');
    if (!hit || hidden) return send(res, 404, 'not found', 'text/plain; charset=utf-8');
    res.writeHead(200, { 'content-type': MIME[extname(hit)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(hit).pipe(res);
  } catch (e) {
    send(res, 500, { error: String(e?.message ?? e) });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`http://localhost:${PORT}/docs/reports/test-results.html  （保存先: docs/reports/test-feedback.json）`));
