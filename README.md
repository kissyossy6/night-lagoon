# Night Lagoon（噴水ショー・シミュレーター v2）

夜の湖で、音楽に合わせて約370基の噴水・光・水幕の映像が動く3分半のショーを、ブラウザで再現する。World of Color の機材構成（docs/research.md）を参考にした個人制作の作品。映像と振り付けは自作。音楽は手元の音源を流す（下の「音楽」）。

## はじめかた

### 用意するもの

- [Node.js](https://nodejs.org/) 20 以上（`node -v` で確かめる）
- Chrome か Edge（WebGL2 を使う。動画の書き出しは WebCodecs が必要）
- 曲を入れるなら [ffmpeg](https://ffmpeg.org/)（Mac：`brew install ffmpeg`／Windows：`winget install ffmpeg`）

### 1. 取ってきて、部品を入れる

```bash
git clone https://github.com/kissyossy6/night-lagoon.git
cd night-lagoon
npm install
```

### 2. 曲を作る（入れなくても動く）

曲は GitHub に入れていない。元の録音（パブリックドメイン）を Wikimedia Commons から取ってきて、ショー用の 3 分 34 秒に作る（約 52 MB を取ってくる。数秒で終わる）：

```bash
npm run music
```

`public/music/background.mp3` ができる。曲がないときは無音で動き、スタート画面の「音楽ファイルを選ぶ」で手元の曲を選ぶこともできる。詳しくは下の「音楽」。

### 3. 動かす

```bash
npm run dev
```

ブラウザで http://localhost:5199/ を開く。見本のプロジェクト（Night Lagoon・ファンタジア・花火）から始められる。

### 動かし方の一覧

- スタート・プロジェクト一覧：http://localhost:5199/ → プロジェクトを選ぶ → エディタ（`edit.html?project=<id>`）→「▶ 本番で再生」で本番画面（`play.html?project=<id>`）。流れは `docs/screen-flow.html`
- 本番画面を直接：http://localhost:5199/play.html（版は Night Lagoon・`?show=fantasia`（ファンタジア版）・`?show=hanabi`（花火版））
- タイムラインエディタ（確認用・プロジェクトなし）：http://localhost:5199/edit.html
- 会場エディタ：http://localhost:5199/venue.html
- ノズル単体のラボ：http://localhost:5199/lab.html

使い方の詳しい説明は `docs/manual/index.html`（マニュアル）。

コードのコメントや文書に出てくる `docs/handoff.md`・`docs/video-review.md`・`docs/lab-analysis.md`・`docs/vr180-analysis.md`・`docs/walkaround-plan.md`・`docs/test-scenarios.md`・`docs/reports/`・`docs/reviews/` と、`shots/`・`backups/` は作者の手元だけの作業メモ・記録で、このリポジトリには入っていない（経緯の出典として名前だけ残している）。

プロジェクトは `projects/<id>/`（`project.json` と一覧の絵 `thumb.jpg`）に保存される。**GitHub には入れない**：`.gitignore` で `projects/*` を外し、見本の `projects/sample-*/` だけ残す。見本の絵とスタート画面の背景は `node scripts/home-assets.mjs` で撮り直す。

## ショーの操作

| 操作 | キー・場所 |
| --- | --- |
| 再生・一時停止 | Space、下部バーの ▶ |
| 5秒送る・戻す | → / ← |
| 照明の切替（リアル／理想） | L、下部バーの「表示 ▾」 |
| 機材の本体を出す／隠す | F、「表示 ▾」の「機材」 |
| 景色（岸・手すり・客）を出す／隠す | K、「表示 ▾」の「景色」。隠すと景色を入れる前と同じ絵。表示の札に「・景色なし」 |
| カメラ（客席／目線／スクリーン前／遠景／水面／左／右／空撮／花火と水／花火／おまかせ／自由） | 下部バーの「カメラ ▾」、数字キー 1〜0（1 客席 … 9 花火と水、0 花火）。おまかせは自動でカットとカメラワークが変わる。自由はドラッグで回転・ホイールで拡大 |
| 動画の書き出し | 下部バーの「動画を書き出す」 |
| 品質（自動・高・中・低） | 「表示 ▾」の「画質」。自動は直近60フレームの平均が20msを超えると1段下げる |

本番画面（`play.html`）の URL の指定（2つ以上は `&` でつなぐ。例 `/play.html?show=hanabi&t=160&cam=sky`。前の形の `/?show=…` も `play.html` に回る）：

- `?project=<id>`（プロジェクト。見本の `sample-hanabi` なども可）
- `?show=fantasia|hanabi`（版。なしは Night Lagoon）、`?show=edited`（最後にエディタで開いたプロジェクト）
- `?t=42`（開始位置）、`?light=ideal`、`?quality=high|medium|low`
- `?fixtures=0`（機材の本体を隠す）、`?scenery=0`（景色を隠す）
- `?cam=audience|eye|screen|wide|low|left|right|aerial|sky|pyro|auto|free`
- `?venue=desk|garden|plaza|lagoon`（会場。自分で作った会場の id も可）
- `?gfx=off`（確かめ用：水面の新しい見た目を切る。`impact,surface,mist` のうち書いたものだけ入れる、`all` で全部）
- `?music=score|original`（自作の曲を生成して流す）

一覧と説明はマニュアルの「URL の付け足し」。

## 動画の書き出し

下部バーの「動画を書き出す」から、ショーを MP4（H.264＋AAC、音楽つき）にする。

- **1か所から撮る**：選んだアングル（自由カメラなら今の視点）に固定して撮る
- **おまかせ**：いろいろな角度で自動に撮る（`src/show/cameras.ts` の `directShow`）。静かな場面はゆっくり長いカメラワーク、2回のトゥッティとフィナーレは短いカットで、カットは音楽の立ち上がりに合わせる。ガイザーが上がる瞬間は遠景、物語の場面は水幕を正面から動かさずに撮る。同じ音源なら毎回同じ編集になる
- 範囲（全編／秒で指定）、解像度（720p〜4K）、30／60 fps を選べる。照明は今のモード
- 実時間で録画するのではなく、1コマずつ描いて WebCodecs で書き出す（`src/export/video.ts`）。重い場面でもコマ落ちせず、音とずれない
- Chrome / Edge で動く（WebCodecs が必要）

### Vision Pro 用の 180° 立体映像

客席から見た 180° の立体映像（MV-HEVC、Apple Projected Media Profile）も、同じ「動画を書き出す」の画面から書き出す。開発サーバー（`npm run dev`）で開いたときだけ使える。

1. 「形式」で「Vision Pro（180° 立体）」を選ぶ
2. 「1か所から撮る」の席を選ぶ（おまかせは使えない。カメラは動かない）。一覧の先頭の「**近い席（会場の形から自動）**」は、会場の形から決めた、人がいられるいちばん近い場所（客席の縁より前に出ない・機材から水の高さぶん離れて飛沫が掛からない・目は人の高さ。`src/show/near-seat.ts`）。近いほど両目の立体感が出る。180° のときだけ出る。湖では岸の座る客の中、機材の真ん中まで約 52 m（「客席」は 68 m）
3. 範囲、「片目 4096」（ふつう）か「片目 7680」、30／60 fps を選ぶ。60 fps は片目 4096 だけ（Apple の上限 150 Mbps に収めるため品質 0.8 で書く。30 fps は 0.85）。片目 7680 は 30 fps まで
4. 「音」で「空間（Vision Pro）」（初め）か「ステレオ」を選ぶ。空間は、音楽が舞台の左右、花火が破裂した所、水音が噴水から聞こえ、頭を回しても音が会場に残る（3次アンビソニックスを Apple の APAC にして入れる。`src/audio/spatial.ts`）。ファイル名の末尾が `_spatial`。ステレオは今までどおり
5. 下の注（所要時間・ファイルの大きさ・席から機材の真ん中までと左右の目の差。花火のある版で客席の縁より前の席には ⚠ 花火の保安距離の内側）を見てから書き出す。書き出し中はタブを開いたままにする
6. 終わったら「Finder で表示」（`exports/visionpro/`）。AirDrop で Vision Pro に送り、写真アプリで見る

所要時間と大きさの目安（このMac で測った値。全編 3分37秒）：

| 片目 | fps | 1コマ | 全編の所要 | 全編の大きさ |
| --- | --- | --- | --- | --- |
| 4096 | 30 | 約 2.5 秒 | 約 4.5 時間 | 画面の見積もり 2.7 GB |
| 4096 | 60 | 約 2.5 秒 | 約 9 時間 | 画面の見積もり 2.0 GB（実際に書き出した全編は 1.5 GB） |
| 7680 | 30 | 約 7.1 秒 | 約 13 時間 | 画面の見積もり 3.7 GB |

画面の大きさの見積もりは重い場面の値で出すので、静かな場面の多い範囲では実際はもっと小さい（`src/export/vr180-video.ts` の `vr180BytesPerSecond`）。

**実機ではまだ確かめていない**：Vision Pro の実機で、60 fps・近い席の立体感・空間の音（頭の向きに合わせて鳴るか）・片目 7680 の再生は、どれもまだ見ていない（Mac の上で、書き出せること・音の向きを Apple の変換で2chにした数字までは確かめた。`node scripts/spatial-check.mjs`）。

## 会場と景色

会場エディタ（`venue.html`）で、噴水を置く場所を部品で作る。水の機材の部品（列・帯・弧・円・1台・水幕・プロジェクター・花火の台・客席）のほかに、「＋ 部品を足す ▾」の「景色」で、描くだけの部品を置ける（キューでは動かない）：

- **岸**：護岸・歩道と、その後ろ地平線まで続く地面。「水面の縁ぜんぶ」か「線で引く」。高さ（水面から）と舗装の幅
- **手すり**：線。高さと柱の間隔。足元の岸の上に立つ
- **客**：線の後ろの帯に人の群れ。奥行き・密度（人/m²）・立つ／座る。人は機材の真ん中を向く。下の帯に「客 N人」

組み込みの会場：湖は手前の岸・岸の手すり・座る客と立つ客で 3,082 人、広場は舗装と客 140 人、庭は芝と縁石と2人、机の2つは水槽の縁と天板だけ（机の席は机の前の1人なので人は置かない。人形の大きさの人を置くと水槽が模型に見える）。景色にも会場の決まり（止める・赤・黄、`src/venues/rules.ts` の `sceneryFindings`）がある。本番画面・エディタ・動画と 180° の書き出しに描き、カメラのすぐ前で舞台を塞ぐ人は描かない。描き方は `src/show/scenery.ts`、人の位置は `src/venues/landscape.ts`。

## 照明の2モード

- **リアル（機材どおり）**：各ノズルに同軸のLEDリングが1つ（Disney 特許 US7886992 の構成）。距離の2乗で減衰するビームで照らし、落差は目の見え方に合わせて圧縮する。まとまった柱の中は同じリングの光が通るので、傾いたウィップも先まで光るが、根元から先へ暗くなる。分裂した水はビームから外れると暗い
- **理想（見栄え優先）**：柱の中を光が運ばれ、頂上まで均一に色が付く。実在の機材の裏付けはない

## 音楽

- **プロジェクトごとの曲**：エディタの「ショー設定」の「曲を選ぶ…」で、そのプロジェクトに自分の曲を入れられる。曲は `projects/<id>/music-<hash>.<拡張子>` に置かれ（GitHub には入らない）、ショーの長さは曲の長さ、区間は「全体」から、拍の目安（BPM・最初の拍）を曲から測る。水幕は場面を選ぶまで黒。設計は `docs/music-plan.md`、確認は `node scripts/music-check.mjs`
- **振付の下書き**：自分の曲を入れたら「この曲で下書きを作る」（または新規で曲を選ぶときの「下書きを作る」）で、曲の大きさと音の頭から、静かな始まり・二段の山・暗転・白い最後の一撃までの下書きができる（`src/show/draft.ts`、`docs/music-plan.md` 6）
- 曲を入れていないプロジェクトと見本は、共通の曲を流す。`public/music/background.mp3`（.m4a / .ogg / .wav も可）を置くと、ショーとエディタが読み込む。ショーの開始画面の「音楽ファイルを選ぶ」でも選べる（その場限り）
- 曲のファイルは GitHub に入れていない。`npm run music`（`scripts/get-music.mjs`）が元の録音を取ってきて作る。録音がもう手元にあれば `npm run music -- --source <ファイル.oga>`、作り直すときは `npm run music -- --force`。音量の上げ下げは `scripts/music/gain.json`（作ったときの曲から測った値）、取ってきた録音は `.cache/music/` に残る
- 時計は音源の再生位置に合わせて進む
- 読み込んだ音源は、その場で波形を分析する（`src/audio/analysis.ts`、約0.8秒）。低音・中音・高音の音量と、音の立ち上がり（オンセット）を取り出し、振り付けを作り直す：グリッドの帯の高さが音量に合わせて上下し（`follow` マクロ）、強い立ち上がりで手前の帯が跳ね、チェイサーが走り、ウィップが隊形を変える。ガイザーは一番近い立ち上がりに合わせる
- 場面の区切り（色・暗転・水幕・ガイザーの3回）は、この録音で測った目印（`src/show/song.ts` の `MUSIC`）に置いてある。別の曲にするときは、ここを測り直す
- ショーの長さ（217秒）より長い音源は、最後の2.5秒でフェードして切る。音源がなければ無音で動く
- 自作の曲も残してある：`?music=score`（ラプソディー・イン・ブルーの編曲、サンプル音源、`src/audio/score.ts`）、`?music=original`（合成音の曲、`src/audio/original-score.ts`）

## ライセンス

このリポジトリのコード・文書・画像は [MIT ライセンス](LICENSE)。ただし、下の「クレジット」にある他の人の素材（書体・楽器サンプル・曲）は、それぞれのライセンスに従う。

## クレジット

- 書体（`public/fonts/`）：BIZ UD ゴシック／BIZ UDP ゴシック（The BIZ UDGothic Project Authors、モリサワ）、SIL Open Font License 1.1（`public/fonts/OFL.txt`）

- 背景音楽（`public/music/background.mp3`）：ガーシュウィン「ラプソディー・イン・ブルー」、演奏 米国海兵隊バンド、ピアノ ブラムウェル・トーヴィー（2018年7月10日、ストラスモア）。米国政府の録音のためパブリックドメイン（Wikimedia Commons「US Marine Band Rhapsody in Blue.oga」）。冒頭から176.5秒までと、曲の最後の30秒（全曲の1046秒〜最後の和音）を強い一打の所でつなぎ（`scripts/splice-ending.py`）、最後の和音に残響を足し、音量をそろえて mp3 にした（3分34秒）。演奏しているグローフェの1924年版の編曲は、米国外ではまだ著作権が残っている国があるので、個人で楽しむ範囲で使う
- 楽器サンプル（`?music=score` で使用）：FluidR3 GM（Frank Wen）、Creative Commons Attribution 3.0。[gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) の mp3 版から、3半音おきの音を取り出して使用（`public/samples/fluidr3`）

## 水スクリーン

- `screen`：横長の1枚（幅116m）。`mound[0-0]`・`mound[1-1]`・`mound[2-2]`：左・中央・右の山（World of Color の3つの山）
- どれも水圧＝高さ、明るさ＝投影の明るさ。同じパノラマ映像の、その位置にあたる部分が映る

## 演出のスキル（Claude Code 用）

`.claude/skills/` に、噴水ショーの演出チームの職能を8つのスキルにしてある。Claude Code でこのフォルダを開き、「フィナーレを良くして」「今のショーを講評して」のように頼むと、`show-director` から始まって必要なスキルが順に使われる。

| スキル | 職能 | 決めること |
| --- | --- | --- |
| `show-director` | 総合演出（入口） | 構成・山と谷・ご褒美の配り方、演出台本（`docs/show-plan.md`）、講評の採点表 |
| `music-to-water` | 音楽の読み取り | 音楽地図（区間・追う声部・同期点）、音の割り振り、先取り |
| `fountain-choreography` | 振付 | 場面ごとの主役・伴奏・背景、隊形、時差、キュー |
| `show-lighting` | 照明 | カラースクリプト、明暗、暗転、光で打つ拍 |
| `water-screen-media` | 水幕映像 | 水幕を出す場面、形、映像の中身、額縁 |
| `fountain-layout` | 機材配置 | 機材の数・位置・並び・番号 |
| `fountain-physics` | 技術監督 | 立ち上がり・落下・首振り・着水点・重さの確認 |
| `sound-design` | 音づくり | 花火のドン・水しぶきなどの音を、実物の録音を解析した数字から作る |

根拠は `docs/show-knowledge/`（文献・権威の調査と、Bellagio・Dubai・World of Color・万博のショー映像の分析）。

## 仕組み

```
振り付け（src/show/choreography.ts → ShowFile JSON）
  → キューのコンパイル（src/show/cues.ts：マクロ展開、時刻の純関数）
  → パラメータ履歴テクスチャ（src/show/history.ts：各ノズルの直近12.8秒）
  → 水の評価パス（src/show/jetfield.ts：粒子と柱リボンを浮動小数テクスチャに計算）
  → 描画（柱リボン＋飛沫＋霧、水面反射、ブルーム、ACES）
時計 = 音楽の再生位置（src/show/clock.ts）
```

- 描画方式は全ノズル「方式E」（ラボ `lab.html` で5つの方式を比べて決めた）
- 粒子は解析解で計算するので、どの時刻にも前計算なしでシークできる
- 粒子の枠は「出た水の量」で等間隔に配るので、短いショットにも枠が集中する

## 検証スクリプト（開発サーバー起動中に実行）

撮影と確認は Playwright の Chromium を使う。初めてのときだけ `npx playwright install chromium` を実行する。

| コマンド | 内容 |
| --- | --- |
| `node scripts/show-shot.mjs --t=60,128 --perf` | ショーを撮影し、1フレームの時間を測る |
| `node scripts/player-check.mjs` | 音楽生成・再生・シーク・一時停止を通しで確認 |
| `node scripts/sync-check.mjs` | 大きな噴き上げが音楽のアクセントに合っているか |
| `node scripts/shot.mjs` | ラボでノズル×描画方式を撮影 |
| `node scripts/audio-check.mjs` | 音楽の長さ・ピーク・セクションごとの音量 |
| `node scripts/projection-check.mjs` | 水幕の映像のコンタクトシート |
| `node scripts/editor-check.mjs` | エディタの操作確認 |
| `node scripts/music-check.mjs` | プロジェクトごとの曲：入れる・長さ・拍の目安・警告・⌘Z・本番再生・水幕が黒 |
| `node scripts/venue-race-check.mjs` | 曲の解析前に会場を切り替えても戻らない |
| `node scripts/tempo-check.mjs` | 拍の目安：120 BPM で作った曲で 120、テンポが揺れる録音では出さない |
| `node scripts/draft-check.mjs` | 自分の曲から作る振付の下書き：構成・警告・机でも作れる・場面ごとの写真（`shots/draft/`） |
| `node scripts/scenery-check.mjs` | 会場の景色：古い会場は景色なし・岸の高さに立つ・水の上の人を外す・決まり・組み込みの会場の警告 |
| `node scripts/scenery-cost.mjs` | 景色を出す／隠すで1コマの時間を比べる |
| `node scripts/spatial-check.mjs` | Vision Pro の空間の音：頭の向きごとに Apple の変換で2chにして、左右の耳を測る（Mac の macOS 26 以降） |

開発サーバーで本番画面が開かず、コンソールに `504 (Outdated Optimize Dep)` が出るときは、開発サーバーを起動し直す（`vite.config.ts` の `optimizeDeps` で、three の `BufferGeometryUtils` を初めから束ねるようにして、起きにくくした）。

## 歩き回る（試作・まだ実験）

Vision Pro の中を歩いて見るための試作。計画は `docs/walkaround-plan.md`（Safari の WebXR で今のショーを描き、歩くのは客席のまわりだけ）。今あるのは、VR 用の軽い画質「VR」（本番画面の `?quality=vr`。メニューには出していない。高・中・低の絵は変えていない）と、両目を並べて描く試し台 `tools/vr-look.html`（`src/xr/`。`?perf=1` で重さを測る）、測る道具 `tools/walkaround/`。このMac で両目ぶん 3〜4.6 ms まで軽くした。WebXR にはまだつないでおらず、Vision Pro の実機では試していない。

## 机の噴水（実物）

机の上の 8 台の小さな噴水を、エディタから Art-Net で動かす。会場「机の試作（8台）」、ESP32 のプログラム `tools/desk-fountain/`（Wi-Fi の設定は `secrets.example.h` を `secrets.h` に写す。GitHub には入らない）。部品・配線・合わせ直しは `docs/desk-build.md`。
