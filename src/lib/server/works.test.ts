import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { featuredWork, foldForSearch, rankedWorks, readingStatus, searchWorks, tagOptions, workPage } from './pages';
import { readRevision } from './reading';
import { deviceTokenHash, postReview } from './reviews';
import { addReview, addWork, createClock, createTestDb, fakeClef } from './testing/db';
import { createWork, getWork, selectedTagIds, updateWork } from './works';

describe('作品の登録と、一覧・作品ページの問い合わせ', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;
	let clock: ReturnType<typeof createClock>;

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
		clock = createClock('2026-11-17T03:00:00.000Z');
	});
	afterEach(() => dispose());

	const input = { slug: 'star-line', name: '星屑の鉄道', category: 'game', url: 'https://example.com/', summary: '' };

	it('作品を登録する。名前、分野、リンク、URL 用の名前を検証する。同じ名前は断る', async () => {
		const r = await createWork(db, input, clock.now());
		expect(r.ok).toBe(true);
		expect(await getWork(db, { slug: 'star-line' })).toMatchObject({ name: '星屑の鉄道', category: 'game', url: 'https://example.com/', summary: null, status: 'active' });
		expect(await createWork(db, input, clock.now())).toEqual({ ok: false, error: 'slug_taken' });
		expect(await createWork(db, { ...input, slug: 'Bad Slug' }, clock.now())).toEqual({ ok: false, error: 'bad_slug' });
		expect(await createWork(db, { ...input, slug: 'a', name: ' ' }, clock.now())).toEqual({ ok: false, error: 'bad_name' });
		expect(await createWork(db, { ...input, slug: 'a', category: 'music' }, clock.now())).toEqual({ ok: false, error: 'bad_category' });
		expect(await createWork(db, { ...input, slug: 'a', url: 'javascript:alert(1)' }, clock.now())).toEqual({ ok: false, error: 'bad_url' });
		expect(await createWork(db, { ...input, slug: 'a', url: 'not a url' }, clock.now())).toEqual({ ok: false, error: 'bad_url' });
	});

	it('追加のタグを選ぶ。その分野の追加のタグだけ選べる。選んだタグは、読み取りの質問に入る', async () => {
		const r = (await createWork(db, input, clock.now())) as { ok: true; id: string };
		const edit = { name: '星屑の鉄道', url: '', summary: '', status: 'active' };
		expect((await updateWork(db, r.id, edit, ['game/story', 'game/multiplayer'], clock.now())).ok).toBe(true);
		expect(await selectedTagIds(db, r.id)).toEqual(['game/story', 'game/multiplayer']);
		expect(await updateWork(db, r.id, edit, ['software/support'], clock.now())).toEqual({ ok: false, error: 'bad_tags' });
		expect(await updateWork(db, r.id, edit, ['game/gameplay'], clock.now())).toEqual({ ok: false, error: 'bad_tags' }); // 分野のタグは自動で付くので、選べない
		expect(await updateWork(db, 'missing', edit, [], clock.now())).toEqual({ ok: false, error: 'not_found' });
		expect(await selectedTagIds(db, r.id)).toEqual(['game/story', 'game/multiplayer']);
		expect(await tagOptions(db, 'game')).toEqual([
			{ id: 'game/gameplay', label: 'ゲーム性・内容', domain: true },
			{ id: 'game/music', label: '音楽・音', domain: true },
			{ id: 'game/comfort', label: '快適さ', domain: true },
			{ id: 'game/price', label: '価格', domain: true },
			{ id: 'game/story', label: '物語', domain: false },
			{ id: 'game/multiplayer', label: 'マルチプレイ', domain: false }
		]);
	});

	it('ソフトウェアの作品には、分野のタグが付き、読み取りの質問に入る', async () => {
		const id = await addWork(db, { category: 'software' });
		const dev = await deviceTokenHash('a');
		const p = await postReview(db, { workId: id, deviceHash: dev, ipHash: null, body: '{"function":"positive","stability":"negative"}', disclosure: 'none', disclosureNote: '' }, clock.now());
		if (!p.ok) throw new Error(p.error);
		const clef = fakeClef();
		await readRevision({ db, clef, now: clock.now }, p.revisionId);
		expect(clef.calls[0].questionKeys).toEqual([
			'function_choice', 'function_noul', 'usability_choice', 'usability_noul',
			'stability_choice', 'stability_noul', 'pricing_choice', 'pricing_noul'
		]);
		const page = await workPage(db, (await getWork(db, { id }))!, {});
		expect(page.tags.map((t) => [t.tagId, t.nMention])).toEqual([
			['software/function', 1], ['software/usability', 0], ['software/stability', 1], ['software/pricing', 0]
		]);
	});

	describe('並びとページ', () => {
		const review = async (workId: string, device: string, body: string, over: { writtenOn?: string; disclosure?: string } = {}) => {
			const p = await postReview(db, { workId, deviceHash: await deviceTokenHash(device), ipHash: null, body, disclosure: over.disclosure ?? 'none', disclosureNote: '' }, clock.now());
			if (!p.ok) throw new Error(p.error);
			// 日付は投稿した日にサーバーが決めるので、月ごとの変化を確かめるために、保存したあとで直接書き換える。
			if (over.writtenOn) await db.prepare('UPDATE reviews SET written_on = ? WHERE id = ?').bind(over.writtenOn, p.reviewId).run();
			await readRevision({ db, clef: fakeClef(), now: clock.now }, p.revisionId);
			return p;
		};

		it('並び: 下限の高い順に番号を付け、言及のない作品は、番号なしで後ろに並べる', async () => {
			const a = await addWork(db, { name: 'A' });
			const b = await addWork(db, { name: 'B' });
			await addWork(db, { name: 'C' });
			await addWork(db, { name: 'H', status: 'hidden' });
			await addWork(db, { name: 'S', category: 'software' });
			for (let i = 0; i < 5; i++) await review(a, `a${i}`, '{"gameplay":"positive"}');
			await review(b, 'b0', '{"gameplay":"positive"}');
			const rows = await rankedWorks(db, 'game');
			expect(rows.map((r) => [r.name, r.rank, r.nMention])).toEqual([['A', 1, 5], ['B', 2, 1], ['C', null, 0]]);
			expect((await rankedWorks(db, 'game', 'game/music')).map((r) => r.rank)).toEqual([null, null, null]);
			expect((await rankedWorks(db, 'software')).map((r) => r.name)).toEqual(['S']);
		});

		it('作品ページ: タグごとの数、レビュー（読み取り結果つき）、関係者の別枠、タグでの絞り込み', async () => {
			const id = await addWork(db);
			await review(id, 'a', '{"gameplay":"positive","music":"negative"}', { writtenOn: '2026-10-05' });
			await review(id, 'b', '{"gameplay":"negative"}', { writtenOn: '2026-11-10' });
			await review(id, 'c', '{"gameplay":"positive"}', { disclosure: 'developer' });
			const work = (await getWork(db, { id }))!;

			const page = await workPage(db, work, {});
			expect(page.tags.map((t) => [t.tagId, t.nMention, t.nPos, t.nNeg])).toEqual([
				['game/gameplay', 2, 1, 1], ['game/music', 1, 0, 1], ['game/comfort', 0, 0, 0], ['game/price', 0, 0, 0]
			]);
			expect(page.overall).toMatchObject({ nMention: 3, nPos: 1, nNeg: 2 });
			expect(page.total).toBe(2);
			expect(page.reviews.map((r) => r.writtenOn)).toEqual(['2026-11-10', '2026-10-05']);
			expect(page.reviews[1].reads).toEqual([
				{ tagId: 'game/gameplay', label: 'ゲーム性・内容', value: 'positive' },
				{ tagId: 'game/music', label: '音楽・音', value: 'negative' }
			]);
			expect(page.disclosed).toHaveLength(1);
			expect(page.months).toEqual([
				{ month: '2026-10', nPos: 1, nNeg: 1, nMix: 0 },
				{ month: '2026-11', nPos: 0, nNeg: 1, nMix: 0 }
			]);

			const music = await workPage(db, work, { tag: 'game/music' });
			expect(music.total).toBe(1);
			expect(music.reviews).toHaveLength(1);
		});

		it('検索: 作品名の部分一致。全角半角と大文字小文字を区別せず、分野をまたぐ。非表示の作品は出ない', async () => {
			await addWork(db, { name: 'Star Line Express' });
			await addWork(db, { name: '星屑の鉄道' });
			await addWork(db, { name: 'スターライン', category: 'software' });
			await addWork(db, { name: 'STAR hidden', status: 'hidden' });
			expect(foldForSearch(' Ｓｔａｒ  Ｌine ')).toBe('starline');
			expect((await searchWorks(db, 'star line')).map((h) => h.name)).toEqual(['Star Line Express']);
			expect((await searchWorks(db, 'ＳＴＡＲ')).map((h) => h.name)).toEqual(['Star Line Express']);
			expect((await searchWorks(db, '鉄道')).map((h) => [h.name, h.category])).toEqual([['星屑の鉄道', 'game']]);
			expect((await searchWorks(db, 'スター')).map((h) => [h.name, h.category])).toEqual([['スターライン', 'software']]);
			expect(await searchWorks(db, '  ')).toEqual([]);
			expect(await searchWorks(db, 'zzz')).toEqual([]);
			expect(await searchWorks(db, '%')).toEqual([]); // LIKE の記号として扱わない
		});

		it('読み取りの状況: 読む前は pending、読んだあとは向きつきで ok。関係者と重複の印も返す', async () => {
			const id = await addWork(db);
			const dev = await deviceTokenHash('s');
			const p = await postReview(db, { workId: id, deviceHash: dev, ipHash: null, body: '{"gameplay":"positive","price":"negative"}', disclosure: 'developer', disclosureNote: '', }, clock.now());
			if (!p.ok) throw new Error(p.error);
			expect(await readingStatus(db, p.reviewId)).toEqual({ status: 'pending', reads: [], duplicate: false, disclosed: true });
			await readRevision({ db, clef: fakeClef(), now: clock.now }, p.revisionId);
			expect(await readingStatus(db, p.reviewId)).toEqual({
				status: 'ok',
				reads: [
					{ tagId: 'game/gameplay', label: 'ゲーム性・内容', value: 'positive' },
					{ tagId: 'game/price', label: '価格', value: 'negative' }
				],
				duplicate: false,
				disclosed: true
			});
			const failing = await postReview(db, { workId: id, deviceHash: await deviceTokenHash('t'), ipHash: null, body: '{"x":1}  ', disclosure: 'none', disclosureNote: '' }, clock.now());
			if (!failing.ok) throw new Error(failing.error);
			const broken = fakeClef(() => { throw new Error('boom'); });
			await readRevision({ db, clef: broken, now: clock.now, quickRetryDelayMs: 0 }, failing.revisionId);
			expect((await readingStatus(db, failing.reviewId))?.status).toBe('failed');
			expect(await readingStatus(db, 'missing')).toBeNull();
		});

		it('ページ分け。非表示のレビューは出ない', async () => {
			const id = await addWork(db);
			for (let i = 0; i < 31; i++) await review(id, `d${i}`, '{"x":1}');
			const work = (await getWork(db, { id }))!;
			const first = await workPage(db, work, { page: 1 });
			expect([first.reviews.length, first.pageCount, first.total]).toEqual([30, 2, 31]);
			expect((await workPage(db, work, { page: 2 })).reviews).toHaveLength(1);
			await db.prepare('UPDATE reviews SET hidden = 1').run();
			expect((await workPage(db, work, {})).total).toBe(0);
		}, 60_000);
	});
});

describe('トップで見せる作品', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;
	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
	});
	afterEach(() => dispose());

	const now = new Date('2026-11-19T00:00:00.000Z');

	it('表示中の作品がなければ null', async () => {
		expect(await featuredWork(db, now)).toBeNull();
		await addWork(db, { status: 'hidden' });
		expect(await featuredWork(db, now)).toBeNull();
	});

	it('直近7日の投稿がなければ、いちばん新しく登録された作品。非表示の作品は選ばない', async () => {
		const older = await addWork(db, { name: '古い作品' });
		const newer = await addWork(db, { name: '新しい作品' });
		const hidden = await addWork(db, { name: '隠した作品', status: 'hidden' });
		await db.prepare('UPDATE works SET created_at = ? WHERE id = ?').bind('2026-11-10T00:00:00.000Z', older).run();
		await db.prepare('UPDATE works SET created_at = ? WHERE id = ?').bind('2026-11-18T00:00:00.000Z', newer).run();
		await db.prepare('UPDATE works SET created_at = ? WHERE id = ?').bind('2026-11-19T00:00:00.000Z', hidden).run();
		expect(await featuredWork(db, now)).toMatchObject({ name: '新しい作品', nReviews: 0 });
	});

	it('直近7日に、いちばん多く投稿された作品。7日より前の投稿と、非表示のレビューは数えない', async () => {
		const quiet = await addWork(db, { name: '静かな作品' });
		const busy = await addWork(db, { name: '賑わう作品' });
		await db.prepare('UPDATE works SET created_at = ? WHERE id = ?').bind('2026-11-18T00:00:00.000Z', quiet).run();
		await db.prepare('UPDATE works SET created_at = ? WHERE id = ?').bind('2026-11-01T00:00:00.000Z', busy).run();
		await addReview(db, busy, { at: new Date('2026-11-18T12:00:00.000Z') });
		await addReview(db, busy, { at: new Date('2026-11-18T13:00:00.000Z') });
		await addReview(db, quiet, { at: new Date('2026-11-18T14:00:00.000Z') });
		await addReview(db, quiet, { at: new Date('2026-11-18T15:00:00.000Z'), hidden: true });
		await addReview(db, quiet, { at: new Date('2026-10-01T15:00:00.000Z') });
		expect(await featuredWork(db, now)).toMatchObject({ name: '賑わう作品', nReviews: 2 });
	});
});
