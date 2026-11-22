# コーディングの決まり

既存のコードから拾った形。見本は、`src/lib/server/works.ts`、`works.test.ts`、`inbox.ts`、`src/routes/contact/+page.server.ts`。新しく書くときは、近い見本と同じ形にする。書式は、近くのファイルに合わせる（タブ、シングルクォート、行末に `;`、末尾のカンマなし）。整形の道具は、入れていない（Prettier で試したところ、37 ファイルが変わるため、見送った）。

## 1. 失敗の返し方

起こりうる失敗（入力の誤り、上限、見つからない）は、例外にしない。`{ ok: true, ... } | { ok: false; error: E }` で返す。`E` は、`'bad_slug'` のような snake_case の文字列の型（`WorkError`、`InboxError`）。例外は、ありえない状態のためだけに使う。

## 2. 画面の文言

日本語の文言は、`src/lib/messages.ts` に、`Record<E, string>` で置く。サーバーの関数には書かない。`E` に値を足すと、文言の漏れが型の検査で見つかる。

## 3. 関数の引数

`src/lib/server/` の関数は、`db: D1Database` と `now: Date` を、引数で受ける。`database()` と `new Date()` は、`routes/` 側で渡す。画面から来る値は、`string` のまま受け取り、関数の中で検証する。

## 4. フォームの処理

失敗は `fail(400, { error: 文言, values })`、成功は入力欄を空にした `values` を返す。記録は `console.log(JSON.stringify({ event: '...' }))`。

## 5. テスト

- 実装の隣に、`名前.test.ts` を置く。
- `createTestDb()` を `beforeEach` で作り、`dispose` を `afterEach` で呼ぶ。時刻は `createClock`、AI は `fakeClef`（`src/lib/server/testing/`）。DB のモックは使わない。
- `describe` と `it` の名前は、日本語で書く。同じ振る舞いの、正常と失敗は、1つの `it` にまとめてよい。
- 作品や行の**並び**を確かめるテストは、ランダムな `id`（`crypto.randomUUID()`）の並びに、期待を依存させない。並びを決める（日時や名前で指定する）か、並びに左右されない比べ方にする（4 回に 1 回ほど失敗した例がある）。

## 確認の範囲

- 確認済み: 上の見本のファイルと、`reviews.ts` の失敗の返し方。
- 未確認: `auth.ts`、`reading.ts` の形。Svelte の部品（`src/lib/components/`、`.svelte`）の決まり。
