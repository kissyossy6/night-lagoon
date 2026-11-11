# 詳細設計

2026-11-03 作成。要件と基本設計は [dev-plan.md](dev-plan.md)、経緯と引き継ぎは [handoff.md](handoff.md)。

段階1は、すぐ作れる細かさで書いた。段階2以降は、型・計算・ファイルの単位まで書いた。細部は、その段階に入るときに、ここを直してから作る。

数値に「仮」とあるものは、記憶や目安による値。作る段階で出典を当たって確かめ、出典を書き足す。

---

## 0. 共通

### 0.1 今のコードで、配置に寄りかかっている所（2026-11-03 調べ）

| 場所 | 何に寄りかかっているか |
| --- | --- |
| `src/show/layout.ts` | 機材の並び（`GROUPS`）、水幕4枚の位置と大きさを直に持つ |
| `src/show/runtime.ts:70,81` | `buildLayout(quality)`、`buildLayout('low')` |
| `src/editor/model.ts:12` | `LAYOUT = buildLayout('low')`。`LANES`（行の名前と色）、`TARGET_PRESETS`（対象の候補）を直に持つ |
| `src/editor/inspector.ts:191,230,248` | `LAYOUT` で対象の数を数える |
| `src/show/cues.ts:123` | `resolveTarget` が `layout.groups` を引く |
| `src/show/choreography.ts` | 番号の対象（`grid[0-87]`、`whip[3-6]` など）が約30か所。テンプレート文字列で作る所が3か所（198, 825, 939行） |
| `src/show/cameras.ts:23-41` | 客席とカメラの位置（`ANGLES`）を直に持つ。186行に水幕の幅 116 |
| `src/screen/projection.ts:32`、`rhapsody.ts` | 水幕の大きさ 116 m × 15 m を前提に絵を描く |
| `src/core/stage.ts:166` | 水面は 4000 m 四方の平面（岸がない） |
| `haze.ts`、`scope.ts`、`jetfield.ts`、`splash.ts`、`main.ts`、`editor/main.ts`、`editor/preview.ts` | `Layout` の型を使う |

### 0.2 確かめ方の共通の道具

- 型：`npm run typecheck`
- エディタ：`node scripts/editor-check.mjs`（開発サーバー :5199 が要る。`.claude/launch.json` の `water-show-v2`）
- 本番画面の撮影：`node scripts/show-shot.mjs --t=... --out=... --extra="show=fantasia"`
- **新しく作る**：`scripts/pixel-diff.py <dirA> <dirB>`。同じ名前の画像を比べて、違う画素の数と最大の差を出す。段階1の「1画素も変わらない」の確認に使う。先に同じ版を2回撮って、撮るたびの揺れ（乱数・時刻のずれ）が0かを確かめる。0でなければ、揺れの大きさを基準にする

### 0.3 作業の前に

このプロジェクトは git ではない。大きく変える前に `backups/<日付>-<名前>/` へ `src/` を写す（今までのやり方。例：`backups/2026-10-26-lagoon/`）。

---

## 1. 段階1：会場の切り出し＋見た目の変数

### 1.1 新しいファイル

#### `src/venues/types.ts`

```ts
import type { NozzleSpec, NozzleType } from '../core/nozzles';

export type Vec3 = [number, number, number];

/** 機材の並び（今の layout.ts の GroupDef をここへ移す。中身は同じ） */
export interface GroupDef {
  name: string;               // 'grid'
  type: NozzleType;
  spec: Partial<NozzleSpec>;
  positions: Vec3[];
  spray: number;
  mist: number;
  strands: number;
  burst?: number;
}

/** 行（エディタの1行）の見せ方。今の model.ts の LaneDef と同じ中身 */
export interface LaneStyle {
  group: string;
  name: string;               // 'グリッド'
  base: string;               // 帯の色
  accent: string;             // 行の見出しの色
}

/** 名前付きの並び。'@前列' で引く。値は今の対象の書き方 */
export interface Selection {
  name: string;               // '前列'
  target: string;             // 'grid[0-87]'
}

export interface SeatDef {
  id: string;                 // 'audience'（今の AngleName と同じ）
  label: string;              // '客席'
  pos: Vec3;
  target: Vec3;
  fov: number;
}

export interface ScreenDef {
  center: Vec3;
  width: number;
  height: number;
  dome: boolean;
  group: 'screen' | 'mound'; // どちらの対象に入るか
}

/** 花火の筒の並び（段階2で中身を使う。段階1では空の配列でよい） */
export interface PyroSite {
  name: string;               // '奥の台'
  kind: 'barge' | 'land';
  tubes: Vec3[];
}

export type WaterShape =
  | { kind: 'infinite' }                                   // 今のラグーン（岸なし）
  | { kind: 'rect'; width: number; depth: number }
  | { kind: 'circle'; radius: number }
  | { kind: 'strip'; width: number; depth: number }         // 川・港
  | { kind: 'roundedRect'; width: number; depth: number; radius: number };

export type ScaleTier = 'desk' | 'garden' | 'plaza' | 'lagoon';

export interface Venue {
  id: string;                 // 'lagoon'
  name: string;               // 'ラグーン'
  scale: ScaleTier;
  water: WaterShape;
  groups: GroupDef[];
  lanes: LaneStyle[];
  selections: Selection[];
  screens: ScreenDef[];
  pyro: PyroSite[];
  seats: SeatDef[];
}
```

#### `src/venues/lagoon.ts`

今の値を**そのまま**移す。

- `groups`：`layout.ts` の `GROUPS`（`line`・`band`・`arc` の関数ごと）
- `lanes`：`model.ts` の `LANES`
- `selections`：`model.ts` の `TARGET_PRESETS`。`{ target, name }` を `{ name, target }` に。名前は今の日本語のまま（`'前列'`、`'左アーク'`、`'ガイザー中央2本'` など）
- `screens`：`buildLayout` の中の4枚（横長1枚＝`group: 'screen'`、山3つ＝`group: 'mound'`）
- `seats`：`cameras.ts` の `ANGLES`（`label` 込み）
- `water: { kind: 'infinite' }`、`scale: 'lagoon'`、`pyro: []`

並べ方を作る関数（`line`・`band`・`arc`）は `src/venues/shapes.ts` に移し、ほかの会場でも使えるようにする。

#### `src/venues/index.ts`

```ts
export const VENUES: Record<string, Venue> = { lagoon: LAGOON };
export const DEFAULT_VENUE_ID = 'lagoon';
export function getVenue(id?: string): Venue { return VENUES[id ?? DEFAULT_VENUE_ID] ?? LAGOON; }
```

### 1.2 変えるファイル

| ファイル | 変更 |
| --- | --- |
| `src/show/layout.ts` | `buildLayout(venue: Venue = LAGOON, quality: Quality = 'high')`。`GROUPS` の代わりに `venue.groups`、水幕は `venue.screens` から作る（`groups.screen`・`groups.mound` の番号の振り方は今と同じ順）。`Layout` に `venue: Venue` と `selections: Record<string, string>`（名前 → 対象）を足す |
| `src/show/cues.ts` `resolveTarget` | 先頭が `@` なら `layout.selections` で今の書き方に直してから解く。カンマ区切りの中でも使える（`'@前列,whip'`）。名前の中に `@` を入れ子にしてよいが、深さ4で止める（循環を防ぐ）。見つからない名前は空（今の「無いグループ」と同じ扱い） |
| `src/show/types.ts` `ShowFile` | `version?: 2`、`venue?: string` を足す（どちらも省略可。無ければ v1・ラグーン） |
| `src/show/runtime.ts` | 作るときに会場を受け取る（`venue = getVenue(file.venue)`）。`buildLayout(venue, quality)` |
| `src/editor/model.ts` | `LAYOUT = buildLayout(LAGOON, 'low')`。`LANES = LAGOON.lanes`、`TARGET_PRESETS = LAGOON.selections.map(...)`（今の形 `{ target, name }` で出す）。**段階1では会場の切り替えはしない**ので、定数のままでよい。切り替えは段階5 |
| `src/show/cameras.ts` | `ANGLES` を `LAGOON.seats` から作る（キーと値は今と同じ）。`directShow` の 116 は `layout.screen.width` を渡す形にしてよいが、段階1では値が同じなのでそのままでもよい |
| `src/show/choreography.ts` | **書き換えない**（今の2つの版を守る）。新しい花火版から `@名前` を使う |

### 1.3 見た目の変数（G1〜G4）

#### `src/styles/tokens.css`（新しい）

今の値をそのまま変数にする。名前は意味で付ける（色の名前で付けない）。

```css
:root {
  /* 面 */
  --c-bg: #05070d;  --c-panel: #0b1019;  --c-panel-2: #101725;
  /* 線 */
  --c-line: #1c2638;  --c-line-2: #263247;
  /* 文字 */
  --c-text: #d6e4f7;  --c-text-dim: #7d8ca5;  --c-text-faint: #4b5871;
  /* 差し色・状態 */
  --c-accent: #4fc3ff;  --c-accent-2: #b06bff;  --c-warn: #ff6b6b;  --c-ok: #5ee39a;
  /* 時間軸（timeline.ts の canvas が読む） */
  --c-tl-bg: #0a0e17;  --c-tl-row-a: #0c111b;  --c-tl-row-b: #0e1420;  --c-tl-head: #18202f;
  --c-tl-grid: rgba(120,150,200,0.09);  --c-tl-grid-strong: rgba(120,150,200,0.22);  --c-tl-grid-faint: rgba(120,150,200,0.05);
  --c-tl-sel-fill: rgba(79,195,255,0.10);  --c-tl-sel-line: rgba(79,195,255,0.8);
  /* 書体・大きさ・余白・形 */
  --font-ui: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif;
  --fs-base: 13px;  --radius: 6px;  --line-w: 1px;
}
```

上の値は今の `editor.css` と `timeline.ts` から写したもの。実際に作るときは、`timeline.ts` の22か所、`scope.ts`、`inspector.ts`・`timeline.ts` のコードで付けているスタイル各7か所、`index.html` の `<style>` を全部見て、残りの色も変数にする。プレイヤー（`index.html`）の色（`--ink` など）は、同じ値なら同じ変数に、違う値なら `--c-player-*` として分けて持つ（ここでは値を揃えない。揃えるのは段階1.5）。

#### `src/ui/theme.ts`（新しい）

```ts
export interface Theme { tlBg: string; tlRowA: string; /* …変数と1対1 */ }
export function readTheme(): Theme  // getComputedStyle(document.documentElement) から読む
export function onThemeChange(fn: (t: Theme) => void): void  // 'themechange' イベントで読み直す
```

`timeline.ts`・`scope.ts` は、描くときに色の文字列を直に書かず、`theme.tlRowA` などを使う。

#### CSS の置き場

- `editor.css` の `:root` を `tokens.css` に移し、`editor.css` の頭で `@import` する。今の変数名（`--bg` など）を使っている所は新しい名前に置き換える
- `index.html` の `<style>` を `src/styles/player.css` に移し、`tokens.css` を読む

### 1.4 受け入れ条件

1. `npm run typecheck` が通る
2. 本番画面：`show=`（Night Lagoon）と `show=fantasia` の両方で、t = 10, 45, 63, 67.9, 92, 106.6, 130, 163, 175.5, 178.6, 206 を撮り、作業前と比べて `pixel-diff.py` で差がない（または、作業前に2回撮ったときの揺れ以下）
3. エディタ：`editor-check.mjs` が通り、作業前の撮影と差がない
4. エディタの自動保存（作業前に作ったもの）が、そのまま読める
5. `@前列` などを使ったキューを試しに1つ書いて、`grid[0-87]` と同じ機材が動く（確かめたら消す）

---

## 2. 段階1.5：新しい見た目

1. design-ref で `get_grammar`（媒体：画面）→ `search_references`（道具の画面、時間軸、照明卓、DAW）→ 上位を `get_reference` で画像ごと見る。お手本が無ければ、あなたにそう伝えて、何を集めるかを相談する
2. お手本から「余白の比率・情報の階層・密度・並べ方」を抜き出し、`tokens.css` の値と部品の形を変える。色・文言・ロゴは写さない
3. 撮って `design-reviewer` に渡し、お手本との差の上位5件を直す
4. 見せ方は「今｜案」の並べた画像

---

## 3. 段階2：花火

### 3.1 データ

```ts
// src/show/types.ts に足す
export type ShellName = 'botan' | 'kiku' | 'yanagi' | 'yashi' | 'ring' | 'senrin' | 'strobe' | 'comet' | 'mine';

export interface Fire {
  shell: ShellName;
  size: number;          // 号数（2.5〜10。机・庭では使えない）
  colors: string[];      // 1〜3色。2色目以降は「変化」（途中で色が替わる）
  count?: number;        // 連発の数（既定 1）
  interval?: number;     // 連発の間隔（秒、既定 0.25）
  angle?: number;        // 傾き（度、筒の並びに沿って左右に振る）
  seed?: number;         // 見た目の乱数の種（既定はキューの番号から作る）
}
// Cue に fire?: Fire を足す。t は開花の時刻、target は筒（'pyro'、'pyro[0-4]'、'@奥の台'）
```

- 筒は水の機材（`fixtures`）とは別に持つ。水の機材の数（`channels`）を変えると、`ParamHistory` のテクスチャや `JetField` に響くため
- `Layout` に `tubes: { index, site, position }[]` と `pyroGroups: Record<string, number[]>` を足す。`groups.pyro`（全部）と、筒の並びごとの名前（`pyro:奥の台`）を作る
- `resolveTarget` の花火版として `resolveTubes(target, layout)` を作る（書き方は同じ。`@名前` も使える）

### 3.2 玉の表 `src/pyro/shells.ts`

号数ごとの値（2026-11-03 出典を当てて確かめた。高さ・直径は花火業者・解説の「約」の値）

| 号数 | 玉の直径 cm | 開花の高さ m | 開花の直径 m（資料） | 描く直径 m（×0.82） | 上昇時間 s | 保安距離 m（使う値） | 参考：三重の基準 / NFPA 1123 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2.5 | 7.5 | 90（80〜100） | 50 | 41 | 3.3 | 100 | 65 / 63 |
| 3 | 9 | 120 | 60 | 49 | 3.8 | 140 | 100 / 76 |
| 4 | 12 | 160 | 120（120〜130） | 98 | 4.4 | 150 | 110 / 101 |
| 5 | 15 | 190 | 170（150〜180） | 139 | 4.8 | 220 | 180 / 126 |
| 6 | 18 | 220 | 220 | 180 | 5.2 | 250 | 190 / 151 |
| 7 | 21 | 250 | 240 | 197 | 5.5 | 250 | 210 / 176 |
| 8 | 24 | 280 | 280 | 230 | 5.9 | 250 | 210 / 202 |
| 10 | 30 | 330 | 310（300〜320） | 254 | 6.4 | 300 | 240 / 252 |

- **描く直径**（2026-11-03、ユーザーの「リアルな大きさにして」）：実物の写真2枚（コモンズの大曲の10号・長岡の尺玉、`shots/stage2/real/`）と、資料の大きさで描いた今回を、同じ測り方（開いた幅 ÷ 遠くの地平からの高さ）で比べた。実物は 0.70・0.72〜0.74、今回は 0.87。資料の直径は「約」で大きめに出ていると見て、全部の号数を 0.82 倍で描く（`PHOTO_SPREAD`）。測れたのは10号だけで、ほかの号数も同じ割合と仮定している
- 玉の直径：1号 = 3 cm（神奈川県の基準の数え方。1寸 ≈ 3.03 cm）
- 高さ・直径：[kakizonofireworks](https://kakizonofireworks.com/large-fireworks/)、[pricey.jp](https://www.pricey.jp/web/articles/2131)、[Walkerplus](https://www.walkerplus.com/article/23366/)。食い違い：2.5号の高さ 80〜100 m、2.5号の直径 50 m（70 m の資料もある）、4号 120〜130 m、5号 150〜180 m、10号 300〜320 m。仮の表から、7号の直径を 220 → 240 m に直した
- 上昇時間：直接の資料は「尺玉（10号）で5〜7秒」だけ（[fukubayfield](https://hanabi.fukubayfield.com/archives/660)）。ほかは t ≈ 0.35·√高さ で出した（空気抵抗なしの頂点の時間 √(2h/g) より短い。玉は頂点の少し手前で開く）
- 保安距離：**神奈川県の煙火消費保安基準の A 種（打ち上げ方に制限なし）の割物の値**を使う（[神奈川県 別表1](https://www.pref.kanagawa.jp/documents/14956/kijun.pdf)）。警告は安全側に倒す。参考に、三重県の基準（[三重県](https://www.pref.mie.lg.jp/common/content/001247484.pdf)）と、NFPA 1123 の「筒の内径 1インチあたり 70 ft」（[OAR 837-012-0840](https://oregon.public.law/rules/oar_837-012-0840)、[OnePlan](https://www.oneplan.io/articles/?p=368)。号の cm をインチにして計算）を並べた。ぽか物（柳など）はもっと短くてよいが、ここでは割物の値で揃える
- 警告は目安で、実際の許可の代わりにならない（dev-plan F）
- 星の数・燃える時間・柳や千輪の大きさは、出典が見つからなかった。下の表は見た目で合わせた値

間の号数は表から補間する。玉の種類ごとの値：

| 種類 | 星の数 | 星の空気抵抗 k (1/s) | 燃える時間 s | 尾 | 備考 |
| --- | --- | --- | --- | --- | --- |
| 牡丹 botan | 号数×60 | 1.2 | 1.6 | なし | 球に一様 |
| 菊 kiku | 号数×60 | 1.2 | 1.8 | 短い | 球に一様 |
| 柳 yanagi | 号数×40 | 2.5 | 4.5 | 長い | 金、垂れて残る |
| 椰子 yashi | 8〜12 | 0.8 | 2.5 | 太く長い | 少ない重い星 |
| 型物 ring | 号数×40 | 1.2 | 1.5 | なし | 1つの面の円 |
| 千輪 senrin | 小玉 20 | — | — | — | 0.8秒後に小玉が開く（小玉は牡丹の1.5号相当） |
| 点滅 strobe | 号数×50 | 1.2 | 2.5 | なし | 星が 8〜14 Hz で点滅、星ごとに位相をずらす |
| 彗星 comet | 1 | — | — | 長い | 上がるだけ。開かない |
| スターマイン mine | — | — | — | — | 小さい玉（2.5〜3号）を `count` 発、`interval` で。種類は colors の順に回す |

### 3.3 組み立て `src/pyro/schedule.ts`

`compileShow` の中で `fire` のあるキューを集め、`bursts: Burst[]`（開花の時刻の順）を作って `CompiledShow` に足す。

```ts
export interface Burst {
  id: number;
  tLaunch: number;       // 打ち上げ = tBurst − 上昇時間
  tBurst: number;
  tube: number;
  origin: Vec3;          // 筒の位置
  center: Vec3;          // 開く位置（高さと傾きから）
  shell: ShellName;
  size: number;
  radius: number;        // 開いたときの半径 = 直径/2
  colors: [number, number, number][];
  stars: number;
  k: number;
  burn: number;
  seed: number;
  parent?: number;       // 千輪の小玉なら親
}
```

- `count`・`interval` と複数の筒は、ここで1発ずつに分ける。千輪の小玉もここで作る（乱数の種から決まるので、毎回同じ）
- 開く位置：筒から、傾き `angle` の方向へ、表の高さまで（傾いた分だけ横にずれる）
- 判定（F）：筒から一番近い客席までの距離 < 保安距離 なら `warnings` に赤で入れる（キューは消さない）

### 3.4 描画 `src/techniques/fireworks.ts`

**時刻だけで決める**：星の位置は、空気抵抗を線形（`k`）とした式で、その場で解く。

```
v(τ) = (v0 + g/k)·e^(−kτ) − g/k
p(τ) = center + (v0 + g/k)·(1 − e^(−kτ))/k − (g/k)·τ      （τ = t − tBurst、g = (0, −9.81, 0)）
```

重力がなければ星は半径 `|v0|/k` で止まるので、`|v0| = k × radius` とすると、開いた大きさが表の直径に合う。

- 星の方向：`hash(seed, 星の番号)` から。牡丹・菊は球に一様、型物は1つの面の円、椰子は少ない方向に太く
- 尾：同じ式で τ − 0.04×n（n = 1〜6）の位置も計算し、細い帯にする。柳は n を長く、垂れる
- 上昇：`tLaunch`〜`tBurst` は、筒から開く位置までの昇り（曲導）を細い光の線で描く。上昇の軌跡は等加速度の近似でよい（高さと時間が表に合うこと）
- 明るさ：開いた瞬間の閃光（0.08秒）＋星の燃える時間で弱まる。最後の 20% で消える。点滅は `step(0.5, fract(t × f + 位相))`
- 色：`colors[0]` から、2色目があれば燃える時間の半分で替わる
- GPU の作り：花火の予定のうち、今見えているもの（`tLaunch ≤ t ≤ tBurst + burn × 1.2`）を最大 `MAX_ACTIVE = 48` 発まで選び、1発あたり4画素の浮動小数のデータテクスチャに書く（開く位置、時刻、半径、k、燃える時間、色3つ、種類、種）。星はあらかじめ `MAX_ACTIVE × 最大星数` 個のインスタンスを作っておき、頂点シェーダーが「何発目の何番目の星か」から位置を計算する。使わない星は画面の外に捨てる
- 画質段階：高 1.0、中 0.55、低 0.25（今の `QUALITY_SCALE`）で星の数を間引く
- 加算合成で描き、今のブルームで滲ませる。リアルの明るさは仮に「白の水柱の明るさの 3〜6 倍」から始め、撮って合わせる。理想では 1.3 倍
- 水面の映り：`Reflector` は場面をもう一度描くので、花火を場面に入れれば映る

### 3.5 照らす

- 水面の照明（`stage.ts` の `MAX_POOL_LIGHTS = 32`）：今の水の機材の光と枠を分け合う。開いた瞬間の明るさが大きい花火から、最大8枠を花火に回す。今の枠の割り当て方を最初に読んで決める
- もや（`haze.ts`）：同じ光を、もやの明るさにも足す。読み方は段階2の最初に `haze.ts` を読んで決める

### 3.6 煙 `src/techniques/smoke.ts`

- 1発ごとに、開く位置のまわりに 8〜16 枚の雲の板（`mist.ts` の雲の板の作りを使う）。配置は種から決める
- 位置 = 開く位置 + 風 × (t − tBurst)、大きさは時間で広がる、20〜40秒で薄くなって消える
- 自分の色はほぼ黒〜灰。今光っている花火（データテクスチャの閃光）と、照明の光を受けたときだけ明るく見える
- 風は会場ごとの値（向きと強さ。既定は弱い横風 1.5 m/s）

### 3.7 音 `src/audio/pyro.ts`

水の音（`src/audio/splash.ts`）と同じく、キューから前もって音を作り、曲の下に流す。流し方は `splash.ts` を読んで同じ形にする。

- 遅れ：客席（今の席の位置）から、打ち上げ場所・開く位置までの距離 ÷ 343 m/s
- 打ち上げ：低い「ポン」（50〜80 Hz の短い減衰）＋任意で「ヒュー」（上がる音程の笛、上昇時間ぶん）
- 開花：「ドン」＝ 低い正弦（60 → 35 Hz に下がる）＋ 帯域を絞った雑音の一撃。号数で大きく・低く
- 返り：会場の景色の距離から、0.3〜1.5秒後に弱い返りを2〜3回
- パチパチ：千輪・点滅は、短い雑音の粒を並べる
- 大きさ：しっかり響かせる（決定）。曲に合わせて小さくはしない。音割れだけ防ぐ（全体の最大で抑える）

- 2026-11-03 作り直し（2回目）：「ドン」を実物の録音の解析から作る（`.claude/skills/sound-design`）。手本は Commons の録音から拾った単独のドーン25発の、10帯域の音量の時間変化の中央値（背景を引いた）。合成は帯域ごとのノイズ（6段の帯域フィルタ）にその曲線を掛け、尾に測った揺らぎを足す。値は `src/audio/pyro-boom.json`（`scripts/sound/fit.py` が作る。trim_db は比べて直した分）、号数で伸ばす・低音を足すのは耳で（`STRETCH`・`LOW_DB`）。最後は音量を下げるリミッター（`CEILING` 0.9）。音量は `src/audio/levels.ts`（音楽・水音・花火）とプレイヤーの「音量▾」

### 3.8 エディタ

- 行：会場の `lanes` に `{ group: 'pyro', name: '花火', ... }` を足す
- 帯：開花の時刻に菱形、その前の上昇時間を薄い帯で。色は `colors[0]`
- インスペクター：種類・号数・色（最大3）・数・間隔・傾き・種。号数を変えたら、保安距離の警告をその場で出す
- `PlainCue` に花火のキューを表す形（`kind: 'fire'`）を足す

### 3.8b 作ってみて決めたこと（2026-11-03）

- 星の速さ：抵抗があると星は |v0|/k に近づくだけなので、燃える時間の 80% で表の半径に届く速さ |v0| = k·R/(1−e^(−0.8·k·燃焼)) にした
- 1発あたりのデータは8画素（設計の4画素では足りなかった）。`MAX_ACTIVE = 48`、星は1発 600 まで
- 水面の照明：今の32枠は水幕の足元の光（狭いぼかし）なので分け合わず、花火用に別の8枠（`MAX_SKY_LIGHTS`、上からの光 h/r³）を作った。もやは同じ光の合計を1つの色で足す
- 水面ともやの花火の光は `#ifdef` で、花火のある演出のときだけシェーダーに入れる。0を足すだけでも、シェーダーが変わると数画素が1段ずれたため
- 音は水音と同じ「先に作って曲の下に流す」形。時計（`clock.ts`）に花火用の2本目の層を足した（水音ボタンでは消えない）。音は号数ごとに1つ作って使い回す（1発ずつ作ると 8.5 秒かかった。今は 0.6 秒）
- 保安距離の判定は、会場の `audience`（客席の前の縁の線）から筒までの水平距離。ラグーンは岸 z = 45。筒は「奥の台」（z = −110、4号まで）と「奥の陸」（z = −260、10号まで）
- 一番重い場面（噴水を全部＋花火）は 20 ms。花火と煙を外しても 20 ms で、重さは噴水の側（今の試験用の演出 `?show=test` も 19.5 ms）

- 見た目（2026-11-03、並べた画像で決めた）：星の芯は白くしない、尾は星の色（金は15%）、煙は最初に置いた値の2倍、明るさはリアルで1倍・理想で1.3倍のまま

### 3.9 受け入れ条件

1. 号数ごと（2.5、5、10）に1発ずつ打ち、客席から撮る。開花の大きさが表の直径に合っている（撮った画像から測る）
2. 「実物の写真の大きさ｜今回」の並べた画像をあなたに見せる
3. 同じ時刻へ飛んだとき、続けて再生したときと同じ絵になる（撮って比べる）
4. 一番重い場面で、フレーム時間が 16 ms 前後を大きく超えない
5. 動画書き出しに映る
6. Night Lagoon・ファンタジア版は1画素も変わらない

---

## 4. 段階3：花火版の演出

### 4.0 打ち上げの角度（2026-11-03、済み）

1つの台から色々な角度で打てるようにした。値は `src/pyro/shells.ts` の `ANGLE`、計算は `src/pyro/schedule.ts` の `aim`。

- `Fire.tilt`：前後の傾き（度、客席へ +、奥へ −）。`angle`（左右）と合わせて、筒の向き = (sin 左右·cos 前後, cos 左右·cos 前後, sin 前後)
- `Fire.pattern` と `Fire.spread`（既定 40°）：筒（左から右へ、立っている位置の順に並べ直す）への角度の配り方
  - 扇 `fan`：左端 −広さ/2 〜 右端 +広さ/2、同時
  - V字 `v`：左半分は左へ、右半分は右へ（中央はまっすぐ）
  - X字 `x`：左半分は右へ、右半分は左へ（交差）
  - 順に振る `sweep-lr`・`sweep-rl`・`sweep-out`：間隔ごとに1発ずつ、扇の中を左→右・右→左・中央から外へ。連発（数 > 1）なら各筒の連発の中で、1発ずつなら筒の間で振る
  - 型なしは今までどおり（スターマインは連発の中で ±angle を左→右）。乱数の呼び方も変えていないので、試し打ちの花火は前と1つも違わない（全部の玉の位置を比べた）
- 判定（F）：
  - 赤 `tube`：筒から客席まで < 保安距離（前と同じ）
  - 赤 `burst`：傾けたとき、開く位置の真下（星と不発玉が落ちる範囲の中心）から客席まで < 保安距離（目安。揺らぎを除いた角度で見る）
  - 赤 `toward`：客席の側へ傾けている（止めはしない）
  - 黄 `steep`：まっすぐから 30° を超える。45° を超える分は 45° で止める
- エディタ：インスペクターに「傾き 左右」「傾き 前後」「角度の型」「広さ」。注意は赤と黄の帯で、時間軸の花火の枠も赤（点線）・黄で囲む
- 確かめ：`scripts/pyro-angle-shots.mjs` → `pyro-angle-sheet.py`（打ち上げから開くまでを重ねた絵。`shots/stage3/angles/sheet-patterns.jpg`・`sheet-tilt.jpg`）、`scripts/pyro-angle-editor.mjs`（インスペクターで型と傾きを選び、赤・黄の注意が出るか）

- `SHOW_VARIANTS` の `hanabi` を本物の花火版にした（2026-11-03）。`buildShow(music, 'hanabi')` は Night Lagoon と同じキューを作り、最後に `src/show/hanabi.ts` の `hanabiFireworks()` を足す。プレイヤーは `?show=hanabi`、エディタはファイルのメニューから。段階2の試し打ちは `?show=pyrotest`（`src/show/pyrotest.ts`）へ移し、確かめの道具の URL も直した
- 土台：**Night Lagoon を写して、花火を足す**（ユーザーが決めた、2026-11-03）
- 入れたもの・理由・確かめたことは `docs/show-plan.md` の「花火版」。見本の席として「花火と水」（`sky`、岸の後ろ 200 m）を足した。客席の席では花火が画面の上に出てしまうため
- ラグーンの花火の筒（案）：水幕の後ろの台（z = −45、客席から約110 m → 3号まで）と、奥の陸（z = −180、約245 m → 7号程度まで）。保安距離の判定がそのまま見せ場の制約になる
- 入れどころは show-director の流れで決める（演出台本 `docs/show-plan.md` に花火版の節を足す）。候補：フィナーレの階段（163 → 167 → 169.5）、ラストのサビ（178.54）、最後の和音（205.99）
- 見せ方は「今｜案」と連続コマ

---

## 5. 段階4：実機向けの書き出し

2026-11-03 作った（D1・D2・D6・D5・D3・D4）。この節は作った後の形に直してある。前 `backups/2026-11-03-pre-export/`。

### 5.1 共通

置き場 `src/export/control/`（形式ごとに1ファイル）。

```ts
// src/export/control/types.ts
export const FPS_CHOICES = [40, 30, 25, 44] as const; // 40 は ParamHistory の RATE
export interface ExportOptions {
  fps: number;              // コマ数
  timecodeStart: string;    // ショーの 0 秒のタイムコード 'HH:MM:SS:FF'
  range?: [number, number]; // 秒。無ければ全編
}
export interface ControlExporter {
  id: 'channels-csv' | 'dmx-patch' | 'cue-sheet' | 'pyro-csv' | 'dmx-record';
  label: string; hint: string; ext: string; mime: string;
  timed: boolean;                                  // 時間の表か（割り当て表は false）
  estimate(show, layout, opts): number;            // おおよその大きさ
  run(show, layout, opts): AsyncIterable<string | Uint8Array>; // 少しずつ出す
  notes?(show, layout, opts): string[];            // 書き出す前の黄色い注意
}
```

- 値は全部 `evaluate(show, fixture, channel, t)` から。使う `show` はエディタのプレビューが描いているもの（`preview.rt.show`）そのもの。音楽の解析（「追従」キューの値）が済むまで書き出せない
- 時刻はショー全体のコマの格子（k / fps）。範囲を指定しても格子は同じなので、部分は全体とそろう
- タイムコード（D7）：`HH:MM:SS:FF`、ドロップフレームなし、24 時間で一周。コマ数と開始はどの書き出し（Art-Net も）も同じ設定で、ブラウザが覚える（`localStorage` の `water-show-export-timecode`、`src/export/control/index.ts`）
- 入口はエディタの「書き出し ▾」だけ（5形式と「Art-Net で送る…」）。プレイヤーの「動画を書き出す」はそのまま。画面は `src/editor/control-export.ts`、見た目は `editor.css` の末尾（tokens の変数だけ）
- 保存：`npm run dev` では開発サーバーへ 4 MB ずつ送って `exports/control/` に書く（`scripts/control-store.ts`、`/__control/start・append・end・cancel・reveal`、同じ名前は `-2` を付ける）。ビルドした画面ではダウンロード
- ファイル名：`<題名>_<形式>[_<fps>fps][_<始め>-<終わり>s].<拡張子>`
- 日本語の入る CSV（D2・D6・D5）は BOM つき UTF-8（表計算ソフトで文字化けしない）。行の終わりは CRLF
- 日本語の言い方（マクロ・パラメータ・角度の型・映像）はエディタと同じ名前（`src/editor/model.ts`）を使う（`words.ts`）

### 5.2 D1 チャンネル CSV（`channels-csv.ts`）

- 1行目：`time_s,timecode,grid[0].pressure,grid[0].pan,…,grid[0].intensity,grid[1].pressure,…`
- 列は機材の順 × `CHANNELS`（pressure, pan, tilt, r, g, b, intensity）。名前は組の中の番号（`grid[0]`…`geyser[9]`、水幕は `screen[0]`、`mound[0..2]`）
- 単位：圧力 0〜1、pan・tilt は**度**、色 0〜1（リニア。LED の駆動はこの値に比例）、明るさ 0〜1（理想の照明では 1 を超える。例 1.7）
- 小数3桁、末尾の 0 は省く（`0.5`、`0`）
- 実際の大きさ：ラグーン全編 40 fps で 8,681 行 × 2,634 列、約 77 MB（見積もりの 150 MB の半分）。ブラウザで 1.5 秒

### 5.3 D2 DMX の割り当て表（`profiles.ts`・`dmx-patch.ts`）

機材の種類ごとのチャンネルの並び（`PROFILES`、1か所）：

| 種類 | 並び | 数 |
| --- | --- | --- |
| vertical（グリッド） | ポンプ, R, G, B, 明るさ | 5 |
| oscillating（ウィップ） | ポンプ, 左右(16bit), 前後(16bit), R, G, B, 明るさ | 9 |
| shooter（チェイサー・ガイザー） | 弁, R, G, B, 明るさ | 5 |
| fan（ファン） | 弁, 左右(16bit), 前後(16bit), R, G, B, 明るさ | 9 |
| ring（フラワー） | 弁, 開き(16bit), R, G, B, 明るさ | 7 |
| mist | ポンプ, R, G, B, 明るさ | 5 |
| 水幕 | ポンプ, 映写の明るさ | 2 |

- 設計と変えた所：演出の中でファンは左右に ±35° 振れ、フラワーは 0〜32° 開く（`bloom`）。だからファンに左右・前後、フラワーに「開き」を足した
- 値の直し方：0〜1 → 0〜255。16bit は可動範囲を 0〜65535 に（上位・下位の順）。可動範囲（`HEAD_RANGE`）：ウィップ・ファン ±55°、フラワーの開き 0〜90°
- 範囲の外（明るさ 1 を超える、可動範囲を超える）は端で止め、書き出す前に黄色い注意を出す（`clipNotes`。キューの区間の始めと終わりの値から出すので、全部のコマを調べなくてよい）
- 割り当て：機材の順に番地を詰める。1台がユニバースの境（512）をまたがない。ユニバースは 1 から（Art-Net の番号は 0 から。表には両方）。ラグーンは 4 ユニバース（510・510・507・497 チャンネル）
- 会場に `patch`（組ごとの始まりのユニバースと番地、`src/venues/types.ts`）があれば、その組はそこから詰め、残りは使った番地の後ろに自動。重なりは注意に出す。ラグーンには無い
- CSV の列：`fixture,group,index,type,universe,artnet_universe,address,footprint,channels`。index は組の中の番号、channels は `1 ポンプ / 2 左右(上位) / 3 左右(下位) / …`

### 5.4 D6 キュー表（`cue-sheet.ts`）

- 列：`time_s,timecode,section,target,what,label`
- ファイルのキュー（展開する前）で1つ1行、時刻の順（同じ時刻はファイルの順）。範囲を指定すると、その中で始まるキューだけ
- `section` は演出の区間（`sectionSpans`）、`target` は会場の名前付きの並びに一致すればその名前（`前列`、`奥の台`）、無ければ今の書き方
- `what` の例：`水圧 0.04（1.5秒）・時差 0.008秒 中央から`、`傾け（角度 -30°・動く時間 0.7秒・保持 0.1秒・戻り角度 0°）`、`菊 3号 赤・扇 40°`、`映像 物語 — 紙の船と月`
- 花火の色は近い色の名前（赤・橙・金・黄・緑・シアン・青・紫・マゼンタ・ピンク・銀・白）。水の色は `#rrggbb`

### 5.5 D5 花火の点火表（`pyro-csv.ts`）

- 列：`event,launch_s,launch_tc,burst_s,site,tube,x,y,z,angle,tilt,shell,size_gou,colors,warning`（設計に `tilt` を足した）
- 行は描いている玉（`CompiledShow.bursts`）を打ち上げの順に。千輪の小玉は書かない。打ち上げ = 開く時刻 − 上がる時間
- `tube` は台の中の番号（左から 0）、`x,y,z` は筒の位置。`angle`（左右、+ が舞台右）・`tilt`（前後、+ が客席へ）は、筒から開く位置への向きから出す（描いている玉の角度そのもの。少しの揺らぎも入る）
- `shell` は玉の id（`kiku` など）、`colors` は色の名前、`warning` は保安距離・傾きの警告の文
- Finale 3D・FireOne・Cobra の形式は後で

### 5.6 D3 DMX の記録（`dmx-record.ts`）

- 形式（独自・説明つき）`.dmxrec`：1行目に JSON と改行 `{"format":"dmxrec","version":1,"fps":40,"universes":[1,2,3,4],"timecodeStart":"…","firstFrame":0,"frames":8681,"show":"…","layout":"…"}`、その後にコマごと × ユニバースごとの 512 バイト。コマ k はショーの k / fps 秒
- 値は D2 の並びと直し方のとおり（`dmxFrame`、D4 と同じ関数）
- 大きさ：ラグーン全編 40 fps で約 18 MB。D1 と同じ仕組み（`control-store.ts`）で書く
- 市販のソフトはそのままでは読めない。役目は、DMX でも画面と同じ値が出ているかの確かめと、D4 の元。卓や再生機の形式への変換は、使う機材が決まってから

### 5.7 D4 Art-Net の生出力（`artnet.ts`・`scripts/artnet-bridge.ts`）

- 開発サーバー（Vite のプラグイン、`npm run dev` のときだけ）に WebSocket `/__artnet`。足す部品なし（WebSocket の受け口は自前の数十行）
- ブラウザは、タイムコードの設定のコマ数（既定 40）で毎秒その回数、今の時刻をコマの格子にそろえた DMX を送る：`[Art-Net の番号(2バイト、上位から)][512バイト]…`。再生・一時停止・移動のどれでも送り続ける。格子にそろえるので、送る値は D3 の記録のどれかのコマと1バイトも違わない
- 送り先の設定はテキストで `{"host":"127.0.0.1","port":6454}`（既定）。ブラウザが覚える（`water-show-artnet-target`）。サーバーは毎秒、送った数とエラーを返す
- サーバーは ArtDmx の形にして UDP で送る：`"Art-Net\0"`（8）、OpCode `0x5000`（下位から、2）、ProtVer 14（上位から、2）、Sequence（1〜255、ユニバースごと）、Physical 0、SubUni（番号の下位8bit）、Net（上位7bit）、Length 512（上位から、2）、データ
- 画面：「書き出し ▾」→「Art-Net で送る…」（送り先・送る・止める・送信中の様子）。送っている間は上の帯に「Art-Net 送信中」
- 受ける道具 `scripts/artnet-listen.mjs`：毎秒の受信数と先頭の値を出す。`--compare=<.dmxrec>` で、受けたユニバースの組が記録のコマと同じかを数える

### 5.8 受け入れ条件（確かめ方）

`node scripts/control-check.mjs [--show=lagoon|fantasia|hanabi] [--format=…] [--range=a-b] [--fps=40] [--tc=HH:MM:SS:FF]`（開発サーバーが要る）。エディタの「書き出し」を人と同じ手順で動かし、`exports/control/` のファイルを読み戻して、同じページの `evaluate()` と比べる。

- D1：見出し、行の数（k / fps の格子）、全部の行の時刻とタイムコード（書き出しとは別の計算）、400 行の全部の値が 0.001 以内
- D2：機材の数、並びの数が `PROFILES` どおり、512 をまたがない、重ならない
- D6：キューの数・順・時刻・タイムコード・区間・ラベルがファイルどおり
- D5：玉の数・順・打ち上げと開く時刻・タイムコード・台・玉・号数が描いている玉どおり
- D3：見出しと大きさ、400 コマの全部の値が、`evaluate()` を範囲で止めた値と 8bit は 1/255、16bit は 1/65535 以内（書き出しとは別に直して比べる）
- D4：UDP 6454 で受け、止めた状態で 20 コマへ移動してそれぞれ記録と1バイトも違わない、3 秒の再生で受けた組が全部記録のコマと同じ、毎秒の組の数 = コマ数

2026-11-03：3つの版とも、40・30・25 fps、全編と範囲で通過。3D の絵は Night Lagoon・ファンタジア版（各11コマ、`shots/stage2/same` と）・花火版（17コマ、`shots/stage3/hanabi/compare` と）で0画素の差。

---

## 6. 段階5：会場の編集

（2026-11-05、作った後の形に直した。前の案との違いは各節の「設計と変えた所」）

### 6.1 会場のファイル `src/venues/parts.ts`

会場は部品を並べた JSON。組み込みの会場は `src/venues/builtin/*.json`（置けば一覧に加わる。`import.meta.glob`）、自分の会場は localStorage（`water-show-venues:v1`、`src/venues/store.ts`）と JSON の書き出し・読み込み。`buildVenue(doc)` が部品から `Venue`（1.1 の型）を作る。ラグーンも `lagoon.json` から作り、前の手書きと1ビットも違わない。

```ts
interface WaterPart { group: string; fixture: string; name?: string; skip?: number[]; nudge?: { i: number; by: [number, number] }[]; note?: string }
export type Part =
  | (WaterPart & { kind: 'line';   count: number; from: [number, number]; to: [number, number] })              // 列
  | (WaterPart & { kind: 'band';   count: number; from: [number, number]; to: [number, number]; pitch: number }) // 帯（2列の千鳥）
  | (WaterPart & { kind: 'arc';    count: number; center: [number, number]; radius: number; a0: number; a1: number }) // 弧（度）
  | (WaterPart & { kind: 'ring';   count: number; center: [number, number]; radius: number; a0?: number })      // 円
  | (WaterPart & { kind: 'single'; at: [number, number] })                                                      // 1台
  | { kind: 'screen'; fixture: 'screen' | 'mound'; center: [number, number]; width: number; height: number; name?: string } // 水幕（1枚ずつ）
  | { kind: 'pyro'; site: string; on: 'barge' | 'land'; tubes: number; from: [number, number]; to: [number, number]; height: number } // 花火の台
  | { kind: 'seats'; from: [number, number]; to: [number, number]; name?: string };                             // 客席（最前列の線）

export interface VenueDoc {
  id: string; name: string; scale: ScaleTier; water: WaterShape; parts: Part[];
  selections?: Selection[]; cameras?: (SeatDef & { note?: string })[]; wind?: Vec3; patch?: Venue['patch']; note?: string;
}
```

- 同じ `group` の部品は順につながる（番号は前の部品の続き）。1つのグループに違う種類を混ぜると組み立てられない
- 外す（`skip`）：並びの中の1台を抜く。後ろの番号は詰まる。ずらす（`nudge`）：並びの中の1台を [dx, dz] 動かす
- 名前の付いた部品は、自動で名前付きの並びになる（`@前列`）。手で書いた並びが先で、同じ名前・同じ中身は足さない
- カメラが無い会場は、客席と部品から6つ作る（客席・遠景・目線・左・右・空撮、`autoCameras`）
- プレイヤーは `?venue=<id>` でその会場で流す（カメラは会場のものに替え、無い席は近いものに）

設計と変えた所：水幕は「横長か山か」の1部品でなく1枚ずつ。花火の台は `on` と台の高さ `height`。客席は「前・左右・囲む」でなく最前列の線。風は向きと速さでなく Vec3 のまま。`equipment`（機材の組）は持たず、機材は部品ごとに種類の表から選ぶ（6.4）。1台・外す・ずらす（B9）を足した。

### 6.2 画面 `venue.html`（`src/venues/editor/`）

- 上：会場 ▾（組み込み・自分の会場・新しい会場・写す・JSON の書き出しと読み込み・消す）、元に戻す／やり直す、← 時間軸、3Dで見る
- 左：会場の名前・規模（机・庭・広場・湖）・水面の型と大きさ、部品の一覧（グループごと、警告の印つき）、＋ 部品を足す ▾
- 真ん中：真上から見た図（canvas）。選ぶ・動かす／1台を置く。吸い付きは机 1 cm・庭 5 cm・広場と湖 0.5 m、角度 15°（Alt で外す）。部品をつかむと部品ごと動き、選んだ部品の中の1台をクリックすると1台を選ぶ（ドラッグでずらす、Delete で外す）。右ドラッグ・空いた所のドラッグで動かし、ホイールで拡大
- 右：選んだ部品の値、選んだ1台（ずらす・外す・戻す）、警告の一覧と「警告は目安で、実際の許可の代わりにはなりません。」
- 下：機材の数・水幕・花火の筒・ポンプの合計・飛沫の粒、右に動かないキューの数（6.5）
- 組み込みの会場は読むだけ。最初に変えたとき「〇〇の写し」を作る
- 止めるがある間は「3Dで見る」を押せない（保存は続ける）
- エディタ（edit.html）の上の帯に「会場 ↗」

### 6.3 判定（F）`src/venues/rules.ts`

| 段階 | 名前 | 計算 |
| --- | --- | --- |
| 止める | 組み立てられない | `buildVenue` が失敗（1つのグループに違う種類など） |
| 止める | 水の外 | 機材・水幕が水面の外（水面の型ごとの式。1台にも効く） |
| 止める | 置き場の違い | 陸の花火の台が水の上、水上の台が水の外 |
| 止める | 重なり | 同じ種類どうしが、種類の表の最小間隔より近い |
| 止める | 同じ場所 | 違う種類が、小さい方の最小間隔の 1割より近い |
| 赤 | 花火の保安距離 | 2.5号の保安距離も足りない。台ごとに「〇号まで／打てない」を図と右の欄に出す（`maxSizeAt`） |
| 赤 | 水が客席に届く | 着水の一番遠い点 2h·sin2θ（θ は種類の最大の傾き、45° まで）＋飛沫の余裕（高さの 20%）が客席に入る。客席側へ倒せる角度も出す |
| 赤 | 花火が水幕にかかる | 開く位置と半径の球が水幕の箱にかかる |
| 黄 | 近すぎ | 違う種類が、小さい方の最小間隔の 4割より近い（種類の組ごとに1つ） |
| 黄 | 水盤の外に落ちる | 縁までの距離 < max(高さ, 着水点＋飛沫の余裕) |
| 黄 | ポンプの合計 | 種類ごとの流量 × 数 > 規模ごとの目安（机 0.3・庭 5・広場 150・湖 5,000 L/s） |
| 黄 | 描画の重さ | 飛沫の粒（画質「高」）の合計 > 45万 |
| 黄 | 客席が無い | 花火と飛沫を確かめられない |

仮の数字（飛沫の余裕・同じ場所／近すぎの割合・ポンプと粒の目安）は `rules.ts` の頭にまとめた。ラグーンは止める 0・赤 1（ウィップを客席側へ全開で倒すと 60 m 先、客席まで 39 m、客席側へは 15° まで）・黄 2（グリッドとチェイサー 0.23 m、ウィップとチェイサー 0.36 m）。

設計と変えた所：組み立てられない・同じ場所・近すぎ・水盤の外に落ちる・客席が無いを足した。種類の表に最大の傾き `lean`（ウィップ・ファン 45°、フラワー 29°）を足した。

### 6.4 規模の段の機材と見本の会場

機材の組（`equipment`）は持たず、小さい規模の種類を機材の種類の表（`src/fixtures/water.ts`）に足した。どの会場でもどの種類でも置ける。数字はすべて仮。

| 種類 | 規模 | 型 | 高さ | 最小間隔 | 流量 | 最大の傾き |
| --- | --- | --- | --- | --- | --- | --- |
| ミニ噴き上げ `desk-jet` | 机 | 垂直 | 0.1 m | 0.03 m | 0.007 L/s | 0° |
| 庭の噴き上げ `garden-jet` | 庭 | 垂直 | 1 m | 0.25 m | 0.2 L/s | 0° |
| 小さい扇 `garden-fan` | 庭 | 扇（首は振らない） | 0.5 m | 0.5 m | 0.3 L/s | 45°（水の開き） |
| 床の噴き上げ `floor-jet` | 広場 | 垂直 | 4 m | 1 m | 1.8 L/s | 0° |
| 床の首振り `floor-whip` | 広場 | 首振り | 6 m | 1.5 m | 3.4 L/s | 20° |

- 高さは見本の会場で縁を越えない値（高さ ≤ 縁までの距離、fountain-layout）。机の小型ポンプは 0.1〜0.6 m まで上がるが、60 × 30 cm の水槽では 0.1 m
- 流量は口の面積 × その高さに届く速さ（Q = A·√(2gh)）

見本の会場（`src/venues/builtin/`、一覧は机・庭・広場・湖の順）。どれも止める・赤・黄が 0。グループの名前はラグーンにそろえ、グループ全体を狙うキューは動く。

| 会場 | 水面 | 機材 | 花火・水幕 |
| --- | --- | --- | --- |
| 机の水槽 `desk` | 60 × 30 cm | グリッド18台（帯）、チェイサー7台（列） | なし |
| 庭の池 `garden` | 直径 3 m の円 | 真ん中1台、グリッド8台（円）、小さい扇4台（円） | なし |
| 広場の床噴水 `plaza` | 30 × 20 m | グリッド36台（3列）、首振り8台、真ん中1台 | なし（2.5号でも 100 m 要る） |

小さい規模の物理と描画（B7）：粒 5 cm・霧 50 cm などは 100 m 級のまま。机では 3D が白く飛び、庭も空撮では白く飛ぶ（`shots/stage5/samples/3d-*.png`。広場は読める）。会場の画面に「未校正」と出す。合わせ直しは実物を撮ってから。

### 6.5 会場を替えたときの演出（`src/venues/cues.ts`）

- 演出ファイルの `venue`（無ければラグーン）の会場と比べて、キューごとに狙う台（花火は筒）を数える。0 になれば「動かない」、減れば「一部だけ」
- 動かない理由：グループが無い・番号が範囲の外（N台）・名前の付いた並びが無い・花火の台が無い
- 会場の画面の右下に3つの版の数、押すと内訳（版ごとの数、エディタの演出、理由の多い順）。外した台の影響も出る
- 本番画面は動かないキューを飛ばして流れる（`resolveTarget` は見つからない名前を空にする）

エディタの会場の切り替え（2026-11-05）：
- 上の帯の「会場：〇〇 ▾」で選ぶ（組み込み・自分の会場、一番下に「この会場を編集 ↗」）。演出ファイルの `venue` を書き換え（ラグーンなら書かない）、⌘Z で戻る
- `src/editor/model.ts` の `useVenue(venue)` が `LAYOUT`・`LANES`・`TARGET_PRESETS` を作り直す（`export let`、読む側には新しい値が見える）。ファイルが変わるたびに `venue` に合わせる（切り替え・元に戻す・読み込み）
- 今の会場に無いグループを狙うキューは、一番下の灰色のレーン「この会場に無い」に並ぶ（そういうキューがある間だけ出る）。そこでダブルクリックしても新しいキューは作らない
- 切り替えたとき「動かないキュー N・一部だけ M」を知らせる（前の会場と比べる）
- プレビューのカメラは会場の客席の席へ（ラグーンは今までの視点）
- 同じ種類のグループが2つあると、レーンの名前に役を足す（「ミニ噴き上げ・grid」）
- 演出ファイルを読むとき `venue` を残す（前は `normaliseShow` が落としていた）。`venue` の無いファイルを読むとラグーンに戻る

まだ無いもの：演出を小さい会場に合わせて組み替える仕組み。

---

## 7. 段階6：エディタの使い勝手

2026-11-05 作った後の形。ユーザーに困っている所を聞いた答え（複数選択）：「どこが無理か分からない」（C5）と「探しにくい・見にくい」（6a・6c・C4）。選ばなかった「置く・直す手間」（C1・C7）と「音に合わせにくい」（C2・C3）は入れていない（C2・C3 の作り方は下の 7.6 に残す）。前 `backups/2026-11-05-pre-editor/`、比較 `shots/stage6/`。

### 7.1 フォルダ（6a）`src/editor/timeline.ts`・`view.ts`

- 行は機材の種類の表（`src/fixtures/`）の `folder` で「水・水幕・花火」にまとまる。順は会場の行の順。「この会場に無い」の行はフォルダに入れない
- たたむと1行：中の行ごとに細い帯（6 px）、キューは色の線、警告のあるキューは上に小さな三角（赤・黄）。帯の所を押すと開く
- 開くと、細い見出しの行（24 px、「▾ 水 6行 · 415」）の下に今どおりの行。行の名前は 10 px 字下げ
- 見出しに **S**（これだけ見る：時間軸のほかのフォルダは薄く、3D もこれだけ）と **M**（3D で消す：時間軸では薄く）。押すと説明の札
- たたんだ行のキューはつかめない（見るだけ）。`reveal(i)`・`laneRect(l)` は、たたまれていれば先に開く（警告の一覧や 3D のクリックから行くとき）
- たたんでも開いても演出は変わらない。S/M は**エディタの 3D だけ**：保存する演出・本番画面・書き出しには入らない（書き出しは S/M があると全部の演出を組み立て直して渡す、`main.ts` の `show()`）。3D の左下の札に「3D：花火だけ」など

### 7.2 作業画面のタブ（6c）`src/editor/view.ts`

- 時間軸の上の帯（28 px）：全体・水・光・水幕・花火。会場に無い種類のタブは出さない（机の水槽なら全体・水・光）
- タブごとに覚えるもの：開いたフォルダ、S/M、3D の視点（会場ごと）。置き場は localStorage `water-show-editor-view:v1`（演出ファイルには入れない）
- 最初の見方：全体＝全部たたむ、水＝水を開く、光＝水と水幕を開く、水幕＝水幕を開く、花火＝花火を開き、3D は会場の席「花火」（あれば）
- 光：色か明るさを変えないキュー（`touchesLight`：`set.color`・`set.intensity`・虹・param が明るさ）は薄く（×0.18、名前なし）。噴水の LED の色は噴水の行のまま（2026-11-03 の決定）
- 帯の右に「このタブを最初の見方に戻す」と、S/M で絞っているときはその札

### 7.3 警告の一覧（C5）`src/show/checks.ts`・`src/editor/warnings.ts`

- 右の列を「キュー｜警告」の2つに。警告のタブに数（危ない＋書いたとおりに動かない）
- `checkShow(compiled, layout)` は演出を変えない。`compileShow` が決めたこと（首振りを落とした `limited`、LED を合わせた `ledSlowed`（今回足した記録だけ）、花火の判定）を読み、1つだけ自分で見る：
  - 水が上がりきらない：ポンプの機材（グリッド・ウィップ）で、圧力を 0.3 以上上げたのに、9割の高さに着く前に 0.2 以上下げている。着く時刻＝始まり＋max(長さ, ポンプ 1 秒×上げ幅)＋0.68×√(2h/g)（h＝高さ×圧力、fountain-physics 1 の表と同じ）。0.25 秒の余裕。弁（フラワー・ファン）と空気式（チェイサー・ガイザー）は、短く出しても水は全速で出るので見ない
- 段：**危ない**（花火の保安距離・客席側へ傾ける）、**書いたとおりに動かない**（首振りが速すぎる・水が上がりきらない・この会場で動かない）、**お知らせ**（光の変化を LED の速さに合わせた。決めた振る舞いなので、ふだんはたたむ）
- 一覧の行：押すとそのキューを選び、フォルダを開いて見せ、その時刻へ。ダブルクリックで「キュー」のタブに。選んでいるキューの行は琥珀の印
- 時間軸：危ない・書いたとおりに動かないのキューは点線の枠（赤・黄）、札にその理由。キューの設定の頭にも同じ文（首振り・水）
- 3版の数（2026-11-05）：首振り 6・6・6、水が上がりきらない NL 6・ファンタジア 60・花火版 6（ほとんどグリッドの短いパルス）、お知らせ 115・174・115、花火 0
- 計算は変更のあと 60 ms（ドラッグ中は 300 ms）待って1回（`main.ts` の `runChecks`）。同じ結果を 3D のクリックにも使う

### 7.4 3D でクリックして選ぶ（C4）`src/editor/preview.ts` の `pick`

- 3D の画面でクリック（4 px より動かさず 0.5 秒以内。ドラッグは今どおり視点）すると、その時刻の各機材の水の柱（ノズルから首の向きへ、高さ×圧力）を画面に写し、14 px 以内でいちばん近い台を選ぶ
- その台で、その時刻までに最後に始まったキュー（どの値でも）を選び、時間軸で見せる。Shift で足す。キューが無ければ行を見せるだけ
- 3D に札（4 秒）：「グリッド 43番 ← #241 ∿ pulse（2:55.12〜）」。S/M で 3D から消していても、全部の演出で選ぶ

### 7.4b 選んだ機材の縁取り（2026-11-06）`src/editor/outline.ts`

- Blender の選択の縁取り。ユーザーの決定は「台＋水の柱」（案B）。3D に機材の形が無いので目安の形：台（小さな塊、画面で最低 3 px）＋水が出ている間の柱（首の向きへ高さ×圧力、傾いたら弧の頂点 h·cosθ まで。ファン・フラワーは円錐、水幕は板）。花火は筒の所に塊
- 目安の形を別の型（id を赤緑、明るさの印を青、近い方が前）に描き、縁を絵の上に重ねる：外側は約 2 px、2台が接する所は半分ずつ。明るい1台はほかの台の後ろに隠れない
- 明るい琥珀＝3D でクリックした1台（なければ最後に選んだキューの台全部）、暗い琥珀（0.5 倍）＝ほかの選択。行の名前を押すとその行の台全部（Esc で消える）
- 選んでいないときは何も描かない。画質 高で 92 台を選んで +0.3 ms（`scripts/outline-cost.mjs`）

### 7.5 会場・書き出しへの入口（6d）

- 時間軸 → 会場：「会場：〇〇 ▾」の中の「この会場を編集 ↗」（別の窓）。会場の画面の「← 時間軸」は、エディタから開いたときはその窓に戻って自分を閉じる（前は同じ窓でエディタをもう1つ開き、自動保存を2つの窓が書いていた）
- 時間軸 → 書き出し：「書き出し ▾」の5つの形式と Art-Net。動画・Vision Pro 180° は本番画面にあるので、同じメニューの最後に「動画・Vision Pro 180°（本番画面で）↗」を足した
- 本番画面 → エディタ：下のバーの「エディタ ↗」（前から）

### 7.5b 見た目（design-reviewer の指摘で直した所）

- design-ref に道具の画面のお手本は0件。媒体の文法（差し色1つ、文字の段、8 の倍数、線1種類、影なし）に寄せた：2つのタブの帯を同じ 32 px、フォルダ名は中の行より1段大きい 13 px、警告の数は黄ではなく無彩色の太字、選んだ警告の行は影でなく 2 px の左の線、「このタブを最初の見方に戻す」は下線の文字ではなく小さなボタン、字下げ・余白は 8 の倍数
- 残した指摘：注意の黄（--c-caution）と差し色の琥珀が近い（状態の色を差し色の外に認めるかは持ち主の判断。今は点と枠だけに使う）、文字の段が全体で7つ（tokens.css 全体の話なので段階6では変えない）

### 7.6 残した候補（作り方だけ）

- C2 吸い付き：`analysis.ts` の onsets と拍の時刻を候補にし、帯を動かすとき 0.08 秒以内なら吸い付く（Alt で外す）。今は拍の目盛りにだけ吸い付く
- C3 波形：プレイヤーの `scope.ts` の波形の計算を、時間軸の上の帯に描く。今は目盛りの帯に小さく出ている
- C1 まとめて動かす：Shift・範囲選択・⌘D・矢印キーは今もある。足りないのは写して貼る（⌘C/⌘V）
- 自分でタブを足して保存する（grandMA3 のビューの保存）は後で

---

## 8. 段階7：画質（2026-11-05、作った後の形）

決めごと：表示は時刻だけで決まる（動画・Vision Pro の書き出しの前提）。新しい見た目はどれも**切り替え**。描き方は3版で1つを共有しているので、版ごとの設定は持たない。ユーザーの方針（2026-11-05）：中身（振付・色・時刻）を編集しない改善は、全部の版・全部の会場に自動で入る。だから**いつも入**で、版ごとの選択は画面に出さない。「Night Lagoon は変えない」は中身のことで、描画には当てはまらない（0画素の差を守る必要はもう無い）。振付と書き出しの値（`control-check`）は変わらない。確かめ用に全部切にすると、3版は前と0画素の差（`?gfx=off`、`sh scripts/stage5-shots.sh <出力> gfx=off`、39コマすべて0）。

### 8.0 切り替え `src/show/graphics.ts`

`Graphics = { impact, surface, mist }`（H2・H3・H4）。初めの値は `GRAPHICS_DEFAULT`（今は全部入、本番画面・エディタ・Vision Pro の書き出しの画面が同じ値で始まる）。`ShowRuntime.setGraphics(g)`（変わったら水を作り直す。mist が変わったら水幕も）。重いときの逃げ道：画質「低」（重いとき自動で下がる先）では全部描かない（`drawnGraphics`）。確かめ用の URL：`?gfx=off`（前の見た目）、`?gfx=impact,surface`（書いたものだけ）、`?gfx=all`。シェーダーは `#define`（IMPACT・SURFACE・FINE・SIZED）で、切のときは前と同じシェーダーになる（掛け算の1を足しただけでも GPU の丸めで1段違う画素が出たため、定義ごと外す形にした）。

### 8.1 区切り0：小さい会場の描画（B7 の描画の部分）

`layout.ts` の `drawScale(height)`：高さ 10 m 未満の噴水は、描く大きさを高さに比例して小さく（`size = min(1, h/10)`、粒は 1 mm で止める `drop = max(size, 0.03)`）。ラグーンの機材は全部 10 m 以上なので1。効く所：粒（5 cm → 机 1 mm）、霧（50 cm → 机 5 mm）、もや（`haze.ts`）、水面の光の輪（`buildPools`）、泡の柱の太さ（グリッドの 1 m 幅）。機材表の7行目（`row 6`）に入れ、`SIZED` のときだけシェーダーに入る。物理（表面張力・風）は合わせていない（実物が無いので後で）。机・庭は白く飛ばなくなった（`shots/stage7/0-scale/now-vs-new.jpg`）。

### 8.2 H2 水面に当たる表現 `src/techniques/impact.ts`

- **着水の見本**：機材ごとに、出した水の量に沿って並べた見本（噴霧の粒と同じやり方）。「しぶき用」（多い・1秒で消える、噴霧の 0.15 倍）と「泡用」（少ない・3秒残る、0.06 倍）の2種類。GPU で、その水がいつどこに落ちたか（`dropFrom` を2分探索7回＋最後は直線で）と、落ちた速さを出す
- **しぶき**：しぶき用の見本1つに粒6つ（上と外へ、速い水ほど高く）、泡用の見本1つに霧2つ（速い水ほど多く・大きく・白く）。噴霧と同じ描き方で、光は足すだけ（重なっても黒い穴を作らない）
- **波紋と泡**：真上から見た浮動小数の地図（ラグーン 2048×1460、1画素 18 cm）に、見本ごとに輪（波長はラグーン 0.7 m〜毛管波の 1.7 cm、速さ √(gλ/2π)、0.9 秒、弧に切れる）と泡（広がって3秒で消える、落ちた水の光で明るい）を描き足す。水面のシェーダー（`stage.ts` の IMPACT）が読む：泡は水面に、輪は映り込みを曲げる
- **大きさ**：機材表の8行目（`row 7`）の強さ＝流量 Q = 面積×√(2gh)×本数を、その大きさの水で割った値（Q ∝ L^2.5）の 0.35 乗、0.3〜3、小さい水ほど弱く（×(0.25+0.75·size)）。圧力と、柱のままか崩れたかでも変わる
- **画質段階**：見本の数は段階の倍率に比例し、見本1つの明るさは倍率で割る（書き出しの ×3 は細かくなるだけで明るくならない）。地図の大きさ：high 2048・medium 1536・low 1024・export 4096
- 重さ（1280×720、花火版 205.99）：切 9.8 ms → H2 だけ 15.2 ms。全部入り 14.8 ms（測るたびに ±0.8 ms 揺れる）

### 8.3 H3 水面（`stage.ts` の SURFACE）

短い波の列（波長 17〜70 cm、画素より細かいと消える）で映り込みを光の粒に割る。反射率は水の式（n = 1.333 のフレネル）。近くの水は映り込みを大きく揺らし、遠く（15〜140 m）ほど鏡に近く鋭い。H2 と一緒だと、着水の輪が映り込みを曲げる。

### 8.4 H1 書き出しの高画質

- 画質段階 `'export'`（`QUALITY_SCALE` 3、水面の映りの解像度 1.0）。動画・Vision Pro の書き出しでは**いつも**この段階とモーションブラー（画面の箱は無い）。Vision Pro の所要時間の目安は、動画で測った約5倍を掛けた推定（Vision Pro では測っていない）
- モーションブラー `src/export/blur.ts`：1コマを4回、シャッター 0.5 コマの幅で描き、線形の光で平均する。動画は GPU の浮動小数の板に足す（`FrameBlend`）、Vision Pro は両目の画素を足して平均（`vr180-video.ts`）
- 1280×720 の1秒：今 2.8 秒・高画質＋H2H3 15.5 秒（1コマ約 0.5 秒）

### 8.5 H4 霧と水幕（`mist.ts` の FINE）

水幕の板に、縦に流れる細かい粒の濃淡（数 cm〜数十 cm）を掛け、投影の絵がその粒に乗って見えるように（濃い所ほど絵が鋭い）。縁の霧の玉は 2.5 倍の数・0.6 倍の大きさ。比較 `shots/stage7/h4-mist/`。

### 8.6 H5 WebGPU（作らない。判断の材料）

- 移すと要る作業：シェーダーは全部 GLSL の ShaderMaterial（評価のパス・描画・水面の Reflector・ブルームの EffectComposer）。WebGPURenderer では TSL か WGSL に書き直し、後処理はノードの仕組みへ。ほぼ描画の全部の作り直し
- 得られるもの：計算シェーダー（今は画素のパスで代わりにしている粒の評価・着水の探索）、間接描画（今は死んだ粒も画面の外へ送って描いている：噴霧 42 万、しぶき 126 万）、粒の数を増やす余裕
- 今の数字：一番重い場面で切 9.8 ms・全部入り 14.8 ms（1280×720）。書き出しは時間をかけてよいので GPU の速さに縛られない
- 見本との差の主な理由は、GPU の力より見た目の作り（粒のきらめき、もやの濃さ、柱のぶれ）
- 判断：今は移さない。リアルタイムで粒を2倍以上にしたいとき、または死んだ粒の描画が重さの大半になったときに考え直す

### 8.7 決めること（ユーザー）

- ~~どの版に H2・H3・H4 を入れるか~~ → 全部の版・会場にいつも入（2026-11-05）。版ごとの切り替えは作らない。書き出しの箱も無くしたので、画面に出す新しい名前は無い

確かめ方：Depence の見本（`references/depence/`、Syncronorm の R3 の噴水の映像のコマ、出典 CREDITS.md）と、目線・近くの角度で「見本｜今｜案」（`shots/stage7/h2-impact/final-sample-now-h2-h3.jpg`）。見本は別の会場（広場の噴水）なので、形は比べられない。比べられるのは水際・水面・粒の見え方。前 `backups/2026-11-05-pre-graphics/`。
