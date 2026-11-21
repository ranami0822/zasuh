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
export function parseReviews(json: unknown): CriticSnippet[];  // 純粋。形の悪い要素は、捨てる。language があって 'en' で始まらないものは捨てる（試験では、language がないものは英語として扱った。実際の値は `en-us`）。
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
// aspects: [...gameV1.aspects, { key: 'overall', label: '総合' }]
// questions: [...gameV1.questions, ...4観点の star, overall_choice, overall_star]（22.7 の試験と同じ 14 問、同じ順序）
```

**総合の 2 問の文面は、リポジトリにない**（試験のスクリプト `oc-trial2.mts` は、セッションの一時ディレクトリにだけある。再起動で消える）。下を、そのまま写す（試験と同じ。変えない）。

```ts
const OVERALL = '作品全体への評価（個別の観点ではなく、作品をどう評価しているか）';
// overall_choice（kind 'direction'、aspect 'overall'）
instructions: `次のゲームレビューの抜粋は、${OVERALL}について、どのような見方を示していますか。作品全体を評価する言葉（「傑作」「失望」「おすすめ」など）も、評価として数えてください。事実の説明だけで、評価が読み取れないときは「言及なし」にしてください。書かれていないことは推測しないでください。`
options: 肯定 positive「作品全体を、好意的に評価している」、否定 negative「作品全体を、否定的に評価している」、
         混在 mixed「作品全体について、良い評価と悪い評価の両方が、同じ程度書かれている」、
         言及なし none「作品全体への評価が読み取れない（書かれていないことを推測で補わない）」（この順）
// overall_star（kind 'star'、aspect 'overall'）
instructions: `次のゲームレビューの抜粋は、${OVERALL}について、どのくらい強く肯定または否定していますか。作品全体を評価する言葉も、評価として数えてください。書かれていないことは推測しないでください。`
levels: [
  '作品全体を、強い言葉で否定している（失敗作、おすすめしない、など）',
  '作品全体を、否定的に評価している、または欠点が目立つと述べている',
  '作品全体を、良くも悪くもない、または、良い点と悪い点が釣り合っていると述べている',
  '作品全体を、好意的に評価している（良作、楽しめる、など）',
  '作品全体を、強い言葉で絶賛している（傑作、必携、など）'
]
```

4 観点の star は、`scripts/star-questions.ts` の `star()`（`STAR_RULE`、`STAR_LEVELS` を含む）の複写。

`question-sets/index.ts` の `QUESTION_SETS` には、**入れない**（`latestDefinition('game')` が、一般のレビューの質問セットを返さなくなるため）。`criticV1` は、別に export する。テスト（隣の `critic-v1.test.ts`。`game-v1.test.ts` と同じ形）: 14 問、順序、キーの一意、`toClefQuestions` が通る。

### 1.4 `src/lib/server/reading.ts`（変更は、取り出しだけ）

```ts
/** 本文（メモリ上）を、質問セットで Clef に読ませて、検証した答えを返す。すぐ直る失敗（5xx、通信）は、1 回だけやり直す。 */
export async function readText(
	deps: { clef: ClefClient; quickRetryDelayMs?: number },
	def: { model: ClefModel; questions: Question[] }, // readRevision が渡すのは ResolvedQuestionSet（category・version・aspects がない）なので、QuestionSetDefinition にしない
	text: string
): Promise<{ answers: ReadingAnswer[]; latencyMs: number; inputTokens: number | null }>; // 失敗は、ClefError を投げる（reading.ts の既存の流儀）
```

**決め（ユーザーの確認が要る）:** `readText` は、既存の `readRevision` と同じく、失敗を `ClefError` で投げる（`reading.ts` の形は、`standards.md` で未確認。外部サービスの失敗を、呼び出し側の `try` と再試行の仕組みが、すでにそのまま受けているため）。`standards.md` の 1（例外にしない）に合わせるなら、`readText` だけ `{ ok: false; error }` で返す形にする。

`readRevision` の、Clef を呼んで `interpretAnswers` に通す部分を、`readText` に置き換える。**動作は、変えない**（既存の `reading.test.ts` が、そのまま通ること）。

### 1.5 `src/lib/server/critics.ts`（D1 への保存と、問い合わせ）

```ts
export type CriticError = 'bad_oc_id' | 'oc_id_taken' | 'not_found';

export async function ensureCriticQuestionSet(db: D1Database, def: QuestionSetDefinition, now: Date): Promise<number>; // question_sets の id。ハッシュは `definitionHash(def)`（question-sets/index.ts）、definition_json は `JSON.stringify(def)`。取得か `INSERT OR IGNORE`（tags.ts の resolveWorkQuestionSet と同じ流れ）
export async function knownCriticIds(db: D1Database, workId: string, ocReviewIds: string[]): Promise<Set<string>>;
export async function saveCriticRead(db: D1Database, input: {
	workId: string; snippet: Pick<CriticSnippet, 'ocReviewId' | 'outlet' | 'url' | 'publishedOn'>;
	questionSetId: number; answers: ReadingAnswer[];
}, now: Date): Promise<{ ok: true } | { ok: false; error: 'duplicate' }>;   // db.batch で、critic_reviews と critic_answers を一緒に入れる

export async function linkOpenCritic(db: D1Database, workId: string, ocId: string, now: Date): Promise<{ ok: true } | { ok: false; error: CriticError }>; // ocId が '' なら外す。正の整数のみ。ID が変わる・外すときは、その作品の critic_reviews を消し（critic_answers は CASCADE）、critic_synced_at を null にする（別の作品の結果が残らないように）。同じ ID なら何もしない
export async function worksToSync(db: D1Database, limit: number, now: Date): Promise<{ id: string; ocId: number }[]>; // 古い順（critic_synced_at が null が先）。active のみ。critic_synced_at が now の 20 時間以内のものは、除く
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

テストは、隣の `critics.test.ts`（標準 5: `createTestDb()` を `beforeEach`、`dispose` を `afterEach`、時刻は `createClock`、`describe` と `it` は日本語。DB のモックは使わない）。

### 1.6 `src/lib/server/critic-sync.ts`（1 日 1 回の取得。順序と上限）

```ts
export interface CriticLimits {
	maxCalls: number;       // 1 回の実行での、OpenCritic の呼び出し（検索を除く）。既定 40（無料の Workers の外部への subrequest は 1 回 50 まで。検索と合わせて 45 以下。4. を参照）
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

順序: (1) 結びつけのある作品（`worksToSync`）ごとに、`reviewsOfGame(ocId, 0)`、次は `skip += 20`。**ページの全件が既知か、`maxPagesPerWork` で止める**。新しい抜粋だけ `readText` で読んで、`saveCriticRead`。1 件の失敗（ClefError）は数えて続ける（次の日に、同じ抜粋が、また新しいものとして出る）。作品ごとに、`markSynced`（失敗でも。同じ作品が毎回先頭に来て、ほかが止まるのを防ぐ）。(2) 残りの枠で、`worksNeedingCandidate` の作品名を `searchGame`、上位 1 件を `addCandidate`。(3) `hasBudget` が false、上限に達した、`unauthorized`、`rate_limited` のどれかで、その場で止めて、結果に理由を入れる。ログは `console.log(JSON.stringify({ event: 'critic_sync', ... }))`（抜粋は、出さない）。テスト（`critic-sync.test.ts`）は、`createTestDb()`、`createClock`、Clef は `fakeClef`、OpenCritic は偽の `OpenCriticClient`（標準 5）。

### 1.7 定期実行の接続

- **cron は、足さない**（`wrangler.jsonc` は変えない）。無料プランの cron の数の上限（アカウント全体で 5 個、という記憶。未確認）に、このアカウントの、ほかの Worker と合わせて当たるおそれがあり、当たるとデプロイが失敗するため。毎分の cron の中で、UTC の 18:17〜18:19 のときだけ、取得を呼ぶ。
- `src/worker.ts`: `scheduled(controller, env, ctx)` で、`controller.scheduledTime` を `runScheduled(env, new Date(controller.scheduledTime))` に渡す（今は `_controller: unknown`。型を `{ scheduledTime: number }`、または workers-types の `ScheduledController` にする）。
- `src/lib/server/scheduled.ts`: `export function isCriticSyncTime(now: Date): boolean`（UTC の時が 18、分が 17〜19）。`runScheduled(env: Env, now: Date = new Date())`（省略できる形にして、既存の `scheduled.test.ts` を、そのまま通す）。毎回、今までどおり `sweepReadings`。そのあと、`isCriticSyncTime(now)` で、`normalizeKey(env.OPENCRITIC_API_KEY)` が null でないときだけ `syncCritics`（例外は捕まえて記録し、投げない。既存の sweep と同じ）。**同じ日に 3 回呼ばれても、重ならない**ように、`worksToSync` は、`critic_synced_at` が 20 時間以内の作品を除く（候補の検索は、候補の行がある作品を除くので、重ならない）。
- テスト: `scheduled.test.ts` に、「18:17 でキーがあれば取得する」「キーがなければ何もしない」「18:17 以外では取得しない」「18:17〜18:19 に 3 回呼んでも、同じ作品を 2 回取得しない」を足す（OpenCritic は `fetch` の偽物）。
- `src/lib/server/env.ts`: `OPENCRITIC_API_KEY?: string`。

### 1.8 管理画面と作品ページ

- `src/routes/admin/works/[id]/+page.server.ts` と `+page.svelte`: 「OpenCritic の作品 ID」の入力と保存（action `linkCritic`。`linkOpenCritic`）。失敗は `fail(400, { error: CRITIC_MESSAGES[...], values })`、成功は `values` を返し、`console.log(JSON.stringify({ event: 'critic_linked', ... }))` で記録する（標準 4）。`database()` と `new Date()` は、ここで渡す（標準 3）。ゲームの作品だけ。
- `src/routes/admin/inbox/+page.server.ts` と `+page.svelte`: 「専門家の欄の候補」の一覧（`openCandidates`）と、承認・却下（action `approveCandidate`、`rejectCandidate`）。失敗は `fail(400, { error: CRITIC_MESSAGES[...], values })`、記録は `console.log(JSON.stringify({ event: 'critic_candidate_decided', ... }))`（標準 4）。
- `src/routes/works/[slug]/+page.server.ts` の `load`: `critics: await criticSection(db, work.id)` を足す。
- `src/lib/components/CriticSection.svelte`（新規。props: `section: CriticSection`）と `StarDist.svelte`（5 段階の棒と、小さな平均。**観点を、まとめて平均しない**）。作品ページの、一般のレビューの前に、区切って置く。`section` が null なら、何も出さない。出すもの: 見出し、総合の分布、観点ごとの分布（言及のあるもの）、各レビュー（媒体名の文字、元記事へのリンク、総合の向きと星、言及された観点の向き）、出典（OpenCritic の名前と `https://opencritic.com` へのリンク、「AI が読み取った結果」の注記）。**媒体のロゴ、媒体の点数、抜粋は、出さない。** リンクは `rel="noopener noreferrer nofollow"`、`target="_blank"`。

## 2. 分担と順序（1 つの agent に、1 つの仕事）

| 段 | 仕事 | 担当 | 渡すもの |
|---|---|---|---|
| A1 | `opencritic.ts` とそのテスト | `coder-haiku` | 型だけの `opencritic.ts`（本体は未実装）と、失敗するテスト `opencritic.test.ts`（作り物の応答。実在の抜粋は使わない） |
| A2 | `0006_critics.sql`、`critics.ts`、そのテスト | `delegate:builder` | 1.1 と 1.5。テストを先に書かせる |
| A3 | `readText`（`reading.ts`）、`critic-v1.ts`、テスト用の偽 Clef を score に対応 | `delegate:builder` | 1.3、1.4。`reading.ts` は Haiku に任せない（`CLAUDE.md`）。今の `answersFor`（`testing/db.ts`）は、`score` の質問にも noul の形で答え、キーの `_star` を外さない。`_star` を外し、score には `{ type: 'score', score: 0〜4, probabilities: [5 個], confidence }` で答える形に直す（`clefAnswers` も同じく star を扱わない）。既存のテストが通ること |
| B | `critic-sync.ts` と `critic-sync.test.ts`、`scheduled.ts` と `scheduled.test.ts`、`worker.ts`、`env.ts`（`wrangler.jsonc` は変えない。1.7） | `delegate:builder` | 1.6、1.7。A1〜A3 の後 |
| C1 | 管理画面（作品の ID、候補の承認）と `messages.ts` | `coder-haiku` | 型だけのコード（`CRITIC_MESSAGES` の型、action の名前と戻り値）と 1.8。B の後（`critics.ts` ができてから） |
| C2 | `critic-view.ts`（純粋な関数）と、`CriticSection.svelte`、`StarDist.svelte`、`load` の接続 | `coder-haiku` | 型だけのコード（props の型、`CriticSection` の型、`critic-view.ts` の関数の型）、失敗するテスト `critic-view.test.ts`、1.8 |
| D | 最後のレビュー | `delegate:reviewer` | この文書（仕様）と差分だけ |

**C1、C2 の「失敗する検査」（ユーザーの確認が要る）:** 画面（routes と `.svelte`）の単体テストは、今ない。C2 は、表示の計算（段階ごとの確率の合計 → 棒の幅、「言及なし」の扱い、件数の表記）を、`src/lib/critic-view.ts` の純粋な関数に出し、**失敗するテストを私が先に書いて**渡す。部品は、その関数を呼ぶだけにする。C1 は、`critics.ts` を呼ぶ薄い action だけ（検査の中身は、A2 のテスト）。C1、C2 の先に、型だけのコードで、`npm run check` が失敗する状態（存在しない部品や action を、画面が参照）にして渡し、G1、G4b、G5 で確かめる。これで足りなければ、C1 を `delegate:builder-lite` に替える。

A1〜A3 は、ファイルが重ならないので、worktree で並べる（最大 3）。段 B 以降は、前の段のあとに。各 agent は、自分のブランチで作業し、コミットして返す。私が、各ゲートを自分で実行してから、統合ブランチ `claude/opencritic-expert-reviews-biegyr` に取り込む。

毎回の指示に入れる: `$lib` は使わない、`#server/...` を使う、本番・Cloudflare・OpenCritic・デプロイ・マイグレーションの適用には触らない（テストは、偽のクライアントと、`createTestDb()` だけを使う）、作り物のデータだけ（実在の抜粋・記事を置かない）、テストでデータを消すときは自分が作ったものだけ、`docs/standards.md` に従う（テストは実装の隣の `名前.test.ts`、`describe` と `it` は日本語）、ほかのファイルは触らない。

ユーザーの確認のあと、この計画で決めたこと（候補を別の表にする、cron を足さない、`critic-v1`、`readText` の取り出し）を、`docs/mvp-design.md` の 22 章に足す（決定、理由、未確認、見直す条件。`CLAUDE.md`）。

## 3. ゲート（完了の検査）

- G1 型と Svelte: `npm run check` → 0 エラー。
- G2 単体テスト: 各段の新しいテスト（`npx vitest run <file>`）。失敗するテストが先にあり、実装で通る（段 A1 は、私が渡す時点で失敗していることを確認する）。
- G3 全件: 最後に、`npm test` を 1 回（約 40 秒）。
- G4 ビルド: `scripts/deploy.sh --build-only`（本番に触らない）。
- G4b ブラウザの通し: C1、C2 の後に、`npm run e2e`（画面を変えたため。`CLAUDE.md`）。
- G5 画面（任意、C2 の後）: ビルドして `wrangler dev`（`wrangler.local.jsonc`、AI なし）で、作り物の `critic_reviews` を、ローカルの D1 に入れて、作品ページの欄をスクリーンショットで確かめる。
- G6 漏れの確認: `git grep` で、`snippet` の値、`RAPID_API_KEY` の値、`rapidapi` のキーらしい文字列が、リポジトリにないこと。`critic_reviews` と `critic_answers` に、本文の列がないこと（テストで、列名を確かめる）。
- G7 否定の確認（修正に対して）: `opencritic.ts` の `unauthorized` と `rate_limited` の振り分けと、`syncCritics` の「ページの全件が既知なら止まる」「`hasBudget` が false なら止まる」は、その部分をいったん外して、対応するテストが失敗することを、1 回ずつ確かめる。

## 4. リスク・未確認

- OpenCritic の API の規約（未確認。ユーザーの判断で進める）。
- 無料プランの上限（検索 25、そのほか 200 / 日）は、実測。有料プランへの変更は、しない。ほかの用途（私の試験）と、同じキーの枠を共有する。
- Clef の利用枠（1 日 10,000 neurons）は、毎分の読み取り（一般のレビュー）と共有。1 回の取得は、最大 60 件（約 900 neurons の見込み。試験では、記録していない）。
- Workers の無料プランの CPU 時間は 10 ms/回（通信の待ち時間は含まない）。cron の呼び出しは、**別の枠**か、確かめていない。JSON の解析と D1 の処理が、超えるおそれがある（未確認。`syncCritics` は、上限で止まり、次の日に続きから）。
- **subrequest の上限（未確認。記憶による）:** 無料の Workers は、1 回の呼び出しで、外部への fetch が 50 まで（D1 や AI などの Cloudflare のサービスは、別に 1000 まで）。超えると、それ以降の fetch が失敗する。このため `maxCalls` の既定を 120 から 40 に下げた（検索 5 と合わせて 45）。デプロイの前に、Cloudflare の文書で確かめる。1 日 40 回だと、1 回あたり 2 ページ × 約 20 作品が目安。
- **cron は足さない（決め）:** 無料プランの cron の数の上限（アカウント全体で 5 個、という記憶。未確認）を避けるため。毎分の cron の取りこぼし（その分に呼ばれなかった）があっても、18:17〜18:19 の 3 回のどれかで足りる。3 回とも取りこぼしたら、その日は取得しない（次の日に続く）。
- 総合の質問は、試験用の文面。言い換えでの安定性は、測っていない。
- 日本語の作品名は、OpenCritic の検索で見つからない見込み（運営者が、ID を入れる）。
