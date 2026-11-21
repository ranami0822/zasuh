# 専門家の評価の取得を、小さな実行の繰り返しにする計画（2026-11-21）

ブランチ: `claude/critics-incremental-sync-4zuu0a`。前の計画は `docs/critics-plan.md`（1.6、1.7 が、この計画で置き換わる）。決定の記録は、実装のあと、`docs/mvp-design.md` の **22.9** に書く。

## 0. 目的と、確認したこと

目的: 取得を、「1 日 1 回の大きな実行」から、「1 日の決まった時間帯の、小さな実行の繰り返し」に変える。費用は、かけない（無料プランのまま）。

**確認済み**（Cloudflare の公式文書。2026-11-21 に読んだ。D1: https://developers.cloudflare.com/d1/platform/limits/ 、Workers: https://developers.cloudflare.com/workers/platform/limits/ ）:

- D1 は、無料プランで「Queries per Worker invocation（1 回の Worker の呼び出しあたり）50」。**`db.batch()` は、中の文の数に関わらず、1 回と数える**（原文: "a `db.batch()` call counts as a single query"）。
- Workers の無料プランは、1 回の呼び出しあたり、外部への subrequest 50、Cloudflare のサービス宛て 1,000。
- Cron Trigger の CPU 時間は、無料で 10 ms/回。実時間（wall time）は 15 分/回。Cron Trigger の数は、無料で、アカウント全体 5 個。
- Workers の 1 日のリクエスト数は、無料で 100,000。

**未確認（文書に書いていない）:**

- 「毎分の cron の 1 回の実行が、新しい invocation で、それぞれに D1 の 50 の枠がある」とは、**どちらのページにも、明記がない**。文書は、スケジュール実行を invocation と呼んでいる（"Scheduled Workers have a maximum wall time of 15 minutes per invocation."）ので、そう読めるが、読みであって、明記ではない。**本番で、最初の何回かの `critic_sync` のログに、D1 のエラーがないことを見て、確かめる**（7 章）。
- cron の呼び出しが、1 日のリクエスト数に数えられるか。D1 の 1 日の rows read / written の上限（別のページ）。

この計画は、1 回の実行を、D1 の問い合わせ 45 回前後までに収める。上の読みが外れて、1 日で 50 を共有していた場合は、2 回目以降の実行が、D1 のエラーで落ちる（例外は、`scheduled.ts` が捕まえて、記録する。1 日 1 回に戻せば、今までと同じ）。

## 1. 決めること（★ ユーザーの確認が要る）

| 項目 | 提案 | 理由 |
|---|---|---|
| 時間帯 | UTC 17:00〜21:00（日本時間 02:00〜06:00）。`17:00 <= 時刻 < 21:00` | 日本の深夜。UTC の日をまたがない（日ごとの上限を、UTC の日で数えるため）。Clef の無料枠は、00:00 UTC に戻る。そのあとの 3 時間は、ユーザーのレビューの読み取り用に空ける |
| 間隔 | 5 分おき（1 日 48 枠） | 1 枠の読み取り 6 件 × 25 枠 = 150 件（1 日の上限）。枠に余裕がある（失敗した枠の分） |
| 1 回の上限 | 今のまま。呼び出し 8、検索 2、読み取り 6、1 作品 3 ページ | D1 の 50 問い合わせ以内（4 章で、数えて確かめる） |
| 1 日の上限（OpenCritic の呼び出し） | **150**（検索を除く） | 無料プランは 200/日。キーは、私の試験と共有。応答ヘッダーでの「残り 40 以下で止める」（`requestReserve`）が、すでにあるので、それと合わせて、160 を超えない値 |
| 1 日の上限（OpenCritic の検索） | **15** | 無料プランは 25/日。`searchReserve` 5 と合わせて、20 を超えない値 |
| 1 日の上限（Clef の読み取り） | **150 件** | 約 2,000〜2,300 neurons の見込み（1 件 13〜15 neurons。試験の値で、**未確認**）。無料枠 10,000/日の 2 割ほど。残りは、ユーザーのレビューの読み取りと共有の分 |

時間帯・間隔・1 日の上限は、`src/lib/server/critic-slot.ts` と `critic-sync.ts` の定数で、あとから変えられる（再デプロイだけ）。

見込み: 1 日に読めるのは、**6 件 → 150 件**（25 倍）。レビュー 20 件の作品なら、約 3.3 回の実行（約 17 分）で読み切る。

## 2. 全体の動き

毎分の cron は、今までどおり。`runScheduled` が、`sweepReadings`（ユーザーのレビューの読み取り）のあと、時間帯の中なら `syncCritics` を呼ぶ。

1. `criticSyncSlot(now)` が、枠の名前（例 `2026-11-21T17:05`。5 分の頭の時刻）を返す。時間帯の外なら null。
2. `claimCriticSlot` が、その枠を取る。**同じ枠は、1 回だけ**（INSERT OR IGNORE）。同時に、その日の合計から、この枠の割り当て（呼び出し・検索・読み取り）を決めて、記録する。割り当ては、1 回の上限と、その日の残りの、小さいほう。
3. `syncCritics` は、割り当ての範囲で、作品ごとに、続きのページから読む。止まった作品は、止まったページを覚える（`critic_cursor`）。読み切った作品は、その日のうちに、もう選ばない（`critic_done_on`）。
4. 終わりに、`finishCriticSlot` が、割り当てを、実際に使った数に直す。**異常終了（例外）した枠は、割り当てのまま残る**（その日の合計を、多めに数える側に倒す）。

**同じ呼び出しで、`sweepReadings` が拾ったとき（`picked > 0`）は、その分の取得を、しない**（枠も取らない。同じ 5 分の、次の分に回る）。理由: D1 の 50 問い合わせは、1 回の呼び出しの中で、sweep と取得が共有するため（**読み。0 章の未確認と同じ**）。

## 3. 置き場所と、型

### 3.1 `src/lib/server/critic-slot.ts`（新規。純粋な関数。D1 を知らない）→ `coder-haiku`

```ts
export interface CriticSlotConfig {
	/** 時間帯の始まり（UTC の時、含む）と終わり（含まない）。 */
	startHourUtc: number;
	endHourUtc: number;
	/** 枠の長さ（分）。60 を割り切れる値。 */
	intervalMinutes: number;
}
export const CRITIC_SLOT_CONFIG: CriticSlotConfig = { startHourUtc: 17, endHourUtc: 21, intervalMinutes: 5 };

/** now が入る枠の名前（'YYYY-MM-DDTHH:MM'。UTC。枠の頭の時刻）。時間帯の外なら null。 */
export function criticSyncSlot(now: Date, config: CriticSlotConfig = CRITIC_SLOT_CONFIG): string | null;
```

`scheduled.ts` の `isCriticSyncTime` は、この関数に置き換えて、消す。

### 3.2 `migrations/0007_critic_slots.sql`（足すだけ。本番には適用しない）→ `delegate:builder`

```sql
-- 作品ごとの、取得の進み具合。
-- critic_cursor: NULL は、途中ではない。数は、次の実行が取るページ（0 始まり）。
-- critic_done_on: 最後まで読み切った（または、その日は諦めた）UTC の日付 'YYYY-MM-DD'。
-- critic_searched_on: 候補を検索した UTC の日付（見つからなかったときも入れる）。
ALTER TABLE works ADD COLUMN critic_cursor INTEGER;
ALTER TABLE works ADD COLUMN critic_done_on TEXT;
ALTER TABLE works ADD COLUMN critic_searched_on TEXT;

-- 実行の枠ごとの記録。1 日の合計は、day で足す。critic_runs（0006）は、使わなくなる（残す）。
-- slot は 'YYYY-MM-DDTHH:MM'、day は slot の先頭 10 文字。
-- calls、searches、reads は、取る前は割り当て、終わったら実績（reads は、失敗した読み取りも数える）。
-- stopped は、終わった理由。NULL は、実行中か、異常終了。
CREATE TABLE critic_slots (
  slot TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  started_at TEXT NOT NULL,
  calls INTEGER NOT NULL,
  searches INTEGER NOT NULL,
  reads INTEGER NOT NULL,
  stopped TEXT
);
CREATE INDEX critic_slots_day ON critic_slots (day);
```

注: テスト用の DB（`testing/db.ts` の `createTestDb`）は、**行の先頭が `--` の行だけ**を除き、`;` で文を分けて、`db.batch` で適用する。文の後ろに続けた `-- ...`（行の途中のコメント）は、除かれず、次の文の先頭に付く。だから、コメントは、必ず独立した行に書き、中に `;` を書かない（上の形）。

### 3.3 `src/lib/server/critics.ts`（変更）→ `delegate:builder`

```ts
export interface CriticAllowance { calls: number; searches: number; reads: number }
/** reserve: OpenCritic の応答ヘッダーの残り（呼び出し）が requestReserve 以下で止まった（結果の stopped は 'budget' のまま。枠の記録だけ分ける）。 */
export type CriticSlotStop = 'done' | 'budget' | 'reserve' | 'unauthorized' | 'rate_limited' | 'clef_failed';

export type ClaimError = 'already_ran' | 'stopped_today' | 'daily_limit';
/**
 * 枠を取る。取れたら、その枠の割り当てを返す（枠の行を入れる）。
 * 割り当て = 各項目で min(perRun, daily - その日にほかの枠が使った分)。
 * 取れない場合（行は入れない）:
 *  - already_ran: その枠の行が、もうある。
 *  - stopped_today: その日の、ほかの枠が、unauthorized か rate_limited か reserve で終わっている（その日は、もう呼ばない）。
 *  - daily_limit: 割り当ての calls か reads が 0（検索だけ残っていても、取らない）。
 * 日は slot の先頭 10 文字。重ならない 2 つの枠が同時に取っても、合計が daily を超えない（1 文の INSERT ... SELECT で、残りの計算と挿入を一緒にする）。
 * SQL の形（集計は副問い合わせに入れる。HAVING を GROUP BY なしで使わない）:
 *   INSERT OR IGNORE INTO critic_slots (slot, day, started_at, calls, searches, reads)
 *   SELECT ?, ?, ?, min(?, ? - t.c), min(?, ? - t.s), min(?, ? - t.r)
 *     FROM (SELECT coalesce(sum(calls), 0) AS c, coalesce(sum(searches), 0) AS s, coalesce(sum(reads), 0) AS r,
 *                  coalesce(sum(stopped IN ('unauthorized', 'rate_limited', 'reserve')), 0) AS halted
 *             FROM critic_slots WHERE day = ?) t
 *    WHERE t.halted = 0 AND min(?, ? - t.c) > 0 AND min(?, ? - t.r) > 0
 * 1 文は、D1 で、ほかの書き込みと混ざらない（D1 は、1 つの DB への問い合わせを、順に 1 つずつ実行する）。
 * meta.changes が 0 のときだけ、もう 1 回問い合わせて、理由（already_ran → stopped_today → daily_limit の順）を決める。
 */
export async function claimCriticSlot(
	db: D1Database, slot: string, now: Date, perRun: CriticAllowance, daily: CriticAllowance
): Promise<{ ok: true; allowance: CriticAllowance } | { ok: false; error: ClaimError }>;

/** 割り当てを、実際に使った数に直し、終わった理由を入れる。 */
export async function finishCriticSlot(db: D1Database, slot: string, used: CriticAllowance, stopped: CriticSlotStop): Promise<void>;

/** その日（UTC）に、枠の記録に入っている合計（割り当ての残りを含む）。ログと、テストで使う。 */
export async function criticDayTotals(db: D1Database, day: string): Promise<CriticAllowance>;

export interface WorkToSync { id: string; ocId: number; /** 次に取るページ（0 始まり）。途中でなければ 0。 */ cursor: number }
/**
 * 取得する作品。ゲームで、公開中で、ID があり、「now の UTC の日に、まだ読み切っていない」もの
 * （critic_done_on が null か、その日より前）。順序: 途中のもの（critic_cursor が null でない）を先、
 * そのあと critic_synced_at が古い順（null が先）、id。これまでの「20 時間以内は除く」は、なくす。
 */
export async function worksToSync(db: D1Database, limit: number, now: Date): Promise<WorkToSync[]>;

/** 止まった作品の、続きのページを覚える。critic_synced_at と critic_done_on は、変えない（先頭に居続けて、ほかの作品を止めないのは、markSynced の側で守る）。 */
export async function saveCriticCursor(db: D1Database, workId: string, cursor: number): Promise<void>;

/** その日は、もう選ばない（読み切った、または、失敗して諦めた）。critic_cursor = NULL、critic_done_on = now の日、critic_synced_at = now。 */
export async function markSynced(db: D1Database, workId: string, now: Date): Promise<void>;
```

`claimDailyRun` は、消す。`linkOpenCritic` で ID が変わる・外れるときは、`critic_cursor` と `critic_done_on` も null にする（別の作品の進み具合が残らないように）。

`worksNeedingCandidate(db, limit, now)` に `now` を足し、`critic_searched_on` が null か、その日より前の作品だけを返す。検索のあと（見つからなくても、`bad_response` でも）、`markSearched(db, workId, now)` で `critic_searched_on` に、その日を入れる（`unauthorized`・`rate_limited` で止まったときは、入れない）。<!-- REVIEW: critic_searched_on は、レビューで足した列（1 章の表の決定ではない）。検索の 1 日の上限 15 を、同じ作品の検索で使い切らないための案。代わりに、1 日の検索の上限を 1 回の上限と同じ 2 にする案もある（その場合は 1 章の表の変更で、ユーザーの確認が要る）。 -->理由: 今は、見つからない作品は、候補の行がないので、毎回の実行で、また検索される。1 日 1 回なら 1 日 2 件で済んだが、1 日 48 枠では、同じ作品の検索だけで、その日の検索の上限（15）を使い切る。

### 3.4 `src/lib/server/critic-sync.ts`（変更）→ `delegate:builder`

```ts
export interface CriticDailyLimits { maxCalls: number; maxSearches: number; maxReads: number }
/** 1 日の合計の上限（1 章の表）。 */
export const DEFAULT_CRITIC_DAILY_LIMITS: CriticDailyLimits = { maxCalls: 150, maxSearches: 15, maxReads: 150 };

// CriticSyncResult.stopped に 'stopped_today' | 'daily_limit' を足す（'already_ran' は残す。フィールドは、増やさない）。
export async function syncCritics(deps: {
	db: D1Database; clef: ClefClient; oc: OpenCriticClient;
	/** 枠の名前（criticSyncSlot の戻り値）。必須。 */
	slot: string;
	now?: () => Date; limits?: Partial<CriticLimits>; dailyLimits?: Partial<CriticDailyLimits>; sleep?: (ms: number) => Promise<void>;
}): Promise<CriticSyncResult>;
```

動き（今の動きからの違いだけ）:

1. 最初に `claimCriticSlot`。`perRun` は、既定値と `deps.limits` を合わせた `limits` の `maxCalls / maxSearches / maxReads`（既存のテストが `limits` で 1 回の上限を変えているため）。`daily` は `dailyLimits`。取れなければ、`stopped` にその理由を入れて、すぐ返す（OpenCritic も Clef も呼ばない。記録も出さない。今の `already_ran` と同じ）。取れたら、`limits.maxCalls / maxSearches / maxReads` を、割り当てで置き換える。
2. 作品は `worksToSync` の順。各作品は、`cursor` のページから。**ページの番号は、0 から数えて `maxPagesPerWork` 未満まで**（`cursor` から数えない。続きから読んでも、1 日に見る深さは、今と同じ 3 ページ）。**ページの全件が既知でも、次のページを取る**（今のまま。並び順が未確認のため）。
3. 止まり方:
   - 呼び出し・読み取りの上限で止まる（`budget`）: **作品は取得済みにせず**、まだ終えていないページの番号を `saveCriticCursor`（読み取りの途中で止まったら、そのページ。ページを終えて次の呼び出しの前に止まったら、次のページ。そのページの抜粋は、次の実行で取り直す。読んだものは、`knownCriticIds` で飛ばす）。**その作品で、この実行に 1 ページも取っていないとき（作品の最初の呼び出しの前に止まったとき）は、何もしない**（まだ始めていない作品に cursor を入れると、「途中」として先頭に来てしまう）。
   - 応答ヘッダーの残りが `requestReserve` 以下で止まる: 結果は、今までどおり `budget`。作品の扱いも `budget` と同じ。枠の記録は `reserve` にして、**その日の、ほかの枠も動かない**（`stopped_today`）。理由: 今の判定は、同じ実行の直前の応答を見るので、新しい実行の最初の 1 回は、必ず通る。1 日 48 枠だと、残りが少ないときに、毎枠 1 回ずつ使ってしまう（キーは、試験と共有）。
   - 作品を最後まで読む（件数が 20 未満のページ、または `maxPagesPerWork` に達する）: `markSynced`。
   - 作品の応答が `bad_response` などで、その作品だけ諦める: `markSynced`（その日は、もう選ばない。次の日に、0 ページ目から）。
   - 読み取りが、続けて 3 回失敗（`clef_failed`）: その作品を `markSynced`、全体は、この枠で止める。ほかの枠は、続ける。
   - `unauthorized`、`rate_limited`（OpenCritic の 429、Clef の 429）: 作品は、取得済みにしない（cursor は、`budget` と同じ決まりで入れる）。この枠は止まり、**その日の、ほかの枠も、`stopped_today` で動かない**。
4. 終わりに、必ず 1 回、`finishCriticSlot`（使った数は、呼び出し・検索・読み取り（失敗を含む）。例外が出たときは呼ばない）。`console.log` の `critic_sync` に、`slot` と、その日の合計（`criticDayTotals`。`day: { calls, searches, reads }`）を足す（本文・URL・キーは出さない）。`CriticSyncResult` の形は変えない（記録の行だけに足す）。
5. 作品の取得が `done`（今日読める作品が、もうない）のとき、残りの割り当てで、候補の検索をする（今のまま。ただし、その日に検索した作品は除く。3.3 の `critic_searched_on`）。

### 3.5 `src/lib/server/scheduled.ts`（変更）→ 私（変更が 30 行未満）

```ts
export async function runScheduled(env: Env, now?: Date, deps?: { fetch?: typeof fetch }): Promise<void>;
// sweep のあと: key がなく、または criticSyncSlot(now) が null、または sweep の picked > 0 なら、何もしない。
// それ以外は、syncCritics({ ..., slot }) を呼ぶ（例外は、今までどおり、捕まえて記録する）。
```

### 3.6 `src/lib/server/testing/count-queries.ts`（新規。テスト用の道具）→ `coder-haiku`

```ts
/** D1 への問い合わせ（prepare した文の first / all / run / raw を 1 回ずつ、db.batch() を、文の数に関わらず 1 回）を数える。同じ db の動きは変えない。 */
export function countQueries(db: D1Database): { db: D1Database; count: () => number; reset: () => void };
```

## 4. ゲート（完了の検査）

- G1 型と Svelte: `npm run check` → 0 エラー。
- G2 新しい動き: 各段で、先に書いた失敗するテストが、実装で通る。
- G3 **1 回の実行の D1 の問い合わせ ≤ 45（数えて確かめる）**: `critic-sync.test.ts` に、`countQueries` で、次の 3 つを足す（`limits` は渡さず、既定の上限で）。(a) 8 作品が、それぞれ 1 ページ（既知のものだけ）で、呼び出し 8 まで使う。(b) 1 作品の 1 ページに新しい抜粋 20 件、読み取り 6 まで使う。(c) いちばん多い場合: 質問セットがまだない DB で、8 作品が、それぞれ 1 ページ（件数 20 未満）、そのうち 6 作品に新しい抜粋 1 件。そのあと、ID のない作品 2 つの候補の検索。どれも、枠を取るところから、終わりまで（`finishCriticSlot` と `criticDayTotals` を含む）で、`count() <= 44`（定期実行の `sweepReadings` が、拾うものがないとき 1 回使うので、呼び出し全体で 45）。外部への呼び出し（OpenCritic の呼び出し＋検索）も、`<= 50`。見積もり（c）: 枠 1、作品の一覧 1、質問セット 3、既知の確認 8、読み取りの保存 6 × 2、取得済み 8、検索の一覧 1、検索ごとに候補と検索日 2 × 2、終わり 1、合計 1 ＝ 40。
- G4 枠: 同じ枠に 2 回同時に呼んでも、1 回分だけ動く。別の枠では、また動く。1 日の合計の上限で止まる（`daily_limit`）。割り当ては、その日の残りで小さくなる（例: 残り読み取り 4 なら、`reads` 4）。`unauthorized`、`rate_limited`、`reserve` で、その日の残りの枠が動かず、次の日は動く。
- G5 進み具合: 止まった作品が、次の枠で、続きのページから読まれる（OpenCritic への呼び出しの `skip` で見る）。続きから読んでも、ページの番号は `maxPagesPerWork` 未満まで。まだ始めていない作品に、cursor が入らない。読み切った作品は、その日のうちに選ばれず、次の日に、また選ばれる。失敗が続く作品が、先頭に居続けて、ほかの作品を止めない。候補が見つからない作品は、その日のうちに、もう検索されない。
- G6 否定の確認（修正に対して）: (i) `claimCriticSlot` の「枠が取れていたら 2 回目は ok: false」、(ii) `worksToSync` の「読み切った作品を除く」、(iii) `saveCriticCursor` の呼び出し、の 3 つを、いったん外して、対応するテストが失敗することを、1 回ずつ確かめる。
- G7 全件: `npm test`（最後に 1 回）。G8 ビルド: `scripts/deploy.sh --build-only`（本番には触らない）。
- G9 漏れの確認: `git grep` で、抜粋の本文・キーが、リポジトリにないこと。`critic_slots` に、本文の列がないこと。

画面は変えないので、`npm run e2e` は、しない。

## 5. 分担と順序

| 段 | 仕事 | 担当 | 渡すもの |
|---|---|---|---|
| H1 | 3.1 `critic-slot.ts` | `coder-haiku` | 型だけのコードと、失敗するテスト（完全な形） |
| H2 | 3.6 `count-queries.ts` | `coder-haiku` | 型だけのコードと、失敗するテスト（完全な形） |
| B1 | 3.2 マイグレーションと 3.3 `critics.ts`、テスト | `delegate:builder` | 3.2、3.3、G4、G5（`critics.ts` の部分）のテストの一覧。**テストを先に書かせる**（失敗を確認してから実装） |
| B2 | 3.4 `critic-sync.ts`、テスト（既存の更新を含む） | `delegate:builder` | 3.4、G3〜G5。B1、H2 の後 |
| S | 3.5 `scheduled.ts` と `scheduled.test.ts` | 私 | B2 の後 |
| R | 最後のレビュー | `delegate:reviewer` | この計画の 0〜3 章と、差分だけ |

順序: H1 → H2（同じ作業ツリー。1 つずつ。ブランチ・worktree は増やさない）→ B1 → B2 → S → R。各段の終わりに、私が、ゲートを再実行して、コミットする（プッシュは、最後にまとめて）。

**既存のテストの更新（仕様が変わるため。通すための書き換えではない）:** `critic-sync.test.ts` の `run()` が、`slot` を渡す（枠は、`criticSyncSlot(clock.now())`。同じ日に 2 回走らせるテストは、時計を 5 分進める）。`already_ran` の 2 つのテスト、「20 時間以内は除く」の `worksToSync` のテスト、`isCriticSyncTime` と、`scheduled.test.ts` の「18:17〜18:19」のテスト（「18:16、18:20、19:17 では取得しない」は、新しい時間帯の中なので、外の時刻 16:59、21:00、06:17 に変える）は、新しい仕様（枠・1 日の合計・読み切りの日）のテストに置き換える。**仕様が変わるので、期待を直す既存のテスト（ほかにはない）:** (1)「maxReads で 2 ページ目の途中で止まった翌日、読み残しを読む」は、翌日、cursor のページ 1 から読むので、`skip` は `[20, 40]`、結果は `calls: 2`（`read: 18`、合計 43 件は同じ）。(2)「最後に 1 回だけ記録し…」は、記録の行に `slot` と `day` が増えるので、`{ event: 'critic_sync', ...result, slot, day: … }` と比べる。(3) `critics.test.ts` の `worksToSync` の `toEqual`（`{ id, ocId }`）は、戻り値に `cursor` が増えるので、`cursor: 0` を足す。`worksNeedingCandidate(db, 10)` の呼び出しは、`now` を渡す。**それ以外の既存のテストは、そのまま通る**ことを、G2 で確かめる（結果の形 `toEqual` が、そのまま通ること。上の `toEqual` は、`limits` の `maxReads`・`maxCalls` が割り当てに入るので、変わらない）。

毎回の指示に入れる: `$lib` は使わない、`#server/...` を使う、本番・Cloudflare・OpenCritic・デプロイ・マイグレーションの適用には触らない、作り物のデータだけ（実在の抜粋は、置かない）、テストでデータを消すときは自分が作ったものだけ、`docs/standards.md`（失敗は `{ ok: false; error }`、関数は `db` と `now` を引数で受ける、テストは隣の `.test.ts`、日本語）、ほかのファイルは触らない、コミットまでで、プッシュはしない。

## 6. リスク

- 0 章の未確認（毎分の実行が、D1 の枠を、それぞれ持つか）。外れたら、2 回目以降の実行が、D1 のエラーで落ちる。**見直す条件:** 本番の最初の数回で、`critic_sync_failed` に D1 の上限のエラーが出たら、間隔を広げる（1 日の合計の上限は、そのまま）か、1 日 1 回に戻す。
- cron の CPU 時間（無料で 10 ms/回）。取得は、待ち時間が長いが、JSON の解析と D1 の処理は、CPU を使う。**未確認**（今までと同じ）。1 回の実行は、小さいので、1 日 1 回のときより、起きにくい。
- 異常終了した枠は、割り当てのまま残るので、その日の合計が、実際より多く数えられる。安全側。
- 1 日の合計は、UTC の日で数える。OpenCritic の無料枠が、いつ戻るか（UTC の 0 時か、24 時間の移動か）は、**未確認**。応答ヘッダーでの「残り」の確認（今まで）は、そのまま残す。
- Clef の 1 件あたりの neurons（13〜15）は、試験の見込み。**未確認**。本番の最初の日に、Clef の使用量を、ダッシュボードで見て、150 件が収まるかを確かめる。
- `sweepReadings` が拾ったときに、その分の取得を見送る。ユーザーのレビューが、毎分、拾われ続けると、取得が、何も進まない（まれ。拾うのは、猶予 2 分を過ぎた、読み取りの失敗したものだけ）。

## 7. 本番での確認（デプロイは、ユーザーの指示のあと）

デプロイと、`--migrate`（0007）は、ユーザーが指示したときだけ。そのあと、最初の時間帯（UTC 17:00〜）に: (1) ログの `critic_sync` が、枠ごとに出て、`stopped` と、その日の合計が、上限以内か。(2) `critic_sync_failed` に、D1 の上限のエラーがないか（0 章の未確認の確認）。(3) `critic_slots` の行数と、`critic_reviews` の件数が、増えているか。(4) Clef の使用量。
