# water-show_v2

噴水ショーのシミュレーター（プレイヤー・エディタ・会場の編集・書き出し）。持ち主の個人の作品。軸は「誰でも、演出を、自分の規模に合わせて、自由に作れる」。

- 日本語で話し、日本語で書く（計画・報告・コメントの下書きも）
- 続きの作業は、まず `docs/handoff.md` を読む（手元だけの作業メモで GitHub には無い。`docs/reports/`・`docs/reviews/`・`docs/video-review.md` なども同じ）。要件は `docs/dev-plan.md`
- 演出の仕事は `.claude/skills/show-director` から始める。今｜案の撮影は `show-compare`、仕上げの確かめと報告は `show-qa`
- 報告は結論を先に1〜2行、持ち主が決めること・やることを1つ、確かめていないこと、自分で見る方法。内部の記号（R1・H2・6b など）には言葉を添える（`show-qa/references/report.md`）
- Night Lagoon・ファンタジア版の中身は変えない。新しい案は新しい版へ。描き方の改善は全部の版に入れる
- git で管理し、GitHub（`kissyossy6/night-lagoon`）に公開している。commit・push は持ち主が言ったときだけ。それとは別に、大きく変える前は今どおり `backups/<日付>-<名前>/` へ写す（作業中の控え。GitHub には入らない）
- ショーは `projects/<id>/project.json` に1プロジェクト1フォルダで持つ（`docs/projects-plan.md`、GitHub には見本 `sample-*` だけ）。本番再生は `play.html`
- 開発サーバーは http://localhost:5199（`preview_start` の `water-show-v2`）。自動の再生では音を出さない
