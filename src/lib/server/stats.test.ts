import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRevision } from './reading';
import { OVERALL, ranking, recomputeWorkStats, scoreCounts, wilsonLower } from './stats';
import { addReview, addWork, createClock, createTestDb, fakeClef } from './testing/db';

describe('wilsonLower', () => {
	it('言及がなければ null', () => {
		expect(wilsonLower(0, 0)).toBeNull();
	});

	it('既知の値と合う', () => {
		// 全部が肯定のとき、下限は n / (n + z^2)。
		expect(wilsonLower(10, 10)).toBeCloseTo(10 / (10 + 1.959964 ** 2), 6);
		expect(wilsonLower(1, 1)).toBeCloseTo(0.2065, 3);
		expect(wilsonLower(0, 10)).toBe(0);
		expect(wilsonLower(50, 100)).toBeCloseTo(0.4038, 3);
	});

	it('3件の肯定100%は、300件の肯定90%より下になる', () => {
		expect(wilsonLower(3, 3)!).toBeLessThan(wilsonLower(270, 300)!);
	});

	it('混在は 0.5 として数える', () => {
		expect(scoreCounts({ nPos: 0, nNeg: 0, nMix: 4 })).toEqual({ nMention: 4, scoreLower: wilsonLower(2, 4) });
		expect(scoreCounts({ nPos: 2, nNeg: 1, nMix: 2 }).scoreLower).toBeCloseTo(wilsonLower(3, 5)!, 12);
	});
});

describe('集計と順位', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;
	const clock = createClock();
	const clef = fakeClef();

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
	});
	afterEach(() => dispose());

	async function post(workId: string, directions: Record<string, string>, opts = {}) {
		const r = await addReview(db, workId, { body: JSON.stringify(directions), ...opts });
		await readRevision({ db, clef, now: clock.now }, r.revisionId);
		return r;
	}

	async function stats(workId: string) {
		const { results } = await db
			.prepare('SELECT tag_id AS aspect, n_mention, n_pos, n_neg, n_mix, score_lower FROM aspect_stats WHERE work_id = ?')
			.bind(workId)
			.all<{ aspect: string; n_mention: number; n_pos: number; n_neg: number; n_mix: number; score_lower: number | null }>();
		return Object.fromEntries(results.map((r) => [r.aspect, r]));
	}

	it('観点ごとに数え、言及なしは数えない。総合は全観点の合計', async () => {
		const work = await addWork(db);
		await post(work, { gameplay: 'positive', music: 'positive' });
		await post(work, { gameplay: 'negative' });
		await post(work, { gameplay: 'mixed', comfort: 'negative' });
		await post(work, {});

		const s = await stats(work);
		expect(s['game/gameplay']).toMatchObject({ n_mention: 3, n_pos: 1, n_neg: 1, n_mix: 1 });
		expect(s['game/gameplay'].score_lower).toBeCloseTo(wilsonLower(1.5, 3)!, 9);
		expect(s['game/music']).toMatchObject({ n_mention: 1, n_pos: 1 });
		expect(s['game/comfort']).toMatchObject({ n_mention: 1, n_neg: 1 });
		expect(s['game/price']).toMatchObject({ n_mention: 0, score_lower: null });
		expect(s[OVERALL]).toMatchObject({ n_mention: 5, n_pos: 2, n_neg: 2, n_mix: 1 });
	});

	it('利害関係のあるレビューと、非表示のレビューは数えない', async () => {
		const work = await addWork(db);
		await post(work, { gameplay: 'negative' });
		await post(work, { gameplay: 'positive' }, { disclosure: 'developer' });
		const hidden = await post(work, { gameplay: 'positive' });
		await db.prepare('UPDATE reviews SET hidden = 1 WHERE id = ?').bind(hidden.reviewId).run();

		await recomputeWorkStats(db, work, clock.now());

		expect((await stats(work))['game/gameplay']).toMatchObject({ n_mention: 1, n_pos: 0, n_neg: 1 });
	});

	it('順位は下限の高い順。少数の高評価は、多数の高評価より下。非表示の作品と言及のない作品は載らない', async () => {
		const many = await addWork(db, { name: 'many' });
		const few = await addWork(db, { name: 'few' });
		const bad = await addWork(db, { name: 'bad' });
		const hiddenWork = await addWork(db, { name: 'hidden', status: 'hidden' });
		const silent = await addWork(db, { name: 'silent' });

		for (let i = 0; i < 12; i++) await post(many, { gameplay: i < 11 ? 'positive' : 'negative' });
		await post(few, { gameplay: 'positive' });
		for (let i = 0; i < 3; i++) await post(bad, { gameplay: 'negative', music: 'positive' });
		await post(hiddenWork, { gameplay: 'positive' });
		await post(silent, {});

		const overall = await ranking(db, 'game');
		// many: 11/12、few: 1/1、bad: 肯定3・否定3（全観点の合計）。1件だけの肯定は、12件中11件の肯定より下。
		expect(overall.map((r) => r.name)).toEqual(['many', 'few', 'bad']);
		expect(overall[0]).toMatchObject({ nMention: 12, nPos: 11, nNeg: 1 });

		// 観点を選ぶと、その観点だけで並ぶ。
		expect((await ranking(db, 'game', { tagId: 'game/gameplay' })).map((r) => r.name)).toEqual(['many', 'few', 'bad']);
		expect((await ranking(db, 'game', { tagId: 'game/music' })).map((r) => r.name)).toEqual(['bad']);
	});
});
