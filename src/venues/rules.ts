import { kind, NOZZLES } from '../fixtures';
import { sizeRow, MAX_SIZE, MIN_SIZE } from '../pyro/shells';
import { audienceDistance, maxSizeAt } from '../pyro/schedule';
import type { Layout } from '../show/layout';
import { isWaterPart, PART_NAMES, partPositions, placedAt, type Part, type VenueDoc } from './parts';
import type { ScaleTier, Vec3, Venue, WaterShape } from './types';

/**
 * The venue editor's rules (docs/detailed-design.md 6.3, dev-plan F), in
 * three steps:
 *   止める (stop)   impossible: the venue editor will not open it in 3D
 *   赤 (danger)     dangerous
 *   黄 (note)       strained, or worth a look
 * They act on every fixture, arrays and single ones alike. They are a guide
 * and never stand in for a real permit (DISCLAIMER, shown under the list).
 *
 * The numbers marked 仮 are first guesses, kept here in one place.
 */

export type Level = 'stop' | 'danger' | 'note';

export interface Finding {
  /** Which rule (RULE_NAMES). */
  rule: RuleId;
  level: Level;
  /** Plain Japanese, shown in the list. */
  text: string;
  /** Where to mark it on the top view ([x, z] m). */
  at?: [number, number];
  /** The part it is about (index in doc.parts), to select it from the list. */
  part?: number;
}

export type RuleId = 'outside' | 'ground' | 'overlap' | 'samespot' | 'close' | 'pyroSafety' | 'spray' | 'burst' | 'spill' | 'pump' | 'heavy' | 'noSeats' | 'build' | 'projector';

/** The rules' names, for the list and the docs (step in brackets). */
export const RULE_NAMES: Record<RuleId, string> = {
  build: '組み立てられない',
  outside: '水の外',
  ground: '置き場の違い',
  overlap: '重なり',
  samespot: '同じ場所',
  pyroSafety: '花火の保安距離',
  spray: '水が客席に届く',
  burst: '花火が水幕にかかる',
  close: '近すぎ',
  spill: '水盤の外に落ちる',
  pump: 'ポンプの合計',
  heavy: '描画の重さ',
  noSeats: '客席が無い',
  projector: 'プロジェクター',
};

/** Farthest a lit screen may stand from where the projector faces (deg) before it reads as not aimed at it. 仮. */
export const PROJECTOR_AIM_DEG = 60;

export const LEVEL_NAMES: Record<Level, string> = { stop: '止める', danger: '赤', note: '黄' };

export const DISCLAIMER = '警告は目安で、実際の許可の代わりにはなりません。';

// ------------------------------------------------------------ 仮 numbers
/** Spray beyond where the water lands, as a share of the apex height (仮, detailed design 6.3). */
export const SPRAY_MARGIN = 0.2;
/**
 * Two fixtures of different kinds: closer than this share of the smaller
 * kind's spacing they stand on one spot (止める); closer than CLOSE_SHARE,
 * a note to check the real fixtures' size (仮). The lagoon's chaser arcs run
 * through the grid down to 0.23 m, its whip and chaser ends 0.36 m apart.
 */
export const SAME_SPOT_SHARE = 0.1;
export const CLOSE_SHARE = 0.4;
/** Water the pumps of a venue of each scale give (L/s, 仮). The lagoon's kinds sum to about 3,100. */
export const PUMP_BUDGET: Record<ScaleTier, number> = { desk: 0.3, garden: 5, plaza: 150, lagoon: 5000 };
/** Spray particles at 'high' quality that still run smoothly (仮: the lagoon's 394,800 and a little). */
export const SPRAY_BUDGET = 450_000;

// ----------------------------------------------------------------- facts
interface Fx {
  part: number;
  /** Place in the array (before 外す). */
  i: number;
  x: number;
  z: number;
  kind: string;
}

const round1 = (v: number) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
const round2 = (v: number) => Math.round(v * 100) / 100;

/** What the list calls a part: 列「前列」, 1台（ガイザー）. */
export function partLabel(p: Part): string {
  if (p.kind === 'pyro') return `花火の台「${p.site}」`;
  if (p.kind === 'single') return `1台（${kind(p.fixture).name}）`;
  const name = 'name' in p && p.name ? `「${p.name}」` : '';
  return `${PART_NAMES[p.kind]}${name}`;
}

function waterFixtures(doc: VenueDoc): Fx[] {
  const out: Fx[] = [];
  doc.parts.forEach((p, n) => {
    if (!isWaterPart(p)) return;
    for (const f of placedAt(p)) out.push({ part: n, i: f.i, x: f.pos[0], z: f.pos[2], kind: p.fixture });
  });
  return out;
}

/** Apex height at full pressure (m) of a water kind. */
export function apex(kindId: string): number {
  const n = kind(kindId).nozzle;
  return n ? (n.spec.height ?? NOZZLES[n.type].height) : 0;
}

/** Where water of this kind can land, from the fixture (m): tilted columns, fountain-physics 4. */
export function reach(kindId: string): number {
  const h = apex(kindId);
  const lean = Math.min(45, kind(kindId).place.lean);
  return 2 * h * Math.sin(2 * (lean * Math.PI) / 180);
}

function inside(w: WaterShape, x: number, z: number): boolean {
  switch (w.kind) {
    case 'infinite':
      return true;
    case 'circle':
      return Math.hypot(x, z) <= w.radius + 1e-9;
    case 'roundedRect': {
      const r = Math.min(w.radius, w.width / 2, w.depth / 2);
      const dx = Math.max(0, Math.abs(x) - (w.width / 2 - r));
      const dz = Math.max(0, Math.abs(z) - (w.depth / 2 - r));
      return Math.abs(x) <= w.width / 2 + 1e-9 && Math.abs(z) <= w.depth / 2 + 1e-9 && Math.hypot(dx, dz) <= r + 1e-9;
    }
    default:
      return Math.abs(x) <= w.width / 2 + 1e-9 && Math.abs(z) <= w.depth / 2 + 1e-9;
  }
}

/** How far a point inside the water is from its edge (m); Infinity without an edge. */
function toEdge(w: WaterShape, x: number, z: number): number {
  switch (w.kind) {
    case 'infinite':
      return Infinity;
    case 'circle':
      return w.radius - Math.hypot(x, z);
    case 'roundedRect': {
      const r = Math.min(w.radius, w.width / 2, w.depth / 2);
      const dx = Math.abs(x) - (w.width / 2 - r);
      const dz = Math.abs(z) - (w.depth / 2 - r);
      if (dx > 0 && dz > 0) return r - Math.hypot(dx, dz);
      return Math.min(w.width / 2 - Math.abs(x), w.depth / 2 - Math.abs(z));
    }
    default:
      return Math.min(w.width / 2 - Math.abs(x), w.depth / 2 - Math.abs(z));
  }
}

/** The venue as the pyro helpers want it (they read only layout.venue). */
const asLayout = (venue: Venue) => ({ venue }) as unknown as Layout;

/** Per fireworks site (by part index): the biggest size its tubes may fire and their distance to the audience. */
export function pyroLimits(doc: VenueDoc, venue: Venue): Map<number, { size: number; distance: number }> {
  const out = new Map<number, { size: number; distance: number }>();
  const hasSeats = !!venue.audience || venue.seats.length > 0;
  if (!hasSeats) return out;
  doc.parts.forEach((p, n) => {
    if (p.kind !== 'pyro') return;
    const tubes = partPositions(p);
    let size = Infinity;
    let distance = Infinity;
    for (const t of tubes) {
      size = Math.min(size, maxSizeAt(t, asLayout(venue)));
      distance = Math.min(distance, audienceDistance(t, asLayout(venue)));
    }
    if (tubes.length) out.set(n, { size, distance });
  });
  return out;
}

// ----------------------------------------------------------------- rules
export function checkVenue(doc: VenueDoc, venue: Venue): Finding[] {
  const out: Finding[] = [];
  const w = doc.water;
  const fx = waterFixtures(doc);
  const hasSeats = doc.parts.some((p) => p.kind === 'seats');

  // ---- 止める: 水の外 / 置き場の違い
  if (w.kind !== 'infinite') {
    const byPart = new Map<number, Fx[]>();
    for (const f of fx) if (!inside(w, f.x, f.z)) byPart.set(f.part, [...(byPart.get(f.part) ?? []), f]);
    for (const [n, list] of byPart) {
      out.push({ rule: 'outside', level: 'stop', part: n, at: [list[0].x, list[0].z], text: `${partLabel(doc.parts[n])}の${list.length}台が水の外にあります。` });
    }
    doc.parts.forEach((p, n) => {
      if (p.kind === 'screen' && (!inside(w, p.center[0] - p.width / 2, p.center[1]) || !inside(w, p.center[0] + p.width / 2, p.center[1]))) {
        out.push({ rule: 'outside', level: 'stop', part: n, at: p.center, text: `水幕${p.name ? `「${p.name}」` : ''}が水の外にはみ出しています。` });
      }
      if (p.kind === 'pyro') {
        const tubes = partPositions(p);
        const wrong = tubes.filter((t) => inside(w, t[0], t[2]) !== (p.on === 'barge'));
        if (wrong.length) {
          out.push({
            rule: 'ground',
            level: 'stop',
            part: n,
            at: [wrong[0][0], wrong[0][2]],
            text: p.on === 'barge' ? `${partLabel(p)}は水上の台なのに、${wrong.length}本の筒が水の外にあります。` : `${partLabel(p)}は陸なのに、${wrong.length}本の筒が水の上にあります。`,
          });
        }
      }
    });
  }

  // ---- 止める: 重なり（同じ種類）・同じ場所 / 黄: 近すぎ（違う種類）
  const pairs = new Map<string, { rule: RuleId; a: number; b: number; d: number; count: number; at: [number, number]; spacing: number; kinds: [string, string] }>();
  const maxSpacing = Math.max(0, ...fx.map((f) => kind(f.kind).place.spacing));
  const sorted = [...fx].sort((p, q) => p.x - q.x);
  for (let a = 0; a < sorted.length; a++) {
    const A = sorted[a];
    for (let b = a + 1; b < sorted.length; b++) {
      const B = sorted[b];
      if (B.x - A.x >= maxSpacing) break;
      const d = Math.hypot(A.x - B.x, A.z - B.z);
      let rule: RuleId | null = null;
      let spacing: number;
      if (A.kind === B.kind) {
        spacing = kind(A.kind).place.spacing;
        if (d < spacing - 1e-9) rule = 'overlap';
      } else {
        spacing = Math.min(kind(A.kind).place.spacing, kind(B.kind).place.spacing);
        if (d < spacing * SAME_SPOT_SHARE) rule = 'samespot';
        else if (d < spacing * CLOSE_SHARE) rule = 'close';
      }
      if (!rule) continue;
      const [p, q] = A.part <= B.part ? [A, B] : [B, A];
      // 近すぎ is one note per pair of kinds (an arc woven through a grid
      // touches several of its bands); the others name the parts
      const key = rule === 'close' ? `close:${[p.kind, q.kind].sort().join(':')}` : `${rule}:${p.part}:${q.part}`;
      const hit = pairs.get(key);
      if (!hit) pairs.set(key, { rule, a: p.part, b: q.part, d, count: 1, at: [(A.x + B.x) / 2, (A.z + B.z) / 2], spacing, kinds: [p.kind, q.kind] });
      else {
        hit.count++;
        if (d < hit.d) Object.assign(hit, { d, at: [(A.x + B.x) / 2, (A.z + B.z) / 2] });
      }
    }
  }
  for (const h of pairs.values()) {
    const A = partLabel(doc.parts[h.a]);
    const B = partLabel(doc.parts[h.b]);
    const where = h.a === h.b ? `${A}の中で` : `${A}と${B}が`;
    if (h.rule === 'overlap') {
      out.push({ rule: 'overlap', level: 'stop', part: h.b, at: h.at, text: `${where}${h.count}か所、${round2(h.d)} m まで近づいています（${kind(h.kinds[0]).name}どうしは ${h.spacing} m 以上）。` });
    } else if (h.rule === 'samespot') {
      out.push({ rule: 'samespot', level: 'stop', part: h.b, at: h.at, text: `${A}と${B}が${h.count}か所でほぼ同じ場所にあります（${round2(h.d)} m）。` });
    } else {
      const [ka, kb] = h.kinds.map((k) => kind(k).name);
      out.push({
        rule: 'close',
        level: 'note',
        part: h.b,
        at: h.at,
        text: `${ka}と${kb}が${h.count}か所で近づいています（一番近いのは${A}と${B}の ${round2(h.d)} m）。実機の大きさで収まるか確かめてください。`,
      });
    }
  }

  // ---- 赤: 花火の保安距離 / 花火が水幕にかかる
  const limits = pyroLimits(doc, venue);
  doc.parts.forEach((p, n) => {
    if (p.kind !== 'pyro') return;
    const tubes = partPositions(p);
    if (!tubes.length) return;
    const mid = tubes[Math.floor(tubes.length / 2)];
    const lim = limits.get(n);
    if (lim && lim.size === 0) {
      out.push({
        rule: 'pyroSafety',
        level: 'danger',
        part: n,
        at: [mid[0], mid[2]],
        text: `${partLabel(p)}から客席まで ${round1(lim.distance)} m。一番小さい${MIN_SIZE}号でも保安距離は ${sizeRow(MIN_SIZE).safety} m 要ります。`,
      });
    }
    // the biggest size that may go up here opens highest and widest; any
    // smaller one opens lower: try them all
    const top = lim ? lim.size : MAX_SIZE;
    for (let s = MIN_SIZE; s <= top + 1e-6; s += 0.5) {
      const row = sizeRow(s);
      const hit = venue.screens.find((sc) => tubes.some((t) => sphereHitsBox([t[0], t[1] + row.height, t[2]], row.diameter / 2, sc.center, sc.width, sc.height)));
      if (hit) {
        out.push({
          rule: 'burst',
          level: 'danger',
          part: n,
          at: [mid[0], mid[2]],
          text: `${partLabel(p)}の${s}号は、開くと水幕にかかります（開く高さ ${row.height} m・半径 ${round1(row.diameter / 2)} m）。`,
        });
        break;
      }
    }
  });

  // ---- 赤: 水が客席に届く / 黄: 水盤の外に落ちる
  if (hasSeats && venue.audience) {
    const worst = new Map<number, { f: Fx; d: number }>();
    for (const f of fx) {
      const h = apex(f.kind);
      const d = audienceDistance([f.x, 0, f.z], asLayout(venue));
      if (d < reach(f.kind) + SPRAY_MARGIN * h) {
        const cur = worst.get(f.part);
        if (!cur || d < cur.d) worst.set(f.part, { f, d });
      }
    }
    for (const [n, { f, d }] of worst) {
      const h = apex(f.kind);
      const lean = kind(f.kind).place.lean;
      const k = kind(f.kind).name;
      const room = (d - SPRAY_MARGIN * h) / (2 * h);
      let text: string;
      if (room <= 0 || lean === 0) text = `${partLabel(doc.parts[n])}は客席まで ${round1(d)} m。${k}（高さ ${h} m）の飛沫が客席にかかります。`;
      else {
        const ok = Math.floor((0.5 * Math.asin(Math.min(1, room)) * 180) / Math.PI / 5) * 5;
        text = `${partLabel(doc.parts[n])}の${k}を客席側へ倒すと、水が客席に届きます（全開で ${round1(reach(f.kind))} m 先に落ちる・客席まで ${round1(d)} m）。全開なら客席側へは ${ok}° まで。`;
      }
      out.push({ rule: 'spray', level: 'danger', part: n, at: [f.x, f.z], text });
    }
  }
  if (w.kind !== 'infinite') {
    const worst = new Map<number, { f: Fx; d: number; need: number }>();
    for (const f of fx) {
      if (!inside(w, f.x, f.z)) continue;
      const h = apex(f.kind);
      // a column falls about as far as it is tall in a breeze (fountain-layout:
      // the height no more than the distance to the rim); a tilted one lands farther
      const need = Math.max(h, reach(f.kind) + SPRAY_MARGIN * h);
      const d = toEdge(w, f.x, f.z);
      if (d < need) {
        const cur = worst.get(f.part);
        if (!cur || d - need < cur.d - cur.need) worst.set(f.part, { f, d, need });
      }
    }
    for (const [n, { f, d, need }] of worst) {
      out.push({
        rule: 'spill',
        level: 'note',
        part: n,
        at: [f.x, f.z],
        text: `${partLabel(doc.parts[n])}の水が水盤の外に落ちます（縁まで ${round1(d)} m・${kind(f.kind).name}は ${round1(need)} m 要る）。`,
      });
    }
  }

  // ---- 黄: ポンプの合計 / 描画の重さ / 客席が無い
  let flow = 0;
  let spray = 0;
  for (const g of venue.groups) {
    const k = kind(g.kind);
    flow += k.place.flow * g.positions.length;
    spray += (k.nozzle?.spray ?? 0) * g.positions.length;
  }
  for (const s of venue.screens) {
    const k = kind(s.group).place;
    flow += k.flow * (k.flowPer === 'metre' ? s.width : 1);
  }
  const budget = PUMP_BUDGET[doc.scale];
  if (flow > budget) {
    out.push({ rule: 'pump', level: 'note', text: `ポンプの合計が ${Math.round(flow).toLocaleString('ja-JP')} L/s で、この規模の目安 ${budget.toLocaleString('ja-JP')} L/s を超えます（どちらも仮の数字）。` });
  }
  if (spray > SPRAY_BUDGET) {
    out.push({ rule: 'heavy', level: 'note', text: `飛沫の粒が ${spray.toLocaleString('ja-JP')} で、なめらかに動く目安 ${SPRAY_BUDGET.toLocaleString('ja-JP')} を超えます。画質「中」以下で見てください。` });
  }
  if (!hasSeats && (fx.length || doc.parts.some((p) => p.kind === 'pyro'))) {
    out.push({ rule: 'noSeats', level: 'note', text: '客席がないので、花火の保安距離と飛沫を確かめられません。部品「客席」を足してください。' });
  }

  // ---- 黄: プロジェクター (it only lights; no 止める or 赤)
  out.push(...projectorFindings(doc, venue));

  const order: Record<Level, number> = { stop: 0, danger: 1, note: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/**
 * The projector: lights no screen, faces away from a screen it lights, or
 * stands on the audience's side of it (front projection: the picture lands on
 * what stands behind the mist too, and the light goes into the audience's
 * eyes; rear projection is the rule for water screens, k4-light-screen S1).
 */
function projectorFindings(doc: VenueDoc, venue: Venue): Finding[] {
  const pj = venue.projector;
  const n = doc.parts.findIndex((p) => p.kind === 'projector');
  if (!pj || n < 0 || !venue.screens.length) return [];
  const at: [number, number] = [pj.at[0], pj.at[2]];
  const out: Finding[] = [];
  if (!pj.covers.length) {
    out.push({ rule: 'projector', level: 'note', part: n, at, text: 'プロジェクターがどの水幕にも当たっていません（「当てる水幕」を選んでください）。映像はどこにも映りません。' });
    return out;
  }
  const face = Math.atan2(pj.aim[2] - pj.at[2], pj.aim[0] - pj.at[0]);
  const names = doc.parts.filter((p) => p.kind === 'screen').map((p) => (p as { name?: string }).name);
  const nameOf = (k: number) => names[k] ?? `水幕${k + 1}`;
  const away: string[] = [];
  const front: string[] = [];
  for (const k of pj.covers) {
    const s = venue.screens[k];
    const to = Math.atan2(s.center[2] - pj.at[2], s.center[0] - pj.at[0]);
    const off = Math.abs(((to - face + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (off > (PROJECTOR_AIM_DEG * Math.PI) / 180) away.push(nameOf(k));
    if (venue.audience) {
      const aud = (venue.audience.from[2] + venue.audience.to[2]) / 2;
      if (Math.sign(pj.at[2] - s.center[2]) === Math.sign(aud - s.center[2]) && pj.at[2] !== s.center[2]) front.push(nameOf(k));
    }
  }
  if (away.length) out.push({ rule: 'projector', level: 'note', part: n, at, text: `プロジェクターが ${away.join('・')} の方を向いていません（向きから ${PROJECTOR_AIM_DEG}° より外）。` });
  if (front.length) out.push({ rule: 'projector', level: 'note', part: n, at, text: `プロジェクターが ${front.join('・')} の客席側にあります（前から映すと、幕の後ろの物にも像が当たり、光が客席へ向きます。水幕は後ろから映すのが基本）。` });
  return out;
}

/** Does a ball at c with radius r touch the screen's box (its mist, 2.5 m deep)? */
function sphereHitsBox(c: Vec3, r: number, center: Vec3, width: number, height: number): boolean {
  const lo: Vec3 = [center[0] - width / 2, 0, center[2] - 1.25];
  const hi: Vec3 = [center[0] + width / 2, height, center[2] + 1.25];
  let d2 = 0;
  for (let k = 0; k < 3; k++) {
    const v = Math.max(lo[k], Math.min(c[k], hi[k]));
    d2 += (c[k] - v) ** 2;
  }
  return d2 <= r * r;
}
