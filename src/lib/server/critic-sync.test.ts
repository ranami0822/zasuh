import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClefError } from '#server/clef';
import { syncCritics, type CriticLimits } from '#server/critic-sync';
import { ensureCriticQuestionSet, linkOpenCritic, saveCriticRead, worksToSync } from '#server/critics';
import type { CriticSnippet, OcGame, OcRateLimit, OcResult, OpenCriticClient } from '#server/opencritic';
import { criticV1 } from '#server/question-sets/critic-v1';
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

/** 偽の OpenCritic。呼ばれた順に記録する。既定は、レビューも検索も空。 */
function fakeOc(
	handlers: {
		reviews?: (ocId: number, skip: number) => OcResult<CriticSnippet[]>;
		search?: (name: string) => OcResult<OcGame[]>;
	} = {}
): OpenCriticClient & { calls: { kind: 'reviews' | 'search'; ocId?: number; skip?: number; name?: string }[] } {
	const calls: { kind: 'reviews' | 'search'; ocId?: number; skip?: number; name?: string }[] = [];
	return {
		calls,
		async reviewsOfGame(ocId, skip) {
			calls.push({ kind: 'reviews', ocId, skip });
			return (handlers.reviews ?? (() => ok([])))(ocId, skip);
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

	function run(oc: OpenCriticClient, clef = fakeClef(), limits: Partial<CriticLimits> = {}) {
		return syncCritics({ db, clef, oc, now: clock.now, limits, sleep: noSleep });
	}

	it('新しい抜粋だけを読んで保存する。媒体名と URL は入り、本文の列はない', async () => {
		const workId = await linkedWork(101);
		const setId = await ensureCriticQuestionSet(db, criticV1, clock.now());
		const known = snippet('a-0');
		await saveCriticRead(db, { workId, snippet: known, questionSetId: setId, answers: [] }, clock.now());
		const clef = fakeClef();
		const oc = fakeOc({ reviews: () => ok(page('a', 3)) });

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
		const oc = fakeOc({ reviews: () => ok(page('a', 3)) });
		await run(oc, clef);
		expect(clef.calls).toHaveLength(3);

		clock.advance(24 * 60 * 60 * 1000);
		const result = await run(oc, clef);

		expect(result).toEqual({ works: 1, calls: 1, searches: 0, read: 0, failed: 0, stopped: 'done' });
		expect(clef.calls).toHaveLength(3);
		expect(await savedIds(workId)).toEqual(['a-0', 'a-1', 'a-2']);
		expect(await syncedAt(workId)).toBe(clock.now().toISOString());
	});

	it('ページの全件が既知なら、次のページを取らない', async () => {
		const workId = await linkedWork(101);
		const clef = fakeClef();
		const oc = fakeOc({ reviews: (_id, skip) => ok(page(`p${skip}`, PAGE)) });
		await run(oc, clef, { maxPagesPerWork: 1 });
		expect(clef.calls).toHaveLength(PAGE);

		clock.advance(24 * 60 * 60 * 1000);
		oc.calls.length = 0;
		const result = await run(oc, clef);

		expect(oc.calls).toEqual([{ kind: 'reviews', ocId: 101, skip: 0 }]);
		expect(result).toMatchObject({ works: 1, calls: 1, read: 0, stopped: 'done' });
		expect(clef.calls).toHaveLength(PAGE);
		expect(await syncedAt(workId)).toBe(clock.now().toISOString());
	});

	it('1 作品で取るページは maxPagesPerWork まで。呼び出しの間に待つ', async () => {
		const workId = await linkedWork(101);
		const oc = fakeOc({ reviews: (_id, skip) => ok(page(`p${skip}`, PAGE)) });
		const sleeps: number[] = [];

		const result = await syncCritics({
			db,
			clef: fakeClef(),
			oc,
			now: clock.now,
			limits: { maxPagesPerWork: 2 },
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
		const oc = fakeOc({ reviews: (_id, skip) => ok(skip === 0 ? page('p0', PAGE) : page('p20', 2)) });

		const result = await run(oc);

		expect(oc.calls.map((c) => c.skip)).toEqual([0, 20]);
		expect(result).toEqual({ works: 1, calls: 2, searches: 0, read: 22, failed: 0, stopped: 'done' });
		expect(await syncedAt(workId)).toBe(clock.now().toISOString());
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
		const oc = fakeOc({ reviews: (ocId) => (ocId === 101 ? { ok: false, error: 'bad_response' } : ok(page('g', 2))) });

		const result = await run(oc);

		expect(result).toEqual({ works: 2, calls: 2, searches: 0, read: 2, failed: 1, stopped: 'done' });
		expect(await syncedAt(bad)).toBe(clock.now().toISOString());
		expect(await savedIds(good)).toEqual(['g-0', 'g-1']);
	});

	it('無料枠の残りが requestReserve 以下になったら、次の呼び出しの前に止める', async () => {
		const first = await linkedWork(101);
		const second = await linkedWork(102);
		const oc = fakeOc({ reviews: (ocId) => ok(page(`w${ocId}`, 2), { requestsRemaining: 40 }) });

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
		const oc = fakeOc({ reviews: (_id, skip) => ok(page(`p${skip}`, PAGE)) });

		const result = await run(oc, fakeClef(), { maxCalls: 1 });

		expect(result).toEqual({ works: 0, calls: 1, searches: 0, read: PAGE, failed: 0, stopped: 'budget' });
		expect(oc.calls).toHaveLength(1);
		expect(await syncedAt(workId)).toBeNull();
	});

	it('読んだ数が maxReads に達したら止め、その作品に markSynced しない', async () => {
		const workId = await linkedWork(101);
		const clef = fakeClef();
		const oc = fakeOc({ reviews: () => ok(page('a', 5)) });

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
		const oc = fakeOc({ reviews: () => ok(page('a', 3)) });

		const result = await run(oc, clef);

		expect(result).toEqual({ works: 1, calls: 1, searches: 0, read: 2, failed: 1, stopped: 'done' });
		expect(await savedIds(workId)).toEqual(['a-0', 'a-2']);
		expect(await syncedAt(workId)).toBe(clock.now().toISOString());
	});

	it('Clef の 429 で全体を止め、その作品に markSynced しない', async () => {
		const workId = await linkedWork(101);
		const clef = fakeClef(() => {
			throw new ClefError('Clef の呼び出しに失敗しました (429)', false);
		});
		const oc = fakeOc({ reviews: () => ok(page('a', 3)) });

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
		const oc = fakeOc({ reviews: () => ok(page('a', 3)) });
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
		expect(JSON.parse(logs[0])).toEqual({ event: 'critic_sync', ...result });
		for (const line of [...logs, ...errors]) {
			expect(line).not.toContain('作り物の抜粋の本文');
			expect(line).not.toContain('example.com');
		}
	});
});
