# pnn（Pink nervous nipples）

書くための、いちばん速い PWA エディタ。Zasuh とは独立。設計は [`../docs/pnn-editor-design.md`](../docs/pnn-editor-design.md)、見た目と動きは [`../docs/pnn-design-system.md`](../docs/pnn-design-system.md)。

```bash
cd pnn
npm install
npm run dev          # 開発サーバー（service worker は、本番ビルドでだけ登録される）
npm test             # 保存層と、装飾の命令のテスト
npm run check        # 型チェック
npm run build        # 静的に書き出す（.svelte-kit/cloudflare）
npm run preview      # 本番ビルドを確認する
npm run db:migrate:local   # ローカルの D1 に表を作る
npm run dev:worker   # ビルドして、wrangler dev（http://localhost:8787。passkey は localhost で動く）
npm run audit        # 見切れの検査（AUDIT_URL=http://localhost:8787/）
npm run e2e          # エディタの通し（AUDIT_URL=http://localhost:8787/）
npm run e2e:server   # 公開の場の通し（2人。passkey は仮想の認証器。BASE=http://localhost:8787）
npm run deploy       # 本番: ビルド → D1 のマイグレーション → wrangler deploy
```

公開の場とログインの設計は [`../docs/pnn-server-design.md`](../docs/pnn-server-design.md)。
ローカルの秘密の鍵は `.dev.vars` の `PNN_SECRET`（コミットしない）。本番は `wrangler secret put PNN_SECRET`。
**本番の PNN_SECRET を失うと、仮名を計算し直せず、書いた人が自分の投稿を編集できなくなる。** 安全な場所に控えておく。

- `src/lib/store.ts` — IndexedDB（保存と読み込みは、ここに閉じる）
- `src/lib/saver.ts` — 入力 250ms の待ちで書き出す。閉じる前は、すぐ書き出す
- `src/lib/editor/` — CodeMirror 6 の装飾（その場の整形）と、装飾バーの命令
- `src/lib/press.ts` — 触ったときの動き
- `src/service-worker.ts` — オフライン。重いフォントの塊は、使ったときにキャッシュする
- フォントの再生成: `scripts/build-font.py`（冒頭を参照）。`static/fonts/` に出力する

## 注意（つまずいた点）

- 文書の状態に `$state` を使うと、Svelte のプロキシを IndexedDB に渡して、保存が黙って失敗する。文書は `$state.raw` で持つ。
- SvelteKit 3 では、`$service-worker` が無くなり、`$app/manifest` と `$app/env` を使う。`src/tsconfig.json` は、service worker のビルドが読む。
- SvelteKit 3 のアダプタでは、Cloudflare の環境（D1 など）を `event.platform` ではなく `cloudflare:workers` の `env` から読む（`src/lib/server/http.ts`）。
- 日本語の変換中の挙動は、自動テストでは再現できない。実機で確かめる。
