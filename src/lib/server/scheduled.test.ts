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
