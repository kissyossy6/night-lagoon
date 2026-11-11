# プロジェクトごとの曲（設計）

2026-11-12 作成・同日に作った（持ち主「おすすめで進めて」で 4 の3つはおすすめどおり）。前提は [projects-plan.md](projects-plan.md) の 6（後の段に回していたもの）。

---

## 0. 結論（先に）

> 今は、どのプロジェクトも同じ1曲（Rhapsody in Blue の録音、`public/music/background.mp3`）で、本番画面の長さも 3:37 に決め打ち。
> これを、**プロジェクトごとに自分の曲を入れられる**ようにする。
>
> 1. 曲は `projects/<id>/` の中に置く（GitHub には入らない。今の `.gitignore` のまま）
> 2. 曲を入れると、**長さはその曲の長さ**になり、波形の解析（水が音に反応する所）もその曲で行う
> 3. 曲を入れていないプロジェクトと3つの見本は、**今の曲のまま、何も変わらない**
> 4. 6段に分けて作る。各段で見本が1画素も変わらないことを確かめる

---

## 1. 今の作り（曲が決め打ちになっている所）

| 所 | 今 | 直すこと |
| --- | --- | --- |
| 曲のファイル | `src/audio/background.ts` が `public/music/background.*` だけを探す | プロジェクトの曲があればそれを読む |
| 本番画面の長さ | `src/show/main.ts` が `SHOW_DURATION`（217 秒、`song.ts`）を十数か所で使う。時計・シークバー・区間の帯・動画の書き出しの範囲・水音と花火の音の長さ | 開いた演出の `duration` を使う |
| エディタの長さ | もう演出の `duration` を使っている（ショー設定で変えられる） | そのまま |
| 拍の速さ | 演出の `bpm`・`offset`（ショー設定で変えられる）。曲から自動では測っていない | 曲を入れたときに目安を出す（4段） |
| 区間（序章・目覚め…） | 演出に無ければ `song.ts` の `SECTIONS`（Rhapsody の区切り） | 自分の曲では Rhapsody の区切りを使わない（4段） |
| 水幕の物語の絵 | 時刻ごとに Rhapsody 用の絵（`src/screen/projection.ts`） | 自分の曲では時刻で決まる物語の絵を出さず、選んだ場面（clip）だけ（5段） |
| 一覧の長さの表示 | 演出の `duration`、無ければ 217 秒 | そのまま（曲を入れると曲の長さになる） |
| Vision Pro の書き出し | `src/export/vr180-page.ts` が 217 秒と今の曲 | プロジェクトの曲と長さ |
| 「音楽ファイルを選ぶ」（本番画面） | その場で曲を差し替えるだけで、保存されない | そのまま残す（試しに聞く用） |

---

## 2. できあがりの形

### 2.1 保存

```
projects/<id>/
  project.json   … "music": { "file": "music.mp3", "name": "夏祭り.mp3", "duration": 128.4 }
  music.mp3      … 入れた曲（形式は入れたまま：mp3・m4a・ogg・wav）
  thumb.jpg
```

- `music` が無いプロジェクトは今の曲（`public/music/background.*`）
- 複製すると曲も写す。削除（ゴミ箱）は今どおりフォルダごと
- 開発サーバー無し（ブラウザ保存の予備）のときは曲を入れられない（「この環境では曲を入れられません」）。曲は大きく、ブラウザの記録に向かないため

### 2.2 エディタ

- 「ショー設定」に **曲** の行：今の曲の名前と長さ、「曲を選ぶ…」「今の曲に戻す」
- 曲を選ぶと：
  - 長さを曲の長さにする（BPM・オフセットは目安を出し、押すと入る。4段）
  - 波形を解析し直す（水が音に反応するキューは新しい曲に合わせて動く）
  - 曲の終わりより後ろにあるキューは**消さずに残し**、警告の一覧に「曲の後ろにある」と出す
  - ⌘Z で前の曲に戻せる
- 新しく「空のショー」を作るとき、曲を選べる（選ばなければ今の曲・180 秒、今と同じ）→ 2026-11-12 は作っていない。作ったあとエディタの「曲を選ぶ…」で入れる

### 2.3 本番再生

- `play.html?project=<id>` は、そのプロジェクトの曲と長さで流す
- 動画・Vision Pro の書き出しも同じ曲と長さ

---

## 3. 段階

| 段 | 内容 | 主に触る所 | 終わりの確かめ |
| --- | --- | --- | --- |
| **1. 保存の土台** | 曲を置く・読む・複製で写す API（`/__projects/music`）、`project.json` の `music` | `scripts/project-store.ts`・`src/projects/` | 曲を入れる → 読める → 複製に付いていく → 削除で一緒にゴミ箱へ |
| **2. 長さを演出から** | 本番画面の `SHOW_DURATION` を開いた演出の `duration` に。曲の読み込みを「プロジェクトの曲、無ければ今の曲」に（本番画面・エディタ・Vision Pro） | `src/show/main.ts`・`src/audio/background.ts`・`src/editor/transport.ts`・`src/export/vr180-page.ts` | 3つの見本が0画素の差・control-check の値が同じ。60 秒の曲を入れた試しのプロジェクトが 60 秒で止まる |
| **3. エディタで曲を選ぶ** | ショー設定の「曲」、選ぶ・戻す・⌘Z、解析し直し、曲の後ろのキューの警告（空のショーを作る画面で選ぶのは作っていない） | `src/editor/inspector.ts`・`src/editor/main.ts`・`src/show/checks.ts` | 本物のマウスで：選ぶ → 長さが変わる → 再生 → ⌘Z → 自動保存を開き直して残る |
| **4. 拍と区間** | 曲から拍の速さの目安（解析の onsets から）を出し、押すと BPM・オフセットに入る。自分の曲の区間は「全体」1つから（Rhapsody の区切りを使わない） | `src/audio/analysis.ts`・`src/show/sections.ts`・`src/editor/inspector.ts` | 拍のはっきりした曲で目安が合う（クリック音の試しの曲で ±1 BPM） |
| **5. 水幕の絵** | 自分の曲では、時刻で決まる Rhapsody の物語の絵を出さない。映すのはキューの clip で選んだ場面だけ | `src/screen/projection.ts`・`src/show/runtime.ts` | 自分の曲で水幕を上げても、選んでいない物語の絵が出ない。見本は0画素の差 |
| **6. まわり** | 一覧の長さ、マニュアル（2・3・6章）、確認の scripts、README | `docs/manual`・`scripts/*` | typecheck・editor-check・player-check・control-check・venue-check |

- 見本が変わらないことは、2・5段のあとに 3版×決めた時刻を撮って0画素の差で確かめる（show-compare の diff）
- 試しに使う曲は、自分で作ったクリック音などの短い音（他人の曲は使わない、GitHub にも入れない）

---

## 4. 決めたこと（2026-11-12、おすすめどおり）

1. **曲の後ろにはみ出したキュー**：消さずに残して警告（`src/show/checks.ts` の `past`「曲の後ろにある」）
2. **自分の曲の区間**：「全体」1つから自分で足す（`src/show/sections.ts` の `OWN_MUSIC_SECTIONS`）
3. **自分の曲の水幕の絵**：選んだ場面だけ。clip の無い間は黒（`src/show/cues.ts` の `screenAt` の `blank`）

## 4b. 作った形（2026-11-12）

- 演出ファイルに `music`（`file`・`name`・`duration`、`src/show/types.ts` の `ShowMusic`）。プロジェクトではなく演出に持たせたので、⌘Z で曲の入れ替えが戻る。古い曲のファイルは消さない（戻したときに要る）。名前は中身のハッシュなので、同じ曲は1つ
- 置き場の API：`POST /__projects/music?id=&name=`（200 MB まで）・`GET /__projects/music?id=&file=`。複製・見本にするとき曲も写す（`scripts/project-store.ts`）
- 本番画面：長さは開いた演出の `duration`（`src/show/main.ts` の `showLength()`）。見本・曲なしのプロジェクトの曲の切り方は今のまま（217 秒）
- エディタ：「ショー設定」の「曲」の行（`src/editor/inspector.ts` の `buildMusic`）、`pickMusic`・`resetMusic`・`reloadMusic`（`src/editor/main.ts`）、`Transport.musicSource`
- 拍の目安：`src/audio/analysis.ts` の `estimateTempo`（立ち上がりの位相をそろえる。倍・半分は 120 BPM に近い方。作った曲 128 BPM・0.5 秒 → 128・0.49、90 BPM・0.8 秒 → 90・0.79）
- `normaliseShow` が `music` を残すようにした（無いと開き直すと曲が消えていた）
- 前からの不具合も直した：217 秒より短い自分のショー（空のショー 180 秒など）を開き直すと、古い保存の延長（`extendToMusic`）が Rhapsody の最後の 189 キューを足して 217 秒にしていた。延長は組み込みの版の題を持つものだけにした
- 確かめ：`scripts/music-check.mjs`（18 項目）、見本3版 39 コマが作業前と0画素の差、typecheck・editor-check・player-check・stage6-check・venue-check・venue-editor-check・venue-race-check・control-check 通過
- 残り：時間軸の水幕の行の線（霧に映る）は、黒の間も「映っている」と描く。JSON で書き出して別のプロジェクトへ読み込むと、曲のファイルは付いていかない（共通の曲で流れず、読み込めないお知らせ）。Vision Pro の試験台（`tools/vr180.html`）は見本の曲のまま

---

## 5. 今回はやらないこと

- 曲を切る・つなぐ・フェードを付けるなどの編集（入れた曲をそのまま使う）
- 曲を替えたときに、振付を新しい曲に合わせて自動で作り直すこと（見本の作り方 `buildShow` は Rhapsody 専用）
- 1つのプロジェクトに複数の曲
- ブラウザ保存（開発サーバー無し）での曲
