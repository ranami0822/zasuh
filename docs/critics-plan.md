# 専門家（批評家）の評価欄: 実装の計画

状態: **計画。ユーザーの確認の前。** 決定は `docs/mvp-design.md` の 22 章（22.6、22.7 の試験の結果を含む）。この文書は、実装の分け方と、型、置き場所、エラーの扱い、確認の方法。コーディングの決まりは `docs/standards.md`。

## 0. 前提と、決まっていないこと

- **保存するのは、結果だけ**: 向き、星（段階ごとの確率を含む）、媒体名、元記事の URL、読んだ日時、作品との対応。**抜粋、記事の題名、著者、媒体の点数は、保存も表示もしない。** 抜粋は、取得してから Clef に渡すまで、メモリ上だけに置く。
- **質問セット `critic-v1`（新規）**: 22.7 の試験と同じ 14 問。`game-v1` の 8 問（4 観点の向きと言及）→ 4 観点の星 → 総合の向き → 総合の星。この順序と文面は、版の一部（変えるときは `critic-v2` を足す）。**星の質問の文面は、`scripts/star-questions.ts` の複写**（`src/` から `scripts/` を読まないため）。**総合の質問は、試験用に作った文面**で、20 章の規約ではない。
- **星の採用（20 章）は、ユーザーの確認がまだ**。この計画は、星を保存し、専門家の欄だけに出す。**デプロイ（ユーザーの作業）の前に、20 章の確認が要る**（`CLAUDE.md`: 採用までは、本番の画面は点数なし）。
- **受信箱との違い（ユーザーの確認が要る）**: 22.1 は「自動の候補は、受信箱に入れる」。`messages` の `kind` は CHECK 制約（`work_request`、`contact`、`dispute`）で、SQLite は CHECK を直接変えられない（表の作り直しが要る。本番の表に触る）。**候補は、別の表 `critic_candidates` に入れ、管理画面の「受信箱」のページに、同じ画面で並べて出す。** `messages` は、変えない。
- **キーの名前**: Worker のシークレット `OPENCRITIC_API_KEY`（RapidAPI のキー）。ユーザーが、`scripts/cf.sh secret put OPENCRITIC_API_KEY` で入れる。なければ、機能は、止まったままになる（エラーにしない）。キーは、前後の空白と引用符を外して使う（試験で、末尾に `'` が入っていて、403 になった）。
- **未確認のまま進める**: OpenCritic の API の規約（22.3。ユーザーの判断）。止める条件は、22.4。

## 1. 置き場所と、型

### 1.1 `migrations/0006_critics.sql`（足すだけ。本番には適用しない）

```sql
-- 作品に、OpenCritic の作品 ID と、最後に取得した日時。
ALTER TABLE works ADD COLUMN opencritic_id INTEGER;
ALTER TABLE works ADD COLUMN critic_synced_at TEXT;
CREATE UNIQUE INDEX works_opencritic ON works (opencritic_id) WHERE opencritic_id IS NOT NULL;

-- 専門家のレビューの、読み取りの結果。抜粋・題名・著者・点数は、持たない。
CREATE TABLE critic_reviews (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works (id),
  oc_review_id TEXT NOT NULL,
  outlet TEXT NOT NULL,
  url TEXT NOT NULL,
  published_on TEXT,
  question_set_id INTEGER NOT NULL REFERENCES question_sets (id),
  read_at TEXT NOT NULL,
  UNIQUE (work_id, oc_review_id)
);
CREATE INDEX critic_reviews_work ON critic_reviews (work_id, published_on);

-- 質問ごとの答え（reading_answers と同じ形。タグの列は、ない）。
CREATE TABLE critic_answers (
  critic_review_id TEXT NOT NULL REFERENCES critic_reviews (id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  aspect TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('direction', 'mention', 'star')),
  value TEXT NOT NULL,
  prob REAL NOT NULL,
  probs_json TEXT,
  PRIMARY KEY (critic_review_id, question_key)
);

-- 自動の候補（作品名で検索した、いちばん上の 1 件）。運営者が承認すると、works.opencritic_id に入る。
CREATE TABLE critic_candidates (
  work_id TEXT PRIMARY KEY REFERENCES works (id),
  oc_id INTEGER NOT NULL,
  oc_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected')),
  created_at TEXT NOT NULL
);
```

`probs_json` は、direction なら向きごとの確率、star なら `{ score, levels, confidence }`（`reading_answers` と同じ）。

### 1.2 `src/lib/server/opencritic.ts`（API の呼び出しと、応答の解析。D1 を知らない）

```ts
/** メモリ上だけで扱う。保存しない。 */
export interface CriticSnippet {
	ocReviewId: string;     // 応答の _id
	text: string;           // snippet（空でないもの）
	outlet: string;         // Outlet.name（空なら、取り込まない）
	url: string;            // externalUrl（http / https のみ）
	publishedOn: string | null; // publishedDate の日付部分（YYYY-MM-DD）。読めなければ null
}
export interface OcGame { id: number; name: string; dist: number }
/** 応答ヘッダー x-ratelimit-requests-remaining と x-ratelimit-searches-remaining。なければ null。 */
export interface OcRateLimit { requestsRemaining: number | null; searchesRemaining: number | null }
export type OcError = 'unauthorized' | 'rate_limited' | 'bad_response' | 'network';
export type OcResult<T> = { ok: true; value: T; limit: OcRateLimit } | { ok: false; error: OcError };

export function normalizeKey(raw: string | undefined): string | null;
export function parseReviews(json: unknown): CriticSnippet[];  // 純粋。形の悪い要素は、捨てる。language が 'en' で始まらないものは捨てる。
export function parseSearch(json: unknown): OcGame[];          // 純粋。
export function hasBudget(limit: OcRateLimit, kind: 'request' | 'search', reserve: number): boolean; // 残りが null なら true（不明のときは、呼び出し側の回数の上限で止める）

export interface OpenCriticClient {
	searchGame(name: string): Promise<OcResult<OcGame[]>>;
	reviewsOfGame(ocId: number, skip: number): Promise<OcResult<CriticSnippet[]>>;
}
export function createOpenCriticClient(opts: { key: string; fetch?: typeof fetch; timeoutMs?: number }): OpenCriticClient;
```

エラーの対応: 401、または 403 で本文に `not subscribed` を含む → `unauthorized`。429、または、そのほかの 403 → `rate_limited`。通信の失敗、時間切れ → `network`。200 で JSON が配列でない → `bad_response`。5xx → `network`。ホストは `opencritic-api.p.rapidapi.com`、ヘッダーは `x-rapidapi-host`、`x-rapidapi-key`。

### 1.3 `src/lib/server/question-sets/critic-v1.ts`

```ts
export const criticV1: QuestionSetDefinition; // category 'game'、version 1、model 'clef-flash'
// aspects: gameplay、music、comfort、price、overall
// questions: [...gameV1.questions, ...4観点の star, overall_choice, overall_star]（22.7 の試験と同じ 14 問、同じ順序）
```

`question-sets/index.ts` の `QUESTION_SETS` には、**入れない**（`latestDefinition('game')` が、一般のレビューの質問セットを返さなくなるため）。`criticV1` は、別に export する。テスト: 14 問、順序、キーの一意、`toClefQuestions` が通る。

### 1.4 `src/lib/server/reading.ts`（変更は、取り出しだけ）

```ts
/** 本文（メモリ上）を、質問セットで Clef に読ませて、検証した答えを返す。すぐ直る失敗（5xx、通信）は、1 回だけやり直す。 */
export async function readText(
	deps: { clef: ClefClient; quickRetryDelayMs?: number },
	def: QuestionSetDefinition,
	text: string
): Promise<{ answers: ReadingAnswer[]; latencyMs: number; inputTokens: number | null }>; // 失敗は、ClefError を投げる（reading.ts の既存の流儀）
```

`readRevision` の、Clef を呼んで `interpretAnswers` に通す部分を、`readText` に置き換える。**動作は、変えない**（既存の `reading.test.ts` が、そのまま通ること）。

### 1.5 `src/lib/server/critics.ts`（D1 への保存と、問い合わせ）

```ts
export type CriticError = 'bad_oc_id' | 'oc_id_taken' | 'not_found';

export async function ensureCriticQuestionSet(db: D1Database, def: QuestionSetDefinition, now: Date): Promise<number>; // question_sets の id。tags.ts の resolveWorkQuestionSet と同じ、ハッシュで取得か追加
export async function knownCriticIds(db: D1Database, workId: string, ocReviewIds: string[]): Promise<Set<string>>;
export async function saveCriticRead(db: D1Database, input: {
	workId: string; snippet: Pick<CriticSnippet, 'ocReviewId' | 'outlet' | 'url' | 'publishedOn'>;
	questionSetId: number; answers: ReadingAnswer[];
}, now: Date): Promise<{ ok: true } | { ok: false; error: 'duplicate' }>;   // db.batch で、critic_reviews と critic_answers を一緒に入れる

export async function linkOpenCritic(db: D1Database, workId: string, ocId: string, now: Date): Promise<{ ok: true } | { ok: false; error: CriticError }>; // ocId が '' なら外す。正の整数のみ
export async function worksToSync(db: D1Database, limit: number): Promise<{ id: string; ocId: number }[]>; // 古い順（critic_synced_at が null が先）。active のみ
export async function markSynced(db: D1Database, workId: string, now: Date): Promise<void>;

export interface Candidate { workId: string; workName: string; ocId: number; ocName: string }
export async function worksNeedingCandidate(db: D1Database, limit: number): Promise<{ id: string; name: string }[]>; // game、active、opencritic_id なし、候補の行なし
export async function addCandidate(db: D1Database, workId: string, game: OcGame, now: Date): Promise<void>;
export async function openCandidates(db: D1Database): Promise<Candidate[]>;
export async function decideCandidate(db: D1Database, workId: string, approve: boolean, now: Date): Promise<{ ok: true } | { ok: false; error: CriticError }>; // 承認は linkOpenCritic と同じ検査

/** 作品ページに出す形。件数が 0 なら null。 */
export interface CriticSection {
	count: number;
	/** 段階ごとの確率の合計（ソフトな件数。星1〜星5）と、連続値の平均。観点を平均しない。 */
	overall: { soft: number[]; mean: number | null };
	aspects: { aspect: string; label: string; n: number; soft: number[]; mean: number | null }[]; // 向きが「言及なし」でないものだけを数える
	items: { outlet: string; url: string; publishedOn: string | null;
		overall: { direction: Direction; star: number | null };
		features: { aspect: string; label: string; direction: Direction; star: number | null }[] }[]; // 新しい順。最大 CRITIC_ITEMS_MAX（30）
}
export async function criticSection(db: D1Database, workId: string): Promise<CriticSection | null>;
```

エラーの文言は `src/lib/messages.ts` に `CRITIC_MESSAGES: Record<CriticError, string>` で置く（標準 2）。

### 1.6 `src/lib/server/critic-sync.ts`（1 日 1 回の取得。順序と上限）

```ts
export interface CriticLimits {
	maxCalls: number;       // 1 回の実行での、OpenCritic の呼び出し（検索を除く）。既定 120
	maxSearches: number;    // 候補の検索。既定 5
	maxReads: number;       // Clef で読む抜粋の数。既定 60（約 900 neurons）
	maxPagesPerWork: number; // 既定 3（60 件）
	requestReserve: number; // 無料枠の残りが、これ以下になったら止める。既定 40（上限 200）
	searchReserve: number;  // 既定 5（上限 25）
	pauseMs: number;        // 呼び出しの間隔。既定 1500
}
export interface CriticSyncResult { works: number; calls: number; searches: number; read: number; failed: number; stopped: 'done' | 'budget' | 'unauthorized' | 'rate_limited' }
export async function syncCritics(deps: { db: D1Database; clef: ClefClient; oc: OpenCriticClient; now?: () => Date; limits?: Partial<CriticLimits>; sleep?: (ms: number) => Promise<void> }): Promise<CriticSyncResult>;
```

順序: (1) 結びつけのある作品（`worksToSync`）ごとに、`reviewsOfGame(ocId, 0)`、次は `skip += 20`。**ページの全件が既知か、`maxPagesPerWork` で止める**。新しい抜粋だけ `readText` で読んで、`saveCriticRead`。1 件の失敗（ClefError）は数えて続ける（次の日に、同じ抜粋が、また新しいものとして出る）。作品ごとに、`markSynced`（失敗でも。同じ作品が毎回先頭に来て、ほかが止まるのを防ぐ）。(2) 残りの枠で、`worksNeedingCandidate` の作品名を `searchGame`、上位 1 件を `addCandidate`。(3) `hasBudget` が false、上限に達した、`unauthorized`、`rate_limited` のどれかで、その場で止めて、結果に理由を入れる。ログは `console.log(JSON.stringify({ event: 'critic_sync', ... }))`（抜粋は、出さない）。

### 1.7 定期実行の接続

- `wrangler.jsonc`: `triggers.crons` に、`"17 18 * * *"`（毎日 18:17 UTC = 03:17 JST）を足す（既存の `* * * * *` は、残す）。**設定の変更だけ。デプロイはしない。**
- `src/worker.ts`: `scheduled(controller, env, ctx)` で、`controller.cron` を `runScheduled(env, controller.cron)` に渡す。
- `src/lib/server/scheduled.ts`: `export const CRITIC_CRON = '17 18 * * *'`。`cron === CRITIC_CRON` なら、`env.OPENCRITIC_API_KEY` があるときだけ `syncCritics`。ほかは、今までどおり `sweepReadings`。
- `src/lib/server/env.ts`: `OPENCRITIC_API_KEY?: string`。

### 1.8 管理画面と作品ページ

- `src/routes/admin/works/[id]/+page.server.ts` と `+page.svelte`: 「OpenCritic の作品 ID」の入力と保存（action `linkCritic`。`linkOpenCritic`）。失敗は `fail(400, { error: CRITIC_MESSAGES[...] })`（標準 4）。ゲームの作品だけ。
- `src/routes/admin/inbox/+page.server.ts` と `+page.svelte`: 「専門家の欄の候補」の一覧（`openCandidates`）と、承認・却下（action `approveCandidate`、`rejectCandidate`）。
- `src/routes/works/[slug]/+page.server.ts` の `load`: `critics: await criticSection(db, work.id)` を足す。
- `src/lib/components/CriticSection.svelte`（新規。props: `section: CriticSection`）と `StarDist.svelte`（5 段階の棒と、小さな平均。**観点を、まとめて平均しない**）。作品ページの、一般のレビューの前に、区切って置く。`section` が null なら、何も出さない。出すもの: 見出し、総合の分布、観点ごとの分布（言及のあるもの）、各レビュー（媒体名の文字、元記事へのリンク、総合の向きと星、言及された観点の向き）、出典（OpenCritic の名前と `https://opencritic.com` へのリンク、「AI が読み取った結果」の注記）。**媒体のロゴ、媒体の点数、抜粋は、出さない。** リンクは `rel="noopener noreferrer nofollow"`、`target="_blank"`。

## 2. 分担と順序（1 つの agent に、1 つの仕事）

| 段 | 仕事 | 担当 | 渡すもの |
|---|---|---|---|
| A1 | `opencritic.ts` とそのテスト | `coder-haiku` | 型だけの `opencritic.ts`（本体は未実装）と、失敗するテスト `opencritic.test.ts`（作り物の応答。実在の抜粋は使わない） |
| A2 | `0006_critics.sql`、`critics.ts`、そのテスト | `delegate:builder` | 1.1 と 1.5。テストを先に書かせる |
| A3 | `readText`（`reading.ts`）、`critic-v1.ts`、テスト用の偽 Clef を score に対応 | `delegate:builder` | 1.3、1.4。`reading.ts` は Haiku に任せない（`CLAUDE.md`） |
| B | `critic-sync.ts`、`scheduled.ts`、`worker.ts`、`env.ts`、`wrangler.jsonc` | `delegate:builder` | 1.6、1.7。A1〜A3 の後 |
| C1 | 管理画面（作品の ID、候補の承認）と `messages.ts` | `coder-haiku` | 1.5 の型と 1.8。B の後（`critics.ts` ができてから） |
| C2 | `CriticSection.svelte`、`StarDist.svelte`、`load` の接続 | `coder-haiku` | 1.5 の `CriticSection` の型と 1.8 |
| D | 最後のレビュー | `delegate:reviewer` | この文書（仕様）と差分だけ |

A1〜A3 は、ファイルが重ならないので、worktree で並べる（最大 3）。段 B 以降は、前の段のあとに。各 agent は、自分のブランチで作業し、コミットして返す。私が、各ゲートを自分で実行してから、統合ブランチ `claude/opencritic-expert-reviews-biegyr` に取り込む。

毎回の指示に入れる: `$lib` は使わない、`#server/...` を使う、本番・Cloudflare・OpenCritic・デプロイ・マイグレーションの適用には触らない（テストは、偽のクライアントと、`createTestDb()` だけを使う）、作り物のデータだけ（実在の抜粋・記事を置かない）、`docs/standards.md` に従う、ほかのファイルは触らない。

## 3. ゲート（完了の検査）

- G1 型と Svelte: `npm run check` → 0 エラー。
- G2 単体テスト: 各段の新しいテスト（`npx vitest run <file>`）。失敗するテストが先にあり、実装で通る（段 A1 は、私が渡す時点で失敗していることを確認する）。
- G3 全件: 最後に、`npm test` を 1 回（約 40 秒）。
- G4 ビルド: `scripts/deploy.sh --build-only`（本番に触らない）。
- G5 画面（任意、C2 の後）: ビルドして `wrangler dev`（`wrangler.local.jsonc`、AI なし）で、作り物の `critic_reviews` を、ローカルの D1 に入れて、作品ページの欄をスクリーンショットで確かめる。
- G6 漏れの確認: `git grep` で、`snippet` の値、`RAPID_API_KEY` の値、`rapidapi` のキーらしい文字列が、リポジトリにないこと。`critic_reviews` と `critic_answers` に、本文の列がないこと（テストで、列名を確かめる）。
- G7 否定の確認（修正に対して）: `opencritic.ts` の `unauthorized` と `rate_limited` の振り分けと、`syncCritics` の「ページの全件が既知なら止まる」「`hasBudget` が false なら止まる」は、その部分をいったん外して、対応するテストが失敗することを、1 回ずつ確かめる。

## 4. リスク・未確認

- OpenCritic の API の規約（未確認。ユーザーの判断で進める）。
- 無料プランの上限（検索 25、そのほか 200 / 日）は、実測。有料プランへの変更は、しない。ほかの用途（私の試験）と、同じキーの枠を共有する。
- Clef の利用枠（1 日 10,000 neurons）は、毎分の読み取り（一般のレビュー）と共有。1 回の取得は、最大 60 件（約 900 neurons の見込み。試験では、記録していない）。
- Workers の無料プランの CPU 時間は 10 ms/回。cron の呼び出しは、**別の枠**か、確かめていない。1 回の取得は、待ち時間を含めて長いので、超えるおそれがある（未確認。`syncCritics` を、小さく分けて実行できる形にしてある: 上限で止まり、次の日に続きから）。
- 総合の質問は、試験用の文面。言い換えでの安定性は、測っていない。
- 日本語の作品名は、OpenCritic の検索で見つからない見込み（運営者が、ID を入れる）。
