# Zasuh

人が理由つきで書いたレビューを、AIが決まった質問で読み取り、観点ごとの分布と順位にする評価サイト。点数は付けない。

- 設計: [`docs/design.md`](docs/design.md)（方針と決定事項）、[`docs/mvp-design.md`](docs/mvp-design.md)（最初のプロトタイプ）
- 実験: [`experiments/clef-mention/`](experiments/clef-mention/README.md)（質問の形と成績の記録）
- 第二の側面（独立）: [`docs/pink-nervous-nipples.md`](docs/pink-nervous-nipples.md)（自分をそのまま出すメディア。PWA エディタと吐き出しの場）

## 構成

- SvelteKit（Cloudflare Workers）、D1、Workers AI（Clef）
- `migrations/` — D1 のスキーマ
- `src/lib/server/tags.ts` — タグ（版つき）と、作品のタグから質問を組み立てる処理。定義を変えるときは、版を上げて追加する
- `src/lib/server/question-sets/` — 実験で確かめた質問の文面（ゲームの分野のタグの元）
- `src/lib/server/reading.ts` — レビューを読んで、答えを保存する
- `src/lib/server/sweep.ts` — 読めていないレビューを拾い直す（定期実行）
- `src/lib/server/stats.ts` — 集計と順位（Wilson 信頼区間の下限）
- `src/worker.ts` — ワーカーの入口（SvelteKit の出力に、定期実行を足す）

## 使い方

```bash
npm install
npm test                    # テスト（ローカルの D1 を使う。通信しない）
npm run check               # 型チェック
npm run db:migrate:local    # ローカルの D1 にスキーマを作る
npm run dev:worker          # ビルドして、ワーカーをローカルで動かす
```

`npm run dev:worker` は、Workers AI につなぐため、Cloudflare の認証を求める。
定期実行は、起動中に `http://localhost:8787/__scheduled` を開くと動く。

質問セットを変えるときの確認は、`scripts/eval-question-set.ts` の冒頭を参照。
