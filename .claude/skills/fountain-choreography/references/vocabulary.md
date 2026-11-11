# 振付の語彙の辞典

業界共通の用語集はない。名前はメーカー・会場の呼び名と、映像の観察から整理したもの（推測を含む）。作り方はこのプロジェクトのマクロ（`src/show/cues.ts`）。原本は `docs/show-knowledge/k3-equipment.md`。

## 型と作り方

| 名前 | 形 | 向く場面 | 作り方 |
| --- | --- | --- | --- |
| Sweep（掃く） | 首振りの列が端から端へ順に倒れる | 旋律の大きなフレーズ、場面の始まり | whip `lean` angle ±40、stagger 0.04 `index`（戻りは `reverse`）。`dur` は 2×40÷90 ≈ 0.9秒以上 |
| Sway（揺れ） | そろって、または左右逆向きにゆっくり揺れる | 静かな場面、ワルツ | `sway` amp 12〜20、period 6〜8、時差なし。逆向きは左右の半分に分けて amp の符号を変える |
| Fan open / close（扇） | 中央から外へ開き、閉じる | 決めのポーズ、和音の広がり | whip `spread` from −a to +a（開く）、to=0 へ戻す（閉じる）。dur ≥ 2×（端の1基が動く角度）÷90。まっすぐから開くなら角度は a、扇から交差へなら 2a |
| Cross（交差） | 左右の柱が中央の上で X | 緊張、対立、2つの声 | `spread` from +a to −a |
| Chase（追いかけ） | 光と水の窓が弧・列を走る | 打楽器、細かい音符、加速 | chaser `chase` speed 18〜30／秒、hold 0.25。左右の弧で交互 |
| Swirl（渦） | 円周を回り続ける | 回転、魔法、上昇 | chaser リング（`chaser[40-55]`）を `chase` laps 2〜4 |
| Wave（波） | 高さの山が列を伝わる | 流れ、海、ゆったりした拍 | 帯ごとに `wave` period 2、stagger 0.02 `index` → 次は `reverse`。`wave` は最後に base へ戻るので暗転の直前に置かない |
| Ripple（波紋） | 中央から外へ広がる | 一音の余韻 | `pulse` stagger 0.004〜0.008 `center` |
| Gather / Collapse | 外から中央へ寄る、外から消える | 終わり、まとめ、溜め | `set`/`off` stagger `edges` |
| Burst / Hit（打つ） | 全部が同時に一瞬立つ | 強拍、クラッシュ | `pulse` hold 0.12〜0.4、stagger 0 |
| Shoot（撃つ） | 太い柱を1発 | 最大のアクセント | geyser `pulse` hold 1〜2、白。間引いて（`geyser[0-9:3]`） |
| Bounce（弾む） | 同じ柱が少しずつ低く何度か立つ | 跳ねるリズム、ユーモア | 連続 `pulse` で level 1→0.7→0.45（専用マクロなし） |
| Cascade / Stairs（段） | 高さが端から段々に変わる | 下降・上昇する音階 | 帯を区切った `set` の手書き（高さの勾配のマクロはない） |
| Bloom / Crown | 輪が外へ開く。中央に1本足すと王冠 | 頂点、解決、静かな一輪 | flower `bloom` to 18〜28。中央の geyser と同時に |
| Swell / Breathe | 高さが音量で満ち引き | 弦の長い音、パッド | `follow` curve level（先取りは fountain-physics） |
| Strobe / Flicker | 短い点滅 | 電子音、きらめき | `pulse` hold 0.05〜0.1 を連打、白。1秒に3回まで |
| Rainbow sweep | 色相が列を走る | フィナーレ | `rainbow` span 1 を1つの帯に（帯をつないだ `grid` 全体には使わない） |
| Call and response | 左右が交互に答える | 2つの楽器の掛け合い | 左右の弧、whip の左右半分に交互にキュー |
| Tableau（静止） | 隊形のまま止める | 音の休み、溜め | 動きのキューを入れず、高さと色だけ保つ |
| Arch frame（額縁） | 左右の whip が内へ倒れて水幕を囲む | 物語、独奏 | `whip[3-6]` pan 35、`whip[17-20]` pan −35、圧力 0.4〜0.6 |
| Pilot lights（種火） | 低い水が水面の光の点になる | 始まりと終わり、暗闇 | grid pressure 0.04、stagger `center`（灯る）／`edges`（消える） |

## 足すと良いマクロ（提案。コード変更なので先にユーザーに聞く）

- `order: 'alternate'`：奇数と偶数で交互（Grand Haven の A/B モジュール）
- `order: 'mirror'`：左右が中央から鏡写しで同じ順位
- `ramp`：pressure を位置で線形に変える（`spread` の pressure 版）。Cascade・階段
- 順位を並び順ではなく x 座標で決める（帯をつないだグループのずれを根本から直す）

## 使い方の原則

- **隊形を保つ**：同じ群は同じ形で動かす。揃わない動きは乱れに見える（WoC・Bellagio の観察）
- **一度に主役は1群**：1つの群が主旋律、1〜2群が伴奏、残りは低く背景
- **鏡写しが基本**：崩すのは乱れを表したいときだけ
- **低い位置の動きは見えにくい**：Grand Haven の振付者は回転噴水を低いレベルではほぼ使わない。動かすときは十分な高さを出す
- **振付は手で付ける**：プロは1曲に Station Park 2〜10日、Bellagio 2分の曲に最大1週間、Grand Haven 4〜60時間、WET 2〜4週間（中）。自動の追従は下書き
