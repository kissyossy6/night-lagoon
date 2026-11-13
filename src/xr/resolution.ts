/**
 * 46d 段階 2（docs/walkaround-plan.md）：重い所だけ、自動で描く大きさを下げる。
 *
 * 毎コマ、そのコマにかかった時間（ms）を frame() に渡すと、次のコマの描く大きさ（StereoView.scale）
 * を返す（映り込みを描くかは mirror → StereoView.mirror）。段（levels）は重い順で、一番下は
 * 0.5 倍のまま映り込みも切る。決まり：
 *
 *   下げる   直近 window コマのうち downAfter コマが budget を越えたら、1段下げる。下げた直後の
 *            settle コマは時間が前の大きさの分を引きずるので、見ない
 *   上げる   upAfter コマ続けて budget×headroom より軽かったら、1段上げてみる。上げてすぐ
 *            （probation コマ以内に）また下がったら、次に上げるまでの待ちを2倍にする（最大 maxWait）
 *   先回り   ショーは時刻だけで決まるので、下げた時刻を秒ごとに覚えておき、lead 秒先がそこに
 *            当たったら先に下げる（巻き戻して同じ所を見るとき、引っかかる前に下がる）
 *
 * Mac の試し台は、1コマの時間をそのまま渡す（budget＝5 ms 前後）。WebXR では、前のコマから
 * の間隔を渡し、budget を 1 コマの長さ（90 Hz なら 11.1 ms）の 1.3 倍ほどにすると「コマを落とした」
 * ときだけ下がる（段階 1b で実機に合わせて決める）。
 */

export interface GovernorOptions {
  /** ms a frame may take. */
  budget: number;
  /** The steps, heaviest first. */
  levels?: Level[];
  window?: number;
  downAfter?: number;
  settle?: number;
  upAfter?: number;
  headroom?: number;
  probation?: number;
  maxWait?: number;
  /** Seconds of show time to look ahead into the remembered heavy spots; 0 turns it off. */
  lead?: number;
}

/**
 * The steps, lightest last. A step is a drawing scale of the eye's size and whether the water's
 * mirror image is drawn: the last step keeps the smallest scale and drops the mirror too (the owner,
 * 2026-11-13: where even the smallest scale is too heavy, as the fireworks version's white finale).
 */
export interface Level {
  scale: number;
  mirror: boolean;
}
export const LEVELS: Level[] = [
  { scale: 1, mirror: true },
  { scale: 0.85, mirror: true },
  { scale: 0.7, mirror: true },
  { scale: 0.6, mirror: true },
  { scale: 0.5, mirror: true },
  { scale: 0.5, mirror: false },
];

export class ResolutionGovernor {
  readonly levels: Level[];
  private o: Required<Omit<GovernorOptions, 'levels'>>;
  /** Index into levels. */
  level = 0;
  private recent: boolean[] = [];
  private settling = 0;
  private calm = 0;
  private wait: number;
  private sinceUp = Infinity;
  /** Show second → the lowest level (largest index) that second needed. */
  private heavy = new Map<number, number>();
  /** The level the measurements alone would choose (the look-ahead can only go below it). */
  private measured = 0;

  constructor(opts: GovernorOptions) {
    this.levels = opts.levels ?? LEVELS;
    this.o = {
      budget: opts.budget,
      window: opts.window ?? 8,
      downAfter: opts.downAfter ?? 3,
      settle: opts.settle ?? 6,
      upAfter: opts.upAfter ?? 90,
      headroom: opts.headroom ?? 0.75,
      probation: opts.probation ?? 45,
      maxWait: opts.maxWait ?? 720,
      lead: opts.lead ?? 0.5,
    };
    this.wait = this.o.upAfter;
  }

  get scale() {
    return this.levels[this.level].scale;
  }

  /** Whether the water's mirror image is drawn at this step. */
  get mirror() {
    return this.levels[this.level].mirror;
  }

  /** This frame took 'ms' at show time t (seconds); returns the scale for the next frame. */
  frame(ms: number, t?: number): number {
    const o = this.o;
    this.sinceUp++;
    if (this.settling > 0) this.settling--;
    else {
      this.recent.push(ms > o.budget);
      if (this.recent.length > o.window) this.recent.shift();
      const over = this.recent.filter(Boolean).length;
      if (over >= o.downAfter && this.measured < this.levels.length - 1) {
        this.measured++;
        this.recent = [];
        this.settling = o.settle;
        this.calm = 0;
        // fell again right after going up: wait longer before the next try
        if (this.sinceUp < o.probation) this.wait = Math.min(o.maxWait, this.wait * 2);
        if (t !== undefined) {
          const s = Math.floor(t);
          this.heavy.set(s, Math.max(this.heavy.get(s) ?? 0, this.measured));
        }
      } else if (ms < o.budget * o.headroom) {
        if (++this.calm >= this.wait && this.measured > 0) {
          this.measured--;
          this.calm = 0;
          this.sinceUp = 0;
          this.recent = [];
          this.settling = o.settle;
        }
      } else this.calm = 0;
    }
    // look ahead: a second that needed a lower level before gets it a little early
    let ahead = 0;
    if (t !== undefined && o.lead > 0) {
      for (const s of [Math.floor(t), Math.floor(t + o.lead)]) ahead = Math.max(ahead, this.heavy.get(s) ?? 0);
    }
    this.level = Math.max(this.measured, ahead);
    return this.scale;
  }

  /** Forget the remembered heavy spots (another show, another venue). */
  forget() {
    this.heavy.clear();
  }
}
