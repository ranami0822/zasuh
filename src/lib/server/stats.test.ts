import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRevision } from './reading';
import { starSummary } from './star-stats';
import { OVERALL, ranking, recomputeWorkStats } from './stats';
import { addReview, addWork, answersFor, createClock, createTestDb, fakeClef } from './testing/db';
import type { Direction } from './question-sets/types';

/** 偽の Clef が、その向きに対して返す、段階ごとの確率（星1〜5）。 */
function levelsOf(dir: Direction): number[] {
	const a = answersFor({ x_star: { type: 'score', instructions: '', criteria: ['1', '2', '3', '4', '5'] } }, { x: dir });
	return (a.x_star as { probabilities: number[] }).probabilities;
}

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
			.prepare('SELECT tag_id AS aspect, n_mention, soft_1, soft_2, soft_3, soft_4, soft_5, mean, se, score_lower FROM aspect_star_stats WHERE work_id = ?')
			.bind(workId)
			.all<{ aspect: string; n_mention: number; soft_1: number; soft_2: number; soft_3: number; soft_4: number; soft_5: number; mean: number | null; se: number | null; score_lower: number | null }>();
		return Object.fromEntries(results.map((r) => [r.aspect, r]));
	}

	it('観点ごとに、言及ありの星を、確率のまま足す。言及なしは数えない。総合は分野のタグの合計', async () => {
		const work = await addWork(db);
		await post(work, { gameplay: 'positive', music: 'positive' });
		await post(work, { gameplay: 'negative' });
		await post(work, { gameplay: 'mixed', comfort: 'negative' });
		await post(work, {});

		const s = await stats(work);
		const gameplay = starSummary([{ levels: levelsOf('positive') }, { levels: levelsOf('negative') }, { levels: levelsOf('mixed') }]);
		expect(s['game/gameplay']).toMatchObject({ n_mention: 3, mean: gameplay.mean, se: null, score_lower: gameplay.lower });
		// 確率の合計（ソフトな件数）は、丸めない。3件で、合計 3。
		const soft = [1, 2, 3, 4, 5].map((k) => s['game/gameplay'][`soft_${k}` as 'soft_1']);
		soft.forEach((v, i) => expect(v).toBeCloseTo(gameplay.soft[i], 9));
		expect(soft.reduce((t, v) => t + v, 0)).toBeCloseTo(3, 9);
		expect(s['game/music']).toMatchObject({ n_mention: 1 });
		expect(s['game/comfort']).toMatchObject({ n_mention: 1 });
		expect(s['game/price']).toBeUndefined(); // 言及のない観点は、行を作らない
		expect(s[OVERALL]).toMatchObject({ n_mention: 5 });
	});

	it('言及ありかどうかは、言及の質問（noul）で決める。言及なしの観点の星は、数えない', async () => {
		const work = await addWork(db);
		await post(work, { gameplay: 'positive' }); // 偽の Clef は、他の観点の星も返す（言及なしの観点は、星3 の近く）
		const s = await stats(work);
		expect(s['game/music']).toBeUndefined();
		expect(s['game/comfort']).toBeUndefined();
		expect(s[OVERALL].n_mention).toBe(1);
	});

	it('向き（v1）だけの読み取りは、数えない', async () => {
		const work = await addWork(db);
		const r = await addReview(db, work, { body: '{}' });
		await db.batch([
			db
				.prepare("INSERT INTO question_sets (hash, model, definition_json, created_at) VALUES ('h', 'clef-flash', '{}', '2026-11-15T00:00:00.000Z')"),
			db
				.prepare("INSERT INTO readings (id, revision_id, question_set_id, model, status, attempts, created_at, updated_at) VALUES ('rd', ?, 1, 'clef-flash', 'ok', 1, '2026-11-15T00:00:00.000Z', '2026-11-15T00:00:00.000Z')")
				.bind(r.revisionId),
			db.prepare("INSERT INTO reading_answers (reading_id, question_key, tag_id, tag_version, kind, value, prob) VALUES ('rd', 'gameplay_choice', 'game/gameplay', 1, 'direction', 'positive', 0.9)"),
			db.prepare("INSERT INTO reading_answers (reading_id, question_key, tag_id, tag_version, kind, value, prob) VALUES ('rd', 'gameplay_noul', 'game/gameplay', 1, 'mention', 'true', 0.9)")
		]);
		await recomputeWorkStats(db, work, clock.now());
		expect((await stats(work))[OVERALL]).toMatchObject({ n_mention: 0 });
	});

	it('利害関係のあるレビューと、非表示のレビューは数えない', async () => {
		const work = await addWork(db);
		await post(work, { gameplay: 'negative' });
		await post(work, { gameplay: 'positive' }, { disclosure: 'developer' });
		const hidden = await post(work, { gameplay: 'positive' });
		await db.prepare('UPDATE reviews SET hidden = 1 WHERE id = ?').bind(hidden.reviewId).run();

		await recomputeWorkStats(db, work, clock.now());

		const g = (await stats(work))['game/gameplay'];
		expect(g.n_mention).toBe(1);
		expect(g.mean).toBeCloseTo(starSummary([{ levels: levelsOf('negative') }]).mean!, 9);
	});

	it('件数が 5 以上なら幅（se）を出し、控えめな値は 平均 - 1.96 × 幅', async () => {
		const work = await addWork(db);
		for (const d of ['positive', 'positive', 'negative', 'mixed', 'positive'] as const) await post(work, { gameplay: d });
		const g = (await stats(work))['game/gameplay'];
		expect(g.n_mention).toBe(5);
		expect(g.se).not.toBeNull();
		expect(g.score_lower).toBeCloseTo(g.mean! - 1.959964 * g.se!, 9);
	});

	it('順位は、控えめな値の高い順。少数の高評価は、多数の高評価より下。非表示の作品と言及のない作品は載らない', async () => {
		const many = await addWork(db, { name: 'many' });
		const few = await addWork(db, { name: 'few' });
		const bad = await addWork(db, { name: 'bad' });
		const hiddenWork = await addWork(db, { name: 'hidden', status: 'hidden' });
		const silent = await addWork(db, { name: 'silent' });

		for (let i = 0; i < 12; i++) await post(many, { gameplay: i < 11 ? 'positive' : 'negative' });
		await post(few, { gameplay: 'positive', music: 'positive' });
		for (let i = 0; i < 3; i++) await post(bad, { gameplay: 'negative' });
		await post(hiddenWork, { gameplay: 'positive' });
		await post(silent, {});

		const overall = await ranking(db, 'game');
		// many: 12件で平均が高い。few: 1件だけ高い（共通の幅で下げる）。bad: 低い平均。
		expect(overall.map((r) => r.name)).toEqual(['many', 'few', 'bad']);
		expect(overall[0].n).toBe(12);
		expect(overall[0].mean!).toBeGreaterThan(overall[1].mean! - 1); // 平均だけなら、few は many に近い
		expect(overall[0].scoreLower).toBeGreaterThan(overall[1].scoreLower);

		// 観点を選ぶと、その観点だけで並ぶ。
		expect((await ranking(db, 'game', { tagId: 'game/gameplay' })).map((r) => r.name)).toEqual(['many', 'few', 'bad']);
		expect((await ranking(db, 'game', { tagId: 'game/music' })).map((r) => r.name)).toEqual(['few']);
	});
});
