/** Build docs/reports/test-results.html from shots/test-run/results/*.json + scripts/test-run/highlights.json */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
const ROOT = new URL('../../', import.meta.url).pathname;
const look = readFileSync(ROOT + 'docs/reports/look-report.html', 'utf8');
const css = look.slice(look.indexOf('<style>') + 7, look.indexOf('</style>'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const results = {};
for (const f of readdirSync(ROOT + 'shots/test-run/results').filter((f) => f.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(ROOT + 'shots/test-run/results/' + f, 'utf8'));
  const n = String(j.n);
  results[n] ??= { n: Number(n), title: j.title, rows: [] };
  for (const row of j.rows) {
    const k = results[n].rows.findIndex((x) => x.id === row.id);
    if (k >= 0) results[n].rows[k] = row; else results[n].rows.push(row);
  }
}
const hl = existsSync(ROOT + 'scripts/test-run/highlights.json') ? JSON.parse(readFileSync(ROOT + 'scripts/test-run/highlights.json', 'utf8')) : { fails: [], concerns: [], view: [], intro: '' };
const META = {
  1: ['高', '段階 2・3・7', '花火版を、頭から最後まで通す。花火が出る場面・カメラ・最後の終わり方'],
  2: ['高', '段階 1〜7', '承認済みの Night Lagoon とファンタジア版が前のままか。花火が出ないこと'],
  3: ['高', '段階 7', '水面の新しい画質が初めから入っていること、切れること、低い画質で自動で切れること'],
  4: ['低', '段階 1.5・7', '下のバー・カメラ・照明・波形・水音'],
  5: ['中', '段階 3', '音量メニュー（音楽・水音・花火）の効き方、元に戻す、覚えること'],
  6: ['中', '段階 3・7', '音量を変えて動画（MP4）を書き出し、音と絵を確かめる'],
  7: ['高', '段階 2・3・6', '花火を足したとき、保安距離・傾きの警告がその場で出て、一覧にも出ること'],
  8: ['高', '段階 6', 'エディタで、タブ・S/M・たたむ・警告の一覧・3D のクリック・縁取り'],
  9: ['中', '段階 1・1.5・6', '作る・直す・保存する・本番で観る、の基本の流れ'],
  10: ['高', '段階 5', '自分の庭の池の会場を作って、本番画面とエディタで使う'],
  11: ['中', '段階 5・7', '机の会場で 3D が白く飛ばないこと'],
  12: ['中', '段階 5・4', '広場の会場に替えたとき、エディタ・本番画面・書き出しが一緒に替わること'],
  13: ['中', '段階 5', '会場の部品の操作（動かす・足す・外す・保存・写す・消す）'],
  14: ['高', '段階 5', '危ない会場の作り方を、画面が止める・教えてくれるか'],
  15: ['低', '段階 5', '演出を別の会場で流したとき、動かないキューが数で見えること'],
  16: ['高', '段階 4', '実機向け 5 形式の書き出し（割り当て表・キュー表・点火表・CSV・DMX の記録）'],
  17: ['中', '段階 4', 'Art-Net で値を送り、受け側で記録と一致すること'],
  18: ['中', '段階 4・5・7', '書き出しの値と時刻が、会場や描画を変えても前のままであること'],
};
const Q = existsSync(ROOT + 'scripts/test-run/questions.json') ? JSON.parse(readFileSync(ROOT + 'scripts/test-run/questions.json', 'utf8')) : {};
const ST = { pass: ['in', '合格'], fail: ['hold', '不合格'], user: ['user', 'ユーザーが見て決める'], skip: ['no', '試せなかった'], info: ['info', '参考'] };
const mainRows = (r) => r.rows.filter((x) => x.status !== 'info');
const count = (rows, s) => rows.filter((x) => x.status === s).length;
const all = Object.values(results).sort((a, b) => a.n - b.n);
const tot = { pass: 0, fail: 0, user: 0, skip: 0, info: 0 };
for (const r of all) for (const x of r.rows) tot[x.status]++;
const overall = (r) => (count(r.rows, 'fail') ? ['hold', '不合格あり'] : count(r.rows, 'user') || count(r.rows, 'skip') ? ['user', '見て決める・未確認あり'] : ['in', '全部合格']);
const imgs = (shots) => (shots ?? []).filter(Boolean);
const fbHtml = (n, x) => { const q = Q[n + ':' + x.id]; if (!q) console.warn('質問が無い項目:', n + ':' + x.id); return `<form class="fb" data-key="${n}:${esc(x.id)}" data-q="${esc(q ?? x.text.slice(0, 120))}" onsubmit="return false">
    <p class="fb-q"><span>見るところ</span>${esc(q ?? '上の文を読んで、よいか決める')}</p>
    <div class="fb-v" role="group" aria-label="判定"><button type="button" data-v="good">よい</button><button type="button" data-v="warn">気になる</button><button type="button" data-v="bad">だめ</button></div>
    <textarea rows="2" placeholder="コメント（気づいたこと・直してほしいこと）" aria-label="コメント"></textarea>
    <span class="fb-s" aria-live="polite"></span></form>`; };
const rowHtml = (n) => (x) => `<li class="row ${ST[x.status][0]}" data-user="${x.status === 'user' ? 1 : 0}">
  <div class="rh"><span class="st ${ST[x.status][0]}">${ST[x.status][1]}</span><b class="rid">${esc(x.id.replace(/^(\d+\.\d+).*/, '$1'))}${/^\d+\.\d+/.test(x.id) && x.id.replace(/^\d+\.\d+/, '') ? `<small>${esc(x.id.replace(/^\d+\.\d+/, ''))}</small>` : esc(/^\d/.test(x.id) ? '' : x.id)}</b></div>
  <div class="rb"><p>${esc(x.text)}</p>${x.note ? `<p class="note">${esc(x.note)}</p>` : ''}
  ${imgs(x.shots).length ? `<div class="thumbs">${imgs(x.shots).map((s) => `<img loading="lazy" src="../../${esc(s)}" alt="${esc(s.split('/').pop())}" title="${esc(s.split('/').pop())}">`).join('')}</div>` : ''}
  ${x.status === 'user' ? fbHtml(n, x) : ''}</div></li>`;
const secs = all.map((r) => {
  const m = META[r.n] ?? ['', '', ''];
  const [oc, ol] = overall(r);
  return `<section class="theme" id="s${r.n}" data-short="${r.n}　${esc(r.title)}">
  <h2><span class="n">シナリオ ${r.n}</span>${esc(r.title)} <span class="st ${oc}">${ol}</span></h2>
  <p class="intro">優先度 ${m[0]}・${m[1]}。${esc(m[2])}。<br>合格 ${count(r.rows, 'pass')}・不合格 ${count(r.rows, 'fail')}・見て決める ${count(r.rows, 'user')}・試せなかった ${count(r.rows, 'skip')}（参考 ${count(r.rows, 'info')}）</p>
  <ul class="rows">${r.rows.map(rowHtml(r.n)).join('')}</ul></section>`;
}).join('\n');
const tbl = all.map((r) => { const [oc, ol] = overall(r); return `<tr><td><a href="#s${r.n}">${r.n}</a></td><td>${esc(r.title)}</td><td>${(META[r.n] ?? [])[0] ?? ''}</td><td class="c ok">${count(r.rows, 'pass')}</td><td class="c ng">${count(r.rows, 'fail')}</td><td class="c us">${count(r.rows, 'user')}</td><td class="c sk">${count(r.rows, 'skip')}</td><td><span class="st ${oc}">${ol}</span></td></tr>`; }).join('');
const list = (a) => (a.length ? `<ol class="top3">${a.map((x) => `<li><b>${esc(x.title)}</b><p>${esc(x.body)}</p>${x.link ? `<p class="go"><a href="#${x.link}">${esc(x.linkText ?? 'その項目へ')}</a></p>` : ''}</li>`).join('')}</ol>` : '<p class="intro">なし</p>');
const view = hl.view.map((v) => `<figure><img loading="lazy" src="../../${esc(v.src)}" alt=""><figcaption><b>${esc(v.title)}</b>　${esc(v.cap)}<br><code>${esc(v.src)}</code></figcaption></figure>`).join('');
const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>シナリオテストの結果</title>
<!-- 見た目は look-report.html と同じ（src/styles/tokens.css の値）。見るだけなら開発サーバー（http://localhost:5199/docs/reports/test-results.html）でもよい。
     画像は ../../shots/test-run/ を参照するだけ。作り：node scripts/test-run/report.mjs
     判定とコメントを保存するには node scripts/test-run/feedback-server.mjs で開く（http://localhost:5201/docs/reports/test-results.html）。-->
<link rel="stylesheet" href="../../src/styles/tokens.css">
<style>${css}
  .st.user::before { background: var(--r-accent); }
  .st.hold::before { background: #d9604c; }
  .st.info::before { background: var(--r-faint); }
  table.sum { width: 100%; border-collapse: collapse; font-size: 13.5px; margin: 8px 0 0; }
  table.sum th, table.sum td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--r-line); }
  table.sum th { color: var(--r-dim); font-weight: 500; font-size: 12px; }
  table.sum td.c { text-align: right; font-family: var(--r-mono-face); }
  td.ok { color: var(--r-ok); } td.ng { color: #e0806e; } td.us { color: var(--r-accent-light); } td.sk { color: var(--r-dim); }
  ul.rows { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--r-line); }
  li.row { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--r-line); }
  li.row .rh { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  li.row .rid { font-family: var(--r-mono-face); font-size: 13px; color: var(--r-strong); font-weight: 500; }
  li.row .rid small { color: var(--r-faint); font-size: 11px; margin-left: 4px; font-weight: 400; }
  li.row p { margin: 0 0 6px; font-size: 14px; line-height: 1.7; }
  li.row p.note { color: var(--r-accent-light); font-size: 13px; }
  li.row.hold { background: color-mix(in srgb, #d9604c 7%, transparent); }
  .thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .thumbs img { height: 108px; width: auto; border: 1px solid var(--r-line); border-radius: var(--r-radius); cursor: zoom-in; background: #000; }
  .fb { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px 12px; margin-top: 10px; padding: 10px 12px; border: 1px solid var(--r-line-2); border-radius: var(--r-radius); background: var(--r-panel-2); }
  li.row p.fb-q { flex: 0 0 100%; margin: 0; font-size: 15.5px; font-weight: 700; color: var(--r-strong); line-height: 1.6; }
  .fb-q span { font-size: 11px; font-weight: 400; color: var(--r-accent-light); border: 1px solid var(--r-accent); border-radius: var(--r-radius); padding: 1px 6px; margin-right: 8px; vertical-align: 2px; }
  .fb-v { display: flex; gap: 0; }
  .fb-v button { font: inherit; font-size: 13px; color: var(--r-text); background: var(--r-panel); border: 1px solid var(--r-line-2); padding: 6px 14px; cursor: pointer; margin-left: -1px; }
  .fb-v button:first-child { margin-left: 0; border-radius: var(--r-radius) 0 0 var(--r-radius); } .fb-v button:last-child { border-radius: 0 var(--r-radius) var(--r-radius) 0; }
  .fb-v button:hover { border-color: var(--r-accent); position: relative; }
  .fb-v button[aria-pressed="true"] { color: #14161a; font-weight: 700; position: relative; }
  .fb-v button[data-v="good"][aria-pressed="true"] { background: var(--r-ok); border-color: var(--r-ok); }
  .fb-v button[data-v="warn"][aria-pressed="true"] { background: var(--r-accent); border-color: var(--r-accent); }
  .fb-v button[data-v="bad"][aria-pressed="true"] { background: #e0806e; border-color: #e0806e; }
  .fb textarea { flex: 1 1 320px; min-width: 0; font: inherit; font-size: 13.5px; line-height: 1.6; color: var(--r-text); background: var(--r-panel); border: 1px solid var(--r-line-2); border-radius: var(--r-radius); padding: 6px 10px; resize: vertical; }
  .fb textarea:focus { outline: none; border-color: var(--r-accent); }
  .fb-s { flex: 0 0 100%; font-size: 12px; color: var(--r-faint); min-height: 1em; } .fb-s.err { color: #e0806e; }
  li.row[data-user="1"].done { opacity: .72; } li.row[data-user="1"].done:focus-within, li.row[data-user="1"].done:hover { opacity: 1; }
  #fbbar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin: 0 0 18px; padding: 10px 14px; border: 1px solid var(--r-line-2); border-radius: var(--r-radius); background: var(--r-panel); font-size: 13.5px; }
  #fbbar b { color: var(--r-strong); font-family: var(--r-mono-face); } #fbbar .sp { flex: 1; }
  #fbbar button { font: inherit; font-size: 12.5px; color: var(--r-text); background: var(--r-panel-2); border: 1px solid var(--r-line-2); border-radius: var(--r-radius); padding: 5px 12px; cursor: pointer; } #fbbar button:hover { border-color: var(--r-accent); }
  #fbbar button[aria-pressed="true"] { border-color: var(--r-accent); color: var(--r-accent-light); }
  #fbwarn { display: none; margin: 0 0 14px; padding: 10px 14px; border: 1px solid #d9604c; border-radius: var(--r-radius); background: color-mix(in srgb, #d9604c 10%, transparent); font-size: 13.5px; } #fbwarn.on { display: block; } #fbwarn code { font-family: var(--r-mono-face); }
  body.only-open li.row[data-user="1"].done, body.only-open li.row:not([data-user="1"]) { display: none; }
  ol.top3 { margin: 0; padding-left: 1.4em; max-width: 960px; } ol.top3 li { margin-bottom: 14px; } ol.top3 b { color: var(--r-strong); } ol.top3 p { margin: 4px 0 0; font-size: 14px; }
  .viewfirst { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 14px; }
  @media (max-width: 980px) { li.row { grid-template-columns: 1fr; gap: 6px; } }
</style></head>
<body>
<div class="wrap">
<nav class="toc" aria-label="目次"><div class="brand">water-show v2 ・ シナリオテストの結果</div><ol id="toc"></ol></nav>
<main>
<header class="top" id="top">
  <div class="eyebrow">2026-11-06 に 18 本を通し、2026-11-07 に直して流し直した結果</div>
  <h1>シナリオテストの結果</h1>
  <p class="lede">${esc(hl.intro)}</p>
  <div class="facts" id="facts">
    <div><b>${tot.pass}</b><span>合格</span></div><div><b>${tot.fail}</b><span>不合格</span></div>
    <div><b>${tot.user}</b><span>ユーザーが見て決める</span></div><div><b>${tot.skip}</b><span>試せなかった</span></div>
    <div><b>${tot.info}</b><span>参考の記録</span></div><div><b>${all.length}</b><span>シナリオ</span></div>
  </div>
  <p class="howto">「見て決める」の項目には、<b>よい／気になる／だめ</b>の判定とコメント欄が付いています。押すと自動で保存されます。終わったら私に声をかけてください。</p>
  <p class="howto">手順は <a href="../test-scenarios.md">docs/test-scenarios.md</a>。画像は押すと大きくなります。</p>
</header>
<div id="fbwarn"></div>
<div id="fbbar"><span>あなたの判定 <b id="fb-done">0</b> / <b id="fb-all">0</b> 件</span><span>よい <b id="fb-good">0</b>・気になる <b id="fb-warn">0</b>・だめ <b id="fb-bad">0</b></span><span class="sp"></span><button type="button" id="fb-only" aria-pressed="false">まだのものだけ見る</button><button type="button" id="fb-next">次のまだの項目へ ↓</button></div>
<section class="theme" id="summary" data-short="まとめ" style="margin-top:48px">
  <h2><span class="n">まとめ</span>シナリオごとの結果</h2>
  <table class="sum"><thead><tr><th>#</th><th>シナリオ</th><th>優先度</th><th>合格</th><th>不合格</th><th>見て決める</th><th>試せなかった</th><th>全体</th></tr></thead><tbody>${tbl}</tbody></table>
</section>
<section class="theme" id="fails" data-short="不合格と気になった所"><h2><span class="n">要点</span>不合格と直したこと、気になった所</h2>${list(hl.fails)}<h3 style="margin:22px 0 8px;font-size:15px;color:var(--r-strong)">そのほか気になった所</h3>${list(hl.concerns)}</section>
<section class="theme" id="view" data-short="一番見てほしい画面"><h2><span class="n">要点</span>一番見てほしい画面（3枚）</h2><div class="viewfirst">${view}</div></section>
<section class="theme" id="how" data-short="通し方"><h2><span class="n">方法</span>どうやって通したか</h2><p class="intro" style="max-width:900px">${hl.how ?? ''}</p></section>
${secs}
</main></div>
<div id="lb"><div class="bar"><span class="cap"></span><button data-a="prev">‹ 前</button><button data-a="next">次 ›</button><button data-a="fit">原寸</button><a class="open" target="_blank" style="font-size:12px">別のタブで開く</a><button data-a="close">閉じる</button></div><div class="stage"><img alt=""></div></div>
<script>
(() => {
  const toc = document.getElementById('toc');
  const secs = [...document.querySelectorAll('section.theme')];
  secs.forEach((s, i) => { if (i === 3 || i === 5) { const d = document.createElement('li'); d.className = 'sep'; toc.appendChild(d); } const li = document.createElement('li'); li.innerHTML = '<a href="#' + s.id + '"><span>' + s.dataset.short + '</span></a>'; toc.appendChild(li); });
  const links = [...toc.querySelectorAll('a')];
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)); }), { rootMargin: '-20% 0px -70% 0px' });
  secs.forEach((s) => io.observe(s));
  const imgs = [...document.querySelectorAll('main img')];
  const lb = document.getElementById('lb'), big = lb.querySelector('img'), cap = lb.querySelector('.cap'), open = lb.querySelector('.open');
  let at = 0;
  const show = (i) => { at = (i + imgs.length) % imgs.length; const im = imgs[at]; big.src = im.src; cap.textContent = (im.closest('section')?.querySelector('h2')?.textContent || '') + ' — ' + (im.title || im.alt || ''); open.href = im.src; lb.classList.add('fit'); lb.querySelector('[data-a=fit]').textContent = '原寸'; lb.querySelector('.stage').scrollTop = 0; };
  imgs.forEach((im, i) => im.addEventListener('click', () => { show(i); lb.classList.add('on'); }));
  lb.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'close' || e.target.classList.contains('stage')) lb.classList.remove('on'); if (a === 'prev') show(at - 1); if (a === 'next') show(at + 1); if (a === 'fit') { lb.classList.toggle('fit'); e.target.textContent = lb.classList.contains('fit') ? '原寸' : '画面に合わせる'; } });
  addEventListener('keydown', (e) => { if (!lb.classList.contains('on')) return; if (e.key === 'Escape') lb.classList.remove('on'); if (e.key === 'ArrowLeft') show(at - 1); if (e.key === 'ArrowRight') show(at + 1); });
})();
// 判定とコメント：保存サーバー（feedback-server.mjs）があればファイル（docs/reports/test-feedback.json）へ、無ければこのブラウザの中にだけ残す
(() => {
  const forms = [...document.querySelectorAll('form.fb')];
  const warn = document.getElementById('fbwarn');
  const LS = 'water-show-test-feedback';
  let server = false, items = {};
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };
  const lsSet = (o) => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch {} };
  const label = { good: 'よい', warn: '気になる', bad: 'だめ' };
  const paint = (f) => {
    const it = items[f.dataset.key] || { v: '', c: '' };
    f.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === it.v)));
    const ta = f.querySelector('textarea'); if (document.activeElement !== ta) ta.value = it.c || '';
    f.closest('li.row').classList.toggle('done', !!it.v);
  };
  const stats = () => {
    const c = { good: 0, warn: 0, bad: 0 };
    forms.forEach((f) => { const v = (items[f.dataset.key] || {}).v; if (v) c[v]++; });
    document.getElementById('fb-all').textContent = forms.length;
    document.getElementById('fb-done').textContent = c.good + c.warn + c.bad;
    for (const k in c) document.getElementById('fb-' + k).textContent = c[k];
  };
  const status = (f, text, err) => { const s = f.querySelector('.fb-s'); s.textContent = text; s.classList.toggle('err', !!err); };
  const put = async (f) => {
    const key = f.dataset.key, it = items[key] || { v: '', c: '' };
    const payload = { key, v: it.v || '', c: it.c || '', q: f.dataset.q };
    const hhmm = () => new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (server) {
      try {
        const r = await fetch('/api/feedback', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error((await r.json()).error || r.status);
        status(f, '保存しました ' + hhmm()); return;
      } catch (e) { status(f, '保存できませんでした（' + e.message + '）。入力はこのページに残っています', true); return; }
    }
    const o = lsGet(); if (payload.v || payload.c.trim()) o[key] = { ...payload, t: new Date().toISOString() }; else delete o[key]; lsSet(o);
    status(f, 'このブラウザの中にだけ保存しました ' + hhmm());
  };
  let timer = {};
  forms.forEach((f) => {
    const key = f.dataset.key;
    f.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      const it = items[key] ??= { v: '', c: '' };
      it.v = it.v === b.dataset.v ? '' : b.dataset.v; // 同じボタンをもう一度押すと外れる
      paint(f); stats(); put(f);
    });
    f.querySelector('textarea').addEventListener('input', (e) => {
      (items[key] ??= { v: '', c: '' }).c = e.target.value; status(f, '入力中…');
      clearTimeout(timer[key]); timer[key] = setTimeout(() => { stats(); put(f); }, 700);
    });
    f.querySelector('textarea').addEventListener('blur', () => { if (timer[key]) { clearTimeout(timer[key]); timer[key] = 0; put(f); } });
  });
  (async () => {
    try {
      const r = await fetch('/api/feedback', { cache: 'no-store' });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw 0;
      items = (await r.json()).items || {}; server = true;
      const local = lsGet(), keys = Object.keys(local).filter((k) => !items[k]);
      if (keys.length) { // 保存サーバーが無いときに残した分を、ファイルへ移す
        keys.forEach((k) => { items[k] = local[k]; });
        for (const k of keys) { const f = forms.find((x) => x.dataset.key === k); if (f) await put(f); }
        lsSet({});
      }
    } catch {
      items = lsGet();
      warn.classList.add('on');
      warn.innerHTML = '<b>保存先につながっていません。</b>この開き方だと、判定とコメントはこのブラウザの中にだけ残り、私は読めません。ターミナルで <code>node scripts/test-run/feedback-server.mjs</code> を動かして、<a href="http://localhost:5201/docs/reports/test-results.html">http://localhost:5201/docs/reports/test-results.html</a> から開き直してください（ここまでの入力は、そこで開くと自動でファイルへ移ります）。';
    }
    forms.forEach(paint); stats();
  })();
  const only = document.getElementById('fb-only');
  only.addEventListener('click', () => { const on = only.getAttribute('aria-pressed') !== 'true'; only.setAttribute('aria-pressed', String(on)); document.body.classList.toggle('only-open', on); });
  document.getElementById('fb-next').addEventListener('click', () => {
    const f = forms.find((x) => !(items[x.dataset.key] || {}).v && x.getBoundingClientRect().top > 120) || forms.find((x) => !(items[x.dataset.key] || {}).v);
    if (f) { f.scrollIntoView({ block: 'center', behavior: 'smooth' }); f.querySelector('textarea').focus({ preventScroll: true }); }
  });
})();
</script></body></html>`;
writeFileSync(ROOT + 'docs/reports/test-results.html', html);
console.log('wrote docs/reports/test-results.html', tot);
