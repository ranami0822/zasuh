import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClefError } from './clef';
import { toClefQuestions } from './question-sets';
import { gameV1 } from './question-sets/game-v1';
import { gameV2 } from './question-sets/game-v2';
import type { StarQuestion } from './question-sets/types';
import { REGISTRY, type TagRegistry } from './tags';
import { backoffMs, interpretAnswers, LEASE_MS, MAX_ATTEMPTS, readRevision, readText } from './reading';
import realResponse from './testing/clef-response.json';
import { addReview, addWork, clefAnswers, createClock, createTestDb, fakeClef, registryWithoutSoftwareDomain } from './testing/db';

describe('質問セット', () => {
	it('ゲーム用 v1 は、4観点 × (向き + 言及) の8問を、決まった順序で送る', () => {
		const questions = toClefQuestions(gameV1);
		expect(Object.keys(questions)).toEqual([
			'gameplay_choice',
			'gameplay_noul',
			'music_choice',
			'music_noul',
			'comfort_choice',
			'comfort_noul',
			'price_choice',
			'price_noul'
		]);
		expect(questions.gameplay_choice.type).toBe('choice');
		expect(Object.keys(questions.gameplay_choice.criteria)).toEqual(['肯定', '否定', '混在', '言及なし']);
		expect(questions.gameplay_noul).toMatchObject({ type: 'noul' });
		expect(Object.keys(questions.gameplay_noul.criteria)).toEqual(['true', 'false']);
	});
});

describe('interpretAnswers', () => {
	it('実際の Clef の応答（実験の記録）を読める', () => {
		const answers = interpretAnswers(gameV1, realResponse.answers);
		expect(answers).toHaveLength(8);

		const byKey = Object.fromEntries(answers.map((a) => [a.questionKey, a]));
		// 向きの確率が低い（0.51）ので、要確認。
		expect(byKey.gameplay_choice).toMatchObject({
			aspect: 'gameplay',
			kind: 'direction',
			value: 'none',
			prob: 0.5146,
			probs: { positive: 0.0893, negative: 0.0339, mixed: 0.3622, none: 0.5146 },
			needsCheck: true
		});
		expect(byKey.gameplay_noul).toMatchObject({ kind: 'mention', value: 'false', prob: 0.0453, probs: null });
		// 向きの確率が高く、言及とも食い違わないので、要確認ではない。
		expect(byKey.music_choice).toMatchObject({ value: 'none', needsCheck: false });
	});

	it('向きと言及が食い違うとき、言及の確率がどっちつかずのときは、要確認', () => {
		const disagree = clefAnswers({ gameplay: 'positive' });
		(disagree.gameplay_noul as { noul: number }).noul = 0.1;
		const unsure = clefAnswers({ music: 'negative' });
		(unsure.music_noul as { noul: number }).noul = 0.6;

		const find = (answers: Record<string, unknown>, key: string) =>
			interpretAnswers(gameV1, answers).find((a) => a.questionKey === key)!;
		expect(find(disagree, 'gameplay_choice').needsCheck).toBe(true);
		expect(find(disagree, 'music_choice').needsCheck).toBe(false);
		expect(find(unsure, 'music_choice').needsCheck).toBe(true);
	});

	it('形が想定と違う答えは、エラーにする', () => {
		const missing = clefAnswers({});
		delete missing.price_noul;
		const unknownChoice = clefAnswers({});
		(unknownChoice.gameplay_choice as { choice: string }).choice = 'わからない';
		const badProb = clefAnswers({});
		(badProb.music_noul as { noul: unknown }).noul = 1.5;

		for (const answers of [missing, unknownChoice, badProb]) {
			expect(() => interpretAnswers(gameV1, answers)).toThrow(ClefError);
		}
	});
});

describe('readRevision', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;
	let clock: ReturnType<typeof createClock>;

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
		clock = createClock();
	});
	afterEach(() => dispose());

	const reading = (revisionId: string) =>
		db
			.prepare('SELECT * FROM readings WHERE revision_id = ?')
			.bind(revisionId)
			.first<{ id: string; status: string; attempts: number; next_attempt_at: string | null; error: string | null; model: string; input_tokens: number | null }>();
	const answerCount = async () =>
		(await db.prepare('SELECT COUNT(*) AS n FROM reading_answers').first<{ n: number }>())!.n;

	it('読み取った答えを保存し、集計を作る', async () => {
		const work = await addWork(db);
		const { revisionId } = await addReview(db, work, { body: '{"gameplay":"positive","comfort":"negative"}' });
		const clef = fakeClef();

		const outcome = await readRevision({ db, clef, now: clock.now }, revisionId);

		expect(outcome.status).toBe('ok');
		expect(clef.calls).toHaveLength(1);
		expect(clef.calls[0]).toMatchObject({ model: 'clef-flash', state: '{"gameplay":"positive","comfort":"negative"}' });
		expect(clef.calls[0].questionKeys).toHaveLength(8);

		expect(await reading(revisionId)).toMatchObject({
			status: 'ok',
			attempts: 1,
			next_attempt_at: null,
			error: null,
			model: 'clef-flash',
			input_tokens: 1700
		});
		// 向き（direction）の質問はない。言及（noul）と星（score）が、観点ごとに1つずつ。
		const { results } = await db
			.prepare("SELECT tag_id, tag_version, kind, value FROM reading_answers ORDER BY tag_id, kind")
			.all();
		expect(results).toEqual([
			{ tag_id: 'game/comfort', tag_version: 2, kind: 'mention', value: 'true' },
			{ tag_id: 'game/comfort', tag_version: 2, kind: 'star', value: '1' },
			{ tag_id: 'game/gameplay', tag_version: 2, kind: 'mention', value: 'true' },
			{ tag_id: 'game/gameplay', tag_version: 2, kind: 'star', value: '5' },
			{ tag_id: 'game/music', tag_version: 2, kind: 'mention', value: 'false' },
			{ tag_id: 'game/music', tag_version: 2, kind: 'star', value: '3' },
			{ tag_id: 'game/price', tag_version: 2, kind: 'mention', value: 'false' },
			{ tag_id: 'game/price', tag_version: 2, kind: 'star', value: '3' }
		]);
		expect(await answerCount()).toBe(8);
		// 星は、段階ごとの確率と連続値を、丸めずに保存する。
		const star = await db
			.prepare("SELECT probs_json FROM reading_answers WHERE question_key = 'gameplay_star'")
			.first<{ probs_json: string }>();
		const saved = JSON.parse(star!.probs_json) as { score: number; levels: number[] };
		expect(saved.levels).toHaveLength(5);
		expect(saved.levels.reduce((t, p) => t + p, 0)).toBeCloseTo(1, 9);
		expect(saved.score).toBeGreaterThan(4);

		// 集計: 言及ありの観点だけ、星を数える。
		const stats = await db
			.prepare("SELECT tag_id, n_mention FROM aspect_star_stats WHERE work_id = ? ORDER BY tag_id")
			.bind(work)
			.all();
		expect(stats.results).toEqual([
			{ tag_id: '_overall', n_mention: 1 }, // 総合は、レビューごとに1つ
			{ tag_id: 'game/comfort', n_mention: 1 },
			{ tag_id: 'game/gameplay', n_mention: 1 }
		]);
	});

	it('読み終えた版は、もう一度読まない', async () => {
		const { revisionId } = await addReview(db, await addWork(db), { body: '{}' });
		const clef = fakeClef();
		await readRevision({ db, clef, now: clock.now }, revisionId);

		expect(await readRevision({ db, clef, now: clock.now }, revisionId)).toEqual({
			status: 'skipped',
			reason: 'busy_or_done'
		});
		expect(clef.calls).toHaveLength(1);
	});

	it('読み取り中の版は、ほかの処理が読まない。止まったままなら、期限のあとでやり直せる', async () => {
		const { revisionId } = await addReview(db, await addWork(db), { body: '{}' });
		let release!: () => void;
		const slow = fakeClef(async () => {
			await new Promise<void>((r) => (release = r));
			throw new Error('処理が途中で止まった');
		});
		const first = readRevision({ db, clef: slow, now: clock.now }, revisionId);
		await expect.poll(() => slow.calls.length).toBe(1);

		const fast = fakeClef();
		expect((await readRevision({ db, clef: fast, now: clock.now }, revisionId)).status).toBe('skipped');
		expect(fast.calls).toHaveLength(0);

		// 止まった処理が、失敗も記録できなかった場合を再現する（読み取り中のまま、期限を過ぎる）。
		await db.prepare("UPDATE readings SET status = 'running' WHERE revision_id = ?").bind(revisionId).run();
		clock.advance(LEASE_MS + 1);
		expect((await readRevision({ db, clef: fast, now: clock.now }, revisionId)).status).toBe('ok');
		expect(await reading(revisionId)).toMatchObject({ status: 'ok', attempts: 2 });

		// 止まっていた処理があとから失敗しても、新しい結果を上書きしない。
		release();
		await first;
		expect(await reading(revisionId)).toMatchObject({ status: 'ok', attempts: 2, error: null });
	});

	it('失敗を記録し、次に試す時刻までは読まない。時刻を過ぎたら、やり直す', async () => {
		const { revisionId } = await addReview(db, await addWork(db), { body: '{"music":"positive"}' });
		const failing = fakeClef(() => {
			throw new ClefError('Clef が 400 を返しました', false);
		});

		const outcome = await readRevision({ db, clef: failing, now: clock.now }, revisionId);
		expect(outcome).toMatchObject({ status: 'error', error: 'Clef が 400 を返しました' });
		expect(failing.calls).toHaveLength(1);
		expect(await reading(revisionId)).toMatchObject({
			status: 'error',
			attempts: 1,
			error: 'Clef が 400 を返しました',
			next_attempt_at: new Date(clock.now().getTime() + backoffMs(1)).toISOString()
		});
		expect(await answerCount()).toBe(0);

		const clef = fakeClef();
		clock.advance(backoffMs(1) - 1);
		expect((await readRevision({ db, clef, now: clock.now }, revisionId)).status).toBe('skipped');
		clock.advance(1);
		expect((await readRevision({ db, clef, now: clock.now }, revisionId)).status).toBe('ok');
		expect(await reading(revisionId)).toMatchObject({ status: 'ok', attempts: 2, error: null });
		expect(await answerCount()).toBe(8);
	});

	it('1日の利用枠を使い切って失敗が続いても、枠が戻る翌日まで、やり直しの回数が残る', async () => {
		const { revisionId } = await addReview(db, await addWork(db), { body: '{}' });
		const start = clock.now().getTime();
		let quotaExhausted = true;
		const clef = fakeClef(() => {
			if (quotaExhausted) throw new ClefError('Clef が 429 を返しました', false);
			return { answers: clefAnswers({}, gameV2), inputTokens: null };
		});

		// 24時間のあいだ、試せるようになるたびに試して、失敗し続ける。
		while (clock.now().getTime() - start < 24 * 60 * 60_000) {
			const outcome = await readRevision({ db, clef, now: clock.now }, revisionId);
			expect(outcome.status).toBe('error');
			const row = await reading(revisionId);
			clock.advance(new Date(row!.next_attempt_at!).getTime() - clock.now().getTime());
		}

		quotaExhausted = false;
		expect((await readRevision({ db, clef, now: clock.now }, revisionId)).status).toBe('ok');
	});

	it('一時的な失敗は、その場で1回だけやり直す', async () => {
		const { revisionId } = await addReview(db, await addWork(db), { body: '{}' });
		const flaky = fakeClef((_state, call) => {
			if (call === 1) throw new ClefError('Clef が 503 を返しました', true);
			return { answers: clefAnswers({}, gameV2), inputTokens: null };
		});

		const outcome = await readRevision({ db, clef: flaky, now: clock.now, quickRetryDelayMs: 0 }, revisionId);
		expect(outcome.status).toBe('ok');
		expect(flaky.calls).toHaveLength(2);
		expect(await reading(revisionId)).toMatchObject({ status: 'ok', attempts: 1 });
	});

	it('回数の上限に達したら、もう読まない', async () => {
		const { revisionId } = await addReview(db, await addWork(db), { body: '{}' });
		const failing = fakeClef(() => {
			throw new ClefError('失敗', false);
		});
		for (let i = 0; i < MAX_ATTEMPTS; i++) {
			expect((await readRevision({ db, clef: failing, now: clock.now }, revisionId)).status).toBe('error');
			clock.advance(backoffMs(MAX_ATTEMPTS));
		}
		expect((await readRevision({ db, clef: failing, now: clock.now }, revisionId)).status).toBe('skipped');
		expect(failing.calls).toHaveLength(MAX_ATTEMPTS);
		expect(await reading(revisionId)).toMatchObject({ status: 'error', attempts: MAX_ATTEMPTS });
	});

	it('形が想定と違う答えは、一部だけ保存せず、失敗にする', async () => {
		const { revisionId } = await addReview(db, await addWork(db), { body: '{}' });
		const broken = fakeClef(() => {
			const answers = clefAnswers({}, gameV2);
			delete answers.price_star;
			return { answers, inputTokens: 1 };
		});
		expect((await readRevision({ db, clef: broken, now: clock.now }, revisionId)).status).toBe('error');
		expect(await answerCount()).toBe(0);
	});

	it('タグのない作品（タグを選んでいないソフトウェア）のレビューは、読まない', async () => {
		const { revisionId } = await addReview(db, await addWork(db, { category: 'software' }), { body: '{}' });
		const clef = fakeClef();
		expect(await readRevision({ db, clef, now: clock.now, registry: registryWithoutSoftwareDomain }, revisionId)).toEqual({
			status: 'skipped',
			reason: 'no_question_set'
		});
		expect(clef.calls).toHaveLength(0);
		expect(await reading(revisionId)).toBeNull();
	});

	it('存在しない版は、読まない', async () => {
		expect(await readRevision({ db, clef: fakeClef(), now: clock.now }, 'missing')).toEqual({
			status: 'skipped',
			reason: 'not_found'
		});
	});

	describe('読み直し（reread）', () => {
		// 星を入れる前の登録（ゲームの分野のタグが v1 = 向きと言及）。
		const v1Registry: TagRegistry = { ...REGISTRY, tags: REGISTRY.tags.filter((t) => t.version === 1) };
		const readingsOf = async (revisionId: string) =>
			(
				await db
					.prepare('SELECT id, question_set_id, status FROM readings WHERE revision_id = ? ORDER BY created_at, question_set_id')
					.bind(revisionId)
					.all<{ id: string; question_set_id: number; status: string }>()
			).results;
		const kindsOf = async (readingId: string) =>
			(
				await db
					.prepare('SELECT kind, COUNT(*) AS n FROM reading_answers WHERE reading_id = ? GROUP BY kind ORDER BY kind')
					.bind(readingId)
					.all<{ kind: string; n: number }>()
			).results;

		it('別の質問の組で読めた版を、いまの質問の組で読み直し、星を保存する。古い読み取りは残る', async () => {
			const work = await addWork(db);
			const { revisionId } = await addReview(db, work, { body: '{"gameplay":"positive"}' });
			const clef = fakeClef();
			const old = await readRevision({ db, clef, now: clock.now, registry: v1Registry }, revisionId);
			expect(old.status).toBe('ok');

			const outcome = await readRevision({ db, clef, now: clock.now }, revisionId, { reread: true });

			expect(outcome.status).toBe('ok');
			expect(clef.calls).toHaveLength(2);
			const rows = await readingsOf(revisionId);
			expect(rows).toHaveLength(2);
			expect(rows.every((r) => r.status === 'ok')).toBe(true);
			expect(new Set(rows.map((r) => r.question_set_id)).size).toBe(2);
			const oldId = (old as { readingId: string }).readingId;
			const newId = (outcome as { readingId: string }).readingId;
			expect(await kindsOf(oldId)).toEqual([
				{ kind: 'direction', n: 4 },
				{ kind: 'mention', n: 4 }
			]);
			expect(await kindsOf(newId)).toEqual([
				{ kind: 'mention', n: 4 },
				{ kind: 'star', n: 4 }
			]);
			// 読めたあとに、作品の星の集計が作り直される。
			const stats = await db
				.prepare("SELECT tag_id, n_mention FROM aspect_star_stats WHERE work_id = ? AND tag_id = 'game/gameplay'")
				.bind(work)
				.first();
			expect(stats).toEqual({ tag_id: 'game/gameplay', n_mention: 1 });
		});

		it('reread を付けなければ、別の質問の組で読めた版は、今までどおり読まない', async () => {
			const { revisionId } = await addReview(db, await addWork(db), { body: '{"gameplay":"positive"}' });
			const clef = fakeClef();
			await readRevision({ db, clef, now: clock.now, registry: v1Registry }, revisionId);

			expect(await readRevision({ db, clef, now: clock.now }, revisionId)).toEqual({ status: 'skipped', reason: 'busy_or_done' });
			expect(clef.calls).toHaveLength(1);
			expect(await readingsOf(revisionId)).toHaveLength(1);
		});

		it('同じ版を2回読み直しても、いまの質問の組の読み取りは1つだけ（2回目は読まない）', async () => {
			const { revisionId } = await addReview(db, await addWork(db), { body: '{"gameplay":"positive"}' });
			const clef = fakeClef();
			await readRevision({ db, clef, now: clock.now, registry: v1Registry }, revisionId);

			expect((await readRevision({ db, clef, now: clock.now }, revisionId, { reread: true })).status).toBe('ok');
			expect(await readRevision({ db, clef, now: clock.now }, revisionId, { reread: true })).toEqual({
				status: 'skipped',
				reason: 'busy_or_done'
			});
			expect(clef.calls).toHaveLength(2);
			expect(await readingsOf(revisionId)).toHaveLength(2);
		});
	});
});

describe('星（score）', () => {
	const levels = ['大きく否定', '否定', '同程度', '肯定', '大きく肯定'];
	const starQuestion: StarQuestion = { key: 'gameplay_star', aspect: 'gameplay', kind: 'star', instructions: '強さ', levels };
	const def = { questions: [starQuestion] };
	const answer = (over: Record<string, unknown> = {}) => ({ gameplay_star: { type: 'score', score: 3.4, probabilities: [0.01, 0.03, 0.06, 0.8, 0.1], confidence: 0.8, legend: '肯定', ...over } });

	it('Clef に、段階の説明を、低い順の配列として渡す（type は score）', () => {
		expect(toClefQuestions(def)).toEqual({ gameplay_star: { type: 'score', instructions: '強さ', criteria: levels } });
		// 渡した配列を、あとから書き換えても、質問の定義は変わらない
		(toClefQuestions(def).gameplay_star.criteria as string[]).push('x');
		expect(starQuestion.levels).toHaveLength(5);
	});

	it('score（0〜段階の数 - 1）を、1〜5 の星に直す。四捨五入した星を value にし、確率は、その星のもの', () => {
		const [a] = interpretAnswers(def, answer());
		expect(a).toMatchObject({
			questionKey: 'gameplay_star',
			aspect: 'gameplay',
			kind: 'star',
			value: '4',
			prob: 0.8,
			probs: null,
			needsCheck: false,
			star: { levels: [0.01, 0.03, 0.06, 0.8, 0.1], confidence: 0.8 }
		});
		expect(a.star!.score).toBeCloseTo(4.4, 9); // 3.4 + 1。段階の間の値は、そのまま残す
	});

	it('端の値、段階の境の四捨五入', () => {
		const value = (score: number) => interpretAnswers(def, answer({ score }))[0].value;
		expect(value(0)).toBe('1');
		expect(value(4)).toBe('5');
		expect(value(0.4)).toBe('1');
		expect(value(0.6)).toBe('2');
		expect(value(2.49)).toBe('3');
		expect(value(4 + 1e-9)).toBe('5'); // 少しの誤差は許して、範囲に収める
	});

	it('範囲の外、数でない、ない score は、エラーにする（一部だけ保存しない）', () => {
		for (const score of [-0.5, 4.5, 5, NaN, Infinity, '3', null, undefined]) {
			expect(() => interpretAnswers(def, answer({ score })), String(score)).toThrow(ClefError);
		}
		expect(() => interpretAnswers(def, {})).toThrow(ClefError);
		expect(() => interpretAnswers(def, { gameplay_star: 'x' })).toThrow(ClefError);
	});

	it('段階ごとの確率は、配列、または、番号か説明文をキーにした辞書を読める。読めなければ、星だけを使う（未確認の形に備える）', () => {
		const p = [0.1, 0.2, 0.3, 0.2, 0.2];
		expect(interpretAnswers(def, answer({ probabilities: p }))[0].star!.levels).toEqual(p);
		expect(interpretAnswers(def, answer({ probabilities: { '0': 0.1, '1': 0.2, '2': 0.3, '3': 0.2, '4': 0.2 } }))[0].star!.levels).toEqual(p);
		const byText = Object.fromEntries(levels.map((l, i) => [l, p[i]]));
		expect(interpretAnswers(def, answer({ probabilities: byText }))[0].star!.levels).toEqual(p);

		for (const probabilities of [undefined, [0.5, 0.5], [0.1, 0.2, 0.3, 0.2, 2], { x: 1 }, 'a']) {
			const [a] = interpretAnswers(def, answer({ probabilities, confidence: 'high' }));
			expect(a.star!.levels).toBeNull();
			expect(a.star!.confidence).toBeNull();
			expect(a.prob).toBe(0);
			expect(a.value).toBe('4');
		}
	});

	it('向き・言及の質問と一緒でも、それぞれに、解釈される。星は、要確認の判定に使わない', () => {
		const both = { questions: [...gameV1.questions, starQuestion] };
		const answers = { ...clefAnswers({ gameplay: 'positive' }), ...answer() };
		const out = interpretAnswers(both, answers);
		expect(out.map((a) => a.kind)).toEqual(['direction', 'mention', 'direction', 'mention', 'direction', 'mention', 'direction', 'mention', 'star']);
		expect(out.filter((a) => a.kind !== 'star').every((a) => a.star === undefined)).toBe(true);
		expect(out.find((a) => a.kind === 'star')!.needsCheck).toBe(false);
	});

	describe('保存', () => {
		let db: D1Database;
		let dispose: () => Promise<void>;
		beforeEach(async () => {
			({ db, dispose } = await createTestDb());
		});
		afterEach(() => dispose());

		const starRegistry: TagRegistry = {
			tags: [{ id: 'test/star', key: 'gameplay', version: 1, label: 'ゲーム性', questions: [starQuestion] }],
			domainTags: { game: ['test/star'], software: [] },
			extraTags: { game: [], software: [] }
		};

		it('星の質問を含むタグを読むと、reading_answers に、星と確率が入る（質問は score で送られる）', async () => {
			const { revisionId } = await addReview(db, await addWork(db), { body: 'x' });
			const clef = fakeClef(() => ({ answers: answer(), inputTokens: 100 }));
			const clock = createClock();
			expect(await readRevision({ db, clef, now: clock.now, registry: starRegistry }, revisionId)).toMatchObject({ status: 'ok' });

			const row = await db
				.prepare('SELECT question_key, tag_id, kind, value, prob, probs_json, needs_check FROM reading_answers')
				.first<{ question_key: string; tag_id: string; kind: string; value: string; prob: number; probs_json: string; needs_check: number }>();
			expect(row).toMatchObject({ question_key: 'gameplay_star', tag_id: 'test/star', kind: 'star', value: '4', prob: 0.8, needs_check: 0 });
			expect(JSON.parse(row!.probs_json)).toMatchObject({ levels: [0.01, 0.03, 0.06, 0.8, 0.1], confidence: 0.8 });
		});

		it('答えが範囲の外なら、失敗として記録する（保存しない）', async () => {
			const { revisionId } = await addReview(db, await addWork(db), { body: 'x' });
			const clef = fakeClef(() => ({ answers: answer({ score: 9 }), inputTokens: 100 }));
			const outcome = await readRevision({ db, clef, now: createClock().now, registry: starRegistry }, revisionId);
			expect(outcome).toMatchObject({ status: 'error' });
			expect(await db.prepare('SELECT COUNT(*) AS n FROM reading_answers').first()).toEqual({ n: 0 });
		});
	});
});

describe('readText', () => {
	const def = { model: 'clef-flash' as const, questions: gameV1.questions };

	it('本文を、質問セットのモデルと質問で読ませて、検証した答えと、入力のトークン数を返す', async () => {
		const clef = fakeClef();
		const out = await readText({ clef }, def, '{"gameplay":"positive"}');
		expect(clef.calls).toEqual([
			{ model: 'clef-flash', state: '{"gameplay":"positive"}', questionKeys: Object.keys(toClefQuestions(gameV1)) }
		]);
		expect(out.answers).toHaveLength(8);
		expect(out.answers[0]).toMatchObject({ questionKey: 'gameplay_choice', value: 'positive' });
		expect(out.inputTokens).toBe(1700);
		expect(out.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it('5xx・通信の失敗は、1回だけやり直す。やり直しても失敗なら、ClefError を投げる', async () => {
		const flaky = fakeClef((_state, call) => {
			if (call === 1) throw new ClefError('Clef が 503 を返しました', true);
			return { answers: clefAnswers({}), inputTokens: null };
		});
		expect((await readText({ clef: flaky, quickRetryDelayMs: 0 }, def, '{}')).inputTokens).toBeNull();
		expect(flaky.calls).toHaveLength(2);

		const down = fakeClef(() => {
			throw new ClefError('Clef が 503 を返しました', true);
		});
		await expect(readText({ clef: down, quickRetryDelayMs: 0 }, def, '{}')).rejects.toThrow(ClefError);
		expect(down.calls).toHaveLength(2);
	});

	it('すぐには直らない失敗（429 など）は、やり直さない', async () => {
		const limited = fakeClef(() => {
			throw new ClefError('Clef が 429 を返しました', false);
		});
		await expect(readText({ clef: limited, quickRetryDelayMs: 0 }, def, '{}')).rejects.toThrow(ClefError);
		expect(limited.calls).toHaveLength(1);
	});

	it('答えの形が想定と違えば、ClefError を投げる', async () => {
		const broken = fakeClef(() => {
			const answers = clefAnswers({});
			delete answers.price_noul;
			return { answers, inputTokens: 10 };
		});
		await expect(readText({ clef: broken }, def, '{}')).rejects.toThrow(ClefError);
	});
});
