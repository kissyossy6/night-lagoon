# このプロジェクトでの書き方（Night Lagoon）

7つのスキルが共通で使う、機材・キューの書き方・確かめ方の早見表。数値はコードが正。食い違ったらコードを読み、ここを直す。

## 目次
1. 舞台と機材
2. キューの書き方
3. マクロ
4. 音楽とのつなぎ
5. 確かめ方
6. 既に決まっていること

## 1. 舞台と機材（`src/show/layout.ts`）

座標はメートル。x＝客席から見て右、y＝上、z＝客席側。浮き舞台は 122×37m で原点が中心。客席カメラは (0, 7, 66)。

| グループ | 数 | 位置 | 高さ・動き | 性格（WoC の機材） |
| --- | --- | --- | --- | --- |
| `grid` | 264 | 3帯×88。前 `grid[0-87]`（z=15.5）、中 `grid[88-175]`、後 `grid[176-263]`（z=10.6）。各帯は半ピッチずらした2列で、左から右へ番号 | 最大12m、垂直固定。泡の炎 | 主力・土台。ピクセル的に形を作る |
| `whip` | 24 | 一列、x=−55〜55m、z=6 | 30m。pan/tilt ±55°、最大 90°/秒 | 「バレエ」。隊形で動く柱 |
| `chaser` | 56 | 左の弧 `chaser[0-19]`、右の弧 `chaser[20-39]`、中央リング `chaser[40-55]` | 25m。短いショット（1発約1秒） | 「繊細さより力」。追いかけっこ |
| `fan` | 12 | 一列、x=−50〜50m、z=1 | 扇。開閉は弁（開 0.2秒・閉 0.25秒） | 面を作る |
| `flower` | 6 | 一列、x=−45〜45m、z=−6 | 外へ開く泡の花（`tilt` で開き）。弁 | 華やぎ・ご褒美 |
| `geyser` | 10 | 奥の一列、x=−54〜54m、z=−11 | 61m の白い太柱、重い霧。1発約1.2〜2秒 | 最大の大技。打つと霧が10秒以上残る |
| `screen` | 1 | 横長の水幕 116×15m、z=−20 | pressure＝高さ、intensity＝投影の明るさ | 物語の全景 |
| `mound` | 3 | `mound[0-0]` 左（x=−40, 幅28, 高12）、`mound[1-1]` 中央（幅40, 高18）、`mound[2-2]` 右 | 同上 | WoC の3つの山。脇役・転換・山場 |

各ノズルに同軸の RGB LED リング（真下から自分の水だけを照らす）。照明モードは `real`（機材どおり）と `ideal`（見栄え優先）。演出は両方で成り立つように作り、`real` で確かめる。

水幕は全部、背面の同じプロジェクターから1枚のパノラマを映す（`src/screen/projection.ts`）。山にはその位置の部分だけが映る。

## 2. キューの書き方（`src/show/types.ts`、`src/show/choreography.ts`）

振付は `buildShow(music)` という小さなプログラムで、JSON のキュー列を出す。エディタ（edit.html）はその JSON を受け取って手で直せる。

```ts
interface Cue {
  t: number | string;      // 秒（"小節:拍" も可。ただし今は秒で書く）
  target: string;          // "grid" / "grid[0-87]" / "geyser[0-9:3]"（3つおき）/ "whip,fan"
  set?: Partial<Params>;   // pressure 0..1 / pan / tilt（度）/ color '#rrggbb' / intensity 0..1+
  dur?: number;            // そこまで変化にかける秒
  ease?: 'linear' | 'in' | 'out' | 'inOut' | 'step';
  stagger?: number;        // 1基ごとの時差（秒）
  order?: 'index' | 'reverse' | 'center' | 'edges' | 'random';
  macro?: MacroName; args?: Record<string, number | string>;
  clip?: Clip;             // 水幕だけ：映す場面・映像の切り替え
}
```

`choreography.ts` の中の道具：`set(t, target, params, dur, extra)`、`macro(t, target, name, args, extra)`、`off(t, target, dur)`、`pops(a, b, min)`（強い立ち上がりで手前の帯を跳ねさせる）、`follow(a, b, target, curve, min, max)`（床の高さは帯ごとにこれで書き、帯の差は min・max で固定の形にする）、`chases(times, color, speed, ring)`（左右の弧を交互に、3回に1回リング。リングの色は既定で同じ色）。ウィップの隊形は `macro(t, 'whip', 'spread'|'lean', ...)` でフレーズの頭に直接書く、`onsets(a, b, min, gap)`、`snap(t)`（一番近い強い立ち上がりへ寄せる）。色は定数 `C`（cyan, blue, deep, green, purple, magenta, red, orange, gold, white, pink）。

時差は「順位×stagger」。順位は `index`／`reverse` で 0〜n−1、`center`／`edges` で 0〜(n−1)/2。帯（88基）を `index` で端から端まで 0.35秒で走らせるなら `stagger: 0.004`、`center` で中央から外へ 0.35秒なら `stagger: 0.008`。

## 3. マクロ（`src/show/cues.ts` の `expand`）

| マクロ | 何をするか | 主な args |
| --- | --- | --- |
| `wave` | pressure（など）を base±amp で往復。最後は base に戻る | `base` `amp` `period` `cycles` `param` |
| `sway` | pan を往復（首振り） | `amp` `period` `dur` |
| `pulse` | 短い噴き上げ：上げて、保って、下げる | `level` `hold` `rest` `attack` `release`。`set` で色も |
| `chase` | 並び順に1基ずつ噴く追いかけっこ | `speed`（基/秒）`hold` `laps` `level` |
| `bloom` | フラワーを外へ開く（tilt） | `to`（度）`dur` |
| `spread` | 並び順に角度を割り振る隊形。−a→+a で外へ開く扇、+a→−a で中央で交差 | `from` `to` `dur` `param` |
| `lean` | 全員が同じ角度へ倒して戻る。時差で波 | `angle` `dur` `hold` `back`（`'stay'` で戻らない） |
| `follow` | 音のエンベロープに追従 | `curve`（`level` `low` `mid` `high`）`min` `max` `dur` `param` |
| `rainbow` | 並びに色相を割り振る | `hue` `span` |

機材の制約はコンパイル時に効く：首振りは 90°/秒で頭打ち（`HEAD_MAX_DEG_S`）、flower と fan の水圧 0↔正は弁の速さ（`VALVE_OPEN_S`／`VALVE_CLOSE_S`）。同じ時刻のキューは後に書いたほうが勝つ。

## 4. 音楽とのつなぎ（`src/show/song.ts`、`src/audio/analysis.ts`）

- 音楽は既存の録音（`public/music/background.mp3`、今はラプソディー・イン・ブルーの冒頭176.5秒を曲の本当のラストにつないだもの。ショーは217秒。最後の和音に合成の残響）。ユーザーは曲の自作を望んでいない
- 2層で合わせる：
  - 場面（色・暗転・水幕・ガイザー）は録音から測った目印 `MUSIC`（`song.ts`）に置く。曲を替えたら測り直す
  - 場面の中の水は波形解析に追従（低中高の帯域エンベロープ、スペクトルフラックスのオンセット）
- `SECTIONS`：intro 0–16 / awakening 16–62 / theme 62–115 / story 115–158 / build 158–163 / finale 163–176.6 / ending 176.6–206.6 / coda 206.6–217（秒）

## 5. 確かめ方（開発サーバー `npm run dev`、http://localhost:5199/ が動いている状態で）

| 目的 | やり方 |
| --- | --- |
| ある時刻の絵 | `node scripts/show-shot.mjs --t=60,128`（客席カメラ）。`--perf` でフレーム時間 |
| ブラウザで見る | `http://localhost:5199/?t=62&light=real&cam=wide` など（`cam=screen|wide|low|left|right|aerial|auto|free`） |
| 大技と音のずれ | `node scripts/sync-check.mjs` |
| エディタ | `node scripts/editor-check.mjs` |
| 水幕の映像 | `node scripts/projection-check.mjs`（コンタクトシート） |
| 型とビルド | `npx tsc --noEmit`、`npm run build` |

**コードを変えずに案を試し撮りする**：Playwright の使い捨てブラウザで `http://localhost:5199/lab.html` を開き、ページの中で `import('/src/show/choreography.ts')` などから振付を組み立てて差し替えたものを、`localStorage.setItem('water-show-editor:v1', JSON.stringify(show))` で「エディタで保存したショー」として入れる。同じページで `?t=<秒>&shot=1&show=edited` を開いて撮る。使い捨てのブラウザなので、ユーザーのエディタの保存には触れない。首振りの上限にかかったキューは `compileShow(show, buildLayout(undefined, 'low')).limited` で一覧できる（`buildLayout(会場, 画質)`）。演出案を出すときは、これで「今」と「案」を並べて撮って見せると説得力が違う。**この手順は show-compare スキルの `make-proposal.mjs`・`capture.mjs` が道具にしてある**（音楽を解析してから組み立てる、`duration` を 217 にそろえる、の2つの落とし穴も済ませてある：音楽なしの `buildShow()` は波形に追従するキューが抜けて「今」と比べられない。`duration` が 217 より短いと、再生のときにラストが組み込みのものに差し替わる）。

フレーム時間の目安は 1280×720 で 20ms 未満。ガイザーの霧と水幕が重い（ガイザー10本＋山3つを同時に出すと超える）。

## 6. 既に決まっていること（ユーザーと合意済み。覆すなら先に聞く）

- 1場面1色＋差し色1色。多色は1〜2場面だけのご褒美
- ガイザーは3回程度（最初の山場・フィナーレの頭・最後の一発）。2026-10-27 に曲を本当のラストまで延ばし、最後の和音の10本を足して4回になった
- 最後の大きな和音は色をほぼ入れず、大量の水を白で見せる（ユーザーの希望、2026-10-27）
- 物語の間はウィップのアーチで水幕を囲み、他は消すか最小限
- 始まりと終わりは「種火」（グリッドを水圧0.04で光の点に）
- 暗転は、暗くしたい時刻より約3秒前に消し始める（水が落ちきるのに約3秒）
- 物語の場面ではカメラを自動で寄せない
- 用語：照明モードは「リアル（機材どおり）」「理想（見栄え優先）」。「本来」と呼ばない
- 参考映像をブラウザで再生するときは音を消す
- Night Lagoon・ファンタジア版の中身（振付）は変えない。新しい案は新しい版か花火版へ（`SHOW_VARIANTS`）。描き方・エンジンの改善は全部の版に入れ、版ごとに聞かない
- 色を急に変えない・ショーの途中で0まで落とさない（LED の下限 色0.6・明るさ0.9・点く0.12秒、瞬断は 0.3〜0.65 まで）
- 入りは、水を音楽と一緒に伸ばす（暗いうちに立てて拍で光を入れる型は「いきなり出現して不自然」と言われた）
- 自動の再生や試しでは音を出さない
- 経緯は `docs/video-review.md`、機材の根拠は `docs/research.md`
