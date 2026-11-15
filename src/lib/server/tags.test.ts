import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toClefQuestions } from './question-sets';
import { gameV1 } from './question-sets/game-v1';
import { readRevision } from './reading';
import { sweepReadings } from './sweep';
import {
	composeQuestionSet,
	MAX_QUESTIONS,
	REGISTRY,
	resolveWorkQuestionSet,
	setWorkTags,
	workTags,
	type TagRegistry
} from './tags';
import { addReview, addWork, createClock, createTestDb, fakeClef, testTag } from './testing/db';

const story = testTag('test/story', 'story');
const withStory: TagRegistry = { ...REGISTRY, tags: [...REGISTRY.tags, story] };

describe('タグ', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;
	let clock: ReturnType<typeof createClock>;

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
		clock = createClock();
	});
	afterEach(() => dispose());

	const game = async () => ({ id: await addWork(db), category: 'game' as const });
	const directions = async () => {
		const { results } = await db
			.prepare(
				`SELECT v.body AS body, a.tag_id AS tag, a.tag_version AS version, a.value AS value
				   FROM reading_answers a
				   JOIN readings rd ON rd.id = a.reading_id
				   JOIN review_revisions v ON v.id = rd.revision_id
				  WHERE a.kind = 'direction' ORDER BY v.created_at, a.tag_id`
			)
			.all<{ body: string; tag: string; version: number; value: string }>();
		return results;
	};

	it('ゲームの作品には、分野の4つのタグが自動で付く。質問は、実験で確かめた質問セットと同じ', async () => {
		const work = await game();
		expect((await workTags(db, work)).map((t) => t.id)).toEqual([
			'game/gameplay',
			'game/music',
			'game/comfort',
			'game/price'
		]);
		const set = (await resolveWorkQuestionSet(db, work, clock.now()))!;
		expect(set.model).toBe('clef-flash');
		expect(toClefQuestions(set)).toEqual(toClefQuestions(gameV1));
		expect(Object.keys(toClefQuestions(set))).toEqual(Object.keys(toClefQuestions(gameV1)));
	});

	it('タグを選んでいないソフトウェアには、質問がない。タグを選ぶと、読まれる', async () => {
		const work = { id: await addWork(db, { category: 'software' }), category: 'software' as const };
		expect(await resolveWorkQuestionSet(db, work, clock.now(), withStory)).toBeNull();

		await setWorkTags(db, work, ['test/story'], clock.now(), withStory);
		await addReview(db, work.id, { body: '{"story":"positive"}' });
		const clef = fakeClef();
		expect(await sweepReadings({ db, clef, now: clock.now, registry: withStory })).toMatchObject({ picked: 1, ok: 1 });
		expect(clef.calls[0].questionKeys).toEqual(['story_choice', 'story_noul']);
		expect(await directions()).toEqual([{ body: '{"story":"positive"}', tag: 'test/story', version: 1, value: 'positive' }]);
	});

	it('作品が選んだタグの質問は、分野のタグのあとに入る。同じ組は、同じ質問セットになる', async () => {
		const a = await game();
		const b = await game();
		const plain = await game();
		await setWorkTags(db, a, ['test/story', 'game/music', 'test/story'], clock.now(), withStory);
		await setWorkTags(db, b, ['test/story'], clock.now(), withStory);

		const setA = (await resolveWorkQuestionSet(db, a, clock.now(), withStory))!;
		expect(setA.tags).toEqual([
			{ id: 'game/gameplay', version: 1 },
			{ id: 'game/music', version: 1 },
			{ id: 'game/comfort', version: 1 },
			{ id: 'game/price', version: 1 },
			{ id: 'test/story', version: 1 }
		]);
		expect(Object.keys(toClefQuestions(setA)).slice(-2)).toEqual(['story_choice', 'story_noul']);
		expect((await resolveWorkQuestionSet(db, b, clock.now(), withStory))!.id).toBe(setA.id);
		expect((await resolveWorkQuestionSet(db, plain, clock.now(), withStory))!.id).not.toBe(setA.id);
	});

	it('タグを変えても、読み終えたレビューは読み直さない。あとのレビューは、新しい組で読む', async () => {
		const work = await game();
		const clef = fakeClef();
		const before = await addReview(db, work.id, { body: '{"gameplay":"positive"}', at: new Date('2026-11-01T00:00:00Z') });
		await readRevision({ db, clef, now: clock.now, registry: withStory }, before.revisionId);

		await setWorkTags(db, work, ['test/story'], clock.now(), withStory);
		expect((await sweepReadings({ db, clef, now: clock.now, registry: withStory })).picked).toBe(0);
		expect((await readRevision({ db, clef, now: clock.now, registry: withStory }, before.revisionId)).status).toBe('skipped');

		const after = await addReview(db, work.id, { body: '{"gameplay":"negative","story":"positive"}', at: new Date('2026-11-02T00:00:00Z') });
		await readRevision({ db, clef, now: clock.now, registry: withStory }, after.revisionId);
		expect(clef.calls.map((c) => c.questionKeys.length)).toEqual([8, 10]);

		// 集計は、タグごとに、読んだレビューの分だけ数える。
		const { results } = await db
			.prepare("SELECT tag_id, n_mention, n_pos, n_neg FROM aspect_stats WHERE tag_id IN ('game/gameplay', 'test/story') ORDER BY tag_id")
			.all();
		expect(results).toEqual([
			{ tag_id: 'game/gameplay', n_mention: 2, n_pos: 1, n_neg: 1 },
			{ tag_id: 'test/story', n_mention: 1, n_pos: 1, n_neg: 0 }
		]);
	});

	it('タグの版を上げても、読み終えたレビューは読み直さない。あとのレビューは、新しい版で読み、版を記録する', async () => {
		const work = await game();
		await setWorkTags(db, work, ['test/story'], clock.now(), withStory);
		const clef = fakeClef();
		const first = await addReview(db, work.id, { body: '{"story":"positive"}', at: new Date('2026-11-01T00:00:00Z') });
		await readRevision({ db, clef, now: clock.now, registry: withStory }, first.revisionId);

		const v2: TagRegistry = { ...withStory, tags: [...withStory.tags, testTag('test/story', 'story', 2)] };
		expect((await sweepReadings({ db, clef, now: clock.now, registry: v2 })).picked).toBe(0);
		const second = await addReview(db, work.id, { body: '{"story":"negative"}', at: new Date('2026-11-02T00:00:00Z') });
		await readRevision({ db, clef, now: clock.now, registry: v2 }, second.revisionId);

		expect((await directions()).filter((d) => d.tag === 'test/story')).toEqual([
			{ body: '{"story":"positive"}', tag: 'test/story', version: 1, value: 'positive' },
			{ body: '{"story":"negative"}', tag: 'test/story', version: 2, value: 'negative' }
		]);
	});

	it('版を上げずにタグの定義を変えたら、エラーにする', async () => {
		const work = await game();
		await setWorkTags(db, work, ['test/story'], clock.now(), withStory);
		await resolveWorkQuestionSet(db, work, clock.now(), withStory);

		const changed = { ...story, questions: story.questions.map((q) => ({ ...q, instructions: q.instructions + '（変更）' })) };
		const tampered: TagRegistry = { ...REGISTRY, tags: [...REGISTRY.tags, changed] };
		await expect(resolveWorkQuestionSet(db, work, clock.now(), tampered)).rejects.toThrow('版を上げて');
	});

	it('定義のないタグは選べない。質問が64問を超える組も選べない', async () => {
		const work = await game();
		await expect(setWorkTags(db, work, ['test/unknown'], clock.now(), withStory)).rejects.toThrow('定義がありません');

		const many = Array.from({ length: 29 }, (_, i) => testTag(`test/t${i}`, `t${i}`));
		const big: TagRegistry = { ...REGISTRY, tags: [...REGISTRY.tags, ...many] };
		// 分野の4つ + 28個 = 32個（64問）までは入る。
		await setWorkTags(db, work, many.slice(0, 28).map((t) => t.id), clock.now(), big);
		expect((await resolveWorkQuestionSet(db, work, clock.now(), big))!.questions).toHaveLength(MAX_QUESTIONS);
		await expect(setWorkTags(db, work, many.map((t) => t.id), clock.now(), big)).rejects.toThrow('64 問まで');
		// 失敗したときは、前の組のまま。
		expect(await workTags(db, work, big)).toHaveLength(32);
	});

	it('質問のキーが重なるタグは、同じ組に入れられない', () => {
		expect(() => composeQuestionSet([story, testTag('test/other', 'story')])).toThrow('重なって');
	});
});
