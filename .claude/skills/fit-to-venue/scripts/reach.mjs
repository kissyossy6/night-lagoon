/**
 * How much of a show works in other venues, scene by scene, and what the
 * venues have. The starting point for re-fitting a show to a venue.
 *
 *   node .claude/skills/fit-to-venue/scripts/reach.mjs [--show=lagoon|fantasia|hanabi | --file=<show.json>] [--venues=desk,garden,plaza]
 *
 * Prints, per venue: its size, wind and fixtures (group, count, kind, height,
 * spacing, @names), then cues that move nothing / only part, per section of
 * the music, and the most common reasons. Needs the dev server on :5199.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const variant = arg('show', 'lagoon');
const file = arg('file', '');
const venues = arg('venues', 'desk,garden,plaza').split(',');
const fileSrc = file ? readFileSync(file, 'utf8') : '';

const launch = { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: 'chrome' }));
const page = await browser.newPage();
await page.goto('http://localhost:5199/lab.html?shot=1');
const report = await page.evaluate(
  async ({ variant, fileSrc, venues }) => {
    const { buildShow } = await import('/src/show/choreography.ts');
    const { loadBackground } = await import('/src/audio/background.ts');
    const { analyseMusic } = await import('/src/audio/analysis.ts');
    const { SHOW_DURATION, SECTIONS, barToSeconds } = await import('/src/show/song.ts');
    const { getVenue } = await import('/src/venues/index.ts');
    const { cueReach, whyNothing } = await import('/src/venues/cues.ts');
    const { resolveTarget } = await import('/src/show/cues.ts');
    const { resolveTubes } = await import('/src/pyro/schedule.ts');
    const { buildLayout } = await import('/src/show/layout.ts');
    const { cueTime } = await import('/src/show/cues.ts');
    let show;
    if (fileSrc) show = JSON.parse(fileSrc);
    else {
      const m = await loadBackground(new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 44100 }), SHOW_DURATION);
      show = buildShow(m ? analyseMusic(m.buffer) : undefined, variant);
    }
    const own = getVenue(show.venue);
    // cues that move nothing even in the show's own venue (cueReach leaves them out)
    const ownLayout = buildLayout(own, 'low');
    const deadWhy = new Map();
    for (const c of show.cues) {
      const n = (c.fire ? resolveTubes(c.target, ownLayout) : resolveTarget(c.target, ownLayout)).length;
      if (n) continue;
      const k = `${c.target} — ${whyNothing(c, ownLayout)}`;
      deadWhy.set(k, (deadWhy.get(k) ?? 0) + 1);
    }
    const dead = [...deadWhy].sort((a, b) => b[1] - a[1]);
    // SECTIONS are in bars (1-based); cue times are seconds
    const sectionOf = (t) => SECTIONS.find((s) => t >= barToSeconds(s.from) && t < barToSeconds(s.to))?.name ?? '?';
    const out = [];
    for (const id of venues) {
      const v = getVenue(id);
      const l = buildLayout(v, 'low');
      const groups = Object.entries(l.groups).map(([g, list]) => {
        const f = l.fixtures[list[0]];
        return { group: g, n: list.length, kind: f?.type ?? '?', height: f?.spec?.height ?? null };
      });
      const sel = Object.entries(l.selections ?? {}).map(([k, t]) => `@${k} = ${t}`);
      const total = cueReach(show, own, v);
      // per section: re-count with one-section files
      const per = {};
      for (const s of SECTIONS) {
        const cues = show.cues.filter((c) => {
          try {
            return sectionOf(cueTime(c.t, show)) === s.name;
          } catch {
            return false;
          }
        });
        const r = cueReach({ ...show, cues }, own, v);
        per[s.name] = `${r.all - r.none - r.part}/${r.all} 動く（${r.none} 動かない・${r.part} 一部）`;
      }
      out.push({ id, name: v.name, scale: v.scale, water: v.water, wind: v.wind, groups, sel, pyro: Object.keys(l.pyroGroups ?? {}), total, per });
    }
    return { title: show.title, own: own.id, cues: show.cues.length, out, dead };
  },
  { variant, fileSrc, venues },
);
console.log(`ショー: ${report.title}（${report.own} 用、${report.cues} キュー）`);
const deadN = report.dead.reduce((a, [, n]) => a + n, 0);
console.log(`自分の会場（${report.own}）でも何も動かさないキュー: ${deadN}`);
for (const [k, n] of report.dead.slice(0, 8)) console.log(`    ${n}× ${k}`);
for (const v of report.out) {
  console.log(`\n== ${v.name} (${v.id}, ${v.scale}) 水面 ${JSON.stringify(v.water)} 風 ${JSON.stringify(v.wind)}`);
  for (const g of v.groups) console.log(`  ${g.group}: ${g.n} 台  種類 ${g.kind}${g.height ? `  高さ ${g.height} m` : ''}`);
  console.log(`  花火の台: ${v.pyro.length ? v.pyro.join(', ') : 'なし'}`);
  if (v.sel.length) console.log(`  名前の付いた並び:\n    ${v.sel.join('\n    ')}`);
  console.log(`  全体: ${v.total.all} のうち 動かない ${v.total.none}・一部だけ ${v.total.part}`);
  for (const [s, r] of Object.entries(v.per)) console.log(`    ${s.padEnd(10)} ${r}`);
  console.log('  動かない理由（多い順）:');
  for (const r of v.total.reasons.slice(0, 8)) console.log(`    ${r.n}× ${r.target} — ${r.why}`);
}
await browser.close();
