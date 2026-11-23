import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCriticPane } from './critic-view';
import { CRITIC_ITEMS_MAX, ensureCriticQuestionSet, saveCriticRead } from './critics';
import { criticV1 } from './question-sets/critic-v1';
import type { ReadingAnswer } from './reading';
import { MIN_N_FOR_SE } from './star-stats';
import { countQueries } from './testing/count-queries';
import { addWork, createClock, createTestDb } from './testing/db';

type Aspect = 'gameplay' | 'music' | 'comfort' | 'price';

interface Spec {
	/** 総合の星。なければ、読めていないレビュー。 */
	overall?: { score: number; levels: number[] | null };
	/** 観点ごとの、言及の有無と星。 */
	aspects?: Partial<Record<Aspect, { mentioned: boolean; score: number }>>;
}

function starAnswer(key: string, aspect: string, score: number, levels: number[] | null): ReadingAnswer {
	return {
		questionKey: key,
		aspect,
		kind: 'star',
		value: String(Math.round(score)),
		prob: 0.8,
		probs: null,
		star: { score, levels, confidence: 0.8 },
		needsCheck: false
	};
}

/** critic-v1 の質問の key で、答えを手で作る。 */
function answers(spec: Spec): ReadingAnswer[] {
	const out: ReadingAnswer[] = [];
	for (const [aspect, a] of Object.entries(spec.aspects ?? {})) {
		out.push({ questionKey: `${aspect}_noul`, aspect, kind: 'mention', value: String(a.mentioned), prob: 0.9, probs: null, needsCheck: false });
		out.push(starAnswer(`${aspect}_star`, aspect, a.score, [0, 0, 0, 1, 0]));
	}
	if (spec.overall) out.push(starAnswer('overall_star', 'overall', spec.overall.score, spec.overall.levels));
	return out;
}

const LEVELS = {
	five: [0, 0, 0, 0, 1],
	four: [0, 0, 0, 1, 0],
	mixed: [0, 0.5, 0.5, 0, 0]
};

describe('getCriticPane（作品ページの専門家の欄）', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;
	let clock: ReturnType<typeof createClock>;
	let qs: number;

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
		clock = createClock('2026-11-20T12:00:00.000Z');
		qs = await ensureCriticQuestionSet(db, criticV1, clock.now());
	});
	afterEach(() => dispose());

	async function save(workId: string, id: string, publishedOn: string | null, spec: Spec) {
		clock.advance(60_000);
		const r = await saveCriticRead(
			db,
			{ workId, snippet: { ocReviewId: id, outlet: `媒体${id}`, url: `https://example.com/${id}`, publishedOn }, questionSetId: qs, answers: answers(spec) },
			clock.now()
		);
		expect(r).toEqual({ ok: true });
	}

	it('T1: 専門家のレビューがない作品は null', async () => {
		const workId = await addWork(db);
		expect(await getCriticPane(db, workId)).toBeNull();
	});

	it('T2: 件数、ソフトな件数、平均。並びは公開日の降順で、公開日のないものが最後', async () => {
		const workId = await addWork(db);
		await db.prepare('UPDATE works SET opencritic_id = ? WHERE id = ?').bind(10181, workId).run();
		await save(workId, 'old', '2026-10-01', { overall: { score: 5, levels: LEVELS.five } });
		await save(workId, 'nodate', null, { overall: { score: 4, levels: LEVELS.four } });
		await save(workId, 'new', '2026-11-01', { overall: { score: 2.5, levels: LEVELS.mixed } });

		const pane = (await getCriticPane(db, workId))!;
		expect(pane.n).toBe(3);
		expect(pane.soft).toHaveLength(5);
		expect(pane.soft.reduce((s, x) => s + x, 0)).toBeCloseTo(3);
		expect(pane.soft).toEqual([0, 0.5, 0.5, 1, 1]);
		expect(pane.mean).toBeCloseTo((5 + 4 + 2.5) / 3);
		expect(pane.items.map((i) => i.url)).toEqual(['https://example.com/new', 'https://example.com/old', 'https://example.com/nodate']);
		expect(pane.items[0]).toEqual({ outlet: '媒体new', publishedOn: '2026-11-01', url: 'https://example.com/new', stars: 2.5, aspects: [] });
		expect(pane.items[2].publishedOn).toBeNull();
		expect(pane.sourceUrl).toBe('https://opencritic.com/game/10181/-');
	});

	it('T3: 言及のあった観点だけが aspects に入る（観点の順は、ゲーム性・音楽・快適さ・価格）', async () => {
		const workId = await addWork(db);
		await save(workId, 'a', '2026-11-01', {
			overall: { score: 4.2, levels: LEVELS.four },
			aspects: {
				price: { mentioned: true, score: 2.1 },
				gameplay: { mentioned: true, score: 4.6 },
				music: { mentioned: false, score: 3 },
				comfort: { mentioned: false, score: 3 }
			}
		});

		const pane = (await getCriticPane(db, workId))!;
		expect(pane.items[0].aspects).toEqual([
			{ key: 'gameplay', label: 'ゲーム性', stars: 4.6 },
			{ key: 'price', label: '価格', stars: 2.1 }
		]);
	});

	it('T4: 総合の星がないレビュー（読めていない）は、数えず、並べない', async () => {
		const workId = await addWork(db);
		await save(workId, 'read', '2026-10-01', { overall: { score: 4, levels: LEVELS.four } });
		await save(workId, 'unread', '2026-11-01', { aspects: { gameplay: { mentioned: true, score: 4 } } });
		// 星の値はあるが、段階ごとの確率が読めなかった（levels が null）ものも、集計できないので数えない
		await save(workId, 'nolevels', '2026-11-02', { overall: { score: 3, levels: null } });

		const pane = (await getCriticPane(db, workId))!;
		expect(pane.n).toBe(1);
		expect(pane.items.map((i) => i.url)).toEqual(['https://example.com/read']);
	});

	it('T4b: 総合の星のないレビューしかない作品は null', async () => {
		const workId = await addWork(db);
		await save(workId, 'unread', '2026-11-01', {});
		expect(await getCriticPane(db, workId)).toBeNull();
	});

	it(`T5: n が ${MIN_N_FOR_SE} 未満なら se は null、${MIN_N_FOR_SE} 以上なら数値`, async () => {
		const workId = await addWork(db);
		const scores = [5, 4, 2.5, 5, 4];
		const levels = [LEVELS.five, LEVELS.four, LEVELS.mixed, LEVELS.five, LEVELS.four];
		for (let i = 0; i < MIN_N_FOR_SE - 1; i++) {
			await save(workId, `r${i}`, `2026-11-0${i + 1}`, { overall: { score: scores[i], levels: levels[i] } });
		}
		const few = (await getCriticPane(db, workId))!;
		expect(few.n).toBe(MIN_N_FOR_SE - 1);
		expect(few.se).toBeNull();

		await save(workId, 'last', '2026-11-09', { overall: { score: scores[4], levels: levels[4] } });
		const enough = (await getCriticPane(db, workId))!;
		expect(enough.n).toBe(MIN_N_FOR_SE);
		expect(typeof enough.se).toBe('number');
		expect(enough.se).toBeGreaterThan(0);
	});

	it('T6: D1 への問い合わせは 3 回以下', async () => {
		const workId = await addWork(db);
		const empty = countQueries(db);
		await getCriticPane(empty.db, workId);
		console.log(`getCriticPane の問い合わせ: レビューなし ${empty.count()} 回`);
		expect(empty.count()).toBeLessThanOrEqual(3);

		await save(workId, 'a', '2026-11-01', { overall: { score: 4, levels: LEVELS.four }, aspects: { gameplay: { mentioned: true, score: 4 } } });
		await save(workId, 'b', '2026-11-02', { overall: { score: 5, levels: LEVELS.five }, aspects: { music: { mentioned: true, score: 5 } } });
		const full = countQueries(db);
		const pane = await getCriticPane(full.db, workId);
		console.log(`getCriticPane の問い合わせ: レビュー 2 件 ${full.count()} 回`);
		expect(pane?.n).toBe(2);
		expect(full.count()).toBeLessThanOrEqual(3);
	});

	it('T7: ほかの作品のレビューは混ざらない', async () => {
		const workId = await addWork(db);
		const other = await addWork(db);
		await save(workId, 'mine', '2026-11-01', { overall: { score: 4, levels: LEVELS.four } });
		await save(other, 'theirs', '2026-11-02', { overall: { score: 1, levels: [1, 0, 0, 0, 0] }, aspects: { gameplay: { mentioned: true, score: 1 } } });

		const pane = (await getCriticPane(db, workId))!;
		expect(pane.n).toBe(1);
		expect(pane.soft).toEqual(LEVELS.four);
		expect(pane.items.map((i) => i.url)).toEqual(['https://example.com/mine']);
		expect(pane.items[0].aspects).toEqual([]);
	});

	it(`並べるのは最大 ${CRITIC_ITEMS_MAX} 件（新しい順）。集計は全件`, async () => {
		const workId = await addWork(db);
		for (let i = 0; i <= CRITIC_ITEMS_MAX; i++) {
			const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
			await save(workId, `r${i}`, day, { overall: { score: 4, levels: LEVELS.four } });
		}
		const pane = (await getCriticPane(db, workId))!;
		expect(pane.n).toBe(CRITIC_ITEMS_MAX + 1);
		expect(pane.items).toHaveLength(CRITIC_ITEMS_MAX);
		expect(pane.items[0].url).toBe(`https://example.com/r${CRITIC_ITEMS_MAX}`);
		expect(pane.items.at(-1)!.url).toBe('https://example.com/r1');
	});

	it('OpenCritic の作品 ID がなければ、出典は OpenCritic のトップ', async () => {
		const workId = await addWork(db);
		await save(workId, 'a', '2026-11-01', { overall: { score: 4, levels: LEVELS.four } });
		expect((await getCriticPane(db, workId))!.sourceUrl).toBe('https://opencritic.com');
	});
});
