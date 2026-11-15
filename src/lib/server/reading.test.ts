import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClefError } from './clef';
import { toClefQuestions } from './question-sets';
import { gameV1 } from './question-sets/game-v1';
import { backoffMs, interpretAnswers, LEASE_MS, MAX_ATTEMPTS, readRevision } from './reading';
import realResponse from './testing/clef-response.json';
import { addReview, addWork, clefAnswers, createClock, createTestDb, fakeClef } from './testing/db';

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
		const { results } = await db
			.prepare("SELECT tag_id, tag_version, value, needs_check FROM reading_answers WHERE kind = 'direction' ORDER BY tag_id")
			.all();
		expect(results).toEqual([
			{ tag_id: 'game/comfort', tag_version: 1, value: 'negative', needs_check: 0 },
			{ tag_id: 'game/gameplay', tag_version: 1, value: 'positive', needs_check: 0 },
			{ tag_id: 'game/music', tag_version: 1, value: 'none', needs_check: 0 },
			{ tag_id: 'game/price', tag_version: 1, value: 'none', needs_check: 0 }
		]);
		expect(await answerCount()).toBe(8);

		const stats = await db
			.prepare("SELECT n_mention, n_pos FROM aspect_stats WHERE work_id = ? AND tag_id = 'game/gameplay'")
			.bind(work)
			.first();
		expect(stats).toEqual({ n_mention: 1, n_pos: 1 });
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
			return { answers: clefAnswers({}), inputTokens: null };
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
			return { answers: clefAnswers({}), inputTokens: null };
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
			const answers = clefAnswers({});
			delete answers.price_choice;
			return { answers, inputTokens: 1 };
		});
		expect((await readRevision({ db, clef: broken, now: clock.now }, revisionId)).status).toBe('error');
		expect(await answerCount()).toBe(0);
	});

	it('タグのない作品（タグを選んでいないソフトウェア）のレビューは、読まない', async () => {
		const { revisionId } = await addReview(db, await addWork(db, { category: 'software' }), { body: '{}' });
		const clef = fakeClef();
		expect(await readRevision({ db, clef, now: clock.now }, revisionId)).toEqual({
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
});
