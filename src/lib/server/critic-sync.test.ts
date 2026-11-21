import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClefError } from '#server/clef';
import { criticSyncSlot } from '#server/critic-slot';
import { DEFAULT_CRITIC_LIMITS, MAX_CONSECUTIVE_READ_FAILURES, syncCritics, type CriticDailyLimits, type CriticLimits } from '#server/critic-sync';
import { ensureCriticQuestionSet, linkOpenCritic, saveCriticRead, worksToSync } from '#server/critics';
import type { CriticSnippet, OcGame, OcRateLimit, OcResult, OpenCriticClient } from '#server/opencritic';
import { criticV1 } from '#server/question-sets/critic-v1';
import { countQueries } from '#server/testing/count-queries';
import { addWork, createClock, createTestDb, fakeClef } from '#server/testing/db';

/** OpenCritic の 1 ページの件数。 */
const PAGE = 20;
const NO_LIMIT: OcRateLimit = { requestsRemaining: null, searchesRemaining: null };

function ok<T>(value: T, limit: Partial<OcRateLimit> = {}): OcResult<T> {
	return { ok: true, value, limit: { ...NO_LIMIT, ...limit } };
}

/** 作り物の抜粋。本文は、偽の Clef が読む JSON（観点ごとの向き）に、目印の文を足したもの。 */
function snippet(id: string): CriticSnippet {
	return {
		ocReviewId: id,
		text: JSON.stringify({ gameplay: 'positive', overall: 'positive', note: `作り物の抜粋の本文 ${id}` }),
		outlet: `作り物の媒体 ${id}`,
		url: `https://example.com/review/${id}`,
		publishedOn: '2026-11-10'
	};
}

function page(prefix: string, count: number): CriticSnippet[] {
	return Array.from({ length: count }, (_, i) => snippet(`${prefix}-${i}`));
}

type ReviewPage = { snippets: CriticSnippet[]; rawCount: number };

/** レビューの 1 ページの応答。rawCount は、解析で捨てたものを含む件数（既定は、抜粋の数と同じ）。 */
function okPage(snippets: CriticSnippet[], limit: Partial<OcRateLimit> = {}, rawCount = snippets.length): OcResult<ReviewPage> {
	return ok({ snippets, rawCount }, limit);
}

/** 偽の OpenCritic。呼ばれた順に記録する。既定は、レビューも検索も空。 */
function fakeOc(
	handlers: {
		reviews?: (ocId: number, skip: number) => OcResult<ReviewPage>;
		search?: (name: string) => OcResult<OcGame[]>;
	} = {}
): OpenCriticClient & { calls: { kind: 'reviews' | 'search'; ocId?: number; skip?: number; name?: string }[] } {
	const calls: { kind: 'reviews' | 'search'; ocId?: number; skip?: number; name?: string }[] = [];
	return {
		calls,
		async reviewsOfGame(ocId, skip) {
			calls.push({ kind: 'reviews', ocId, skip });
			return (handlers.reviews ?? (() => okPage([])))(ocId, skip);
		},
		async searchGame(name) {
			calls.push({ kind: 'search', name });
			return (handlers.search ?? (() => ok([])))(name);
		}
	};
}

const noSleep = async () => {};

describe('syncCritics（専門家の評価欄の取得）', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;
	let clock: ReturnType<typeof createClock>;

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
		clock = createClock('2026-11-20T18:17:00.000Z');
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await dispose();
	});

	/** OpenCritic の作品 ID を結びつけた、ゲームの作品。 */
	async function linkedWork(ocId: number): Promise<string> {
		const id = await addWork(db);
		const r = await linkOpenCritic(db, id, String(ocId), clock.now());
		expect(r.ok).toBe(true);
		return id;
	}

	async function syncedAt(workId: string): Promise<string | null> {
		const row = await db.prepare('SELECT critic_synced_at AS at FROM works WHERE id = ?').bind(workId).first<{ at: string | null }>();
		return row!.at;
	}

	async function savedIds(workId: string): Promise<string[]> {
		const { results } = await db
			.prepare('SELECT oc_review_id AS id FROM critic_reviews WHERE work_id = ? ORDER BY oc_review_id')
			.bind(workId)
			.all<{ id: string }>();
		return results.map((r) => r.id);
	}

	/** 計画の上限（既定値は、無料の D1 に合わせて、もっと小さい）。個別のテストは、必要な値だけ上書きする。 */
	const PLAN_LIMITS: Partial<CriticLimits> = { maxCalls: 40, maxSearches: 5, maxReads: 60 };

	/** 今の時刻の枠の名前。 */
	function slot(): string {
		return criticSyncSlot(clock.now())!;
	}

	function run(oc: OpenCriticClient, clef = fakeClef(), limits: Partial<CriticLimits> = {}, dailyLimits: Partial<CriticDailyLimits> = {}) {
		return syncCritics({ db, clef, oc, slot: slot(), now: clock.now, limits: { ...PLAN_LIMITS, ...limits }, dailyLimits, sleep: noSleep });
	}

	/** 次の枠（5 分後。同じ日）。 */
	const NEXT_SLOT = 5 * 60 * 1000;
	const NEXT_DAY = 24 * 60 * 60 * 1000;

	async function workState(workId: string): Promise<{ cursor: number | null; doneOn: string | null; searchedOn: string | null }> {
		const row = await db
			.prepare('SELECT critic_cursor AS cursor, critic_done_on AS doneOn, critic_searched_on AS searchedOn FROM works WHERE id = ?')
			.bind(workId)
			.first<{ cursor: number | null; doneOn: string | null; searchedOn: string | null }>();
		return row!;
	}

	async function slotRow(name: string): Promise<{ calls: number; searches: number; reads: number; stopped: string | null } | null> {
		return db
			.prepare('SELECT calls, searches, reads, stopped FROM critic_slots WHERE slot = ?')
			.bind(name)
			.first<{ calls: number; searches: number; reads: number; stopped: string | null }>();
	}

	it('既定の上限は、無料の D1（1 回の呼び出しで 50 問い合わせ）に収まる大きさ', () => {
		const l = DEFAULT_CRITIC_LIMITS;
		// 作品ごとに 2 回（ページの既知の確認と取得済み）、読み取り 1 件ごとに 2 回、検索の記録に 2 回、ほかに 10 回ほど。
		expect(10 + l.maxCalls * 2 + l.maxReads * 2 + l.maxSearches * 2).toBeLessThanOrEqual(50);
	});

	it('新しい抜粋だけを読んで保存する。媒体名と URL は入り、本文の列はない', async () => {
		const workId = await linkedWork(101);
		const setId = await ensureCriticQuestionSet(db, criticV1, clock.now());
		const known = snippet('a-0');
		await saveCriticRead(db, { workId, snippet: known, questionSetId: setId, answers: [] }, clock.now());
		const clef = fakeClef();
		const oc = fakeOc({ reviews: () => okPage(page('a', 3)) });

		const result = await run(oc, clef);

		expect(result).toEqual({ works: 1, calls: 1, searches: 0, read: 2, failed: 0, stopped: 'done' });
		expect(oc.calls).toEqual([{ kind: 'reviews', ocId: 101, skip: 0 }]);
		expect(clef.calls.map((c) => c.state)).toEqual([snippet('a-1').text, snippet('a-2').text]);
		expect(await savedIds(workId)).toEqual(['a-0', 'a-1', 'a-2']);
		const row = await db
			.prepare('SELECT outlet, url, published_on AS publishedOn, question_set_id AS setId FROM critic_reviews WHERE oc_review_id = ?')
			.bind('a-1')
			.first();
		expect(row).toEqual({ outlet: '作り物の媒体 a-1', url: 'https://example.com/review/a-1', publishedOn: '2026-11-10', setId });
		const answers = await db
			.prepare("SELECT COUNT(*) AS n FROM critic_answers a JOIN critic_reviews r ON r.id = a.critic_review_id WHERE r.oc_review_id = 'a-1'")
			.first<{ n: number }>();
		expect(answers!.n).toBe(criticV1.questions.length);
		const { results: columns } = await db.prepare('PRAGMA table_info(critic_reviews)').all<{ name: string }>();
		expect(columns.map((c) => c.name)).not.toContain('text');
		expect(columns.map((c) => c.name)).not.toContain('snippet');
		expect(await syncedAt(workId)).toBe(clock.now().toISOString());
	});

	it('2 回目は、既知の抜粋を読まず、Clef を呼ばない', async () => {
		const workId = await linkedWork(101);
		const clef = fakeClef();
		const oc = fakeOc({ reviews: () => okPage(page('a', 3)) });
		await run(oc, clef);
		expect(clef.calls).toHaveLength(3);

		clock.advance(24 * 60 * 60 * 1000);
		const result = await run(oc, clef);

		expect(result).toEqual({ works: 1, calls: 1, searches: 0, read: 0, failed: 0, stopped: 'done' });
		expect(clef.calls).toHaveLength(3);
		expect(await savedIds(workId)).toEqual(['a-0', 'a-1', 'a-2']);
		expect(await syncedAt(workId)).toBe(clock.now().toISOString());
	});

	it('ページの全件が既知でも、次のページを取り、新しい抜粋を読んで保存する', async () => {
		const workId = await linkedWork(101);
		const clef = fakeClef();
		const oc = fakeOc({ reviews: (_id, skip) => okPage(skip === 0 ? page('p0', PAGE) : page('p20', 5)) });
		await run(oc, clef, { maxPagesPerWork: 1 });
		expect(clef.calls).toHaveLength(PAGE);

		clock.advance(24 * 60 * 60 * 1000);
		oc.calls.length = 0;
		const result = await run(oc, clef);

		expect(oc.calls.map((c) => c.skip)).toEqual([0, 20]);
		expect(result).toEqual({ works: 1, calls: 2, searches: 0, read: 5, failed: 0, stopped: 'done' });
		expect(clef.calls).toHaveLength(PAGE + 5);
		expect(await savedIds(workId)).toHaveLength(PAGE + 5);
		expect(await savedIds(workId)).toContain('p20-4');
		expect(await syncedAt(workId)).toBe(clock.now().toISOString());
	});

	it('maxReads で 2 ページ目の途中で止まった翌日、読み残しを読む', async () => {
		const workId = await linkedWork(101);
		const clef = fakeClef();
		const pages: Record<number, CriticSnippet[]> = { 0: page('p0', PAGE), 20: page('p20', PAGE), 40: page('p40', 3) };
		const oc = fakeOc({ reviews: (_id, skip) => okPage(pages[skip] ?? []) });

		const first = await run(oc, clef, { maxReads: 25 });
		expect(first).toEqual({ works: 0, calls: 2, searches: 0, read: 25, failed: 0, stopped: 'budget' });
		expect(await syncedAt(workId)).toBeNull();

		clock.advance(24 * 60 * 60 * 1000);
		oc.calls.length = 0;
		const second = await run(oc, clef);

		expect(oc.calls.map((c) => c.skip)).toEqual([20, 40]);
		expect(second).toEqual({ works: 1, calls: 2, searches: 0, read: 18, failed: 0, stopped: 'done' });
		expect(clef.calls).toHaveLength(43);
		expect(await savedIds(workId)).toHaveLength(43);
		expect(await syncedAt(workId)).toBe(clock.now().toISOString());
	});

	it('1 作品で取るページは maxPagesPerWork まで。呼び出しの間に待つ', async () => {
		const workId = await linkedWork(101);
		const oc = fakeOc({ reviews: (_id, skip) => okPage(page(`p${skip}`, PAGE)) });
		const sleeps: number[] = [];

		const result = await syncCritics({
			db,
			clef: fakeClef(),
			oc,
			slot: slot(),
			now: clock.now,
			limits: { ...PLAN_LIMITS, maxPagesPerWork: 2 },
			sleep: async (ms) => {
				sleeps.push(ms);
			}
		});

		expect(oc.calls.map((c) => c.skip)).toEqual([0, 20]);
		expect(result).toEqual({ works: 1, calls: 2, searches: 0, read: 40, failed: 0, stopped: 'done' });
		expect(sleeps).toEqual([1500]);
		expect(await syncedAt(workId)).toBe(clock.now().toISOString());
	});

	it('件数が 20 未満のページを、最後のページとして終える', async () => {
		const workId = await linkedWork(101);
		const oc = fakeOc({ reviews: (_id, skip) => okPage(skip === 0 ? page('p0', PAGE) : page('p20', 2)) });

		const result = await run(oc);

		expect(oc.calls.map((c) => c.skip)).toEqual([0, 20]);
		expect(result).toEqual({ works: 1, calls: 2, searches: 0, read: 22, failed: 0, stopped: 'done' });
		expect(await syncedAt(workId)).toBe(clock.now().toISOString());
	});

	it('最後のページかは、解析で捨てる前の件数で決める（生の 20 件のうち 2 件を捨てても、次のページを取る）', async () => {
		const workId = await linkedWork(101);
		const oc = fakeOc({ reviews: (_id, skip) => (skip === 0 ? okPage(page('p0', PAGE - 2), {}, PAGE) : okPage(page('p20', 2))) });

		const result = await run(oc);

		expect(oc.calls.map((c) => c.skip)).toEqual([0, 20]);
		expect(result).toEqual({ works: 1, calls: 2, searches: 0, read: PAGE, failed: 0, stopped: 'done' });
		expect(await savedIds(workId)).toContain('p20-1');
	});

	describe('枠（5 分）と 1 日の合計', () => {
		/** 少し待ってから答える偽の Clef（2 つの実行が重なるように）。 */
		const slowClef = () =>
			fakeClef(async (state, _call, questions) => {
				await new Promise((r) => setTimeout(r, 5));
				return fakeClef().run('clef-flash', state, questions);
			});

		it('同じ枠に 2 つ同時に走らせても、取得と読み取りは 1 回分だけ。片方は already_ran で、何も呼ばない', async () => {
			const workId = await linkedWork(101);
			const clef = slowClef();
			const oc = fakeOc({ reviews: () => okPage(page('a', 3)) });

			const results = await Promise.all([run(oc, clef), run(oc, clef)]);

			expect(oc.calls).toHaveLength(1);
			expect(clef.calls).toHaveLength(3);
			expect(results).toEqual(
				expect.arrayContaining([
					{ works: 1, calls: 1, searches: 0, read: 3, failed: 0, stopped: 'done' },
					{ works: 0, calls: 0, searches: 0, read: 0, failed: 0, stopped: 'already_ran' }
				])
			);
			expect(await savedIds(workId)).toEqual(['a-0', 'a-1', 'a-2']);
			expect(await run(oc, clef)).toMatchObject({ stopped: 'already_ran' });
			expect(oc.calls).toHaveLength(1);
		});

		it('別の枠なら、同じ日でも、また動く。枠ごとに、使った数を記録する', async () => {
			await linkedWork(101);
			const oc = fakeOc({ reviews: (ocId) => okPage(page(`w${ocId}`, 2)) });
			const first = slot();
			await run(oc);

			clock.advance(NEXT_SLOT);
			await linkedWork(102);
			const result = await run(oc);

			expect(result).toEqual({ works: 1, calls: 1, searches: 0, read: 2, failed: 0, stopped: 'done' });
			expect(oc.calls.map((c) => c.ocId)).toEqual([101, 102]);
			expect(await slotRow(first)).toEqual({ calls: 1, searches: 0, reads: 2, stopped: 'done' });
			expect(await slotRow(slot())).toEqual({ calls: 1, searches: 0, reads: 2, stopped: 'done' });
		});

		it('1 日の合計の上限（dailyLimits）に達したら、その日の次の枠は daily_limit で、何も呼ばない。次の日は動く', async () => {
			await linkedWork(101);
			const oc = fakeOc({ reviews: (ocId) => okPage(page(`w${ocId}`, 2)) });
			expect(await run(oc, fakeClef(), {}, { maxCalls: 1 })).toMatchObject({ calls: 1, stopped: 'done' });

			clock.advance(NEXT_SLOT);
			await linkedWork(102);
			expect(await run(oc, fakeClef(), {}, { maxCalls: 1 })).toEqual({ works: 0, calls: 0, searches: 0, read: 0, failed: 0, stopped: 'daily_limit' });
			expect(oc.calls).toHaveLength(1);

			clock.advance(NEXT_DAY);
			expect(await run(oc, fakeClef(), {}, { maxCalls: 1 })).toMatchObject({ works: 1, calls: 1 });
		});

		it('割り当ては、その日の残りで小さくなる（読み取りの残りが 4 なら、その枠で読むのは 4 件まで）', async () => {
			const workId = await linkedWork(101);
			const clef = fakeClef();
			const oc = fakeOc({ reviews: () => okPage(page('a', PAGE)) });
			expect(await run(oc, clef, { maxReads: 6 }, { maxReads: 10 })).toMatchObject({ read: 6, stopped: 'budget' });

			clock.advance(NEXT_SLOT);
			const result = await run(oc, clef, { maxReads: 6 }, { maxReads: 10 });

			expect(result).toEqual({ works: 0, calls: 1, searches: 0, read: 4, failed: 0, stopped: 'budget' });
			expect(clef.calls).toHaveLength(10);
			expect(await savedIds(workId)).toHaveLength(10);
			expect(await slotRow(slot())).toEqual({ calls: 1, searches: 0, reads: 4, stopped: 'budget' });
		});

		it.each(['unauthorized', 'rate_limited'] as const)('%s で止まったら、枠に記録し、その日の別の枠は stopped_today で何も呼ばない。次の日は動く', async (error) => {
			const workId = await linkedWork(101);
			const oc = fakeOc({ reviews: () => ({ ok: false, error }) });
			const first = slot();
			expect(await run(oc)).toMatchObject({ stopped: error });
			expect(await slotRow(first)).toEqual({ calls: 1, searches: 0, reads: 0, stopped: error });
			// 1 ページも取っていないので、cursor は入らない。
			expect(await workState(workId)).toEqual({ cursor: null, doneOn: null, searchedOn: null });

			clock.advance(NEXT_SLOT);
			expect(await run(oc)).toEqual({ works: 0, calls: 0, searches: 0, read: 0, failed: 0, stopped: 'stopped_today' });
			expect(oc.calls).toHaveLength(1);

			clock.advance(NEXT_DAY);
			expect(await run(oc)).toMatchObject({ calls: 1, stopped: error });
			expect(oc.calls).toHaveLength(2);
		});

		it('Clef の 429 で止まったときも、その日の別の枠は stopped_today。読み途中のページを cursor に入れる', async () => {
			const workId = await linkedWork(101);
			const clef = fakeClef(() => {
				throw new ClefError('Clef の呼び出しに失敗しました (429)', false);
			});
			const oc = fakeOc({ reviews: (_id, skip) => okPage(page(`p${skip}`, PAGE)) });
			const first = slot();
			expect(await run(oc, clef)).toMatchObject({ stopped: 'rate_limited' });
			expect(await slotRow(first)).toEqual({ calls: 1, searches: 0, reads: 1, stopped: 'rate_limited' });
			expect(await workState(workId)).toEqual({ cursor: 0, doneOn: null, searchedOn: null });

			clock.advance(NEXT_SLOT);
			expect(await run(oc, clef)).toMatchObject({ stopped: 'stopped_today' });
			expect(oc.calls).toHaveLength(1);
		});

		it('応答の残りが requestReserve 以下で止まったら、結果は budget、枠の記録は reserve。その日の別の枠は stopped_today、次の日は動く', async () => {
			await linkedWork(101);
			await linkedWork(102);
			const oc = fakeOc({ reviews: (ocId) => okPage(page(`w${ocId}`, 2), { requestsRemaining: 40 }) });
			const first = slot();
			expect(await run(oc)).toMatchObject({ calls: 1, stopped: 'budget' });
			expect(await slotRow(first)).toMatchObject({ calls: 1, stopped: 'reserve' });

			clock.advance(NEXT_SLOT);
			expect(await run(oc)).toMatchObject({ calls: 0, stopped: 'stopped_today' });
			expect(oc.calls).toHaveLength(1);

			clock.advance(NEXT_DAY);
			expect(await run(oc)).toMatchObject({ calls: 1, stopped: 'budget' });
		});

		it('検索の残りが searchReserve 以下で止まったときは、枠の記録も budget で、その日の別の枠は動く', async () => {
			for (const name of ['作り物 1', '作り物 2']) await addWork(db, { name });
			const oc = fakeOc({ search: () => ok([], { searchesRemaining: 5 }) });
			const first = slot();
			expect(await run(oc)).toMatchObject({ searches: 1, stopped: 'budget' });
			expect(await slotRow(first)).toMatchObject({ searches: 1, stopped: 'budget' });

			// 残りの 1 作品を検索する（stopped_today にならない）。
			clock.advance(NEXT_SLOT);
			expect(await run(oc)).toMatchObject({ searches: 1, stopped: 'done' });
			expect(oc.calls.filter((c) => c.kind === 'search')).toHaveLength(2);
		});

		it('途中で例外が出たときは、枠の割り当てを残す（記録を直さない）', async () => {
			await linkedWork(101);
			const oc = fakeOc({
				reviews: () => {
					throw new Error('作り物の例外');
				}
			});

			await expect(run(oc, fakeClef(), { maxCalls: 8, maxSearches: 2, maxReads: 6 })).rejects.toThrow('作り物の例外');

			expect(await slotRow(slot())).toEqual({ calls: 8, searches: 2, reads: 6, stopped: null });
		});
	});

	describe('進み具合（cursor と、読み切りの日）', () => {
		it('読み取りの上限でページの途中で止まった作品は、次の枠で、そのページから読む', async () => {
			const workId = await linkedWork(101);
			const clef = fakeClef();
			const pages: Record<number, CriticSnippet[]> = { 0: page('p0', PAGE), 20: page('p20', PAGE), 40: page('p40', 3) };
			const oc = fakeOc({ reviews: (_id, skip) => okPage(pages[skip] ?? []) });

			expect(await run(oc, clef, { maxReads: 25 })).toMatchObject({ calls: 2, read: 25, stopped: 'budget' });
			expect(await workState(workId)).toEqual({ cursor: 1, doneOn: null, searchedOn: null });

			clock.advance(NEXT_SLOT);
			oc.calls.length = 0;
			const result = await run(oc, clef);

			expect(oc.calls.map((c) => c.skip)).toEqual([20, 40]);
			expect(result).toEqual({ works: 1, calls: 2, searches: 0, read: 18, failed: 0, stopped: 'done' });
			expect(await savedIds(workId)).toHaveLength(43);
			expect(await workState(workId)).toEqual({ cursor: null, doneOn: '2026-11-20', searchedOn: null });
		});

		it('ページを終えて次の呼び出しの前に止まったら、次の枠は次のページから。ページは 0 から数えて maxPagesPerWork 未満まで', async () => {
			const workId = await linkedWork(101);
			const oc = fakeOc({ reviews: (_id, skip) => okPage(page(`p${skip}`, PAGE)) });

			expect(await run(oc, fakeClef(), { maxCalls: 1 })).toMatchObject({ works: 0, calls: 1, stopped: 'budget' });
			expect(await workState(workId)).toMatchObject({ cursor: 1, doneOn: null });
			clock.advance(NEXT_SLOT);
			expect(await run(oc, fakeClef(), { maxCalls: 1 })).toMatchObject({ works: 0, calls: 1, stopped: 'budget' });
			expect(await workState(workId)).toMatchObject({ cursor: 2, doneOn: null });
			clock.advance(NEXT_SLOT);
			expect(await run(oc, fakeClef(), { maxCalls: 1 })).toMatchObject({ works: 1, calls: 1, stopped: 'done' });
			clock.advance(NEXT_SLOT);
			expect(await run(oc, fakeClef(), { maxCalls: 1 })).toMatchObject({ works: 0, calls: 0, stopped: 'done' });

			expect(oc.calls.map((c) => c.skip)).toEqual([0, 20, 40]);
			expect(await savedIds(workId)).toHaveLength(3 * PAGE);
			expect(await workState(workId)).toEqual({ cursor: null, doneOn: '2026-11-20', searchedOn: null });
		});

		it('作品の最初の呼び出しの前に、上限で止まった作品には、cursor を入れない', async () => {
			const first = await linkedWork(101);
			const second = await linkedWork(102);
			const oc = fakeOc({ reviews: (ocId) => okPage(page(`w${ocId}`, 2)) });

			// 1 つ目の作品で読み取りの上限に達し、2 つ目の作品は、最初の呼び出しの前に止まる。
			expect(await run(oc, fakeClef(), { maxReads: 2 })).toMatchObject({ works: 1, calls: 1, read: 2, stopped: 'budget' });

			const [done, rest] = oc.calls[0].ocId === 101 ? [first, second] : [second, first];
			expect(await workState(done)).toMatchObject({ cursor: null, doneOn: '2026-11-20' });
			expect(await workState(rest)).toEqual({ cursor: null, doneOn: null, searchedOn: null });
		});

		it('読み切った作品は、その日の次の枠で選ばれず、次の日に、0 ページ目から選ばれる', async () => {
			const workId = await linkedWork(101);
			const oc = fakeOc({ reviews: () => okPage(page('a', 2)) });
			expect(await run(oc)).toMatchObject({ works: 1, calls: 1 });

			clock.advance(NEXT_SLOT);
			expect(await run(oc)).toEqual({ works: 0, calls: 0, searches: 0, read: 0, failed: 0, stopped: 'done' });
			expect(oc.calls).toHaveLength(1);

			clock.advance(NEXT_DAY);
			expect(await run(oc)).toMatchObject({ works: 1, calls: 1 });
			expect(oc.calls.map((c) => c.skip)).toEqual([0, 0]);
			expect(await workState(workId)).toMatchObject({ doneOn: '2026-11-21' });
		});

		it('bad_response の作品は、その日のうちは、もう選ばれず、ほかの作品を止めない', async () => {
			const bad = await linkedWork(101);
			await linkedWork(102);
			const oc = fakeOc({ reviews: (ocId) => (ocId === 101 ? { ok: false, error: 'bad_response' } : okPage(page('g', 2))) });

			for (let i = 0; i < 3; i++) {
				await run(oc, fakeClef(), { maxCalls: 1 });
				clock.advance(NEXT_SLOT);
			}

			expect(oc.calls.map((c) => c.ocId).sort()).toEqual([101, 102]);
			expect(await workState(bad)).toEqual({ cursor: null, doneOn: '2026-11-20', searchedOn: null });
		});

		it('読み取りが続けて失敗した（clef_failed）作品は、その日のうちは、もう選ばれず、ほかの作品は次の枠で読まれる', async () => {
			const poisoned = await linkedWork(101);
			const healthy = await linkedWork(102);
			const clef = fakeClef((state, _call, questions) => {
				if (state.includes('w101')) throw new ClefError('Clef の答えの形が想定と違います', false);
				return fakeClef().run('clef-flash', state, questions);
			});
			const oc = fakeOc({ reviews: (ocId) => okPage(page(`w${ocId}`, 5)) });

			for (let i = 0; i < 3; i++) {
				await run(oc, clef);
				clock.advance(NEXT_SLOT);
			}

			expect(oc.calls.filter((c) => c.ocId === 101)).toHaveLength(1);
			expect(await savedIds(healthy)).toHaveLength(5);
			expect(await workState(poisoned)).toEqual({ cursor: null, doneOn: '2026-11-20', searchedOn: null });
		});
	});

	describe('候補の検索は、その日のうちに 1 作品 1 回', () => {
		it.each([
			['見つからない', () => ok<OcGame[]>([])],
			['bad_response', (): OcResult<OcGame[]> => ({ ok: false, error: 'bad_response' })]
		])('%s ときも、その日の次の枠では検索しない。次の日は、また検索する', async (_label, respond) => {
			const a = await addWork(db, { name: '作り物 1' });
			const b = await addWork(db, { name: '作り物 2' });
			const oc = fakeOc({ search: respond });
			expect(await run(oc)).toMatchObject({ searches: 2, stopped: 'done' });
			expect((await workState(a)).searchedOn).toBe('2026-11-20');
			expect((await workState(b)).searchedOn).toBe('2026-11-20');

			clock.advance(NEXT_SLOT);
			expect(await run(oc)).toMatchObject({ searches: 0, stopped: 'done' });

			clock.advance(NEXT_DAY);
			expect(await run(oc)).toMatchObject({ searches: 2, stopped: 'done' });
			expect(oc.calls.filter((c) => c.kind === 'search')).toHaveLength(4);
		});

		it.each(['unauthorized', 'rate_limited'] as const)('検索が %s で止まったときは、検索した日を入れない', async (error) => {
			const a = await addWork(db, { name: '作り物 1' });
			const oc = fakeOc({ search: () => ({ ok: false, error }) });

			expect(await run(oc)).toMatchObject({ searches: 1, stopped: error });

			expect((await workState(a)).searchedOn).toBeNull();
		});
	});

	describe('1 回の実行の D1 の問い合わせ（既定の上限。無料の D1 は 1 回の呼び出しで 50。定期実行の sweep の 1 回を除いて 44 まで）', () => {
		/** 既定の上限で、数える db を渡して、1 回走らせる。 */
		async function countedRun(oc: ReturnType<typeof fakeOc>, clef = fakeClef()) {
			const counted = countQueries(db);
			const result = await syncCritics({ db: counted.db, clef, oc, slot: slot(), now: clock.now, sleep: noSleep });
			return { result, queries: counted.count() };
		}

		it('(a) 8 作品が、それぞれ 1 ページ（既知の抜粋だけ）で、呼び出し 8 まで使う', async () => {
			const setId = await ensureCriticQuestionSet(db, criticV1, clock.now());
			for (let ocId = 101; ocId <= 108; ocId++) {
				const workId = await linkedWork(ocId);
				for (const s of page(`w${ocId}`, 3)) await saveCriticRead(db, { workId, snippet: s, questionSetId: setId, answers: [] }, clock.now());
			}
			const oc = fakeOc({ reviews: (ocId) => okPage(page(`w${ocId}`, 3)) });

			const { result, queries } = await countedRun(oc);

			expect(result).toEqual({ works: 8, calls: 8, searches: 0, read: 0, failed: 0, stopped: 'done' });
			console.info(`G3 (a) queries=${queries}`);
			expect(queries).toBeLessThanOrEqual(44);
			expect(oc.calls.length).toBeLessThanOrEqual(50);
		});

		it('(b) 1 作品の 1 ページに新しい抜粋 20 件で、読み取り 6 まで使う', async () => {
			await linkedWork(101);
			const oc = fakeOc({ reviews: () => okPage(page('a', PAGE)) });

			const { result, queries } = await countedRun(oc);

			expect(result).toEqual({ works: 0, calls: 1, searches: 0, read: 6, failed: 0, stopped: 'budget' });
			console.info(`G3 (b) queries=${queries}`);
			expect(queries).toBeLessThanOrEqual(44);
			expect(oc.calls.length).toBeLessThanOrEqual(50);
		});

		it('(c) 質問セットがまだない DB で、8 作品が 1 ページずつ（6 作品に新しい抜粋 1 件、2 作品は既知の 1 件）、そのあと 2 作品の候補の検索', async () => {
			const sets = async () => (await db.prepare('SELECT COUNT(*) AS n FROM question_sets').first<{ n: number }>())!.n;
			// critic-v1 の質問セットは、まだ作らない（取得が作る。その問い合わせも数える）。既知の抜粋は、別の（作り物の）質問セットに結びつける。
			const other = await db
				.prepare("INSERT INTO question_sets (hash, model, definition_json, created_at) VALUES ('other-set', 'other-model', '{}', ?)")
				.bind(clock.now().toISOString())
				.run();
			const setId = other.meta.last_row_id;
			const before = await sets();
			for (let ocId = 101; ocId <= 108; ocId++) {
				const workId = await linkedWork(ocId);
				// 107、108 は、既知の抜粋が 1 件ある（既知の確認の問い合わせが、ページごとに要る。いちばん多い構成にするため）。
				if (ocId >= 107) await saveCriticRead(db, { workId, snippet: snippet(`w${ocId}`), questionSetId: setId, answers: [] }, clock.now());
			}
			// 作品の順番（id はランダム）に結果が左右されないよう、新しい抜粋のない 107、108 を先にする（取得したことのない作品が先）。
			// 読み取りの上限に達したあとの作品は、新しい抜粋がなくても、ページを取る前に止まる（今までの動き）。
			await db.prepare('UPDATE works SET critic_synced_at = ? WHERE opencritic_id <= 106').bind('2026-11-01T00:00:00.000Z').run();
			for (const name of ['作り物 1', '作り物 2']) await addWork(db, { name });
			const oc = fakeOc({
				reviews: (ocId) => okPage([snippet(`w${ocId}`)]),
				search: (name) => ok([{ id: name === '作り物 1' ? 501 : 502, name: 'Fictional Game', dist: 0 }])
			});

			const { result, queries } = await countedRun(oc);

			expect(result).toEqual({ works: 8, calls: 8, searches: 2, read: 6, failed: 0, stopped: 'done' });
			expect(await sets()).toBe(before + 1);
			console.info(`G3 (c) queries=${queries}`);
			expect(queries).toBeLessThanOrEqual(44);
			expect(oc.calls.length).toBeLessThanOrEqual(50);
		});
	});

	it.each(['unauthorized', 'rate_limited'] as const)('%s で全体を止め、その作品に markSynced しない', async (error) => {
		const first = await linkedWork(101);
		const second = await linkedWork(102);
		const clef = fakeClef();
		const oc = fakeOc({ reviews: () => ({ ok: false, error }) });

		const result = await run(oc, clef);

		expect(result).toEqual({ works: 0, calls: 1, searches: 0, read: 0, failed: 0, stopped: error });
		expect(oc.calls).toHaveLength(1);
		expect(clef.calls).toHaveLength(0);
		expect(await syncedAt(first)).toBeNull();
		expect(await syncedAt(second)).toBeNull();
		expect((await worksToSync(db, 10, clock.now())).map((w) => w.id).sort()).toEqual([first, second].sort());
	});

	it('bad_response の作品は、失敗として数えて markSynced し、次の作品へ進む', async () => {
		const bad = await linkedWork(101);
		const good = await linkedWork(102);
		const oc = fakeOc({ reviews: (ocId) => (ocId === 101 ? { ok: false, error: 'bad_response' } : okPage(page('g', 2))) });

		const result = await run(oc);

		expect(result).toEqual({ works: 2, calls: 2, searches: 0, read: 2, failed: 1, stopped: 'done' });
		expect(await syncedAt(bad)).toBe(clock.now().toISOString());
		expect(await savedIds(good)).toEqual(['g-0', 'g-1']);
	});

	it('無料枠の残りが requestReserve 以下になったら、次の呼び出しの前に止める', async () => {
		const first = await linkedWork(101);
		const second = await linkedWork(102);
		const oc = fakeOc({ reviews: (ocId) => okPage(page(`w${ocId}`, 2), { requestsRemaining: 40 }) });

		const result = await run(oc);

		expect(result).toEqual({ works: 1, calls: 1, searches: 0, read: 2, failed: 0, stopped: 'budget' });
		expect(oc.calls).toHaveLength(1);
		// 作品の順は、id（ランダム）で決まる。呼ばれたほうが取得済み。
		const [done, rest] = oc.calls[0].ocId === 101 ? [first, second] : [second, first];
		expect(await syncedAt(done)).toBe(clock.now().toISOString());
		expect(await syncedAt(rest)).toBeNull();
	});

	it('呼び出しの数が maxCalls に達したら、次のページの前に止める', async () => {
		const workId = await linkedWork(101);
		const oc = fakeOc({ reviews: (_id, skip) => okPage(page(`p${skip}`, PAGE)) });

		const result = await run(oc, fakeClef(), { maxCalls: 1 });

		expect(result).toEqual({ works: 0, calls: 1, searches: 0, read: PAGE, failed: 0, stopped: 'budget' });
		expect(oc.calls).toHaveLength(1);
		expect(await syncedAt(workId)).toBeNull();
	});

	it('読んだ数が maxReads に達したら止め、その作品に markSynced しない', async () => {
		const workId = await linkedWork(101);
		const clef = fakeClef();
		const oc = fakeOc({ reviews: () => okPage(page('a', 5)) });

		const result = await run(oc, clef, { maxReads: 3 });

		expect(result).toEqual({ works: 0, calls: 1, searches: 0, read: 3, failed: 0, stopped: 'budget' });
		expect(clef.calls).toHaveLength(3);
		expect(await savedIds(workId)).toEqual(['a-0', 'a-1', 'a-2']);
		expect(await syncedAt(workId)).toBeNull();
	});

	it('1 件の読み取りの失敗は数えて続け、失敗した抜粋は保存しない', async () => {
		const workId = await linkedWork(101);
		const clef = fakeClef((state, _call, questions) => {
			if (state.includes('a-1')) throw new ClefError('Clef の呼び出しに失敗しました (400)', false);
			return fakeClef().run('clef-flash', state, questions);
		});
		const oc = fakeOc({ reviews: () => okPage(page('a', 3)) });

		const result = await run(oc, clef);

		expect(result).toEqual({ works: 1, calls: 1, searches: 0, read: 2, failed: 1, stopped: 'done' });
		expect(await savedIds(workId)).toEqual(['a-0', 'a-2']);
		expect(await syncedAt(workId)).toBe(clock.now().toISOString());
	});

	it(`読み取りが続けて ${MAX_CONSECUTIVE_READ_FAILURES} 回失敗したら（ClefError でなくても）、clef_failed で全体を止める。失敗した作品だけ、順番のために markSynced する`, async () => {
		const first = await linkedWork(101);
		const second = await linkedWork(102);
		const thrown = [new ClefError('Clef の呼び出しに失敗しました (400)', false), new Error('作り物の失敗'), new TypeError('作り物の失敗')];
		const clef = fakeClef((_state, call) => {
			throw thrown[(call - 1) % thrown.length];
		});
		const oc = fakeOc({ reviews: (ocId) => okPage(page(`w${ocId}`, 5)) });

		const result = await run(oc, clef);

		expect(MAX_CONSECUTIVE_READ_FAILURES).toBe(3);
		expect(result).toEqual({ works: 0, calls: 1, searches: 0, read: 0, failed: 3, stopped: 'clef_failed' });
		expect(oc.calls).toHaveLength(1);
		expect(clef.calls).toHaveLength(3);
		const marked = [await syncedAt(first), await syncedAt(second)].filter(Boolean);
		expect(marked).toEqual([clock.now().toISOString()]);
	});

	it('読めない抜粋がある作品が、毎日先頭に居続けて、ほかの作品を止めない', async () => {
		const poisoned = await linkedWork(101);
		const healthy = await linkedWork(102);
		const clef = fakeClef((state, _call, questions) => {
			if (state.includes('w101')) throw new ClefError('Clef の答えの形が想定と違います', false);
			return fakeClef().run('clef-flash', state, questions);
		});
		const oc = fakeOc({ reviews: (ocId) => okPage(page(`w${ocId}`, 5)) });

		const day1 = await run(oc, clef);
		expect(day1.stopped).toBe('clef_failed');
		expect(await syncedAt(poisoned)).not.toBeNull();

		clock.advance(24 * 3_600_000);
		await run(oc, clef);
		expect(await savedIds(healthy)).toHaveLength(5);
		expect(await savedIds(poisoned)).toEqual([]);
	});

	it('2 回続けて失敗しても、そのあと成功すれば数え直して続ける', async () => {
		const workId = await linkedWork(101);
		const clef = fakeClef((state, _call, questions) => {
			if (['a-0', 'a-1', 'a-3', 'a-4'].some((id) => state.includes(`本文 ${id}"`))) {
				throw new ClefError('Clef の呼び出しに失敗しました (400)', false);
			}
			return fakeClef().run('clef-flash', state, questions);
		});
		const oc = fakeOc({ reviews: () => okPage(page('a', 6)) });

		const result = await run(oc, clef);

		expect(result).toEqual({ works: 1, calls: 1, searches: 0, read: 2, failed: 4, stopped: 'done' });
		expect(await savedIds(workId)).toEqual(['a-2', 'a-5']);
		expect(await syncedAt(workId)).toBe(clock.now().toISOString());
	});

	it('Clef の 429 で全体を止め、その作品に markSynced しない', async () => {
		const workId = await linkedWork(101);
		const clef = fakeClef(() => {
			throw new ClefError('Clef の呼び出しに失敗しました (429)', false);
		});
		const oc = fakeOc({ reviews: () => okPage(page('a', 3)) });

		const result = await run(oc, clef);

		expect(result).toEqual({ works: 0, calls: 1, searches: 0, read: 0, failed: 0, stopped: 'rate_limited' });
		expect(clef.calls).toHaveLength(1);
		expect(await savedIds(workId)).toEqual([]);
		expect(await syncedAt(workId)).toBeNull();
	});

	describe('候補の検索', () => {
		async function candidates(): Promise<{ workId: string; ocId: number; ocName: string }[]> {
			const { results } = await db
				.prepare('SELECT work_id AS workId, oc_id AS ocId, oc_name AS ocName FROM critic_candidates ORDER BY oc_id')
				.all<{ workId: string; ocId: number; ocName: string }>();
			return results;
		}

		it('作品名で検索し、上位 1 件を候補として保存する。結果がなければ何もしない', async () => {
			const found = await addWork(db, { name: '作り物のゲーム A' });
			await addWork(db, { name: '作り物のゲーム B' });
			const oc = fakeOc({
				search: (name) =>
					ok(
						name === '作り物のゲーム A'
							? [
									{ id: 501, name: 'Fictional Game A', dist: 0 },
									{ id: 502, name: 'Fictional Game A2', dist: 3 }
								]
							: []
					)
			});

			const result = await run(oc);

			expect(result).toEqual({ works: 0, calls: 0, searches: 2, read: 0, failed: 0, stopped: 'done' });
			expect(await candidates()).toEqual([{ workId: found, ocId: 501, ocName: 'Fictional Game A' }]);
		});

		it('検索は maxSearches まで', async () => {
			for (const name of ['作り物 1', '作り物 2', '作り物 3']) await addWork(db, { name });
			const oc = fakeOc();

			const result = await run(oc, fakeClef(), { maxSearches: 2 });

			expect(oc.calls.filter((c) => c.kind === 'search')).toHaveLength(2);
			expect(result).toMatchObject({ searches: 2, stopped: 'done' });
		});

		it('検索の残りが searchReserve 以下になったら止める', async () => {
			for (const name of ['作り物 1', '作り物 2', '作り物 3']) await addWork(db, { name });
			const oc = fakeOc({ search: () => ok([], { searchesRemaining: 5 }) });

			const result = await run(oc);

			expect(result).toMatchObject({ searches: 1, stopped: 'budget' });
		});

		it('作品の取得で止まったら、検索しない', async () => {
			await linkedWork(101);
			await addWork(db, { name: '作り物のゲーム' });
			const oc = fakeOc({ reviews: () => ({ ok: false, error: 'unauthorized' }) });

			const result = await run(oc);

			expect(result).toMatchObject({ searches: 0, stopped: 'unauthorized' });
			expect(oc.calls.filter((c) => c.kind === 'search')).toHaveLength(0);
		});

		it('検索の unauthorized で止める', async () => {
			for (const name of ['作り物 1', '作り物 2']) await addWork(db, { name });
			const oc = fakeOc({ search: () => ({ ok: false, error: 'unauthorized' }) });

			const result = await run(oc);

			expect(result).toMatchObject({ searches: 1, stopped: 'unauthorized' });
			expect(await candidates()).toEqual([]);
		});
	});

	it('作品がなければ、何も呼ばず、質問セットも作らない', async () => {
		const before = await db.prepare('SELECT COUNT(*) AS n FROM question_sets').first<{ n: number }>();
		const clef = fakeClef();
		const oc = fakeOc();

		const result = await run(oc, clef);

		expect(result).toEqual({ works: 0, calls: 0, searches: 0, read: 0, failed: 0, stopped: 'done' });
		expect(oc.calls).toHaveLength(0);
		expect(clef.calls).toHaveLength(0);
		const after = await db.prepare('SELECT COUNT(*) AS n FROM question_sets').first<{ n: number }>();
		expect(after!.n).toBe(before!.n);
	});

	it('最後に 1 回だけ記録し、抜粋の本文と URL を出さない', async () => {
		await linkedWork(101);
		const clef = fakeClef((state, _call, questions) => {
			if (state.includes('a-1')) throw new ClefError(`Clef の呼び出しに失敗しました (400)`, false);
			return fakeClef().run('clef-flash', state, questions);
		});
		const oc = fakeOc({ reviews: () => okPage(page('a', 3)) });
		const logs: string[] = [];
		vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
			logs.push(args.map(String).join(' '));
		});
		const errors: string[] = [];
		vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
			errors.push(args.map(String).join(' '));
		});
		vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
			errors.push(args.map(String).join(' '));
		});

		const result = await run(oc, clef);

		expect(logs).toHaveLength(1);
		// 読み取りは、失敗を含めて 3。その日の合計は、この枠の実績。
		expect(JSON.parse(logs[0])).toEqual({ event: 'critic_sync', ...result, slot: '2026-11-20T18:15', day: { calls: 1, searches: 0, reads: 3 } });
		for (const line of [...logs, ...errors]) {
			expect(line).not.toContain('作り物の抜粋の本文');
			expect(line).not.toContain('example.com');
		}
	});
});
