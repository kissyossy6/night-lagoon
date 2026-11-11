---
name: show-compare
description: 噴水ショーの「今｜案」を、同じ時刻・同じ席で撮って並べて見せる。コードを変えずに振付の案を組み立てる（make-proposal）、今と案を撮る（capture）、並べた1枚・動きの連続コマ・明るさの表・ボタンで切り替える比較ページを作る（sheet）、描き方を変える前の状態を別のポート 5299 で残して撮る（snapshot-before）、他の版が0画素も変わっていないことを確かめる（diff）。演出・振付・色・水幕・花火・描き方の案を出すとき、直したあとに前後を見せるとき、「今と案を並べて」「比べたい」「前後で見せて」「切り替えて見たい」「本当に変わってない？」「入ってない気がする」と言われたとき、show-director・各専門スキルが「撮って見せる」段に来たときは、名前を出されなくても必ず使うこと。何を見せるか（演出の中身）は決めない。それは show-director と各専門スキル。
---

# show-compare（今｜案を撮って見せる）

このユーザーは、文章の案ではなく**見比べて決める**。「今と案を並べて見せてから実装して」は、場面を作り直すたびに言われてきた。並べ方にも好みがある：同じ時刻・同じ席で左に今・右に案、動きは連続のコマ、ボタンで切り替えて見る、2つの画面を分ける。

このスキルは、その撮り方と見せ方を道具にしたもの。道具は全部 `scripts/` にある（このスキルのフォルダの中）。開発サーバー http://localhost:5199 が動いていること（`preview_start` の `water-show-v2`）。

## どの撮り方か

| 変えるもの | 「今」の出どころ | 「案」の出どころ |
| --- | --- | --- |
| 振付・色・水幕・花火のキュー（中身） | 今の版 `show=lagoon` など | `make-proposal.mjs` で作ったファイル（コードは変えない） |
| 描き方・物理・エンジン（コード） | 変える前に `snapshot-before.sh` で写した控えを 5299 で | 変えたあとの 5199 |
| 会場 | `venue=lagoon` | `venue=plaza` など（同じショー） |

## 1. 案を組み立てる（中身の案）

```bash
node .claude/skills/show-compare/scripts/make-proposal.mjs --base=lagoon --edit=shots/<話題>/edit.mjs --out=shots/<話題>/proposal.json
```

`edit.mjs` はブラウザの中で動く小さな関数で、`buildShow` が作ったショーのキューを足す・消す・直す（書き方はスクリプトの頭）。

- **音楽を解析してから組み立てる**。プレイヤーの「今」は波形に追従するキュー（`follow`・`pops`・onsets）込みで動いているので、音楽なしで組み立てた案と比べると、関係ない所まで違って見える。make-proposal は音楽込みで組み立てる
- 首振りの上限にかかったキューの数も出る。0 でなければ、その案は実機で間に合わない（fountain-physics）
- `duration` は 217 秒にそろえる（短いと、再生のときにラストが組み込みのものに差し替わる）。スクリプトが自動でそろえる

## 2. 撮る

```bash
node .claude/skills/show-compare/scripts/capture.mjs --out=shots/<話題> \
  --src=now:show=lagoon --src=new:file=shots/<話題>/proposal.json \
  --t=62.53,66.5,69.42          # 静止画
  # または --from=91.6 --to=94 --step=0.4   # 動きの連続コマ
  [--cam=audience] [--light=real]
```

- `--src=<名前>:<中身>`。中身は URL の続き（`show=hanabi`、`venue=plaza`、`cam=sky`、`gfx=off` …）。`&` を含むときは全体を引用符で囲む。`file=` は保存したショーとして読み込ませて `show=edited` で流す、`base=http://localhost:5299` は控えのサーバー
- 毎回使い捨てのブラウザなので、ユーザーのエディタの保存には触れない
- 席：水は `audience`（客席）か `eye`（目線）、花火は `sky`（花火と水）。客席のカメラでは花火は画面の外
- 照明は `real`（リアル）で確かめる。見栄えの確認だけなら `ideal`（理想）も
- **動きは静止画では伝わらない**。新しい動き（掃く・波紋・掛け合い・花火の上がる尾）は 0.4〜0.6 秒おきの連続コマで撮る
- **比べる時刻は「直前の区間」も入れる**。山を直したら、その山だけでなく、直前の山・直前の谷も撮る。段の中で上がっていても、直前より暗ければ客には下がって見える

## 3. 並べる・測る・切り替える

```bash
S=.claude/skills/show-compare/scripts
python3 $S/sheet.py compare shots/<話題> shots/<話題>/compare.jpg --title="1:32 の入り 今｜案"   # 時刻ごとに 今｜案（明るさつき）
python3 $S/sheet.py pair-strip shots/<話題> shots/<話題>/motion.jpg                          # 連続コマ：上が今、下が案
python3 $S/sheet.py strip shots/<話題> shots/<話題>/motion-new.jpg --src=new --cols=5        # 1つの版だけの連続コマ
python3 $S/sheet.py bright shots/<話題>                                                     # 明るさ 0〜255 の表
python3 $S/sheet.py ab shots/<話題> --title="1:32 の入り"                                    # 切り替えページ ab.html
```

- 明るさは画面全体の平均（0〜255）。段が上がっているか、白が壁になっていないか（124 を超えたら霧で白く飛んだことがある）を数字で言える
- `ab.html` は http://localhost:5199/shots/<話題>/ab.html で開く。今｜案のボタンかスペースキーで切り替え、「並べる」で左右に。ユーザーに渡すとき、ブラウザの画面に開いて見せる（`mcp__Claude_Browser__navigate`）
- 置き場は `shots/<話題>/`。1枚にまとめたものの名前は `<話題>_compare.jpg`・`<話題>_motion_<動き>.jpg`

## 4. 描き方（コード）を変えるとき

1. **変える前に**控えを作る：`sh .claude/skills/show-compare/scripts/snapshot-before.sh <話題>`（`backups/_before/` を作り直し、`<話題>` を付けると `backups/<日付>-<話題>/src` にも残す。このプロジェクトは git ではない）
2. `preview_start` の `water-show-v2-before` で控えを http://localhost:5299 に立てる
3. 変えたあと、`--src="now:show=lagoon&base=http://localhost:5299" --src=new:show=lagoon` で撮る。同じ開発サーバーで前後を撮ると、HMR で「前」がもう新しいコードになっていることがある
4. 終わったら控えのサーバーを止める（`preview_stop`）

## 5. 変わっていないことを確かめる（他の版・他の機材）

承認済みの版（Night Lagoon・ファンタジア版）の**中身**は変えない約束。描き方の改善は全部の版にかかるのが方針だが、中身だけを変えたつもりのときは、他の版が1画素も変わっていないことを示す。

```bash
node $S/capture.mjs --out=shots/<話題>/same-lagoon --src="now:show=lagoon&base=http://localhost:5299" --src=new:show=lagoon \
  --t=10,45,63,67.9,92,106.6,130,163,175.5,178.6,206
python3 $S/sheet.py diff shots/<話題>/same-lagoon     # 0画素なら終了コード 0
```

- 時刻は今までの「何も変わっていない」確認と同じ11か所（プロジェクトの `scripts/stage1-shots.sh` の T）
- 花火版も撮る（`show=hanabi`、`cam=sky`）。花火の乱れ方はキューの並び順で決まるので、キューを1つ消しただけで花火の絵が変わることがある
- 描き方を直したら、直した機材だけでなく**全部の種類の機材**（グリッド・ウィップ・チェイサー・扇・花・ガイザー・水幕・花火）を撮る。ウィップで直したことが扇と花に入っていなかったことがある（「物理演算だったらみんな共通になるはず」）
- 0画素にならない差は、どこがどう違うのか `scripts/pixel-diff.py <dirA> <dirB> --heat=<dir>` の赤い図で見てから説明する

## 6. ユーザーに渡す

- 結論を先に1〜2行：何を変えたか、どの時刻を見れば違いがわかるか、決めてほしいこと
- 1枚にまとめた絵（compare・motion）と、切り替えページ（ab.html）を開いて見せる
- 数字は「明るさ 37 → 52」のように短く
- **確かめていないことを書く**：撮ったのは静止画と連続コマで、音つきの再生では見ていない、など。音とのずれは `node scripts/sync-check.mjs`、密度は `node scripts/density-check.mjs`、目で見るなら プレイヤーの 波形（W キー）
- ユーザーが自分で見る方法を書く：「`http://localhost:5199/play.html?show=hanabi&t=162` を開く」、案のファイルは「エディタのファイル → 読み込む で `shots/<話題>/proposal.json`」（プロジェクトの仕組みができたら、案をプロジェクトとして保存して一覧から開く）。エディタは前に保存したショーを開くので、新しいものを入れたのに「入ってない」と見えることがある
- 終わったら、使わない大きなファイル（連続コマの PNG の山・書き出した動画）を消すか、消してよいか聞く。ディスクがいっぱいになったことがある

## やってはいけないこと

1. 文章だけで案を出す（このユーザーは見て決める）
2. 静止画1枚で動きの案を見せる
3. 同じ開発サーバーで、コードを変える前と後を撮る（「前」がもう新しくなっている）
4. 音楽なしで組み立てた案を、音楽込みの「今」と並べる
5. 席や照明モードを、今と案で変えて撮る
6. ユーザーのエディタの自動保存（`water-show-editor:v1`）を書き換える（撮るのは使い捨てのブラウザで）
7. 0画素でないのに「変わっていない」と言う
