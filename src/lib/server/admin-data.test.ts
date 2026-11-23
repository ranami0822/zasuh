import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminOverview, reviewsForModeration, revisionsWithoutStars } from './admin-data';
import { ClefError } from './clef';
import { sendMessage } from './inbox';
import { MAX_ATTEMPTS, readRevision } from './reading';
import { closeReports, deleteReview, deviceTokenHash, reportReview, setHidden } from './reviews';
import { REGISTRY, type TagRegistry } from './tags';
import { addReview, addWork, createClock, createTestDb, editReview, fakeClef } from './testing/db';

describe('管理画面の集計と、通報の一覧', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;
	let clock: ReturnType<typeof createClock>;

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
		clock = createClock('2026-11-17T03:00:00.000Z');
	});
	afterEach(() => dispose());

	const read = (revisionId: string) => readRevision({ db, clef: fakeClef(), now: clock.now }, revisionId);
	const report = async (reviewId: string, reporter: string, reason = 'spam', note = '') =>
		reportReview(db, { reviewId, deviceHash: await deviceTokenHash(reporter), ipHash: null, reason, note }, clock.now());

	describe('adminOverview', () => {
		it('何もなければ、すべて 0', async () => {
			expect(await adminOverview(db)).toEqual({ works: [], pendingReadings: 0, failedReadings: 0, openReports: 0, openMessages: 0 });
		});

		it('作品を新しい順に並べ、作品ごとのレビュー数を数える（非表示も数える）', async () => {
			const older = await addWork(db, { name: '古い作品' });
			const newer = await addWork(db, { name: '新しい作品', category: 'software', status: 'hidden' });
			await db.prepare('UPDATE works SET created_at = ? WHERE id = ?').bind('2026-11-10T00:00:00.000Z', older).run();
			await db.prepare('UPDATE works SET created_at = ? WHERE id = ?').bind('2026-11-12T00:00:00.000Z', newer).run();
			await addReview(db, older, { body: 'a' });
			await addReview(db, older, { body: 'b', hidden: true });

			const { works } = await adminOverview(db);
			expect(works.map((w) => [w.name, w.category, w.status, w.reviews])).toEqual([
				['新しい作品', 'software', 'hidden', 0],
				['古い作品', 'game', 'active', 2]
			]);
		});

		it('読み取り待ちは、読めていない表示中のレビューだけ。読めた、または非表示のものは数えない', async () => {
			const work = await addWork(db);
			const unread = await addReview(db, work, { body: '{"gameplay":"positive"}' });
			const done = await addReview(db, work, { body: '{"gameplay":"positive"}' });
			await addReview(db, work, { body: '{}', hidden: true });
			await read(done.revisionId);

			const overview = await adminOverview(db);
			expect(overview.pendingReadings).toBe(1);
			await read(unread.revisionId);
			expect((await adminOverview(db)).pendingReadings).toBe(0);
		});

		it('失敗は、回数の上限に達した読み取りだけ数える。上限の手前なら、自動でやり直すので、数えない', async () => {
			const work = await addWork(db);
			const { revisionId } = await addReview(db, work, { body: '{"gameplay":"positive"}' });
			const failing = fakeClef(() => {
				throw new ClefError('down', false);
			});
			await readRevision({ db, clef: failing, now: clock.now }, revisionId);
			expect((await adminOverview(db)).failedReadings).toBe(0);

			await db.prepare("UPDATE readings SET status = 'error', attempts = ? WHERE revision_id = ?").bind(MAX_ATTEMPTS, revisionId).run();
			const overview = await adminOverview(db);
			expect(overview.failedReadings).toBe(1);
			expect(overview.pendingReadings).toBe(1); // 読めていないことには変わりない
		});

		it('古い版の失敗は数えない（最新の版だけを見る）', async () => {
			const work = await addWork(db);
			const { reviewId, revisionId } = await addReview(db, work, { body: '{"gameplay":"positive"}' });
			const failing = fakeClef(() => {
				throw new ClefError('down', false);
			});
			await readRevision({ db, clef: failing, now: clock.now }, revisionId);
			await db.prepare('UPDATE readings SET attempts = ? WHERE revision_id = ?').bind(MAX_ATTEMPTS, revisionId).run();
			expect((await adminOverview(db)).failedReadings).toBe(1);

			const next = await editReview(db, reviewId, '{"gameplay":"negative"}', clock.now());
			await read(next);
			expect((await adminOverview(db)).failedReadings).toBe(0);
		});

		it('開いた通報は、レビューの数で数える（同じレビューへの複数の通報は、1件）。閉じたら減る', async () => {
			const work = await addWork(db);
			const a = await addReview(db, work, { body: '{}' });
			const b = await addReview(db, work, { body: '{}' });
			await report(a.reviewId, 'x');
			await report(a.reviewId, 'y');
			await report(b.reviewId, 'x');
			expect((await adminOverview(db)).openReports).toBe(2);
			await closeReports(db, a.reviewId);
			expect((await adminOverview(db)).openReports).toBe(1);
		});

		it('未対応の受信箱の件数が入る', async () => {
			await sendMessage(
				db,
				{ kind: 'contact', body: 'お問い合わせの内容です', contact: '', workName: '', category: '', url: '', deviceHash: await deviceTokenHash('m'), ipHash: null },
				clock.now()
			);
			expect((await adminOverview(db)).openMessages).toBe(1);
		});
	});

	describe('revisionsWithoutStars', () => {
		// 星を入れる前の登録（ゲームの分野のタグが v1 = 向きと言及）。
		const v1Registry: TagRegistry = { ...REGISTRY, tags: REGISTRY.tags.filter((t) => t.version === 1) };
		const readV1 = (revisionId: string) => readRevision({ db, clef: fakeClef(), now: clock.now, registry: v1Registry }, revisionId);

		it('表示中のレビューの最新の版のうち、星の答えのある読み取りがないものだけを返す', async () => {
			const work = await addWork(db);
			const noStars = await addReview(db, work, { body: '{"gameplay":"positive"}', at: new Date('2026-11-10T00:00:00.000Z') });
			const unread = await addReview(db, work, { body: '{}', at: new Date('2026-11-11T00:00:00.000Z') });
			const withStars = await addReview(db, work, { body: '{"gameplay":"positive"}' });
			const hidden = await addReview(db, work, { body: '{}', hidden: true });
			const otherWork = await addReview(db, await addWork(db), { body: '{}' });
			await readV1(noStars.revisionId);
			await readV1(hidden.revisionId);
			await readV1(otherWork.revisionId);
			await read(withStars.revisionId);

			expect(await revisionsWithoutStars(db, work)).toEqual([noStars.revisionId, unread.revisionId]);
		});

		it('古い版に星があっても、最新の版に星がなければ返す', async () => {
			const work = await addWork(db);
			const { reviewId, revisionId } = await addReview(db, work, { body: '{"gameplay":"positive"}' });
			await read(revisionId);
			expect(await revisionsWithoutStars(db, work)).toEqual([]);

			const next = await editReview(db, reviewId, '{"gameplay":"negative"}', clock.now());
			await readV1(next);
			expect(await revisionsWithoutStars(db, work)).toEqual([next]);
		});
	});

	describe('reviewsForModeration', () => {
		it('通報のあるレビューに、開いた通報だけを付ける。作品名とスラッグも付く', async () => {
			const work = await addWork(db, { name: '星屑の鉄道' });
			const reported = await addReview(db, work, { body: '通報されるレビュー' });
			await addReview(db, work, { body: '通報されないレビュー' });
			await report(reported.reviewId, 'x', 'abuse', '  ひどい内容  ');
			await report(reported.reviewId, 'y', 'spam');

			const { reported: list, hidden } = await reviewsForModeration(db);
			expect(hidden).toEqual([]);
			expect(list).toHaveLength(1);
			expect(list[0]).toMatchObject({ id: reported.reviewId, workName: '星屑の鉄道', workSlug: work, body: '通報されるレビュー', hidden: false, duplicate: false, disclosure: 'none' });
			expect(list[0].reports.map((r) => [r.reason, r.note]).sort()).toEqual([['abuse', 'ひどい内容'], ['spam', null]]);
		});

		it('通報を閉じると、通報の一覧から消える。非表示にすると、非表示の一覧に出る（通報が閉じていても）', async () => {
			const work = await addWork(db);
			const { reviewId } = await addReview(db, work, { body: '内容' });
			await report(reviewId, 'x');
			await setHidden(db, reviewId, true, clock.now());
			await closeReports(db, reviewId);

			const { reported, hidden } = await reviewsForModeration(db);
			expect(reported).toEqual([]);
			expect(hidden.map((r) => r.id)).toEqual([reviewId]);
			expect(hidden[0]).toMatchObject({ hidden: true, reports: [] });

			await setHidden(db, reviewId, false, clock.now());
			expect((await reviewsForModeration(db)).hidden).toEqual([]);
		});

		it('文面がほぼ同じ、利害関係ありの印が出る', async () => {
			const work = await addWork(db);
			const original = await addReview(db, work, { body: '元のレビュー' });
			const copy = await addReview(db, work, { body: '写したレビュー', disclosure: 'developer' });
			await db.prepare('UPDATE reviews SET duplicate_of = ? WHERE id = ?').bind(original.reviewId, copy.reviewId).run();
			await report(copy.reviewId, 'x', 'conflict');
			const [row] = (await reviewsForModeration(db)).reported;
			expect(row).toMatchObject({ id: copy.reviewId, duplicate: true, disclosure: 'developer' });
		});

		it('削除したレビューは、どちらの一覧にも残らない（通報も一緒に消える）', async () => {
			const work = await addWork(db);
			const { reviewId } = await addReview(db, work, { body: '消すレビュー' });
			await report(reviewId, 'x');
			await deleteReview(db, reviewId, clock.now());
			expect(await reviewsForModeration(db)).toEqual({ reported: [], hidden: [] });
			expect((await adminOverview(db)).openReports).toBe(0);
		});
	});
});
