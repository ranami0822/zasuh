import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureCriticQuestionSet, linkOpenCritic, saveCriticRead } from '#server/critics';
import { criticV1 } from '#server/question-sets/critic-v1';
import { setEnv } from '#server/testing/cloudflare-workers';
import { addWork, createTestDb } from '#server/testing/db';
import { actions } from './+page.server';

// 作り物のデータだけを使う（実在の抜粋・記事は置かない）。
const review = (id: string, over: Record<string, unknown> = {}) => ({
	_id: id,
	snippet: `A made-up snippet ${id}.`,
	externalUrl: `https://example.com/${id}`,
	Outlet: { name: `Outlet ${id}` },
	...over
});

describe('管理画面: 専門家を今すぐ取得（?/syncCritics）の結果の帯', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
	});
	afterEach(async () => {
		vi.unstubAllGlobals();
		await dispose();
	});

	it('点数が取れた抜粋の数と、取得した抜粋の数と、OpenCritic の応答の項目（名前だけ）を出す', async () => {
		const workId = await addWork(db);
		expect((await linkOpenCritic(db, workId, '15398', new Date())).ok).toBe(true);
		// 既知の抜粋だけにして、読み取り（Clef）を呼ばない。
		const setId = await ensureCriticQuestionSet(db, criticV1, new Date());
		for (const id of ['r1', 'r2']) {
			await saveCriticRead(db, { workId, snippet: { ocReviewId: id, outlet: 'o', url: 'https://example.com/', publishedOn: null }, questionSetId: setId, answers: [] }, new Date());
		}
		const original = globalThis.fetch;
		vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) =>
			String(input).startsWith('https://opencritic-api.p.rapidapi.com/')
				? new Response(JSON.stringify([review('r1', { npScore: 91.6, secret: 'value-not-shown' }), review('r2')]))
				: original(input, init)) as typeof fetch);
		setEnv({ DB: db, AI: {}, OPENCRITIC_API_KEY: 'test-key' });

		const result = (await actions.syncCritics({ params: { id: workId } } as never)) as { criticSync: Record<string, unknown> };

		expect(result.criticSync.scores).toBe('点数が取れた抜粋: 1件 / 取得した抜粋: 2件');
		expect(result.criticSync.fields).toBe('OpenCritic の応答の項目: Outlet, _id, externalUrl, npScore, secret, snippet');
		expect(JSON.stringify(result)).not.toContain('value-not-shown');
		const row = await db.prepare("SELECT oc_score AS s FROM critic_reviews WHERE oc_review_id = 'r1'").first<{ s: number }>();
		expect(row!.s).toBe(92);
	});
});
