import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClefError } from './clef';
import { backoffMs, readRevision } from './reading';
import { sweepReadings } from './sweep';
import { addReview, addWork, clefAnswers, createClock, createTestDb, editReview, fakeClef } from './testing/db';

describe('sweepReadings', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;
	let clock: ReturnType<typeof createClock>;
	const GRACE = 2 * 60_000;

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
		clock = createClock();
	});
	afterEach(() => dispose());

	const statuses = async () => {
		const { results } = await db
			.prepare('SELECT revision_id, status, attempts FROM readings')
			.all<{ revision_id: string; status: string; attempts: number }>();
		return Object.fromEntries(results.map((r) => [r.revision_id, r]));
	};

	it('読まれないまま猶予を過ぎたレビューを拾う。投稿されたばかりのものは拾わない', async () => {
		const work = await addWork(db);
		const old = await addReview(db, work, { body: '{"gameplay":"positive"}', at: new Date(clock.now().getTime() - GRACE - 1) });
		const fresh = await addReview(db, work, { body: '{}', at: clock.now() });
		const clef = fakeClef();

		expect(await sweepReadings({ db, clef, now: clock.now })).toEqual({ picked: 1, ok: 1, error: 0, skipped: 0 });
		const s = await statuses();
		expect(s[old.revisionId]).toMatchObject({ status: 'ok' });
		expect(s[fresh.revisionId]).toBeUndefined();

		// 読み終えたものは、次の回では拾わない。
		expect((await sweepReadings({ db, clef, now: clock.now })).picked).toBe(0);
	});

	it('失敗した読み取りを、次に試す時刻のあとでやり直す', async () => {
		const { revisionId } = await addReview(db, await addWork(db), { body: '{}' });
		const failing = fakeClef(() => {
			throw new ClefError('失敗', false);
		});
		await readRevision({ db, clef: failing, now: clock.now }, revisionId);

		const clef = fakeClef();
		clock.advance(backoffMs(1) - 1);
		expect((await sweepReadings({ db, clef, now: clock.now })).picked).toBe(0);
		clock.advance(1);
		expect(await sweepReadings({ db, clef, now: clock.now })).toMatchObject({ picked: 1, ok: 1 });
		expect((await statuses())[revisionId]).toMatchObject({ status: 'ok', attempts: 2 });
	});

	it('非表示のレビュー、非表示の作品、タグのない作品は拾わない', async () => {
		const game = await addWork(db);
		await addReview(db, game, { body: '{}', hidden: true });
		await addReview(db, await addWork(db, { status: 'hidden' }), { body: '{}' });
		await addReview(db, await addWork(db, { category: 'software' }), { body: '{}' });
		const clef = fakeClef();

		expect((await sweepReadings({ db, clef, now: clock.now })).picked).toBe(0);
		expect(clef.calls).toHaveLength(0);
	});

	it('1回に拾う件数には上限があり、古いものから拾う', async () => {
		const work = await addWork(db);
		const reviews = [];
		for (let i = 0; i < 4; i++) {
			reviews.push(await addReview(db, work, { body: '{}', at: new Date(`2026-11-0${i + 1}T00:00:00.000Z`) }));
		}
		const clef = fakeClef();

		expect((await sweepReadings({ db, clef, now: clock.now }, { limit: 3 })).picked).toBe(3);
		const s = await statuses();
		expect(reviews.map((r) => s[r.revisionId]?.status)).toEqual(['ok', 'ok', 'ok', undefined]);
		expect((await sweepReadings({ db, clef, now: clock.now }, { limit: 3 })).picked).toBe(1);
	});

	it('1件の失敗で、残りを止めない', async () => {
		const work = await addWork(db);
		await addReview(db, work, { body: 'bad', at: new Date('2026-11-01T00:00:00.000Z') });
		await addReview(db, work, { body: '{"music":"positive"}', at: new Date('2026-11-02T00:00:00.000Z') });
		const clef = fakeClef((state) => {
			if (state === 'bad') throw new ClefError('失敗', false);
			return { answers: clefAnswers(JSON.parse(state)), inputTokens: null };
		});

		expect(await sweepReadings({ db, clef, now: clock.now })).toEqual({ picked: 2, ok: 1, error: 1, skipped: 0 });
	});

	it('編集されたレビューは、新しい版を読み、集計には最新の版だけを使う', async () => {
		const work = await addWork(db);
		const { reviewId, revisionId } = await addReview(db, work, { body: '{"gameplay":"negative"}' });
		const clef = fakeClef();
		await readRevision({ db, clef, now: clock.now }, revisionId);

		const edited = await editReview(db, reviewId, '{"gameplay":"positive"}', new Date(clock.now().getTime() - GRACE - 1));
		expect(await sweepReadings({ db, clef, now: clock.now })).toMatchObject({ picked: 1, ok: 1 });

		const s = await statuses();
		expect(s[revisionId].status).toBe('ok');
		expect(s[edited].status).toBe('ok');
		const stats = await db
			.prepare("SELECT n_mention, n_pos, n_neg FROM aspect_stats WHERE work_id = ? AND tag_id = 'game/gameplay'")
			.bind(work)
			.first();
		expect(stats).toEqual({ n_mention: 1, n_pos: 1, n_neg: 0 });
	});
});
