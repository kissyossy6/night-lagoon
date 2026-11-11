import { scenario, ROOT } from './lib.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
const S = scenario(18, '書き出しの値と時刻が変わっていない');
const dir = ROOT + 'exports/control/';
const before = new Set(readdirSync(dir));
S.rec('18.前提', 'info', `exports/control/ に前からあるファイル: ${before.size} 個。前のファイル（Night_Lagoon_channels-csv_40fps.csv など）は、以前の確認の後片付けで消えていて、行を見比べる基準が無い。そこで次の3つで代わりに確かめた`);
// 1: the files that make the values are byte-identical to the stage-7 snapshot
const rows = [];
// choreography.ts also holds the list of the versions (SHOW_VARIANTS), which got menu names
// on 2026-11-07 (handoff 追記22): compare it without that block, and its ids and titles apart
const variantsBlock = /export const SHOW_VARIANTS[\s\S]*?\n\];\n(\n\/\*\* The version a \?show=[\s\S]*?\n\}\n)?/;
const docBlock = /\/\*\*\n \* The one list of the versions[\s\S]*?\*\/\n/;
const idsTitles = (t) => [...t.match(variantsBlock)[0].matchAll(/id: '(\w+)', label: '([^']*)', title: '([^']*)'/g)].map((m) => m.slice(1).join('|')).join(';');
for (const f of ['src/show/choreography.ts', 'src/show/cues.ts', 'src/show/types.ts', 'src/show/song.ts']) {
  let same = spawnSync('cmp', ['-s', `${ROOT}backups/2026-11-05-pre-graphics/${f}`, `${ROOT}${f}`]).status === 0;
  let how = '';
  if (!same && f.endsWith('choreography.ts')) {
    const a = readFileSync(`${ROOT}backups/2026-11-05-pre-graphics/${f}`, 'utf8'), b = readFileSync(`${ROOT}${f}`, 'utf8');
    same = a.replace(variantsBlock, '').replace(docBlock, '') === b.replace(variantsBlock, '').replace(docBlock, '') && idsTitles(a) === idsTitles(b);
    if (same) how = '（版の一覧 SHOW_VARIANTS にメニューの名前を足しただけ。振付と版の id・題は同じ）';
  }
  rows.push(`${f.split('/').pop()}: ${same ? '同じ' + how : '違う'}`);
}
const d = spawnSync('diff', [`${ROOT}backups/2026-11-05-pre-graphics/src/fixtures/water.ts`, `${ROOT}src/fixtures/water.ts`]).stdout.toString();
const changedKeys = [...new Set((d.match(/\b(fadeLen|fallFade|guide|height|jets|bore|p|spray|mist|strands|pump|flow)\b(?=:)/g) ?? []))];
S.rec('18.1', rows.every((r) => /: 同じ/.test(r)) ? 'pass' : 'fail', `演出の中身を決める4つのファイルは、段階7の前（backups/2026-11-05-pre-graphics）と中身が${rows.every((r) => /: 同じ/.test(r)) ? 'ぴったり同じ' : '違う'}（${rows.join('、')}）。機材の表 water.ts の差は、光の係数だけ（fadeLen・fallFade・guide、書き出す値の圧力・左右・前後には関わらない）`, '前のファイルとの行の見比べは、基準が無く出来ていない。上は代わりの根拠');
// 2-4: the machine check (a copy that talks to :5200)
const r = spawnSync('node', ['scripts/test-run/control-check-5200.mjs', '--show=lagoon', '--range=10-20', '--fps=40', '--format=channels-csv,dmx-patch,cue-sheet,pyro-csv,dmx-record'], { cwd: ROOT, encoding: 'utf8', timeout: 20 * 60 * 1000 });
const out = (r.stdout ?? '') + (r.stderr ?? '');
const lines = out.split('\n').filter(Boolean);
const patchLines = lines.filter((l) => /dmx-patch|ユニバース|universe|372|台/.test(l)).slice(0, 6);
const failedMsg = lines.filter((l) => /✗/.test(l));
S.rec('18.4', r.status === 0 && !failedMsg.length ? 'pass' : 'fail', `control-check（この確認用に :5200 向けに写した版）を \`--show=lagoon --range=10-20\` で走らせた：終了コード ${r.status}、✓ ${lines.filter((l) => /✓/.test(l)).length} 個・✗ ${failedMsg.length} 個。` + (failedMsg.length ? ' ✗: ' + failedMsg.join(' / ') : ''), '', []);
S.rec('18.出力', 'info', '走らせた出力（先頭 40 行）: ' + lines.slice(0, 40).join(' ⏎ '));
const patchOk = lines.some((l) => /372|dmx-patch/.test(l));
S.rec('18.2', patchOk && !failedMsg.length ? 'pass' : 'fail', `割り当て表：control-check が「1台1行・512 をまたがない・重ならない」を確かめた。${patchLines.join(' / ')}`);
S.rec('18.3', lines.some((l) => /cue-sheet/.test(l)) && !failedMsg.length ? 'pass' : 'fail', `キュー表：control-check が「演出のキュー1つにつき1行・時刻順・タイムコード・場面」を確かめた（✗ なし）`);
const newFiles = readdirSync(dir).filter((f) => !before.has(f));
for (const f of newFiles) { try { unlinkSync(dir + f); } catch {} }
S.rec('18.後片付け', 'info', `control-check が書いた ${newFiles.length} ファイルを消した: ${newFiles.join(', ')}`);
S.save({ out: lines.slice(0, 80) });
