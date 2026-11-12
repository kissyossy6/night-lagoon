import { compileShow, resolveTarget } from '../show/cues';
import { CHECK_KINDS, checkShow, zoneName } from '../show/checks';
import type { Cue, Ease, Fire, FirePattern, MacroName, Order, ParamKey, SceneName, ShellName, ShowFile, VideoFit } from '../show/types';
import { compilePyro, maxSizeAt, resolveTubes, type PyroWarning } from '../pyro/schedule';
import { ANGLE, MINE, SKY_GLOW, sizeRow } from '../pyro/shells';
import { KINDS, type CueSection, type FixtureKind } from '../fixtures';
import {
  EASES,
  FITS,
  LANES,
  LAYOUT,
  MACROS,
  MACRO_ARGS,
  ORDERS,
  PARAMS,
  PATTERN_OPTIONS,
  SCENES,
  SHELL_OPTIONS,
  TARGET_PRESETS,
  bodyOf,
  cueColors,
  cueLabel,
  kindOfLane,
  laneOf,
  parseTimeInput,
  sceneLength,
  spreadOf,
  startOf,
} from './model';
import type { ChangeEvent, EditorState } from './state';
import { SECTION_PALETTE, sectionSpans, sectionsOf } from '../show/sections';
import { knownVideos, refreshVideos, uploadVideo, videoLength, videoName } from './videos';

/**
 * Right-hand panel. With a cue selected: every field of the cue, as real
 * inputs plus a raw JSON fallback; edits apply immediately. With nothing
 * selected: show-level settings and the keyboard reference.
 *
 * With several cues selected, set / dur / ease / stagger / order edits go to
 * all of them; the other fields edit the primary (last clicked) cue.
 */

export interface InspectorActions {
  duplicate(): void;
  remove(): void;
  playheadTime(): number;
  snapTime(t: number): number | string;
  seek(t: number): void;
  /** The project's own music (docs/music-plan.md). */
  music?: {
    /** Why music cannot be picked here, or null. */
    blocked(): string | null;
    pick(file: File): void;
    /** Back to the shared recording. */
    reset(): void;
    /** The loaded music's name (or a word for loading / none). */
    loaded(): string;
    /** Replace the cues with a draft made from the music (src/show/draft.ts); false while the music is not analysed. */
    draft(): boolean;
    /** The beat measured in the music; 'none' when the music has no steady beat; null before it is analysed. */
    tempo(): { bpm: number; offset: number } | 'none' | null;
  };
}

type Sync = () => void;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const k of kids) el.append(k);
  return el;
};

const numStr = (v: unknown) => (v === undefined || v === null || v === '' ? '' : String(v));

export class Inspector {
  private syncs: Sync[] = [];
  private builtKey = '';

  constructor(
    private readonly host: HTMLElement,
    private readonly state: EditorState,
    private readonly actions: InspectorActions,
  ) {
    state.on((e) => this.update(e));
    this.update();
    // the video list arrives later; screen cues show it in their picker
    void refreshVideos().then(() => {
      if (this.cue && this.kindOf(this.cue).cue.sections.includes('clip')) this.build();
    });
  }

  private key(): string {
    const st = this.state;
    const c = st.file.cues[st.primary];
    if (!c) return `none|${st.file.cues.length}`;
    return `${st.primary}|${st.selection.size}|${c.macro ?? ''}|${c.fire ? `${c.fire.shell}:${c.fire.colors?.length ?? 0}` : ''}`;
  }

  update(e?: ChangeEvent) {
    const k = this.key();
    if (k !== this.builtKey || e?.structural) {
      if (e?.source === 'inspector' && k === this.builtKey) return this.sync();
      this.builtKey = k;
      this.build();
    } else {
      this.sync();
    }
  }

  private sync() {
    for (const s of this.syncs) s();
  }

  private build() {
    const st = this.state;
    const scroll = this.host.scrollTop;
    this.host.replaceChildren();
    this.syncs = [];
    const cue = st.file.cues[st.primary];
    if (cue) this.buildCue();
    else this.buildShow();
    this.sync();
    this.host.scrollTop = scroll;
  }

  // -------------------------------------------------------------- helpers

  private edit(field: string, fn: (c: Cue) => void, opts: { all?: boolean; live?: boolean } = {}) {
    const st = this.state;
    const idx = opts.all ? st.selected() : [st.primary];
    st.mutate(
      (f) => {
        for (const i of idx) if (f.cues[i]) fn(f.cues[i]);
      },
      { key: `insp:${field}:${st.primary}`, live: opts.live ?? true, source: 'inspector' },
    );
  }

  private get cue(): Cue | undefined {
    return this.state.file.cues[this.state.primary];
  }

  private row(label: string, ...kids: (Node | string)[]) {
    return h('div', { className: 'row' }, h('label', { textContent: label }), h('div', { className: 'pair' }, ...kids));
  }

  private section(title: string) {
    this.host.append(h('h3', { textContent: title }));
  }

  /** Bind a text/number input to a cue field. */
  private input(type: 'text' | 'number', get: () => string, set: (v: string, el: HTMLInputElement) => void, opts: { step?: number; placeholder?: string; cls?: string; list?: string } = {}) {
    const el = h('input', { type, className: opts.cls ?? (type === 'number' ? 'num' : 'txt') });
    if (opts.step !== undefined) el.step = String(opts.step);
    if (opts.placeholder !== undefined) el.placeholder = opts.placeholder;
    if (opts.list) el.setAttribute('list', opts.list);
    el.addEventListener('input', () => set(el.value, el));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.blur();
      e.stopPropagation();
    });
    this.syncs.push(() => {
      if (document.activeElement !== el) el.value = get();
    });
    return el;
  }

  private select<T extends string>(options: { v: T | ''; ja: string }[], get: () => string, set: (v: T | '') => void) {
    const el = h('select', { className: 'inp' });
    for (const o of options) el.append(h('option', { value: o.v, textContent: o.ja }));
    el.addEventListener('change', () => set(el.value as T | ''));
    this.syncs.push(() => {
      el.value = get();
    });
    return el;
  }

  // ---------------------------------------------------------- music row

  /** 曲: the show's music, pick another or go back to the shared one (docs/music-plan.md). */
  private buildMusic() {
    const st = this.state;
    const m = this.actions.music;
    if (!m) return;
    const name = h('span', { className: 'music-name' });
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';
    const file = h('input', { type: 'file', accept: 'audio/*', hidden: true });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) m.pick(f);
    });
    const pick = h('button', { className: 'btn', textContent: '曲を選ぶ…', type: 'button' });
    pick.addEventListener('click', () => file.click());
    const reset = h('button', { className: 'btn', textContent: '共通の曲に戻す', type: 'button' });
    reset.addEventListener('click', () => m.reset());
    const draft = h('button', { className: 'btn', textContent: 'この曲で下書きを作る', type: 'button', title: '曲の大きさと音の頭から、振付の下書きを作ります（今のキューと置き換え。⌘Z で戻せます）' });
    draft.addEventListener('click', () => m.draft());
    const note = h('div', { className: 'note' });
    const tempo = h('div', { className: 'actions' });
    this.host.append(this.row('曲', name, file), h('div', { className: 'actions' }, pick, reset), h('div', { className: 'actions' }, draft), tempo, note);
    this.syncs.push(() => {
      const own = st.file.music;
      name.textContent = own ? own.name : '共通の曲（Rhapsody in Blue）';
      name.title = own ? `読み込み：${m.loaded()}` : '';
      const why = m.blocked();
      pick.disabled = !!why;
      reset.hidden = !own;
      draft.hidden = !own;
      draft.disabled = !own || m.tempo() === null;
      note.textContent = why ?? (own ? '曲の長さがショーの長さです。曲の後ろのキューは流れません（警告に出ます）' : '自分の曲を入れると、長さと波形がその曲になります');
      const t = own ? m.tempo() : null;
      tempo.replaceChildren();
      tempo.hidden = true;
      if (t === 'none') {
        tempo.hidden = false;
        tempo.append(h('span', { className: 'hint', textContent: '拍の目安：見つかりません（テンポが揺れる曲など）。BPM とオフセットは手で、または「音の頭」にスナップして合わせます' }));
      } else if (t && (Math.abs(t.bpm - st.file.bpm) > 0.05 || Math.abs(t.offset - st.file.offset) > 0.005)) {
        const use = h('button', { className: 'btn', textContent: '入れる', type: 'button' });
        use.addEventListener('click', () =>
          st.mutate(
            (f) => {
              f.bpm = t.bpm;
              f.offset = t.offset;
            },
            { structural: true, source: 'inspector' },
          ),
        );
        tempo.hidden = false;
        tempo.append(h('span', { className: 'hint', textContent: `拍の目安：${t.bpm} BPM・最初の拍 ${t.offset.toFixed(2)} 秒` }), use);
      }
    });
  }

  // ------------------------------------------------------- sections panel

  /** The show's named stretches (序章, 目覚め, …): rename, move, add, remove. */
  private buildSections() {
    const st = this.state;
    this.section('区間');
    // the first edit copies the song's form into the file, then edits that copy
    const own = (f: ShowFile) => (f.sections ??= sectionsOf(f).map((s) => ({ ...s })));
    const edit = (key: string, fn: (f: ShowFile) => void, rebuild = false) => {
      st.mutate(fn, { key: `sect:${key}`, live: !rebuild, source: 'inspector' });
      if (rebuild) this.build();
    };
    const sortByStart = (f: ShowFile) => f.sections?.sort((a, b) => a.t - b.t);
    const list = h('div', { className: 'sects' });
    list.append(h('span', { className: 'hint', textContent: '' }), h('span', { className: 'hint', textContent: '名前' }), h('span', { className: 'hint', textContent: '始まり 秒' }), h('span', { className: 'hint', textContent: '終わり' }), h('span'));
    for (const s of sectionSpans(st.file, st.file.duration)) {
      const i = s.i;
      const color = h('input', { type: 'color', value: s.color, title: '色' });
      color.addEventListener('input', () => edit(`color:${i}`, (f) => (own(f)[i].color = color.value)));
      const name = this.input('text', () => sectionsOf(st.file)[i]?.name ?? '', (v) => edit(`name:${i}`, (f) => (own(f)[i].name = v)));
      const start = this.input('number', () => String(+(sectionsOf(st.file)[i]?.t ?? 0).toFixed(3)), (v) => {
        const x = Number(v);
        if (Number.isFinite(x) && x >= 0 && x <= st.file.duration) edit(`t:${i}`, (f) => (own(f)[i].t = x));
      }, { step: 0.5 });
      // re-sort once the number is settled, so a section moved past its neighbour takes its place
      start.addEventListener('change', () => edit('sort', (f) => sortByStart(f), true));
      const end = h('span', { className: 'hint', textContent: s.to.toFixed(1) });
      const del = h('button', { className: 'btn icon', textContent: '×', title: 'この区間を消す (前の区間がのびる)' });
      del.disabled = sectionsOf(st.file).length <= 1;
      del.addEventListener('click', () => edit(`del:${i}`, (f) => own(f).splice(i, 1), true));
      const go = h('button', { className: 'btn icon', textContent: '↦', title: '始まりへ移動' });
      go.addEventListener('click', () => this.actions.seek(s.from));
      list.append(color, name, start, h('div', { className: 'pair' }, end, go), del);
    }
    this.host.append(list);
    const add = h('button', { className: 'btn', textContent: '再生位置に区間を足す' });
    add.addEventListener('click', () => {
      const t = +this.actions.playheadTime().toFixed(3);
      edit('add', (f) => {
        const l = own(f);
        l.push({ name: `区間 ${l.length + 1}`, t, color: SECTION_PALETTE[l.length % SECTION_PALETTE.length] });
        sortByStart(f);
      }, true);
    });
    const reset = h('button', { className: 'btn', textContent: '曲の区間に戻す', title: '書き換えた区間を消して、曲のもとの区間を使う' });
    reset.disabled = !st.file.sections;
    reset.addEventListener('click', () => edit('reset', (f) => delete f.sections, true));
    this.host.append(h('div', { className: 'actions' }, add, reset));
    this.host.append(h('div', { className: 'note', textContent: '区間は、続けて並びます（終わり＝次の始まり）。名前と色は時間軸・本番画面の帯に出ます。水幕の映像の時刻は変わりません。' }));
  }

  // ------------------------------------------------------------ cue panel

  private buildCue() {
    const st = this.state;
    const host = this.host;
    const cue = this.cue!;
    const lane = laneOf(cue);
    const multi = st.selection.size > 1;

    // header
    const sw = h('span', { className: 'swatch' });
    const title = h('span');
    host.append(h('h2', {}, sw, title));
    const sub = h('div', { className: 'sub' });
    host.append(sub);
    this.syncs.push(() => {
      const c = this.cue;
      if (!c) return;
      const cols = cueColors(c, laneOf(c));
      sw.style.background = cols.length > 1 ? `linear-gradient(90deg, ${cols.join(',')})` : cols[0];
      title.textContent = `${c.macro ? '∿ ' : ''}${cueLabel(c)}`;
      const t = startOf(c, st.file);
      const lname = LANES[laneOf(c)]?.name ?? '不明なレーン';
      sub.textContent = `キュー #${st.primary} · ${lname} · ${Number.isFinite(t) ? t.toFixed(2) + ' 秒' : '時刻不正'}${multi ? ` · 他 ${st.selection.size - 1} 個も選択中` : ''}`;
    });
    if (multi) host.append(h('div', { className: 'note', textContent: '複数選択中: 設定値・長さ・イージング・時差・順序は選択中のすべてに適用されます。' }));
    // what does not play as written (src/show/checks.ts; the fireworks' own
    // warnings are in their section below): the same lines as the 警告 list
    const speedNote = h('div', { className: 'note' });
    speedNote.style.cssText =
      'color: var(--c-caution); background: color-mix(in srgb, var(--c-caution) 12%, transparent); border-color: color-mix(in srgb, var(--c-caution) 35%, transparent); white-space: pre-line';
    host.append(speedNote);
    this.syncs.push(() => {
      // (no picture map: only the head and water lines are wanted here)
      const mine = checkShow(compileShow(st.file, LAYOUT), LAYOUT, { step: 1, zones: [], sources: [] }).filter((c) => c.source === st.primary && (c.kind === 'head' || c.kind === 'water'));
      speedNote.style.display = mine.length ? '' : 'none';
      speedNote.textContent = mine.map((c) => `△ ${CHECK_KINDS[c.kind].title}${c.text ? `（${c.text}）` : ''}：${CHECK_KINDS[c.kind].note}`).join('\n');
    });

    // --- basics
    this.section('基本');
    const tHint = h('span', { className: 'hint' });
    const tIn = this.input(
      'text',
      () => String(this.cue?.t ?? ''),
      (v, el) => {
        const p = parseTimeInput(v);
        el.classList.toggle('bad', p === null);
        if (p !== null) this.edit('t', (c) => (c.t = p));
      },
      { placeholder: '25:1 または 48.0' },
    );
    const nowBtn = h('button', { className: 'btn', textContent: '再生位置', title: '再生位置 (拍にスナップ) を時刻にする' });
    nowBtn.addEventListener('click', () => {
      const t = this.actions.snapTime(this.actions.playheadTime());
      this.edit('t', (c) => (c.t = t), { live: false });
    });
    host.append(this.row('時刻', tIn, nowBtn));
    host.append(this.row('', tHint));
    this.syncs.push(() => {
      const c = this.cue;
      const t = c ? startOf(c, st.file) : NaN;
      tHint.textContent = Number.isFinite(t) ? `= ${t.toFixed(3)} 秒  (小節:拍 か 秒で入力)` : '小節:拍 (例 25:3) か 秒で入力';
    });

    const listId = 'target-list';
    const dl = h('datalist', { id: listId });
    for (const p of TARGET_PRESETS) dl.append(h('option', { value: p.target, label: p.name }));
    host.append(dl);
    const tgHint = h('span', { className: 'hint' });
    const tgIn = this.input(
      'text',
      () => this.cue?.target ?? '',
      (v, el) => {
        const n = this.cue && this.kindOf(this.cue).cue.unit === 'tubes' ? resolveTubes(v, LAYOUT).length : resolveTarget(v, LAYOUT).length;
        el.classList.toggle('bad', n === 0);
        if (v.trim()) this.edit('target', (c) => (c.target = v.trim()));
      },
      { list: listId, placeholder: 'grid[0-87] など' },
    );
    const preset = h('select', { className: 'inp preset', title: 'よく使うターゲット' });
    preset.append(h('option', { value: '', textContent: 'プリセット' }));
    for (const p of TARGET_PRESETS) preset.append(h('option', { value: p.target, textContent: p.name }));
    preset.addEventListener('change', () => {
      if (preset.value) this.edit('target', (c) => (c.target = preset.value), { live: false });
      preset.value = '';
    });
    host.append(this.row('ターゲット', tgIn, preset));
    host.append(this.row('', tgHint));
    this.syncs.push(() => {
      const c = this.cue;
      if (!c) return;
      if (this.kindOf(c).cue.unit === 'tubes') {
        const n = resolveTubes(c.target, LAYOUT).length;
        tgHint.textContent = n ? `${n} 本の筒から打つ` : '⚠ 該当する筒がありません';
        tgHint.style.color = n ? '' : 'var(--c-warn)';
        return;
      }
      const n = resolveTarget(c.target, LAYOUT).length;
      tgHint.textContent = n ? `${n} 台が対象` : '⚠ 該当するノズルがありません';
      tgHint.style.color = n ? '' : 'var(--c-warn)';
    });

    const labIn = this.input(
      'text',
      () => this.cue?.label ?? '',
      (v) =>
        this.edit('label', (c) => {
          if (v) c.label = v;
          else delete c.label;
        }),
      { placeholder: '(任意) ブロックに表示する名前' },
    );
    host.append(this.row('ラベル', labIn));

    // the sections come from the fixture table (src/fixtures/); a cue that
    // fires shells is a fireworks cue wherever its target points
    for (const section of this.kindOf(cue).cue.sections) this.sectionBuilders[section]();

    this.buildJson();
  }

  private kindOf(cue: Cue): FixtureKind {
    return cue.fire ? KINDS.pyro : kindOfLane(laneOf(cue));
  }

  /** One builder per section a kind can list (src/fixtures/types.ts CueSection). */
  private readonly sectionBuilders: Record<CueSection, () => void> = {
    zone: () => this.buildZone(),
    set: () => this.buildSet(),
    motion: () => this.buildMotion(),
    clip: () => this.buildClip(),
    macro: () => this.buildMacro(),
    fire: () => this.buildFire(),
  };

  /** Set values (water and screens). */
  private buildSet() {
    this.section('設定値 (set)');
    const cue = this.cue;
    const kind = cue ? this.kindOf(cue) : null;
    const offered = kind?.cue.params;
    // the kind's values, and any other a cue already sets (an older file's)
    for (const p of PARAMS) if (!offered || offered.includes(p.key) || cue?.set?.[p.key] !== undefined) this.host.append(this.paramRow(p.key));
    if (kind?.folder === 'screen' && kind.id !== 'projector')
      this.host.append(
        h('div', {
          className: 'note',
          textContent: '水幕は霧の高さだけを決めます。映像の明るさは「プロジェクター」の行で決めます（ここに明るさがあると、この幕の区画のプロジェクターへ移して扱います）。',
        }),
      );
  }

  /** The projector's zones a cue lights: all, or one (src/show/layout.ts ProjectorZone). */
  private buildZone() {
    const zones = LAYOUT.projector;
    if (!zones.length) return;
    this.section('区画');
    const n = zones.length;
    const choices = [{ target: 'projector', ja: '全部' }, ...zones.map((_, k) => ({ target: `projector[${k}-${k}]`, ja: zoneName(k, n) || '1' }))];
    const seg = h('div', { className: 'seg' });
    const buttons = choices.map((c) => {
      const b = h('button', { textContent: c.ja, title: c.target });
      b.addEventListener('click', () => this.edit('target', (cue) => (cue.target = c.target), { live: false }));
      seg.append(b);
      return b;
    });
    this.host.append(this.row('区画', seg));
    this.host.append(
      h('div', {
        className: 'note',
        textContent: 'プロジェクターは水幕の後ろから1枚の絵を映します。区画（左・中央・右の山の列）ごとに明るさを決められます。霧のある所にだけ映り、霧が残れば絵も残ります。',
      }),
    );
    this.syncs.push(() => {
      const mine = new Set(resolveTarget(this.cue?.target ?? '', LAYOUT));
      choices.forEach((c, k) => {
        const want = resolveTarget(c.target, LAYOUT);
        buttons[k].classList.toggle('on', want.length === mine.size && want.every((i) => mine.has(i)));
      });
    });
  }

  /** Length, easing, stagger and order. */
  private buildMotion() {
    const host = this.host;
    this.section('動き');
    const durHint = h('span', { className: 'hint' });
    host.append(
      this.row(
        '長さ dur',
        this.input(
          'number',
          () => numStr(this.cue?.dur),
          (v) =>
            this.edit(
              'dur',
              (c) => {
                if (v === '') delete c.dur;
                else c.dur = Math.max(0, Number(v));
              },
              { all: true },
            ),
          { step: 0.05, placeholder: '0' },
        ),
        durHint,
      ),
    );
    this.syncs.push(() => {
      const c = this.cue;
      durHint.textContent = c?.macro ? `マクロ全体 ${bodyOf(c).toFixed(2)} 秒` : '秒';
    });
    host.append(
      this.row(
        'イージング',
        this.select<Ease>(
          [{ v: '', ja: '(既定: 長さ>0 なら inOut)' }, ...EASES],
          () => this.cue?.ease ?? '',
          (v) =>
            this.edit(
              'ease',
              (c) => {
                if (v) c.ease = v;
                else delete c.ease;
              },
              { all: true, live: false },
            ),
        ),
      ),
    );
    const stHint = h('span', { className: 'hint' });
    host.append(
      this.row(
        '時差 stagger',
        this.input(
          'number',
          () => numStr(this.cue?.stagger),
          (v) =>
            this.edit(
              'stagger',
              (c) => {
                if (v === '' || Number(v) === 0) delete c.stagger;
                else c.stagger = Math.max(0, Number(v));
              },
              { all: true },
            ),
          { step: 0.01, placeholder: '0' },
        ),
        stHint,
      ),
    );
    this.syncs.push(() => {
      const c = this.cue;
      const s = c ? spreadOf(c) : 0;
      stHint.textContent = s > 0 ? `全体 ${s.toFixed(2)} 秒` : '秒/台';
    });
    host.append(
      this.row(
        '順序 order',
        this.select<Order>(
          [{ v: '', ja: '(既定: 番号順)' }, ...ORDERS],
          () => this.cue?.order ?? '',
          (v) =>
            this.edit(
              'order',
              (c) => {
                if (v) c.order = v;
                else delete c.order;
              },
              { all: true, live: false },
            ),
        ),
      ),
    );

  }

  /** A macro and its arguments. */
  private buildMacro() {
    const host = this.host;
    const cue = this.cue!;
    this.section('マクロ');
    host.append(
      this.row(
        'マクロ',
        this.select<MacroName>(
          [{ v: '', ja: 'なし (set をそのまま適用)' }, ...MACROS.map((m) => ({ v: m.name, ja: `${m.name} — ${m.ja}` }))],
          () => this.cue?.macro ?? '',
          (v) =>
            this.edit(
              'macro',
              (c) => {
                if (v) {
                  if (c.macro !== v) c.args = {};
                  c.macro = v;
                } else {
                  delete c.macro;
                  delete c.args;
                }
              },
              { live: false },
            ),
        ),
      ),
    );
    if (cue.macro) {
      for (const a of MACRO_ARGS[cue.macro]) {
        if (a.options) {
          host.append(
            this.row(
              a.ja,
              this.select(
                [{ v: '', ja: `(既定: ${a.def})` }, ...a.options.map((o) => ({ v: o, ja: o }))],
                () => numStr(this.cue?.args?.[a.key]),
                (v) => this.setArg(a.key, v === '' ? undefined : v),
              ),
              h('span', { className: 'hint', textContent: a.key }),
            ),
          );
        } else {
          host.append(
            this.row(
              a.ja,
              this.input('number', () => numStr(this.cue?.args?.[a.key]), (v) => this.setArg(a.key, v === '' ? undefined : Number(v)), {
                step: a.step,
                placeholder: `既定 ${a.def}`,
              }),
              h('span', { className: 'hint', textContent: a.key }),
            ),
          );
        }
      }
      host.append(h('div', { className: 'note', textContent: 'マクロ中の set (色など) は各噴射に重ねて適用されます。空欄は既定値。' }));
    }
  }

  /** Fireworks cues: the shell, its size and colours, the run (src/pyro/). */
  private buildFire() {
    const st = this.state;
    const host = this.host;
    const fireEdit = (field: string, fn: (f: Fire) => void, live = true) =>
      this.edit(
        `fire.${field}`,
        (c) => {
          if (!c.fire) return;
          const f = { ...c.fire, colors: [...(c.fire.colors ?? [])] };
          fn(f);
          c.fire = f;
        },
        { all: true, live },
      );
    const fire = () => this.cue?.fire;

    this.section('花火');
    // safety distance and lean: red (dangerous) and yellow (a stretch), at
    // once, while the size, the tubes or the angles change (dev-plan F)
    const warn = h('div', { className: 'note danger' });
    warn.style.cssText = 'color: var(--c-danger-text); background: var(--c-danger-bg); border-color: var(--c-danger-line)';
    const caution = h('div', { className: 'note' });
    caution.style.cssText =
      'color: var(--c-caution); background: color-mix(in srgb, var(--c-caution) 12%, transparent); border-color: color-mix(in srgb, var(--c-caution) 35%, transparent)';
    host.append(warn, caution);
    this.syncs.push(() => {
      const c = this.cue;
      const ws = c ? compilePyro(st.file, LAYOUT).warnings.filter((w) => w.source === st.primary) : [];
      const of = (kind: PyroWarning['kind']) => ws.filter((w) => w.kind === kind);
      const nearest = (list: PyroWarning[]) => list.reduce((a, b) => (b.have < a.have ? b : a));
      const red: string[] = [];
      const tube = of('tube');
      if (tube.length) {
        const w = nearest(tube);
        red.push(`保安距離が足りません：${w.size}号は客席から ${Math.round(w.need)} m 要りますが、この筒は ${Math.round(w.have)} m です（${tube.length} 本）。`);
      }
      if (of('toward').length) red.push(`客席の側へ傾いています（${Math.round(Math.max(...of('toward').map((w) => w.have)))}°）。実際には筒は客席から離れる向きにしか傾けません。`);
      const burst = of('burst');
      if (burst.length) {
        const w = nearest(burst);
        red.push(`開く位置が客席に近すぎます：傾けた分、開く位置の真下（燃えかすの落ちる範囲の中心）が客席から ${Math.round(w.have)} m です。${w.size}号は ${Math.round(w.need)} m 要ります（${burst.length} 本）。`);
      }
      warn.style.display = red.length ? '' : 'none';
      warn.textContent = red.length ? `⚠ ${red.join(' ')} 目安で、実際の許可の代わりにはなりません。` : '';
      const steep = of('steep');
      caution.style.display = steep.length ? '' : 'none';
      if (steep.length) {
        const lean = Math.max(...steep.map((w) => w.have));
        caution.textContent = `△ 傾きが大きい（${Math.round(lean)}°）：${ANGLE.caution}°を超えると開く位置が低くなり、台も組みにくくなります。${lean > ANGLE.max ? `${ANGLE.max}°で止めています。` : ''}`;
      }
    });

    host.append(
      this.row(
        '種類',
        this.select<ShellName>(SHELL_OPTIONS, () => fire()?.shell ?? 'kiku', (v) => v && fireEdit('shell', (f) => (f.shell = v), false)),
      ),
    );
    const sizeHint = h('span', { className: 'hint' });
    host.append(
      this.row(
        '号数',
        this.input(
          'number',
          () => numStr(fire()?.size),
          (v) => {
            const x = Number(v);
            if (v !== '' && Number.isFinite(x)) fireEdit('size', (f) => (f.size = Math.min(10, Math.max(2.5, x))));
          },
          { step: 0.5, placeholder: '2.5〜10' },
        ),
        h('span', { className: 'hint', textContent: '号' }),
      ),
    );
    host.append(this.row('', sizeHint));
    const reach = h('span', { className: 'hint' });
    host.append(this.row('', reach));
    this.syncs.push(() => {
      const f = fire();
      if (!f) return;
      const size = f.shell === 'mine' ? Math.min(MINE.maxSize, Math.max(MINE.minSize, f.size)) : f.size;
      const r = sizeRow(size);
      sizeHint.textContent = `高さ ${Math.round(r.height)} m・直径 ${Math.round(r.diameter)} m・上昇 ${r.rise.toFixed(1)} 秒`;
      const tubes = resolveTubes(this.cue?.target ?? '', LAYOUT);
      const max = tubes.length ? Math.min(...tubes.map((i) => maxSizeAt(LAYOUT.tubes[i].position, LAYOUT))) : 0;
      reach.textContent = tubes.length ? `この筒からは ${max ? `${max}号まで` : '打てない'}（${size}号は ${Math.round(r.safety)} m 要る）` : '';
    });

    // colours: the first, then up to two colour changes
    const cols = fire()?.colors ?? [];
    for (let k = 0; k < Math.min(3, cols.length + 1); k++) {
      const label = k === 0 ? '色' : `変化 ${k}`;
      if (k >= cols.length) {
        const add = h('button', { className: 'btn', textContent: '＋ 色が変わる' });
        add.addEventListener('click', () => fireEdit('colors', (f) => f.colors.push(f.colors[f.colors.length - 1] ?? '#ffffff'), false));
        host.append(this.row(label, add));
        break;
      }
      const pick = h('input', { type: 'color' });
      pick.addEventListener('input', () => fireEdit(`color${k}`, (f) => (f.colors[k] = pick.value)));
      this.syncs.push(() => {
        const c = fire()?.colors?.[k];
        if (document.activeElement !== pick && c && /^#[0-9a-f]{6}$/i.test(c)) pick.value = c.toLowerCase();
      });
      const kids: Node[] = [pick];
      if (k > 0) {
        const del = h('button', { className: 'btn', textContent: '消す' });
        del.addEventListener('click', () => fireEdit('colors', (f) => f.colors.splice(k, 1), false));
        kids.push(del);
      }
      host.append(this.row(label, ...kids));
    }

    const numRow = (label: string, key: 'count' | 'interval' | 'angle' | 'tilt' | 'spread' | 'seed' | 'glow' | 'burn', step: number, placeholder: string, hint: string) =>
      host.append(
        this.row(
          label,
          this.input(
            'number',
            () => numStr(fire()?.[key]),
            (v) =>
              fireEdit(key, (f) => {
                if (v === '' || !Number.isFinite(Number(v))) delete f[key];
                else f[key] = Number(v);
              }),
            { step, placeholder },
          ),
          h('span', { className: 'hint', textContent: hint }),
        ),
      );
    numRow('数', 'count', 1, '既定 1 (マインは 12)', '発 / 筒');
    numRow('間隔', 'interval', 0.05, '既定 0.25', '秒');
    numRow('傾き 左右', 'angle', 1, '既定 0 (マインは 15)', '° 右へ +');
    numRow('傾き 前後', 'tilt', 1, '既定 0', '° 奥へ − / 客席へ + は赤');
    host.append(
      this.row(
        '角度の型',
        this.select<FirePattern>(
          PATTERN_OPTIONS,
          () => fire()?.pattern ?? '',
          (v) =>
            fireEdit(
              'pattern',
              (f) => {
                if (v) f.pattern = v;
                else delete f.pattern;
              },
              false,
            ),
        ),
      ),
    );
    numRow('広さ', 'spread', 5, `既定 ${ANGLE.spread}`, '° 型の両端の開き');
    numRow('種', 'seed', 1, '既定 キューの番号から', '見た目の乱数');
    numRow('燃える時間', 'burn', 0.25, '既定 種類ごと（柳 5.75）', '秒 この花火だけ（星が燃えて消えるまで）');
    numRow('開いた瞬間の光', 'glow', 0.1, `既定 ${SKY_GLOW}`, '空を星の色で照らす強さ（0 なし・1 は比べ場の②）');
    host.append(h('div', { className: 'note', textContent: '時刻は「開く瞬間」。打ち上げは上昇時間ぶん前に自動で決まります（帯の手前の薄い部分）。' }));
  }

  private buildJson() {
    const st = this.state;
    const host = this.host;

    // --- raw JSON
    this.section('JSON (直接編集)');
    const ta = h('textarea', { className: 'json', spellcheck: false });
    const err = h('div', { className: 'err' });
    const apply = () => {
      try {
        const v = JSON.parse(ta.value) as Cue;
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('オブジェクトではありません');
        if (typeof v.t !== 'number' && typeof v.t !== 'string') throw new Error('t がありません');
        if (typeof v.target !== 'string') throw new Error('target がありません');
        ta.classList.remove('bad');
        err.textContent = '';
        const i = st.primary;
        st.mutate(
          (f) => {
            f.cues[i] = v;
          },
          { source: 'inspector-json' },
        );
      } catch (e) {
        ta.classList.add('bad');
        err.textContent = `JSON エラー: ${e instanceof Error ? e.message : e}`;
      }
    };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        apply();
      }
    });
    ta.addEventListener('blur', () => {
      if (ta.value.trim() !== JSON.stringify(this.cue ?? {}, null, 1).trim()) apply();
    });
    this.syncs.push(() => {
      if (document.activeElement !== ta) {
        ta.value = JSON.stringify(this.cue ?? {}, null, 1);
        ta.classList.remove('bad');
        err.textContent = '';
      }
    });
    host.append(ta, err);
    const applyBtn = h('button', { className: 'btn', textContent: 'JSON を適用 (⌘/Ctrl+Enter)' });
    applyBtn.addEventListener('mousedown', (e) => e.preventDefault());
    applyBtn.addEventListener('click', apply);

    // --- actions
    const dup = h('button', { className: 'btn', textContent: '複製 (⌘/Ctrl+D)' });
    dup.addEventListener('click', () => this.actions.duplicate());
    const jump = h('button', { className: 'btn', textContent: 'ここへ移動' });
    jump.addEventListener('click', () => {
      const c = this.cue;
      if (c) this.actions.seek(startOf(c, st.file));
    });
    const del = h('button', { className: 'btn danger', textContent: '削除 (Delete)' });
    del.addEventListener('click', () => this.actions.remove());
    host.append(h('div', { className: 'actions' }, applyBtn));
    host.append(h('div', { className: 'actions' }, jump, dup, del));
  }

  /** Water-screen cues: which picture the projector plays from this cue on. */
  private buildClip() {
    const host = this.host;
    this.section('映像 (プロジェクター)');
    // one select for scenes and video files: "video:<src>" for a file
    const cur = this.cue?.clip;
    const files = [...new Set([...knownVideos(), ...(cur?.scene === 'video' && cur.src ? [cur.src] : [])])];
    const options: { v: string; ja: string }[] = [
      { v: '', ja: '(切り替えない: 前の映像が続く)' },
      { v: 'sync', ja: 'ショーの時刻どおり' },
      ...SCENES,
      ...files.map((f) => ({ v: `video:${f}`, ja: `動画: ${videoName(f)}` })),
    ];
    const pick = h('input', { type: 'file', accept: 'video/mp4,video/webm,video/quicktime,.mp4,.m4v,.mov,.webm' });
    pick.hidden = true;
    const status = h('span', { className: 'hint' });
    const importVideo = async (file: File) => {
      status.textContent = `取り込み中… ${file.name}`;
      status.style.color = '';
      try {
        const src = await uploadVideo(file);
        this.edit('clip', (c) => (c.clip = { scene: 'video', src }), { live: false });
        this.build();
      } catch (e) {
        status.textContent = e instanceof Error ? e.message : String(e);
        status.style.color = 'var(--c-warn)';
      }
    };
    pick.addEventListener('change', () => {
      if (pick.files?.[0]) void importVideo(pick.files[0]);
      pick.value = '';
    });
    host.append(
      this.row(
        '映像',
        this.select<string>(
          options,
          () => {
            const c = this.cue?.clip;
            return c?.scene === 'video' ? `video:${c.src ?? ''}` : (c?.scene ?? '');
          },
          (v) =>
            this.edit(
              'clip',
              (c) => {
                if (!v) delete c.clip;
                else if (v === 'sync') c.clip = { scene: 'sync' };
                else if (v.startsWith('video:')) {
                  // a different file starts from its own beginning
                  const src = v.slice(6);
                  c.clip = c.clip?.scene === 'video' && c.clip.src === src ? c.clip : { scene: 'video', src, ...(c.clip?.fit ? { fit: c.clip.fit } : {}) };
                } else c.clip = c.clip && c.clip.scene !== 'video' ? { ...c.clip, scene: v as SceneName } : { scene: v as SceneName };
              },
              { live: false },
            ),
        ),
      ),
    );
    // drop a file here, or pick one
    const browse = h('button', { className: 'btn', textContent: '動画を取り込む…', title: 'public/videos/ にコピーして、このキューに割り当てる' });
    browse.addEventListener('click', () => pick.click());
    const drop = h('div', { className: 'drop' }, browse, h('span', { className: 'hint', textContent: 'またはここに動画をドロップ' }), pick);
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer?.files[0];
      if (f) void importVideo(f);
    });
    host.append(this.row('', drop));
    host.append(this.row('', status));

    const fromHint = h('span', { className: 'hint' });
    const fromRow = this.row(
      '開始位置',
      this.input(
        'number',
        () => numStr(this.cue?.clip?.from),
        (v) =>
          this.edit('clip.from', (c) => {
            if (!c.clip || c.clip.scene === 'sync') return;
            if (v === '' || Number(v) === 0) delete c.clip.from;
            else if (Number.isFinite(Number(v))) c.clip.from = Number(v);
          }),
        { step: 0.5, placeholder: '0' },
      ),
      fromHint,
    );
    host.append(fromRow);
    const fitRow = this.row(
      '合わせ方',
      this.select<VideoFit>(
        [{ v: '', ja: `(既定: ${FITS[0].ja})` }, ...FITS],
        () => this.cue?.clip?.fit ?? '',
        (v) =>
          this.edit(
            'clip.fit',
            (c) => {
              if (c.clip?.scene !== 'video') return;
              if (v) c.clip.fit = v;
              else delete c.clip.fit;
            },
            { live: false },
          ),
      ),
    );
    host.append(fitRow);
    // a drawn scene on its own (show/types.ts Clip.alone)
    const alone = h('input', { type: 'checkbox' });
    alone.addEventListener('change', () =>
      this.edit(
        'clip.alone',
        (c) => {
          if (!c.clip || c.clip.scene === 'sync' || c.clip.scene === 'video') return;
          if (alone.checked) c.clip.alone = true;
          else delete c.clip.alone;
        },
        { live: false },
      ),
    );
    const aloneRow = this.row('', h('label', { className: 'chk' }, alone, ' この場面だけを流す（重なる前後の場面を出さない）'));
    host.append(aloneRow);
    const note = h('div', { className: 'note' });
    host.append(note);
    this.syncs.push(() => {
      const clip = this.cue?.clip;
      const video = clip?.scene === 'video' ? (clip.src ?? '') : null;
      const scene = clip && clip.scene !== 'sync' && clip.scene !== 'video' ? clip.scene : null;
      fromRow.style.display = scene || video !== null ? '' : 'none';
      fitRow.style.display = video !== null ? '' : 'none';
      aloneRow.style.display = scene ? '' : 'none';
      alone.checked = !!clip?.alone;
      if (scene) fromHint.textContent = `秒 (シーンは約 ${Math.round(sceneLength(scene))} 秒)`;
      else if (video) {
        const d = videoLength(video, () => this.sync());
        fromHint.textContent = d === undefined ? '秒 (長さを確認中…)' : Number.isFinite(d) ? `秒 (動画は ${d.toFixed(1)} 秒)` : '⚠ 動画を読み込めません';
      } else fromHint.textContent = '';
      note.textContent = clip
        ? 'このキューの時刻から、次に映像を指定したキューまでこの映像が流れます。シーンは終わると後ろのシーンに続き、動画は終わると黒になります。プロジェクターは 1 台（1枚の絵）なので、横長と 3 つの山には同じ映像が映ります。明るさはプロジェクターの行で区画ごとに決めます。映像が見えるのは霧のある所だけです。'
        : '映像を選ぶと、このキューの時刻からその映像を頭から流します。動画は public/videos/ に取り込まれます。';
    });
  }

  private setArg(key: string, v: number | string | undefined) {
    this.edit(`arg.${key}`, (c) => {
      const a = { ...(c.args ?? {}) };
      if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) delete a[key];
      else a[key] = v;
      c.args = a;
    });
  }

  private paramRow(key: ParamKey) {
    const p = PARAMS.find((x) => x.key === key)!;
    const has = () => this.cue?.set?.[key] !== undefined;
    const setVal = (v: number | string | undefined, live = true) =>
      this.edit(
        `set.${key}`,
        (c) => {
          const s = { ...(c.set ?? {}) } as Record<string, number | string>;
          if (v === undefined) delete s[key];
          else s[key] = v;
          if (Object.keys(s).length) c.set = s;
          else delete c.set;
        },
        { all: true, live },
      );
    const chk = h('input', { type: 'checkbox', title: `${p.ja} を設定する` });
    const row = h('div', { className: 'prow' });
    const name = h('span', { textContent: p.ja });
    row.append(chk, name);
    chk.addEventListener('change', () => {
      const cur = this.cue?.set?.[key];
      setVal(chk.checked ? (cur ?? p.def) : undefined, false);
    });
    if (key === 'color') {
      const hex = this.input(
        'text',
        () => String(this.cue?.set?.color ?? ''),
        (v, el) => {
          const ok = /^#[0-9a-f]{6}$/i.test(v.trim());
          el.classList.toggle('bad', !ok && v !== '');
          if (ok) setVal(v.trim().toLowerCase());
        },
        { cls: 'num', placeholder: '#rrggbb' },
      );
      const pick = h('input', { type: 'color' });
      pick.addEventListener('input', () => setVal(pick.value));
      this.syncs.push(() => {
        const c = String(this.cue?.set?.color ?? p.def);
        if (document.activeElement !== pick && /^#[0-9a-f]{6}$/i.test(c)) pick.value = c.toLowerCase();
      });
      row.append(hex, pick);
    } else {
      const n = this.input(
        'number',
        () => numStr(this.cue?.set?.[key]),
        (v) => {
          if (v === '') return;
          const x = Number(v);
          if (Number.isFinite(x)) setVal(x);
        },
        { step: p.step, placeholder: String(p.def) },
      );
      const r = h('input', { type: 'range' });
      r.min = String(p.min);
      // a kind may have its own ceiling (the projector's full output)
      r.max = String((this.cue && this.kindOf(this.cue).cue.max?.[key]) ?? p.max);
      r.step = String(p.step);
      r.addEventListener('input', () => setVal(Number(r.value)));
      this.syncs.push(() => {
        const v = this.cue?.set?.[key];
        if (document.activeElement !== r) r.value = String(v ?? p.def);
      });
      row.append(n, r);
      n.dataset.param = key;
    }
    this.syncs.push(() => {
      chk.checked = has();
      row.classList.toggle('off', !has());
    });
    return row;
  }

  // ----------------------------------------------------------- show panel

  private buildShow() {
    const st = this.state;
    const host = this.host;
    host.append(h('h2', { textContent: 'ショー設定' }));
    host.append(h('div', { className: 'sub', textContent: 'キューを選択すると、ここで編集できます。' }));
    const showEdit = (field: keyof ShowFile, v: string) =>
      st.mutate(
        (f) => {
          if (field === 'title') f.title = v;
          else {
            const x = Number(v);
            if (Number.isFinite(x) && (field === 'offset' ? x >= 0 : x > 0)) (f[field] as number) = x;
          }
        },
        { key: `show:${field}`, live: true, source: 'inspector', structural: field !== 'title' },
      );
    host.append(this.row('タイトル', this.input('text', () => st.file.title, (v) => showEdit('title', v))));
    this.buildMusic();
    host.append(this.row('BPM', this.input('number', () => String(st.file.bpm), (v) => showEdit('bpm', v), { step: 1 })));
    host.append(this.row('拍子', this.input('number', () => String(st.file.beatsPerBar), (v) => showEdit('beatsPerBar', v), { step: 1 }), h('span', { className: 'hint', textContent: '拍/小節' })));
    host.append(this.row('オフセット', this.input('number', () => String(st.file.offset), (v) => showEdit('offset', v), { step: 0.01 }), h('span', { className: 'hint', textContent: '秒 (1小節目の前)' })));
    host.append(this.row('長さ', this.input('number', () => String(st.file.duration), (v) => showEdit('duration', v), { step: 1 }), h('span', { className: 'hint', textContent: '秒' })));

    const stats = h('div', { className: 'stats' });
    host.append(stats);
    this.syncs.push(() => {
      const cues = st.file.cues;
      const macros = cues.filter((c) => c.macro).length;
      const lanes = new Set(cues.map(laneOf)).size;
      stats.replaceChildren(
        ...[
          [cues.length, 'キュー'],
          [macros, 'マクロ'],
          [cues.length - macros, 'set キュー'],
          [lanes, '使用レーン'],
        ].map(([v, l]) => h('div', { className: 'stat' }, h('b', { textContent: String(v) }), h('span', { textContent: String(l) }))),
      );
    });

    this.buildSections();

    this.section('操作');
    const keys: [string, string][] = [
      ['Space', '再生 / 一時停止'],
      ['ルーラーをクリック', '再生位置を移動'],
      ['ブロックをドラッグ', '移動 (拍か音の頭にスナップ)'],
      ['Alt + ドラッグ', 'スナップなしで移動'],
      ['右端をドラッグ', '長さ (dur) を変更'],
      ['Shift + クリック', '複数選択 / 解除'],
      ['空白をドラッグ', '範囲選択'],
      ['空白をダブルクリック', 'キューを追加'],
      ['Delete / Backspace', '選択キューを削除'],
      ['⌘/Ctrl + D', '複製 (1小節後)'],
      ['⌘/Ctrl + C / X', 'コピー / 切り取り'],
      ['⌘/Ctrl + V', '再生位置の拍に貼り付け (別のプロジェクトにも)'],
      ['← / →', '選択を 1 拍移動 (Alt: 0.05 秒)'],
      ['⌘/Ctrl + Z', '元に戻す'],
      ['⇧ + ⌘/Ctrl + Z', 'やり直す'],
      ['⌘/Ctrl + ホイール', '横ズーム'],
      ['ホイール / Shift+ホイール', '縦 / 横スクロール'],
      ['Home', '先頭へ'],
      ['Esc', '選択解除'],
    ];
    host.append(h('div', { className: 'keys' }, ...keys.flatMap(([k, v]) => [h('kbd', { textContent: k }), h('span', { textContent: v })])));
    host.append(h('div', { className: 'note', textContent: '編集内容はブラウザに自動保存されます。ファイル › JSON を書き出す で保存してください。' }));
  }
}
