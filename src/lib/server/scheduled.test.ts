import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runScheduled } from './scheduled';
import type { Env } from './env';
import { addReview, addWork, answersFor, createTestDb } from './testing/db';
import { toClefQuestions } from './question-sets';

describe('定期実行', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
	});
	afterEach(() => {
		vi.restoreAllMocks();
		return dispose();
	});

	/** Workers AI の代わり。受け取った質問のすべてに、本文を JSON として読んだ向きで答える。 */
	const fakeAi = () => {
		const run = vi.fn(async (_model: string, input: { state: string; questions: ReturnType<typeof toClefQuestions> }) => ({
			result: { answers: answersFor(input.questions, JSON.parse(input.state)), usage: { input_tokens: 10 } },
			success: true
		}));
		return { run };
	};
	const envWith = (ai: unknown) => ({ DB: db, AI: ai }) as unknown as Env;

	it('猶予を過ぎた、読まれていないレビューを、Workers AI で読んで、結果を保存する', async () => {
		const work = await addWork(db);
		const { revisionId } = await addReview(db, work, { body: '{"gameplay":"positive"}', at: new Date(Date.now() - 10 * 60_000) });
		const ai = fakeAi();
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		await runScheduled(envWith(ai));

		expect(ai.run).toHaveBeenCalledTimes(1);
		expect(ai.run.mock.calls[0][0]).toBe('@cf/cloudflare/clef-flash');
		const row = await db.prepare("SELECT status FROM readings WHERE revision_id = ?").bind(revisionId).first<{ status: string }>();
		expect(row?.status).toBe('ok');
		expect(log).toHaveBeenCalledWith(expect.stringContaining('"event":"sweep"'));
	});

	it('拾うものがなければ、AI を呼ばず、記録も残さない', async () => {
		const ai = fakeAi();
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		await runScheduled(envWith(ai));
		expect(ai.run).not.toHaveBeenCalled();
		expect(log).not.toHaveBeenCalled();
	});

	it('投稿したばかりのレビューは、拾わない（投稿の直後の読み取りに任せる）', async () => {
		const work = await addWork(db);
		await addReview(db, work, { body: '{"gameplay":"positive"}', at: new Date() });
		const ai = fakeAi();
		await runScheduled(envWith(ai));
		expect(ai.run).not.toHaveBeenCalled();
	});

	it('AI が失敗しても、定期実行は、例外を投げない（次の分に、やり直す）', async () => {
		const work = await addWork(db);
		const { revisionId } = await addReview(db, work, { body: '{"gameplay":"positive"}', at: new Date(Date.now() - 10 * 60_000) });
		const ai = { run: vi.fn(async () => { throw new Error('quota'); }) };
		vi.spyOn(console, 'log').mockImplementation(() => {});

		await expect(runScheduled(envWith(ai))).resolves.toBeUndefined();

		const row = await db.prepare('SELECT status, attempts FROM readings WHERE revision_id = ?').bind(revisionId).first<{ status: string; attempts: number }>();
		expect(row?.status).toBe('error');
		expect(row?.attempts).toBeGreaterThan(0);
	});
});

describe('定期実行: 専門家の評価の取得', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		return dispose();
	});

	// 作り物。本文を JSON として読んで答える偽の Workers AI と、偽の OpenCritic。
	const fakeAi = () => ({
		run: vi.fn(async (_model: string, input: { state: string; questions: ReturnType<typeof toClefQuestions> }) => ({
			result: { answers: answersFor(input.questions, JSON.parse(input.state)), usage: { input_tokens: 10 } },
			success: true
		}))
	});
	const fakeOpenCritic = () => {
		const calls: { url: string; key: string }[] = [];
		const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(input), key: (init?.headers as Record<string, string>)['x-rapidapi-key'] });
			const body = String(input).includes('/review/game/')
				? [{ _id: 'r1', snippet: '{"gameplay":"positive"}', language: 'en-us', externalUrl: 'https://example.com/a', Outlet: { name: 'Example Outlet' } }]
				: [];
			return new Response(JSON.stringify(body), { status: 200 });
		}) as typeof fetch;
		return { impl, calls };
	};
	const linkedWork = async () => {
		const work = await addWork(db);
		await db.prepare('UPDATE works SET opencritic_id = 123 WHERE id = ?').bind(work).run();
		return work;
	};
	const slotCount = async () => (await db.prepare('SELECT COUNT(*) AS n FROM critic_slots').first<{ n: number }>())!.n;
	const criticCount = async () => (await db.prepare('SELECT COUNT(*) AS n FROM critic_reviews').first<{ n: number }>())!.n;
	const at = (hm: string) => new Date(`2026-11-21T${hm}:00.000Z`);
	const env = (key: string | undefined) => ({ DB: db, AI: fakeAi(), OPENCRITIC_API_KEY: key }) as unknown as Env;

	it('時間帯の中（17:05）に、キーがあれば、結びついた作品の評価を取得して保存する（キーの前後の引用符は外す）', async () => {
		await linkedWork();
		const oc = fakeOpenCritic();
		await runScheduled(env("test-key'"), at('17:05'), { fetch: oc.impl });
		expect(await criticCount()).toBe(1);
		expect(oc.calls[0].url).toContain('/review/game/123?skip=0');
		expect(oc.calls[0].key).toBe('test-key');
	});

	it('キーがなければ、何も呼ばない', async () => {
		await linkedWork();
		const oc = fakeOpenCritic();
		await runScheduled(env(undefined), at('17:05'), { fetch: oc.impl });
		await runScheduled(env("''"), at('17:05'), { fetch: oc.impl });
		expect(oc.calls).toHaveLength(0);
		expect(await criticCount()).toBe(0);
	});

	it('時間帯（UTC 17:00〜21:00）の外では、取得しない', async () => {
		await linkedWork();
		const oc = fakeOpenCritic();
		for (const hm of ['16:59', '21:00', '06:17', '23:59']) await runScheduled(env('k'), at(hm), { fetch: oc.impl });
		expect(oc.calls).toHaveLength(0);
		expect(await slotCount()).toBe(0);
	});

	it('同じ枠（5 分）の中で 3 回呼ばれても、同じ作品を 2 回は取得しない', async () => {
		await linkedWork();
		const oc = fakeOpenCritic();
		for (const hm of ['17:05', '17:06', '17:09']) await runScheduled(env('k'), at(hm), { fetch: oc.impl });
		expect(oc.calls.filter((c) => c.url.includes('/review/game/'))).toHaveLength(1);
		expect(await criticCount()).toBe(1);
		expect(await slotCount()).toBe(1);
	});

	it('同じ日の次の枠では、読み切った作品を、取得し直さない。次の日は、取得する', async () => {
		await linkedWork();
		const oc = fakeOpenCritic();
		await runScheduled(env('k'), at('17:05'), { fetch: oc.impl });
		await runScheduled(env('k'), at('17:10'), { fetch: oc.impl });
		expect(oc.calls.filter((c) => c.url.includes('/review/game/'))).toHaveLength(1);
		expect(await slotCount()).toBe(2);

		await runScheduled(env('k'), new Date('2026-11-22T17:05:00.000Z'), { fetch: oc.impl });
		expect(oc.calls.filter((c) => c.url.includes('/review/game/'))).toHaveLength(2);
	});

	it('sweep が拾うものがあるときは、その分の取得を見送り、枠も取らない（次の分に、取得する）', async () => {
		const work = await linkedWork();
		await addReview(db, work, { body: '{"gameplay":"positive"}', at: new Date(Date.now() - 10 * 60_000) });
		const oc = fakeOpenCritic();

		await runScheduled(env('k'), at('17:05'), { fetch: oc.impl });
		expect(oc.calls).toHaveLength(0);
		expect(await slotCount()).toBe(0);

		await runScheduled(env('k'), at('17:06'), { fetch: oc.impl });
		expect(oc.calls.filter((c) => c.url.includes('/review/game/'))).toHaveLength(1);
		expect(await slotCount()).toBe(1);
	});

	it('OpenCritic が失敗しても、定期実行は、例外を投げない', async () => {
		await linkedWork();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const failing = (async () => {
			throw new TypeError('fetch failed');
		}) as typeof fetch;
		await expect(runScheduled(env('k'), at('17:05'), { fetch: failing })).resolves.toBeUndefined();
	});
});
