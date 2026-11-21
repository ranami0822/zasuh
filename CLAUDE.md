# Zasuh

人が書いた、理由つきのレビューを、AI が決まった質問で読み取り、観点ごとの向き（肯定・否定・混在）と件数にまとめて見せる評価サイト。**点数の扱いは、見直し中。** 以前の「点数はない」は、AI が決めたもので、ユーザーの決定ではなかった（2026-11-20）。観点ごとの星（強さ）を実験中で、星は整数に丸めず、5段階の分布の棒と小さな平均で見せる方針（`docs/mvp-design.md` の20章、`experiments/clef-mention/README.md` の第7弾）。**採用は、実験の結果と、ユーザーの確認のあと。それまで、本番の画面と質問は、点数なし。**`docs/` の古い記述は、そのまま残っている。 対象は、ゲームとソフトウェア。日本語のみ。公開先は https://review.anami.party 。

最初に読むもの: `docs/mvp-design.md`（設計と、決定の記録。1〜22章）、`docs/standards.md`（コーディングの決まり）、`docs/deploy.md`（デプロイ）、`docs/design.md`（最初の方針と、実験の要約）、`experiments/clef-mention/README.md`（AI の精度の実験）。

## 守ること（ユーザーの指示と決定）

- **応答は、短く、平易な日本語で。造語を避ける。** 分からない言葉は、検索を1回して、それでも分からなければ、推測せず、聞く。過去の会話から導いたことは、そう書く。
- **認証情報**（`CLOUDFLARE_API_TOKEN` など）は、出力・保存・コミットしない。デプロイと wrangler は、`scripts/deploy.sh` と `scripts/cf.sh` を使う。
- **本番への反映（デプロイ、`--migrate`）、DNS・ドメイン・プランの変更、リソースの作成・削除は、ユーザーの依頼があるときだけ。** このアカウントには、**ほかのプロジェクトの Worker と D1 が、たくさんある。触らない**（D1 は、無料プランの上限 10 個。削除は、ユーザーが名指しで許可したものだけ）。
- **プルリクエストは、頼まれるまで作らない。** コミットとプッシュは、指定のブランチにだけ。
- 外部サイト（Steam など）のレビュー本文と、投稿者の情報は、リポジトリに置かない（識別子・ラベル・数値だけ）。取得の回避策（ボット確認の回避など）は取らない。
- 設計を決めたら、`docs/mvp-design.md` に書く（決定、理由、未確認、見直す条件）。「確認済み」「仮定」「未確認」を分ける。
- 「なんでも独自にすればよいわけではない」（ユーザーの指摘）: 独自にするのは、色・書体・面の見せ方だけ。フォーム、ボタン、エラーの出し方などの操作は、慣れた形のまま。

## 構成

SvelteKit 3（Svelte 5）+ `@sveltejs/adapter-cloudflare` 8、Cloudflare Workers、D1（SQLite）、Workers AI（Clef-flash）、Cron（毎分）。UI の部品は ui-sdk（`@ui-sdk/svelte`）。passkey は SimpleWebAuthn。

- `src/lib/server/` … 業務の中心（`reading.ts` 読み取り、`stats.ts` 集計、`reviews.ts` 投稿・編集・通報、`auth.ts` passkey と復旧、`tags.ts` タグ、`pages.ts` 画面の問い合わせ、`inbox.ts` 受信箱）。D1 を使う単体テストが、ここにある。
- `src/routes/` … 画面とフォームの処理。`src/hooks.server.ts` が、`/admin` を守る（フォームの処理は、レイアウトの `load` を通らないため、ここで確かめる）。
- `migrations/` … 0001〜0005。**本番に適用済みのファイルは、書き換えない**（変えるときは、新しい番号を足す）。
- `src/lib/styles/tokens.css`、`app.css` … 見た目。**デザインの正は、`tokens.css`**。
- インポートは、`#server/...`、`#components/...`、`#styles/...`、`#messages`、`#passkey`（`package.json` の `imports`）。`$lib` は、使えない（拡張子なしの `.ts` を、`#lib/*` が解決しないため）。

## ハマりどころ

- **SvelteKit 3 のアダプタは、`event.platform` を渡さない。** DB、AI、シークレット、`waitUntil` は、`cloudflare:workers` から読む（`src/lib/server/request.ts`）。だから、`vite dev` ではなく、**ビルドして `wrangler dev`**（`npm run dev:worker`）で動かす。
- Workers AI のバインディングは、ローカルでも、本物を呼ぶ（無料枠 1日 10,000 neurons を使う）。AI なしで確かめるときは、`wrangler.local.jsonc`（AI と cron なし。git に入れていない）を使う。作り方は、`wrangler.jsonc` から、`ai` と `triggers` と `routes` を外す。
- 単体テストで `cloudflare:workers` を使う部品（`request.ts`、`hooks.server.ts` など）を試すときは、`vi.mock` が効かない（アダプタが仮想モジュールに置き換えるため）。`vite.config.ts` の `test.alias` で、`src/lib/server/testing/cloudflare-workers.ts` に差し替えてあるので、そこから `setEnv` と `waitUntil` を読み込む。
- ブラウザの通しで、ページの読み込みが終わる前にボタンを押すと、何も起きない。待つ（`networkidle`）。
- `rm -rf` は、安全装置に止められることがある。ローカルの DB を作り直すときは、消さずに、`--persist-to` で、新しいディレクトリを指す。
- 無料の Workers は、CPU が 10 ms/回。投稿時の「文面がほぼ同じか」の比較（`text.ts`）は、レビューの多い作品で、超えるおそれがある（`DUPLICATE_SCAN_LIMIT`）。

## コマンド

```bash
npm test                     # 単体テスト（約 180 件、30〜40秒）
npm run check                # 型と Svelte の検査
npm run dev:worker           # ビルドして、wrangler dev（ローカル）
npm run e2e                  # ブラウザの通し（AI なし。空の DB と、.dev.vars の ADMIN_TOKEN=local-test-token が要る）
npm run e2e:passkey          # パスキーと復旧の通し（仮想認証器。WRANGLER_LOG に、wrangler dev の出力ファイルを渡す）
scripts/deploy.sh --build-only   # 作業用コピーで、ビルドだけ（本番に触らない）
```

Playwright は、グローバルに入っている（依存に入れていない）。

## 仕事の任せ方（delegate と spec-driven-dev）

- 設計が決まっていて、検査で正しさが分かる仕事（CRUD、画面の部品、テストの追加）は、`coder-haiku`（`.claude/agents/`）に任せる。設計は、文章ではなく、**型だけのコードと、失敗するテスト**で渡す（関数の型、置くファイル、エラーの扱い、共通部の場所まで決める）。
- 設計の前に、既存の実装を調べる（作り直しを防ぐ）。全体を左右する点（画像の形式など）は、型とテストを作る前に、ユーザーに聞く。変更が 30 行未満なら、渡さず、自分で書く。
- 判断が要る仕事は、`delegate:builder`。`reading.ts`、`auth.ts`、`migrations/`、本番に触る作業は、Haiku に任せない。
- 最後のレビューは、`delegate:reviewer`（仕様と差分だけ渡す）。差分が 50 行未満なら、省く。
- 完了の検査は、`npm run check` と、変更に関わる `npm test`。全件（30〜40秒）は、最後に1回、直接実行する（`runner` は要らない）。画面を変えたときだけ、`npm run e2e`。
- 毎回の指示に入れる: `$lib` は使わない、`#server/...` を使う、本番・Cloudflare・デプロイに触らない、テストでデータを消すときは自分が作ったものだけ。
- **agent に、ブランチと worktree を増やさせない**（個人の開発で、木が増えても得がないため。ユーザーの指示、2026-11-21）。仕事は、指定されたブランチで、順番に行う。ファイルが重ならない並列のときだけ、`isolation: worktree` を使ってよい。そのときは、毎回の指示に、**取り込み先のブランチ**と、**コミットまでで、プッシュはしない**ことを書く。取り込み（`git cherry-pick`）は、まとめ役が、ゲートを再実行してから行い、終わったら、worktree と作業用ブランチを、まとめ役が消す（`git worktree remove`、`git branch -D`。自分が作ったものだけ）。仕事が終わったら、指定のブランチを、統合ブランチへ取り込む（ユーザーの許可を得て）。
- `create_session` で作った子のセッションには、plugin の agent（`delegate:*`、`sdd-*`）が届かなかった（2 回。原因は未確認）。アプリでユーザーが始めたセッションには届いた。plugin を使う仕事は、後者で行う。
- `spec-driven-dev` の標準の確認は、この文書にある決まりだけを見る。書いていない決まりは、確認の対象にならない。
- 費用は、`agent-cost` で、Haiku と Sonnet を同じ設計で比べて確かめる。Haiku が Sonnet の約 20 分の 1（10万トークンまで）という価格は、第三者の記事で、**未確認**。測った結果で、この節を直す。試験 1 回（共有表示。小さい仕事）: Haiku は、費用の約 6%。大半は、まとめ役の会話だった。試験 2 回（専門家の欄。約 2,300 行の本物の仕事、2026-11-21）: Haiku は入力相当の約 5%（311k / 6.0M）、まとめ役の会話は約 57%、Opus（builder、reviewer）は約 38%。Haiku が設計の不足で止まった回数は 0、やり直しも 0。レビューが、実際の不具合を 5 つ見つけた。画面の仕事（Haiku）は、失敗する検査が作りにくく、`npm run check` と e2e に頼った。

## 本番の状態（2026-11-19）

- Worker `zasuh`、D1 `zasuh`（ID は `wrangler.jsonc`）、`review.anami.party`（カスタムドメイン）。`workers.dev` は、無効。マイグレーションは、0001〜0005 を適用済み。
- シークレット: `ADMIN_TOKEN` のみ（管理画面の合言葉。**リポジトリにも、この文書にもない。ユーザーが持っている**。変えるときは、`scripts/cf.sh secret put ADMIN_TOKEN`）。
- **メール送信は、ない**（Workers の有料プランが要るため、ユーザーは、有料にしない）。復旧は、**復旧コード**。メール復旧の実装は、残してあり、送り口（`EMAIL`、`MAIL_FROM`）がないので、画面に出ない。
- 本番に、ユーザーが作ったデータ（作品 OMORI など）が、ある。**テストでデータを消すときは、自分が作ったものだけを消す**（全消しの SQL は、使わない）。

## ブランチ（2026-11-20 に整理）

- GitHub の既定のブランチは `claude/adoring-euler-d7rb8d`（引き継ぎの文書だけ。`main` は、ない）。
- **統合ブランチ: `claude/integration-9ugqua`。新しい作業は、ここから始める。** 本番のコード（`trusting-pascal`）、星の実装（`youthful-faraday`）、星の実験と設計書（`admiring-newton`）、共有表示（`share-preview-trial`）、仕事の任せ方（`tender-cannon`）を、マージ済み。型の検査 0 エラー、単体テスト 215 件、ビルドが通る。
- **専門家の欄（`claude/opencritic-expert-reviews-biegyr`）を、統合ブランチに取り込み済み**（2026-11-21。データと取得まで。マイグレーション 0006、`opencritic.ts`、`critic-sync.ts`、`critics.ts`、`question-sets/critic-v1.ts`、管理画面。画面の部品は保留。`docs/mvp-design.md` の 22.8、`docs/critics-plan.md`）。単体テスト 283 件。**新しいマイグレーションは 0007 から**（0006 は、本番に未適用）。
- 統合しなかったもの: `epic-pasteur`（デザインの試し。`trusting-pascal` が同じ場所を作り直した。※推測）、`brave-davinci`（GTA6 のローンチ準備。古い土台で衝突が多い。必要な部分だけ、取り込み直す）、`jolly-einstein`（別のプロジェクト pnn。PR #1）、`clef-experiment-hc0s6m`（中身は既定に含まれている）。
- 本番にデプロイされているのは、`trusting-pascal` の版（セッションの報告による。統合ブランチは、まだデプロイしていない）。マイグレーションは 0005 まで。**（0006 は、専門家の欄が使った。上のとおり）**
- `docs/mvp-design.md` の章番号は、統合のとき、重なった（19が3つ）ので、振り直した。**次は 23 章から。** 章を足すときは、最後の番号を確かめる。

## 未決・次の候補

- **デザインシステムの見直し**（`docs/mvp-design.md` の 17、18章、`docs/design-system-brief.md`）。差し色の1色、「シアkし」の意味（ユーザーに確認）。
- 「何を魅力として見せるか」（プロダクトとしての見せ方と機能）。
- 規約とプライバシーの草案の、法律の確認と、運営者の表記（ユーザー）。
- 追加のタグとソフトウェアのタグの精度（正解付きのデータがない）。
- **星の実験の続き**（第7弾）: 2日目の実行（S1-V2、S1-order、B0-V2。無料枠が戻る 00:00 UTC のあと）、画面の試作、順位の付け方（平均の信頼区間の下限）。
- **専門家の欄:** 決定は 22 章（OpenCritic の API → Clef。結果だけ保存）。**データと取得は、実装済み（22.8）。作品ページの画面は、星の共通コンポーネントを決めてから。** デプロイの前に、Workers の通信数・D1 の問い合わせ数・cron の数の上限を、Cloudflare の文書で確かめる。`OPENCRITIC_API_KEY` は、ユーザーが `scripts/cf.sh secret put` で入れる。専門家の持ち込み、作り手への開放は、未決。
