import { CHECK_KINDS, type Check, type CheckKind, type CheckLevel } from '../show/checks';
import { clockLabel, cueLabel, LANES, laneOf, startOf } from './model';
import type { EditorState } from './state';

/**
 * The 警告 pane of the right column (docs/dev-plan.md C5): every cue that
 * does not play as written, by level and kind. A row selects its cue and
 * goes to its time; a double-click opens the cue in the キュー pane.
 */

const LEVELS: { level: CheckLevel; name: string; empty: string }[] = [
  { level: 'danger', name: '危ない', empty: '花火の保安距離・傾き：いまは無し' },
  { level: 'caution', name: '書いたとおりに動かない', empty: 'いまは無し' },
  { level: 'info', name: 'お知らせ（自動で合わせた）', empty: 'いまは無し' },
];
const KIND_ORDER: CheckKind[] = ['pyro', 'missing', 'head', 'water', 'nomist', 'linger', 'led'];

export interface WarningActions {
  /** Select cue i, show it in the timeline and go to its time. */
  go(i: number): void;
  /** Open cue i in the キュー pane. */
  open(i: number): void;
}

export class WarningsPanel {
  private list: Check[] = [];
  /** The お知らせ group stays folded until opened (it is long and expected). */
  private infoOpen = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly state: EditorState,
    private readonly actions: WarningActions,
    private readonly onCount: (serious: number) => void,
  ) {
    state.on((e) => {
      if (e.kind === 'selection') this.mark();
    });
  }

  update(list: Check[]) {
    this.list = list;
    this.onCount(list.filter((c) => c.level !== 'info').length);
    this.render();
  }

  private render() {
    const f = this.state.file;
    const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text) el.textContent = text;
      return el;
    };
    const count = (l: CheckLevel) => this.list.filter((c) => c.level === l).length;
    const sum = h('div', 'w-sum');
    for (const L of LEVELS) {
      const s = h('span', `w-lv ${L.level}`);
      s.append(h('i', 'dot'), L.level === 'info' ? 'お知らせ' : L.name, h('b', '', String(count(L.level))));
      sum.append(s);
    }
    const out: HTMLElement[] = [sum];
    for (const L of LEVELS) {
      const items = this.list.filter((c) => c.level === L.level);
      const folded = L.level === 'info' && !this.infoOpen;
      const head = h('div', `w-grp ${L.level}`);
      head.append(h('i', 'dot'), `${L.level === 'info' ? (folded ? '▸ ' : '▾ ') : ''}${L.name}`, h('span', 'c', String(items.length)));
      if (L.level === 'info') {
        head.classList.add('fold');
        head.addEventListener('click', () => {
          this.infoOpen = !this.infoOpen;
          this.render();
        });
      }
      out.push(head);
      if (!items.length) {
        out.push(h('div', 'w-empty', L.empty));
        continue;
      }
      for (const kind of KIND_ORDER) {
        const ks = items.filter((c) => c.kind === kind).sort((a, b) => startOf(f.cues[a.source], f) - startOf(f.cues[b.source], f) || a.source - b.source);
        if (!ks.length) continue;
        const k = CHECK_KINDS[kind];
        const kh = h('div', 'w-kind');
        kh.append(h('b', '', `${k.title}  ${ks.length}`), h('span', '', k.note));
        out.push(kh);
        if (folded) continue;
        for (const c of ks) {
          const cue = f.cues[c.source];
          if (!cue) continue;
          const t = startOf(cue, f);
          const row = h('button', 'w-row');
          row.dataset.i = String(c.source);
          row.append(
            h('span', 't', Number.isFinite(t) ? clockLabel(t) : '—'),
            h('span', 'l', LANES[laneOf(cue)]?.name ?? ''),
            h('span', 'x', `${cue.macro ? '∿ ' : ''}${cueLabel(cue)}${c.text ? `　${c.text}` : ''}`),
          );
          row.title = 'クリック：このキューを選んでその時刻へ　ダブルクリック：キューの設定を開く';
          row.addEventListener('click', () => this.actions.go(c.source));
          row.addEventListener('dblclick', () => this.actions.open(c.source));
          out.push(row);
        }
      }
    }
    out.push(h('p', 'w-foot', '数字は目安で、実機の応答は機材によって違います。花火の警告は、実際の許可の代わりにはなりません。'));
    this.host.replaceChildren(...out);
    this.mark();
  }

  /** Highlight the rows of the selected cues. */
  private mark() {
    const sel = this.state.selection;
    for (const r of this.host.querySelectorAll<HTMLElement>('.w-row')) r.classList.toggle('cur', sel.has(Number(r.dataset.i)));
  }
}
