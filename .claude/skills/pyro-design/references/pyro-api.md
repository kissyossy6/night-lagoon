# 花火の書き方（このプロジェクト）

数値はコードが正しい（2026-11-11 に読んだ値）。食い違っていたらコードを読んで、ここを直す。

## 目次
1. キューの形
2. 筒と的（target）
3. 角度の型
4. 玉の表（号数・種類）
5. 赤・黄のきまり
6. 音
7. 席（カメラ）
8. 確かめる道具
9. 書き出し
10. まだ無いもの

## 1. キューの形（`src/show/types.ts`）

```ts
interface Fire {
  shell: 'botan'|'kiku'|'yanagi'|'yashi'|'ring'|'senrin'|'strobe'|'comet'|'mine';
  size: number;        // 号。2.5〜10 に収める
  colors: string[];    // 1〜3色。2色目・3色目は燃えている間に変わる（等分）
  count?: number;      // 何発（既定 1、mine は 12）
  interval?: number;   // 連発の間（既定 0.25秒、最小 0.02）
  angle?: number;      // 並びの方向への傾き（+ は舞台の右）
  tilt?: number;       // + は客席の側（赤）、− は奥へ
  pattern?: 'fan'|'v'|'x'|'sweep-lr'|'sweep-rl'|'sweep-out';
  spread?: number;     // 型の開き（既定 40°）
  seed?: number;       // 既定 (キューの番号+1)*7919。並びを変えると変わる
  glow?: number;       // 空の明るみ（既定 0.1）
  burn?: number;       // 燃える秒数の上書き（0.3〜12）
}
// Cue.fire に入れる。t は「開く」時刻。打ち上げは t − 上がる時間（compilePyro が決める）
```

花火版の書き方（`src/show/hanabi.ts`）：

```ts
fire(162.62, 'pyro:奥の台', { shell: 'kiku', size: 3, colors: ['#ff3000'], pattern: 'fan', spread: 40 }, '花火 第1波 扇');
```

`hanabiFireworks()` が返すキューは、`buildShow(..., 'hanabi')` で Night Lagoon のキューの後ろに足される（`src/show/choreography.ts`、版の一覧は `SHOW_VARIANTS`）。

## 2. 筒と的（`src/venues/builtin/lagoon.json`、`src/pyro/schedule.ts` の `resolveTubes()`）

花火の筒があるのは今は湖（lagoon）だけ。机・庭・広場には無い。

| 置き場 | 筒 | 位置 | 客席の端（岸 z=45）から | 打てる号数 |
| --- | --- | --- | --- | --- |
| 奥の台（台船） | 5本 | x −40〜40、z −110、高さ1 | 155 m | 4号まで |
| 奥の陸 | 7本 | x −120〜120、z −260、高さ2 | 305 m | 10号まで |

風は [1.5, 0, 0]。

的の書き方：`pyro`（全部）、`pyro:奥の台`、`pyro:奥の陸[1-5:2]`（範囲と間引き）、`,` で並べる、`@選択`（`@花火 全部`、`@奥の台`、`@奥の台 中央`、`@奥の陸`、`@奥の陸 中央`）。

## 3. 角度の型（`schedule.ts` の `aim()`）

筒は x の小さい順（左から）に並べて扱う。

- `fan`：並びの位置に応じて ±spread/2 に傾ける（外へ開く扇）
- `v` / `x`：左半分と右半分を逆に倒す。本数が奇数なら真ん中はまっすぐ
- `sweep-lr` / `sweep-rl` / `sweep-out`：`interval` ずつずらして筒をなめる（1発ずつ）。`count > 1` なら各筒の中で
- mine に型が無いとき：±angle（既定15°）でなめる
- どの1発にも ±2° の散らばりが入る

## 4. 玉の表（`src/pyro/shells.ts`）

号数ごと（`CATALOGUE`。間は `sizeRow()` で補う）。描く直径は表の直径 × 0.82（写真と比べて決めた `PHOTO_SPREAD`）。

| 号 | 高さ m | 表の直径 m | 描く直径 m | 上がる秒 | 保安距離 m |
| --- | --- | --- | --- | --- | --- |
| 2.5 | 90 | 50 | 41 | 3.3 | 100 |
| 3 | 120 | 60 | 49 | 3.8 | 140 |
| 4 | 160 | 120 | 98 | 4.4 | 150 |
| 5 | 190 | 170 | 139 | 4.8 | 220 |
| 6 | 220 | 220 | 180 | 5.2 | 250 |
| 7 | 250 | 240 | 197 | 5.5 | 250 |
| 8 | 280 | 280 | 230 | 5.9 | 250 |
| 10 | 330 | 310 | 254 | 6.4 | 300 |

種類（`SHELLS`。目で決めた値で、出典は無い）：

| 種類 | 星の数 | 燃える秒 | 開き | 性格 |
| --- | --- | --- | --- | --- |
| botan 牡丹 | 60/号 | 1.6 | 1 | 尾の無い星。短く、拍を打つ |
| kiku 菊 | 60/号 | 1.8 | 1 | 尾を引く。いちばん普通の「音符」 |
| yanagi 柳 | 40/号 | 5.75 | 0.55 | 金の長い尾が垂れる。溜め・余韻 |
| yashi 椰子 | 10 | 2.5 | 0.9 | 太い枝が少し |
| ring 型物 | 40/号 | 1.5 | 0.7 | 輪。一度きりの見せ場 |
| senrin 千輪 | — | — | — | 1.5号の子玉20個が 0.8秒＋最大0.7秒遅れてはじける |
| strobe 点滅 | 50/号 | 2.5 | — | 8〜14 Hz で点滅 |
| comet 彗星 | — | — | — | 上がる尾だけ |
| mine | — | — | — | 2.5〜3号を12発、扇状に。色は順番に |

燃え残りの光は 燃える秒×1.2＋0.2。大きい号でも燃える秒は同じ（10号の菊も1.8秒で一度に消える。気づいているが直していない）。

見た目（`src/techniques/fireworks.ts`）：芯の白なし・尾は星の色（ユーザーが選んだ「D」）、煙は×2（40秒残る）、明るさ リアル1／理想1.3。同時に開く玉は48まで、星は600まで。

## 5. 赤・黄のきまり（`compilePyro`、`ANGLE = {caution: 30, max: 45, spread: 40}`）

筒ごとに：

- 赤 `tube`：客席までの距離 < その号の保安距離
- 赤 `burst`：0.5°より傾けたとき、開く点の真下が保安距離より近い
- 赤 `toward`：tilt > 0.5（客席の側へ傾けた）
- 黄 `steep`：傾きの合計 hypot(angle, tilt) > 30°。45°を超えた分は45°で止める
- キューは消さない。`maxSizeAt()` でその筒の上限の号数がわかる（0.5刻み）

会場の編集（`src/venues/rules.ts`）では、2.5号も入らない置き場（100 m 未満）は赤、開いた玉が水幕に当たる位置も赤、台船が陸の上・陸の筒が水の上は止める。

**見ていないもの**：風と燃えかす、法令。保安距離は神奈川県の割物の値で、目安であって許可ではない（`src/show/checks.ts` の文言もそう書いている）。空で玉どうしが重なること、密度、前の玉の燃え残りが消える前に次が開くこと、も見ていない。描く直径と筒の間隔、燃える秒と次の玉の時刻は、自分で計算して確かめる。

## 6. 音（`src/audio/pyro.ts`、`src/audio/levels.ts`）

- 客席（`audience` 席）の位置で鳴らす。光は `t`、音は距離÷343 m/s だけ遅れる
  - 打ち上げのポン：打ち上げ時刻＋筒までの距離/343
  - 開くドン：`t`＋開く点までの距離/343
  - 客席 [0,7,66] から真ん中の筒で：台の3号 約210 m（0.61秒）、台の4号 約234 m（0.68秒）、陸の5号 約375 m（1.09秒）、陸の10号 約460 m（1.34秒）
- 大きさ ∝ (号/5)^0.7 × 300/距離。ドンの中身は実物の録音25発を測った数字（`src/audio/pyro-boom.json`）。作り直すのは sound-design
- 音量の混ぜ方：音楽0.75・水0.5・花火1.5。花火は音楽で下げない
- 遅れの補正は無い。補正するかどうかもまだ決めていない

## 7. 席（カメラ）

| 席 | 位置 | 向き | 使いどころ |
| --- | --- | --- | --- |
| `audience` 客席 | [0,7,66] | — | 花火は画面の外（上は約30°まで）。花火の確認には使わない |
| `sky` 花火と水 | [0,10,200] | [0,110,−60]、画角58 | 水を下、花火を上に入れる。花火版の確認はこれ |
| `pyro` | [0,15,520] | [0,170,−150]、画角50 | 花火だけを大きく。エディタの花火タブの最初の席 |

ブラウザ：`http://localhost:5199/?show=hanabi&t=162&cam=sky&light=real`。試し打ちの見本：`?show=pyrotest`（全種類・全号数と、わざと赤にしたキュー t=130）。

## 8. 確かめる道具（開発サーバー http://localhost:5199 が動いている状態で）

| 目的 | やり方 |
| --- | --- |
| 今｜案の静止画・連続コマ | `node scripts/hanabi-shots.mjs --from=160.6 --to=164 --step=0.4 --shows=lagoon,hanabi --cam=sky --light=real --out=shots/<話題>/` |
| 並べた1枚にする | `python3 scripts/hanabi-sheet.py compare <dir> <out.jpg> <題> t1,t2` ／ `strip <dir> <out.jpg> <題> [列数]` |
| 角度の型を長時間露光で | `node scripts/pyro-angle-shots.mjs` → `python3 scripts/pyro-angle-sheet.py` |
| 警告0（花火版） | `node scripts/stage6-check.mjs` |
| 大きさが表どおりか | `node scripts/pyro-size-check.mjs` → `pyro-size-measure.py` |
| 音を書き出して確かめる | `node scripts/pyro-audio-check.mjs <out.wav>`、今｜案の聴き比べ `pyro-sound-ab.mjs` |
| 飛ばして再生と続けて再生が同じ絵か | `node scripts/pyro-seek-check.mjs` → `pixel-diff.py` |
| 見た目の具合を振る | `node scripts/pyro-looks.mjs --knob=gain|core|smoke --values=...` |
| 点火表の中身 | `node scripts/control-check.mjs --show=hanabi --format=pyro-csv` |
| 型 | `npm run typecheck` |

## 9. 書き出し（`src/export/control/pyro-csv.ts`）

エディタの「書き出し ▾」→ 花火の点火表。列：`event,launch_s,launch_tc,burst_s,site,tube,x,y,z,angle,tilt,shell,size_gou,colors,warning`。1発1行、打ち上げ順。千輪の子玉は入れない。ユーザーは形式の細部には興味が薄い。

## 10. まだ無いもの

- 机・庭・広場の花火の筒（小さい会場向けの花火・手持ちの小さい仕掛け）
- 地上の仕掛け（ナイアガラ・噴き出し）、彗星のフィナーレ、割れて分かれる玉
- 芯（ラボの中だけ）、号数で燃える秒を変えること
- 業務用の点火機の形式（Finale 3D・FireOne・Cobra）
- ドンの遅れの補正
