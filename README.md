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

コードのコメントや文書に出てくる `docs/handoff.md`・`docs/video-review.md`・`docs/lab-analysis.md`・`docs/vr180-analysis.md`・`docs/test-scenarios.md`・`docs/reports/`・`docs/reviews/` と、`shots/`・`backups/` は作者の手元だけの作業メモ・記録で、このリポジトリには入っていない（経緯の出典として名前だけ残している）。

プロジェクトは `projects/<id>/`（`project.json` と一覧の絵 `thumb.jpg`）に保存される。**GitHub には入れない**：`.gitignore` で `projects/*` を外し、見本の `projects/sample-*/` だけ残す。見本の絵とスタート画面の背景は `node scripts/home-assets.mjs` で撮り直す。

## ショーの操作

| 操作 | キー・場所 |
| --- | --- |
| 再生・一時停止 | Space、下部バーの ▶ |
| 5秒送る・戻す | → / ← |
| 照明の切替（リアル／理想） | L、下部バー |
| カメラ（客席／目線／スクリーン前／遠景／水面／左／右／空撮／花火と水／花火／おまかせ／自由） | 下部バーの「カメラ ▾」、数字キー 1〜0（1 客席 … 9 花火と水、0 花火）。おまかせは自動でカットとカメラワークが変わる。自由はドラッグで回転・ホイールで拡大 |
| 動画の書き出し | 下部バーの「動画を書き出す」 |
| 品質（自動・高・中・低） | 下部バー。自動は直近60フレームの平均が20msを超えると1段下げる |

本番画面（`play.html`）の URL の指定（2つ以上は `&` でつなぐ。例 `/play.html?show=hanabi&t=160&cam=sky`。前の形の `/?show=…` も `play.html` に回る）：

- `?project=<id>`（プロジェクト。見本の `sample-hanabi` なども可）
- `?show=fantasia|hanabi`（版。なしは Night Lagoon）、`?show=edited`（最後にエディタで開いたプロジェクト）
- `?t=42`（開始位置）、`?light=ideal`、`?quality=high|medium|low`
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

客席から見た 180° の立体映像（MV-HEVC、Apple Projected Media Profile）も、同じ「動画を書き出す」の画面から書き出す。

1. 「形式」で「Vision Pro（180° 立体）」を選ぶ
2. 「1か所から撮る」の席を選ぶ（おまかせは使えない）
3. 範囲と「片目 4096」（ふつう）か「片目 7680」を選び、下に出る所要時間とファイルの大きさを見てから書き出す
4. 終わったら「Finder で表示」（`exports/visionpro/`）。AirDrop で Vision Pro に送り、写真アプリで見る

全編だと約 2.7 GB・約 130 分かかる。片目 7680 は実機での再生を確かめていない。

## 照明の2モード

- **リアル（機材どおり）**：各ノズルに同軸のLEDリングが1つ（Disney 特許 US7886992 の構成）。距離の2乗で減衰するビームで照らし、落差は目の見え方に合わせて圧縮する。まとまった柱の中は同じリングの光が通るので、傾いたウィップも先まで光るが、根元から先へ暗くなる。分裂した水はビームから外れると暗い
- **理想（見栄え優先）**：柱の中を光が運ばれ、頂上まで均一に色が付く。実在の機材の裏付けはない

## 音楽

- 既存の音源をそのまま流す。`public/music/background.mp3`（.m4a / .ogg / .wav も可）を置くと、ショーとエディタが読み込む。ショーの開始画面の「音楽ファイルを選ぶ」でも選べる（その場限り）
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
