import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	addCandidate,
	criticSection,
	decideCandidate,
	ensureCriticQuestionSet,
	knownCriticIds,
	linkOpenCritic,
	markSynced,
	openCandidates,
	saveCriticRead,
	worksNeedingCandidate,
	worksToSync
} from './critics';
import type { Direction, QuestionSetDefinition } from './question-sets/types';
import type { ReadingAnswer } from './reading';
import { addWork, createClock, createTestDb } from './testing/db';

/** テスト用の質問セット（作り物）。 */
const testDef: QuestionSetDefinition = {
	category: 'game',
	version: 1,
	model: 'clef-flash',
	aspects: [
		{ key: 'overall', label: '総合' },
		{ key: 'story', label: '物語' }
	],
	questions: [
		{ key: 'overall_star', aspect: 'overall', kind: 'star', instructions: '作り物', levels: ['1', '2', '3', '4', '5'] },
		{ key: 'story_star', aspect: 'story', kind: 'star', instructions: '作り物', levels: ['1', '2', '3', '4', '5'] }
	]
};

/** 作品ページに渡す、観点の表示名（作り物）。 */
const ASPECTS = [
	{ key: 'overall', label: '総合' },
	{ key: 'sound', label: '音' },
	{ key: 'story', label: '物語' },
	{ key: 'visual', label: '見た目' }
];

type Spec = Record<string, { dir: Direction; star?: { score: number; levels: number[] | null } }>;

/** 観点ごとの向きと星から、読み取りの答えを手で作る。 */
function answers(spec: Spec): ReadingAnswer[] {
	const out: ReadingAnswer[] = [];
	for (const [aspect, { dir, star }] of Object.entries(spec)) {
		out.push({
			questionKey: `${aspect}_choice`,
			aspect,
			kind: 'direction',
			value: dir,
			prob: 0.9,
			probs: { positive: 0.03, negative: 0.03, mixed: 0.04, none: 0.9, [dir]: 0.9 },
			needsCheck: false
		});
		if (star) {
			const rounded = Math.round(star.score);
			out.push({
				questionKey: `${aspect}_star`,
				aspect,
				kind: 'star',
				value: String(rounded),
				prob: star.levels ? star.levels[rounded - 1] : 0,
				probs: null,
				star: { score: star.score, levels: star.levels, confidence: 0.8 },
				needsCheck: false
			});
		}
	}
	return out;
}

function snippet(id: string, publishedOn: string | null = '2026-11-01') {
	return { ocReviewId: id, outlet: `媒体${id}`, url: `https://example.com/${id}`, publishedOn };
}

describe('専門家の評価の保存と問い合わせ', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;
	let clock: ReturnType<typeof createClock>;

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
		clock = createClock('2026-11-20T12:00:00.000Z');
	});
	afterEach(() => dispose());

	async function setOcId(workId: string, ocId: number, syncedAt: string | null = null) {
		await db.prepare('UPDATE works SET opencritic_id = ?, critic_synced_at = ? WHERE id = ?').bind(ocId, syncedAt, workId).run();
	}

	async function countReviews(workId: string): Promise<{ reviews: number; answers: number }> {
		const r = await db.prepare('SELECT COUNT(*) AS n FROM critic_reviews WHERE work_id = ?').bind(workId).first<{ n: number }>();
		const a = await db
			.prepare('SELECT COUNT(*) AS n FROM critic_answers WHERE critic_review_id IN (SELECT id FROM critic_reviews WHERE work_id = ?)')
			.bind(workId)
			.first<{ n: number }>();
		return { reviews: r!.n, answers: a!.n };
	}

	it('critic_reviews と critic_answers は、抜粋・本文・題名・著者・点数の列を持たない', async () => {
		for (const table of ['critic_reviews', 'critic_answers']) {
			const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
			const names = results.map((r) => r.name);
			expect(names.length).toBeGreaterThan(0);
			for (const name of names) {
				for (const banned of ['snippet', 'body', 'text', 'title', 'author', 'score']) {
					expect(name.toLowerCase()).not.toContain(banned);
				}
			}
		}
	});

	it('質問セットを、取得か追加する。2回呼んでも同じ id', async () => {
		const a = await ensureCriticQuestionSet(db, testDef, clock.now());
		const b = await ensureCriticQuestionSet(db, testDef, clock.now());
		expect(a).toBe(b);
		const c = await ensureCriticQuestionSet(db, { ...testDef, version: 2 }, clock.now());
		expect(c).not.toBe(a);
		const row = await db.prepare('SELECT model, definition_json FROM question_sets WHERE id = ?').bind(a).first<{ model: string; definition_json: string }>();
		expect(row).toEqual({ model: 'clef-flash', definition_json: JSON.stringify(testDef) });
	});

	it('読み取りの結果を保存する。同じレビューの二重保存は duplicate。保存済みの ID が分かる', async () => {
		const workId = await addWork(db);
		const qs = await ensureCriticQuestionSet(db, testDef, clock.now());
		const input = { workId, snippet: snippet('r1'), questionSetId: qs, answers: answers({ overall: { dir: 'positive', star: { score: 4.2, levels: [0, 0, 0.1, 0.6, 0.3] } } }) };
		expect(await saveCriticRead(db, input, clock.now())).toEqual({ ok: true });
		expect(await saveCriticRead(db, input, clock.now())).toEqual({ ok: false, error: 'duplicate' });
		expect(await countReviews(workId)).toEqual({ reviews: 1, answers: 2 });
		expect(await knownCriticIds(db, workId, ['r1', 'r2'])).toEqual(new Set(['r1']));
		expect(await knownCriticIds(db, workId, [])).toEqual(new Set());
		const other = await addWork(db);
		expect(await knownCriticIds(db, other, ['r1'])).toEqual(new Set());
		const star = await db
			.prepare("SELECT value, probs_json FROM critic_answers WHERE question_key = 'overall_star'")
			.first<{ value: string; probs_json: string }>();
		expect(star!.value).toBe('4');
		expect(JSON.parse(star!.probs_json)).toEqual({ score: 4.2, levels: [0, 0, 0.1, 0.6, 0.3], confidence: 0.8 });
	});

	it('OpenCritic の ID を付ける。正の整数だけ。別の作品の ID は断る。変えると前の結果が消える。空で外せる', async () => {
		const workId = await addWork(db);
		const other = await addWork(db);
		for (const bad of ['0', '-1', '1.5', 'abc', '12a', '99999999999999999999']) {
			expect(await linkOpenCritic(db, workId, bad, clock.now())).toEqual({ ok: false, error: 'bad_oc_id' });
		}
		expect(await linkOpenCritic(db, 'missing', '10', clock.now())).toEqual({ ok: false, error: 'not_found' });
		expect(await linkOpenCritic(db, other, '20', clock.now())).toEqual({ ok: true });
		expect(await linkOpenCritic(db, workId, '20', clock.now())).toEqual({ ok: false, error: 'oc_id_taken' });

		expect(await linkOpenCritic(db, workId, '10', clock.now())).toEqual({ ok: true });
		const qs = await ensureCriticQuestionSet(db, testDef, clock.now());
		const read = (id: string) => ({ workId, snippet: snippet(id), questionSetId: qs, answers: answers({ overall: { dir: 'positive' } }) });
		await saveCriticRead(db, read('r1'), clock.now());
		await saveCriticRead(db, { ...read('o1'), workId: other }, clock.now());
		await markSynced(db, workId, clock.now());

		// 同じ ID なら、何もしない
		expect(await linkOpenCritic(db, workId, '10', clock.now())).toEqual({ ok: true });
		expect(await countReviews(workId)).toEqual({ reviews: 1, answers: 1 });

		// ID を変えると、前の結果が消え、取得の日時が null に戻る
		expect(await linkOpenCritic(db, workId, '11', clock.now())).toEqual({ ok: true });
		expect(await countReviews(workId)).toEqual({ reviews: 0, answers: 0 });
		expect(await db.prepare('SELECT opencritic_id, critic_synced_at FROM works WHERE id = ?').bind(workId).first()).toEqual({ opencritic_id: 11, critic_synced_at: null });

		// 外す
		await saveCriticRead(db, read('r2'), clock.now());
		expect(await linkOpenCritic(db, workId, '', clock.now())).toEqual({ ok: true });
		expect(await countReviews(workId)).toEqual({ reviews: 0, answers: 0 });
		expect(await db.prepare('SELECT opencritic_id FROM works WHERE id = ?').bind(workId).first()).toEqual({ opencritic_id: null });

		// 別の作品の結果は、残る
		expect(await countReviews(other)).toEqual({ reviews: 1, answers: 1 });
	});

	it('取得する作品は、古い順。20 時間以内に取得したもの、ID のないもの、非公開の作品は除く', async () => {
		const recent = await addWork(db);
		const old = await addWork(db);
		const never = await addWork(db);
		const edge = await addWork(db);
		const hidden = await addWork(db, { status: 'hidden' });
		await addWork(db); // ID なし
		await setOcId(recent, 1, '2026-11-20T00:00:00.000Z'); // 12 時間前
		await setOcId(old, 2, '2026-11-18T00:00:00.000Z');
		await setOcId(never, 3);
		await setOcId(edge, 4, '2026-11-19T16:00:00.000Z'); // ちょうど 20 時間前
		await setOcId(hidden, 5);

		expect(await worksToSync(db, 10, clock.now())).toEqual([
			{ id: never, ocId: 3 },
			{ id: old, ocId: 2 },
			{ id: edge, ocId: 4 }
		]);
		expect(await worksToSync(db, 1, clock.now())).toEqual([{ id: never, ocId: 3 }]);

		await markSynced(db, never, clock.now());
		expect((await worksToSync(db, 10, clock.now())).map((w) => w.id)).toEqual([old, edge]);
	});

	it('候補が要る作品は、ゲーム・公開中・ID なし・候補の行なしだけ。候補を承認・却下する', async () => {
		const game = await addWork(db, { name: '作り物のゲーム' });
		const linked = await addWork(db);
		await setOcId(linked, 7);
		await addWork(db, { category: 'software' });
		await addWork(db, { status: 'hidden' });
		const rejected = await addWork(db, { name: '却下するゲーム' });

		expect(await worksNeedingCandidate(db, 10)).toEqual([
			{ id: game, name: '作り物のゲーム' },
			{ id: rejected, name: '却下するゲーム' }
		].sort((a, b) => (a.id < b.id ? -1 : 1)));

		await addCandidate(db, game, { id: 7, name: 'Fake Game', dist: 0 }, clock.now());
		await addCandidate(db, rejected, { id: 8, name: 'Other Fake', dist: 1 }, clock.now());
		expect(await worksNeedingCandidate(db, 10)).toEqual([]);
		expect(await openCandidates(db)).toEqual(
			expect.arrayContaining([
				{ workId: game, workName: '作り物のゲーム', ocId: 7, ocName: 'Fake Game' },
				{ workId: rejected, workName: '却下するゲーム', ocId: 8, ocName: 'Other Fake' }
			])
		);

		// ID 7 は別の作品が使っているので、承認できない
		expect(await decideCandidate(db, game, true, clock.now())).toEqual({ ok: false, error: 'oc_id_taken' });
		expect(await decideCandidate(db, 'missing', true, clock.now())).toEqual({ ok: false, error: 'not_found' });

		expect(await decideCandidate(db, rejected, false, clock.now())).toEqual({ ok: true });
		await setOcId(linked, 70);
		expect(await decideCandidate(db, game, true, clock.now())).toEqual({ ok: true });
		expect(await db.prepare('SELECT opencritic_id FROM works WHERE id = ?').bind(game).first()).toEqual({ opencritic_id: 7 });
		expect(await db.prepare('SELECT opencritic_id FROM works WHERE id = ?').bind(rejected).first()).toEqual({ opencritic_id: null });
		expect(await openCandidates(db)).toEqual([]);
		const statuses = await db.prepare('SELECT work_id, status FROM critic_candidates').all<{ work_id: string; status: string }>();
		expect(Object.fromEntries(statuses.results.map((r) => [r.work_id, r.status]))).toEqual({ [game]: 'approved', [rejected]: 'rejected' });
	});

	it('作品ページの欄: 0 件なら null。言及のある観点だけを、段階ごとの確率の合計と平均にまとめる', async () => {
		const workId = await addWork(db);
		expect(await criticSection(db, workId, ASPECTS)).toBeNull();
		const qs = await ensureCriticQuestionSet(db, testDef, clock.now());
		const save = async (id: string, publishedOn: string | null, spec: Spec) => {
			clock.advance(60_000);
			const r = await saveCriticRead(db, { workId, snippet: snippet(id, publishedOn), questionSetId: qs, answers: answers(spec) }, clock.now());
			expect(r).toEqual({ ok: true });
		};

		await save('a', '2026-10-01', {
			overall: { dir: 'positive', star: { score: 4.5, levels: [0, 0, 0, 0.5, 0.5] } },
			story: { dir: 'positive', star: { score: 5, levels: [0, 0, 0, 0, 1] } },
			visual: { dir: 'none', star: { score: 3, levels: [0, 0, 1, 0, 0] } }
		});
		await save('b', '2026-11-01', {
			overall: { dir: 'mixed', star: { score: 2.5, levels: [0, 0.5, 0.5, 0, 0] } },
			story: { dir: 'negative', star: { score: 2, levels: null } },
			sound: { dir: 'mixed', star: { score: 3, levels: [0, 0, 1, 0, 0] } }
		});
		await save('c', null, { overall: { dir: 'none', star: { score: 1, levels: [1, 0, 0, 0, 0] } } });
		await save('d', '2026-11-01', { overall: { dir: 'positive' } });
		// 別の作品の結果は、数えない
		const other = await addWork(db);
		await saveCriticRead(db, { workId: other, snippet: snippet('x'), questionSetId: qs, answers: answers({ overall: { dir: 'positive', star: { score: 5, levels: [0, 0, 0, 0, 1] } } }) }, clock.now());

		const s = (await criticSection(db, workId, ASPECTS))!;
		expect(s.count).toBe(4);
		expect(s.overall.soft).toEqual([0, 0.5, 0.5, 0.5, 0.5]);
		expect(s.overall.mean).toBeCloseTo(3.5);

		// 観点は、渡した一覧の順。overall と、対象のないもの（visual は言及なし）は出ない
		expect(s.aspects.map((a) => a.aspect)).toEqual(['sound', 'story']);
		expect(s.aspects[0]).toEqual({ aspect: 'sound', label: '音', n: 1, soft: [0, 0, 1, 0, 0], mean: 3 });
		expect(s.aspects[1]).toMatchObject({ aspect: 'story', label: '物語', n: 2, soft: [0, 0, 0, 0, 1] });
		expect(s.aspects[1].mean).toBeCloseTo(3.5);

		// 新しい順（公開日、同じなら読んだ日時）。公開日のないものは最後
		expect(s.items.map((i) => i.url)).toEqual(['https://example.com/d', 'https://example.com/b', 'https://example.com/a', 'https://example.com/c']);
		expect(s.items[1]).toEqual({
			outlet: '媒体b',
			url: 'https://example.com/b',
			publishedOn: '2026-11-01',
			overall: { direction: 'mixed', star: 2.5 },
			features: [
				{ aspect: 'sound', label: '音', direction: 'mixed', star: 3 },
				{ aspect: 'story', label: '物語', direction: 'negative', star: 2 }
			]
		});
		expect(s.items[0].overall).toEqual({ direction: 'positive', star: null });
		expect(s.items[2].features).toEqual([{ aspect: 'story', label: '物語', direction: 'positive', star: 5 }]);
		expect(s.items[3]).toMatchObject({ publishedOn: null, overall: { direction: 'none', star: 1 }, features: [] });
	});

	it('作品ページの欄: 対象がなければ soft は 0、mean は null。一覧は最大 30 件', async () => {
		const workId = await addWork(db);
		const qs = await ensureCriticQuestionSet(db, testDef, clock.now());
		for (let i = 0; i < 31; i++) {
			clock.advance(1000);
			await saveCriticRead(db, { workId, snippet: snippet(`r${i}`), questionSetId: qs, answers: answers({ overall: { dir: 'none' } }) }, clock.now());
		}
		const s = (await criticSection(db, workId, ASPECTS))!;
		expect(s.count).toBe(31);
		expect(s.overall).toEqual({ soft: [0, 0, 0, 0, 0], mean: null });
		expect(s.aspects).toEqual([]);
		expect(s.items).toHaveLength(30);
		expect(s.items[0].url).toBe('https://example.com/r30');
	});
});
