# 噴水ショーの機材・配置・振付の語彙・水の物理（k3）

調査日: 2026-10-26。担当スキル: fountain-choreography / fountain-layout / fountain-physics。
docs/research.md・docs/video-review.md の内容（WoC の機材数、Disney 特許、WET Shooter／層流特許）は繰り返さない。
確度: **高**＝特許・メーカー仕様・本人発言、**中**＝業界誌・百科事典、**低**＝販売サイト・学生レポート・推測。出典のない主張には「推測」と書く。「計算」は本書で式から出した値。

---

## 1. 機材の種類 × 表現上の性格

| 機材 | 形・動き | 表現上の性格（向く場面） | 典型の高さ・速さ | このシミュレーターでは | 確度・出典 |
| --- | --- | --- | --- | --- | --- |
| 垂直ジェット（ランス、グリッド） | 固定・鉛直の柱。高さだけ変わる | 画素。並べて波・文字・壁を作る。主力で、背景にも主役にもなる | 0.25〜100m（Safe Rain Lance）。WoC グリッドは12m | grid（264基） | 高 [S1] |
| 追いかけ噴水（chaser／vertical chasing） | 固定。弁の開閉で低い弧や柱を順に打つ | 「走る」動き。弧・円・直線の上を光と水が駆ける。打楽器、細かい音符 | Station Park は低い弧。WoC は24〜26m | chaser（56基） | 中 [S2] |
| 首振り（robotic／moving head／Oarsman／swing／sweep） | 2軸で傾く柱 | 踊り手。筆で描く線、扇の開閉、交差、揺れ。旋律やレガートに向く | Bellagio Oarsman 208基・約23m（77ft）・140gpm。OASE 2軸ドライブ: S は±45°・最大8m、L は200°×140°・最大20m、**最大72°/s** | whip（24基） | 高（OASE）／中（Bellagio）[S3][S4] |
| 扇（fan／peacock／phoenix tail） | 1基から複数の噴口が扇形に開く | 開く・広がる・羽。区切りの決めポーズ | Phoenix tail 2〜5m（販売サイト）。Grand Haven の Peacock は12噴口の縦の弧 | fan（12基） | 低〜中 [S5][S6] |
| 花・王冠（flower／crown／ring／mushroom／water bell） | 外へ開く輪、鐘形の膜 | 咲く・開く。曲の頂点や静かな場面の「一輪」 | Safe Rain の Crown は角度の違う噴口で段々の滝。鐘形は低い | flower（6基） | 中 [S1] |
| 回転（rotating／dancing／helix／cyclone） | 水圧で回る噴口が螺旋を描く | 渦・回転・きらめき。テンポの速い場面の装飾 | Safe Rain Cyclone 1.5〜3m。Grand Haven Helix は低レベルだと回転も見た目も弱く、振付ではほぼレベル4以上しか使わない | なし（WoC の「ダンサー」に当たる） | 高（仕様）／中 [S1][S6] |
| シューター（Shooter／Super／Extreme） | 圧縮空気で水の塊を打ち上げる。音が「ドン」と鳴る | 打撃・爆発。アクセントと最大の山場。連打より単発 | Bellagio: Mini 798基・約30m、Super 192基・約73m、Extreme 16基・約140m（460ft）。空気圧最大約34bar（500psi） | geyser（10基、61m）、chaser の単発 | 中 [S4][S7] |
| 泡（foam／aerated／frothy） | 空気を吸い込んだ白く太い柱 | 白い塊・重さ・力。風に強く、光をよく散らす | OASE Schaumsprudler で0.65m（小型）。風に強いと複数社が記載 | 全機材の aeration 値 | 中 [S8] |
| 層流（laminar／Lexan jets） | ガラス棒のような透明の弧 | 精密・静けさ。光が柱の中を通る。跳ねる弧の「Leapfrog」 | 低い弧 | なし | 高（WET 特許、既知） |
| 霧（mist／fog） | 細かい粒の雲 | 雰囲気・光の受け皿・場面転換の幕 | 地表付近。粒が軽く風で流れるので低く置き、高い柱と組む | haze・mist | 中 [S9] |
| 水幕（water screen） | 扇形の薄い膜に背面から投影 | 映像・物語。主役を水から映像に移す | Aquatique: 高さ6m×幅20m〜15m×45m。OASE WaterScreenNozzle XL は180°の半円、4,000L/min・12bar | screen（116×15m）＋3つの山 | 高 [S10][S11] |
| 変形ノズル（transforming） | 水平360°の平たい膜 ↔ 鉛直の柱 | 変身・驚き | — | なし | 中 [S2] |
| Spout／Bazooka（消防ノズル） | 中央の1本の太い柱、両端から斜めに出して合わせるアーチ | 「声」＝主旋律。アーチは枠 | Grand Haven Spout 最大125ft（約38m） | geyser 1基単独 | 中 [S6] |

- 名前はメーカーごとに違い、共通の用語集はない（Phoenix tail、Butterfly、Swing などは中国メーカー・販売サイトの呼び名）。確度: 中 [S6]
- WET の Hypershooter・Fireballs の仕様は公開資料で確認できなかった。

---

## 2. 配置の原則

| # | ルール | なぜ | 数値 | 出典・確度 |
| --- | --- | --- | --- | --- |
| L1 | 飛沫は**噴水の高さと同じくらいの半径**に広がる。人をその外に置く | 無風でも落ちた水が水平に跳ねる | 水平半径 ≈ 高さ | Safe Rain [S12]・高 |
| L2 | 噴水の高さは**ノズルから水盤の縁までの距離以下**にする | 普通の風で水が外に出ない | 高さ ≤ 縁までの距離（1:1）。もっと保守的に「半径の半分」という説もある | Delta Fountains [S13]・中／学生レポート・低 |
| L3 | 高く噴くほど水盤を広くする。飛沫・風で流れる水・噴きこぼれを受ける | — | 倍率の定めは見つからず | WaterShapes（検索要約）・中 |
| L4 | **奥ほど高く、手前ほど低く** | 低い目線から見ると、手前の柱が奥の柱を隠す | 計算: 客席（z=66m、目の高さ7m）から見て、手前帯（z=15.5m）が12mだと、4.9m奥の帯は**12.5m以上**ないと頭が見えない | 計算 |
| L5 | 主役は中央、左右は鏡写し | 視線が中央に集まる。対称形は「隊形」として読める | Dubai は5つの円と2つの弧。Grand Haven は同じ型のモジュール7つを A/B と交互に並べる | Wikipedia [S7][S6]・中 |
| L6 | 同じ型を繰り返すモジュールとして組む | 同じ動きを複製・反転・ずらしで使える | Grand Haven: 各モジュールに輪4組＋左右の Sweep ＋中央手前の Candelabra（45°・内向き） | [S6]・中 |
| L7 | 霧・細かい水は低く置き、高い柱と組む | 粒が軽いので風に持っていかれる | — | Safe Rain [S9]・高 |
| L8 | 独立して止められる系統に分ける | 静かな場面や風の強い日に一部だけで運転できる | — | Safe Rain [S1]・高 |
| L9 | 近くで見たときと遠くで見たときを両方設計する | 近くでは色と質感、遠くでは構造・順序・模様が見える | Station Park（27×15m、高さ9〜18m） | WaterShapes [S2]・中 |
| L10 | 水盤の底は暗い色（黒） | 深さが出て、水と光が浮く | 水深の業界標準は18in（約46cm） | Delta [S13]・中 |

**機材の比率**（WoC 2010、docs/research.md の数から計算）: グリッド約50%、チェイサー約33%、首振り（単＋双）約12%、その他（花・ダンサー・蝶・ガイザー）約3%。

**このショーの画角**（計算）: 客席中央から舞台の幅122mは**約85°**に広がる。目を動かさずに見やすい中心視野（およそ60°、一般論・推測）を超えるので、両端は周辺視野になる。→ 主役は x=±40m の内側に置く。ガイザー頂部（61m、77m先）の仰角は約35°。

---

## 3. 振付の語彙の辞典

業界共通の用語集はない。名前はメーカーや会場ごとの呼び名と、映像を見て整理したもの（推測を含む）。「作り方」はこのシミュレーターのマクロと stagger 順。

| 名前 | 形 | 向く場面 | このシミュレーターでの作り方 |
| --- | --- | --- | --- |
| Sweep（掃く） | 首振りの列が端から端へ一斉に倒れる | 旋律の大きなフレーズ、場面の始まり | whip `lean` angle ±40、stagger 0.04 `index`（戻りは `reverse`） |
| Sway（揺れ） | 一斉に、または逆向きにゆっくり左右へ揺れる | 静かな場面、ワルツ | `sway` amp 12〜20、period 6〜8。逆向きは左右の半分に分けて符号を変える |
| Fan open / close（扇） | 中央から外へ開き、閉じる | 決めのポーズ、和音の広がり | whip `spread` from −a to +a（開く）。閉じるのは to=0 |
| Cross（交差） | 左右の柱が中央の上で X に交わる | 緊張、対立、2つの声 | `spread` from +a to −a |
| Chase（追いかけ） | 光と水の窓が列や弧を走る | 打楽器、細かい音符、加速 | chaser `chase` speed 18〜30／s、hold 0.25。左右の弧で交互に |
| Swirl（渦） | 円周を回り続ける | 回転、魔法、上昇 | chaser 中央リングを `chase` laps 2〜4 |
| Wave／Mexican wave（波） | 高さの山が列を伝わる | 流れ、海、ゆったりした拍 | 1つの帯に `wave` period 2、stagger 0.02 `index` → 次は `reverse`。Grand Haven の Wave は「観客席のウェーブ」と説明される [S6] |
| Ripple（波紋） | 中央から外へ広がる | ひとつの音から広がる余韻 | `pulse` stagger 0.004 `center` |
| Gather／Collapse（集まる） | 外から中央へ寄る、外から消える | 終わり、まとめ、溜め | `set`/`off` stagger `edges` |
| Burst／Hit（打つ） | 全部が同時に一瞬立つ | 強拍、ドラムのクラッシュ | `pulse` hold 0.12〜0.4、stagger 0 |
| Shoot（撃つ） | 太い柱を1発 | 最大のアクセント、フィナーレ | geyser `pulse` hold 1〜2、白。間引いて（`geyser[0-9:3]`）使う |
| Bounce（弾む） | 同じ柱が少しずつ低く何度か立つ | 跳ねるリズム、ユーモア | 連続 `pulse` で level を 1→0.7→0.45 と下げる（専用マクロなし） |
| Cascade／Stairs（段） | 高さが端から段々に変わる | 下降・上昇する音階 | 現状は帯を区切った `set` の手書き。高さの勾配を作るマクロはない |
| Bloom／Crown（咲く・王冠） | 輪が外へ開く。中央に1本足すと王冠 | 頂点、解決、静かな一輪 | flower `bloom` to 18〜28。中央ガイザーと同時に出す |
| Swell／Breathe（膨らむ） | 高さが音量に合わせて満ち引きする | 弦の長い音、パッド | `follow` curve level/low/mid/high |
| Strobe／Flicker | 短い点滅 | 電子音、きらめき | `pulse` hold 0.05〜0.1 を連打。色を白に |
| Rainbow sweep | 色相が列を走る | フィナーレ | `rainbow` span 1 を1つの帯に |
| Call and response（掛け合い） | 左右が交互に答える | 2つの楽器の掛け合い | 左右の弧・左右の whip の半分に交互にキュー |
| Tableau（静止画） | 隊形のまま止める | 音の休み、溜め | 動きのキューを入れず、高さと色だけ保つ |

**使い方の原則**
- **隊形を保つ**: 同じ群は同じ形で動かす（揃っているか、規則正しくずれているか）。揃わない動きは乱れに見える（推測。WoC・Bellagio の映像の観察）。
- **一度に主役は1群**: 1つの群が主旋律を持ち、1〜2群が伴奏、残りは低く背景（推測）。
- **鏡写しを基本にする**: 左右対称、中央から外、外から中央。崩すのは「乱れ」を表したいときだけ（推測）。
- **低い位置での動きは見えにくい**: Grand Haven の振付者は回転噴水を高さのレベル4未満ではほぼ使わない [S6]。動かすときは十分な高さを出す。
- 振付は1拍ずつ手で付ける。Station Park では簡単な曲で2〜3日、複雑な曲で約10日 [S2]。Bellagio は2分の曲に最大1週間 [S4]。Grand Haven は1曲4〜60時間 [S6]。確度: 中

---

## 4. 物理・制約の数値表

### 式（摩擦なしの理想値）

- 初速 v = √(2gh)、上昇時間 t↑ = v/g = √(2h/g)、理想の滞空時間 = 2·t↑
- 必要な圧力 p = ρgh（1bar ≈ 10.2m）。実際は配管・ノズルの損失と空気抵抗で、これより高い圧力が要る
- 傾けた柱（鉛直から θ）: 最高点 = h·cos²θ、着水距離 R = 2h·sin2θ（h は真上に噴いたときの高さ）
- 霧の粒の落下速度（ストークス則）: v = ρ_w·g·d²/(18μ)

| 高さ h | 初速 | 上昇時間 | 理想の滞空時間 | 理想の圧力 | 該当機材 |
| --- | --- | --- | --- | --- | --- |
| 12m | 15.3m/s | 1.56s | 3.1s | 1.2bar | grid |
| 15m | 17.2m/s | 1.75s | 3.5s | 1.5bar | 水幕・fan |
| 25m | 22.1m/s | 2.26s | 4.5s | 2.5bar | chaser |
| 30m | 24.3m/s | 2.47s | 4.9s | 2.9bar | whip |
| 61m | 34.6m/s | 3.53s | 7.1s | 6.0bar | geyser |
| 73m | 37.8m/s | 3.86s | 7.7s | 7.2bar | Super Shooter |

| 項目 | 値 | 出典・確度 |
| --- | --- | --- |
| 実測の参考（ジュネーヴの Jet d'Eau） | 出口速度55m/s、ノズル径10cm、毎秒500L、空中の水は約7,000L、高さ約140〜150m | Wikipedia [S14]・中 |
| 落下は理想より遅い | 7,000L ÷ 500L/s ＝ 平均滞空 **約14s**。理想は約11s → **約1.3倍**（高い柱は砕けて粒になり、終端速度で落ちるため） | 計算・推測 |
| 雨粒の終端速度 | 直径1mm ≈ 4m/s、2mm ≈ 6.5m/s、3mm ≈ 8m/s | 一般的な気象の値（Gunn & Kinzer 1949）・中 |
| 霧の滞留 | 直径20µm の粒は約1.2cm/s で落ちる → 10m 落ちるのに約14分。消えるのは主に風で流れるから | 計算 |
| 61m の柱が消えるまで | 弁を閉じてから約7〜9s は空中に水が残る | 計算・推測 |
| ポンプ（VFD）の応答 | OASE Varionaut 150/270: 高さ0→100%が**約1s**。400: 約10mまで1.1s。起動は電源投入後3s未満 | OASE 仕様 [S15]・高 |
| 大型ポンプの応答 | 大型ではもっと遅く数秒（推測）。Dubai の Extreme Shooter は圧力を溜める時間が長いので使う回数が少ない（要出典つき） | [S7]・低 |
| 電磁弁の応答 | 高速の電磁弁は25ms未満 | 技術ブログ・低 |
| 空気式（Shooter） | 管内の流速がノズルの1/36なので、噴出が瞬時に止まる（既知の特許） | 高 |
| 首振りの最高角速度 | OASE 2軸ドライブ **72°/s**。Disney 特許: 110°を2s未満（55°/s以上）。Grand Haven Sweep は9段階の速度 | [S3]・高、[S6]・中 |
| 風による自動制限 | OASE: 風の強さで高さを3段階に下げるか停止。Roman Fountains: 3杯式の風速計で0〜25mph（約11m/s）に設定。Station Park: 4段階で流量を下げる。Bellagio: **25mph（約11m/s）でショー中止**、それ未満は風に合わせて調整 | [S16]・高、[S2]・中、[S4]・中 |
| 泡の柱 | 空気が多いほど白い。風に強く、水面の波で形が崩れない。音は大きい | [S8][S13]・中 |
| 細い噴口 | 風と詰まりに弱い | Fountain People（検索要約）・中 |
| 制御の時間精度 | DMX512 は全512chで約44回/s。音と光が約50msずれると気づかれる | 一般的な仕様・高／技術ブログ・低 |

---

## 5. 制御とプログラミング

- **WoC**: grandMA2 卓4台 → MA-Net → FTSI の独自インターフェース → EtherCAT で噴水へ。噴水を**ムービングライトのように**扱う発想（技術監督 Bill Slusser）。主任の噴水プログラマー Jason Badger は照明のムービングライトのプログラマー出身。確度: 中 [S17]
- **Fountain People**: DMX で自社の事務所でプログラムし、書き出して客に渡す。決める前に3Dのレンダリングとアニメーションを客とオンラインで確認する。ソフトは「動画編集ソフトによく似ている」。確度: 中 [S2]
- **OASE**: 無料の WEPS（最大1,024ch、ブロック表示で水の模様を組む、配管長と高低差の補正、WECS III へリアルタイム送信）。大規模は Syncronorm の Depence2（実際の物理条件でハードを再現するプレビズ → そのまま本番のプログラム）。確度: 高 [S18][S19]
- **MediaMation Virtual Fountain**: 円・弧・直線に配置、首振り・昇降・回転、ポンプの立ち上がり・立ち下がり時間を設定、重力のある3Dプレビュー、MIDI シーケンサーで制御。確度: 中 [S20]
- **WET**: 自社ソフトの名前は非公開。振付者は「優雅な動きをコードと数式で書く」と話す。確度: 中 [S21]
- **共通する考え方**: タイムコード（曲）に合わせたタイムライン。チャンネル＝ポンプ・弁・首振りの軸・照明。**プレビズで物理（立ち上がり時間・重力）込みで確かめてから現地で微調整**。

---

## 6. やってはいけないこと

1. 首振りを機材の最高角速度より速く動かす（72°/s 程度が上限。イーズがあると途中の速さは平均の約2倍になる）。
2. 傾けた柱を全圧で噴く。30m の柱を55°傾けると最高点は約10mだが、着水は約56m先（計算）。客席側や水盤の外に落ちる。
3. 手前の帯を最大にして奥の帯を見せようとする（L4）。
4. 高い柱を、落ち切る前に次のキューと重ねて「消えた」ことにする。61m の柱は閉じても7〜9s 空中に残る。暗転には時間が要る。
5. ポンプ駆動の機材で、1拍より短い高さの変化を期待する（0→100%に約1s）。速い打撃は弁か空気式で作る。
6. 霧・細かい水を高く上げる（風で流れる）。
7. 全部を同時に最大にし続ける。山場がなくなり、水量・飛沫の制限にもかかる（推測）。
8. 同じ群をばらばらに動かす（隊形が崩れて見える。推測）。

---

## 7. 今のレイアウトと振付への示唆

1. **グリッド全体（'grid'）への stagger が空間とずれている**（コードを読んで確認）。ranks() は並び順だけで決まり、grid は前・中・後の帯（各88基）を順につないだ264基。そのため `order:'center'` は中帯の中央から始まり、前と後の帯は端から中央へ向かう。`rainbow` は帯ごとに色相の1/3ずつになる。該当箇所は src/show/choreography.ts の 152・232・283・298・303 行。→ ROW ごとに分けて書くか、ranks を x 座標で計算する。
2. **spread が速すぎる**: `spread −50→50, dur 1.2`（188・223 行）と `−45→45, 1.2`（129 行）は、端の1基が100°を1.2s で動く。inOut だと途中の速さは約167°/s で、HEAD_MAX_DEG_S=90 の制限で約2.2s に延びる。その分、拍に遅れて着く。→ dur ≥ 2×角度÷上限 で書く。上限は特許とメーカーの値に合わせて60〜72°/s にするのが妥当（推測）。
3. **傾き×圧力の制限がない**: 30m の whip が全圧で40°以上傾くと、計算では50m以上先に落ちる。客席（whip から60m）側に倒すときは圧力を下げる規則を入れる（推測。実機も同じはず）。
4. **stagger 順を足す**: Grand Haven の A/B 交互・「揃って／逆向きに」揺れる Sweep に当たる `alternate`（奇数と偶数）と `mirror`（左右が中央から鏡写し）。高さの段を作る `ramp` マクロ（pressure を位置で線形に変える＝spread の pressure 版）。
5. **奥行きの層**: 前・中・後の帯の高さは「前低・後高」が原則（L4）。今の follow（前＝高音で低め、後＝低音で高め）は正しい。前帯を全開にする場面（288 行の X など）では中・後帯は見えないと割り切る。
6. **比率**: チェイサーが全体の15%（WoC は約33%）。追いかけの場面を厚くしたいなら、弧かリングを足す余地がある。
7. **暗転・切り替え**: geyser の後は7〜9s、grid は約3s、水が空中に残る。暗い場面の頭は、その分前に消すキューを置く。
8. **風**（任意）: 風速を1つ入れ、11m/s 前後で高い機材（geyser、whip）から段階的に下げる。実機の動きをそのまま見せられる（推測）。

---

## 出典

- [S1] Safe Rain「Tips of fountain design Part 1」、ノズル製品ページ https://saferain.com/en/blog/tips-of-fountain-design-part-1/ ・ https://saferain.com/en/fountain-equipment/fountain-nozzles/
- [S2] WaterShapes「Fountain Fascination」（Chris Thomas、Fountain People、2020）https://watershapes.com/fountain-fascination/ ／ Pool & Spa Marketing https://www.poolspamarketing.com/trade/features/show-fountains-attract-visitors-choreographed-music-water-lights/2/
- [S3] OASE Multi Directional Drive S/L/XL 2D https://www.oase.com/en-AU/fountain-technology/multi-directional-drive-l-2d-dmx02
- [S4] Wikipedia「Fountains of Bellagio」https://en.wikipedia.org/wiki/Fountains_of_Bellagio ／ Las Vegas Advisor https://www.lasvegasadvisor.com/question/bellagio-fountains-nozzles/
- [S5] Safe Rain Large Fan of Jets https://saferain.com/en/fountain-equipment/fountain-nozzles/crystalline-fountain-jets/large-fan-of-jets/ （Phoenix tail の数値は販売サイト・低）
- [S6] Wikipedia「Grand Haven Musical Fountain」https://en.wikipedia.org/wiki/Grand_Haven_Musical_Fountain
- [S7] Wikipedia「Dubai Fountain」https://en.wikipedia.org/wiki/Dubai_Fountain
- [S8] Water Garden（泡ノズル）https://www.water-garden.co.uk/cat/water-features/fountain-nozzles-spray-rings/foam-jet
- [S9] Safe Rain Calix jet データシート https://saferain.com/wp-content/uploads/2025/07/crystalline_fountain_nozzle_calix-jet.pdf
- [S10] Aquatique Show 水幕 https://www.aquatic-show.com/en/water-effects/water-screen
- [S11] OASE WaterScreenNozzle XL https://www.oase.com/cs-CZ/fountain-technology/waterscreennozzle-xl
- [S12] Safe Rain「Tips of fountain design Part 2」https://saferain.com/en/blog/tips-of-fountain-design-part-2/
- [S13] Delta Fountains 設計の手引き https://www.deltafountains.com/?p=772
- [S14] Wikipedia「Jet d'Eau」https://en.wikipedia.org/wiki/Jet_d%27Eau
- [S15] OASE Varionaut 270/400 DMX/02 https://www.oase.com/en-US/fountain-technology/varionaut-270-dmx02-us
- [S16] OASE Wind-dependent fountain control 3 K INT https://www.oase.com/en-US/fountain-technology/wind-dependent-fountain-control-3-k-int ／ Roman Fountains RWC https://landscapearchitect.com/ladetails/landscape-product/fountains-equipment/roman-fountains-corp./rwc-sm-dul-wind-control
- [S17] Live Design「World of Color」https://www.livedesignonline.com/installations/world-color-at-disney-california-adventure （本文は403で読めず、検索の要約から）
- [S18] OASE WEPS https://www.oase.com/en-US/fountain-technology/weps-software ／ OASE カタログ「Show programming」（WECS III・Depence2）
- [S19] Syncronorm × OASE https://www.syncronorm.com/newsitem/oase-living-water
- [S20] MediaMation Virtual Fountain https://www.mediamation.com/?p=4984
- [S21] Directors Notes（WET の振付者のインタビュー）https://directorsnotes.com/?p=90977

**確認できなかったこと**: WET Hypershooter・Fireballs の仕様、Dubai の機材数と風の規則、Crystal Fountains・Lumiartecnia のソフト名、大型ポンプの応答時間の実測値、「水盤は高さの何倍」という定まった倍率（見つかったのは1:1と0.5の2説）。
