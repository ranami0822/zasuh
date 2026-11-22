import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRevision } from './reading';
import {
	closeReports,
	deleteReview,
	deviceTokenHash,
	editReview,
	ensureReviewer,
	EDIT_MAX,
	EDIT_WINDOW_MS,
	findOwnReview,
	ipDayHash,
	POSTS_PER_DEVICE_PER_DAY,
	postReview,
	reportReview,
	setHidden,
	todayJst,
	type PostInput
} from './reviews';
import { addWork, createClock, createTestDb, fakeClef } from './testing/db';

const LONG = '戦闘のテンポが良くて、敵の種類も豊富で飽きない。音楽も場面に合っていて、何度も遊びたくなる出来だった。';

describe('レビューの投稿・編集・通報・管理', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;
	let clock: ReturnType<typeof createClock>;
	let workId: string;

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
		clock = createClock('2026-11-17T03:00:00.000Z');
		workId = await addWork(db);
	});
	afterEach(() => dispose());

	const input = async (device: string, over: Partial<PostInput> = {}): Promise<PostInput> => ({
		workId,
		deviceHash: await deviceTokenHash(device),
		ipHash: null,
		body: '{"gameplay":"positive"}',
		disclosure: 'none',
		disclosureNote: '',
		...over
	});
	const post = async (device: string, over: Partial<PostInput> = {}) => postReview(db, await input(device, over), clock.now());
	const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
		expect(r.ok).toBe(true);
		return r as Extract<T, { ok: true }>;
	};
	const read = async (revisionId: string) => readRevision({ db, clef: fakeClef(), now: clock.now }, revisionId);
	const stats = async (tag = 'game/gameplay') =>
		(await db.prepare('SELECT n_mention FROM aspect_star_stats WHERE work_id = ? AND tag_id = ?').bind(workId, tag).first()) ?? { n_mention: 0 };

	describe('投稿者の行', () => {
		it('端末のハッシュごとに、投稿者を1人だけ作る。同じ端末なら、いつも同じ投稿者', async () => {
			const a = await deviceTokenHash('a');
			const first = await ensureReviewer(db, a, clock.now());
			expect(await ensureReviewer(db, a, clock.now())).toBe(first);
			expect(await ensureReviewer(db, await deviceTokenHash('b'), clock.now())).not.toBe(first);
			const row = await db.prepare("SELECT COUNT(*) AS n FROM reviewers WHERE token_hash = ? AND kind = 'anon'").bind(a).first();
			expect(row).toEqual({ n: 1 });
		});

		it('同時に呼んでも、投稿者は増えない', async () => {
			const a = await deviceTokenHash('race');
			const ids = await Promise.all([1, 2, 3, 4].map(() => ensureReviewer(db, a, clock.now())));
			expect(new Set(ids).size).toBe(1);
			expect(await db.prepare('SELECT COUNT(*) AS n FROM reviewers WHERE token_hash = ?').bind(a).first()).toEqual({ n: 1 });
		});
	});

	describe('投稿', () => {
		it('保存して、版を1つ作る。投稿者は端末のハッシュだけで、本文は前後の空白を除く', async () => {
			const r = must(await post('a', { body: '  {"gameplay":"positive"}  ' }));
			expect(r.duplicateOf).toBeNull();
			const row = await db
				.prepare('SELECT v.body AS body, r.source AS source, p.kind AS kind FROM reviews r JOIN review_revisions v ON v.id = r.current_revision_id JOIN reviewers p ON p.id = r.reviewer_id')
				.first();
			expect(row).toEqual({ body: '{"gameplay":"positive"}', source: 'site', kind: 'anon' });
		});

		it('入力を検証する: 短すぎる、長すぎる、利害関係、メモ、存在しない作品', async () => {
			expect(await post('a', { body: 'あ' })).toEqual({ ok: false, error: 'body_too_short' });
			expect(await post('a', { body: 'あ'.repeat(4001) })).toEqual({ ok: false, error: 'body_too_long' });
			expect(await post('a', { disclosure: 'friend' })).toEqual({ ok: false, error: 'bad_disclosure' });
			expect(await post('a', { disclosure: 'developer', disclosureNote: 'あ'.repeat(201) })).toEqual({ ok: false, error: 'note_too_long' });
			expect(await post('a', { workId: 'missing' })).toEqual({ ok: false, error: 'work_not_found' });
			expect(await db.prepare('SELECT COUNT(*) AS n FROM reviews').first()).toEqual({ n: 0 });
		});

		it('レビューの日付は、投稿した日（日本時間）で、サーバーが決める。投稿者は決められない', async () => {
			expect(todayJst(new Date('2026-11-17T20:00:00Z'))).toBe('2026-11-18');
			must(await postReview(db, { ...(await input('a')), writtenOn: '1999-01-01' } as PostInput, new Date('2026-11-17T20:00:00Z')));
			expect(await db.prepare('SELECT written_on AS d FROM reviews').first()).toEqual({ d: '2026-11-18' });
		});

		it('1つの作品に、1つの端末は1件。別の端末なら投稿できる。非表示の作品には投稿できない', async () => {
			must(await post('a'));
			expect(await post('a')).toEqual({ ok: false, error: 'already_posted' });
			must(await post('b'));
			const hidden = await addWork(db, { status: 'hidden' });
			expect(await post('c', { workId: hidden })).toEqual({ ok: false, error: 'work_not_found' });
		});

		it('端末ごとの1日の上限。24時間たつと、また投稿できる', async () => {
			for (let i = 0; i < POSTS_PER_DEVICE_PER_DAY; i++) must(await post('a', { workId: await addWork(db) }));
			expect(await post('a', { workId: await addWork(db) })).toEqual({ ok: false, error: 'device_limit' });
			clock.advance(24 * 3_600_000);
			must(await post('a', { workId: await addWork(db) }));
		});

		it('送信元ごとの1日の上限。送信元は、日ごとに変わるハッシュで数える', async () => {
			const ip = await ipDayHash('203.0.113.7', 'secret', clock.now());
			for (let i = 0; i < 10; i++) must(await post(`d${i}`, { ipHash: ip, workId: await addWork(db) }));
			expect(await post('d10', { ipHash: ip, workId: await addWork(db) })).toEqual({ ok: false, error: 'ip_limit' });
			const tomorrow = await ipDayHash('203.0.113.7', 'secret', new Date('2026-11-18T03:00:00Z'));
			expect(tomorrow).not.toBe(ip);
			expect(await ipDayHash('203.0.113.7', undefined, clock.now())).toBeNull();
			expect(ip).not.toContain('203.0.113.7');
		});
	});

	describe('文面がほぼ同じレビュー', () => {
		it('先にあるレビューとほぼ同じなら、印を付けて、集計に数えない。元のレビューは数える', async () => {
			const first = must(await post('a', { body: LONG }));
			clock.advance(60_000);
			const copy = must(await post('b', { body: LONG.replace('。', '！！ ').replace('音楽も', '音楽が') }));
			expect(copy.duplicateOf).toBe(first.reviewId);
			expect(must(await post('c', { body: 'ロード時間が長く、起動のたびに待たされる。操作の説明もなく、最初は何をすればよいか分からなかった' })).duplicateOf).toBeNull();
		});

		it('短い文は比べない。同じ人の複数の版は比べない', async () => {
			must(await post('a', { body: '敵の種類が豊富で飽きない' }));
			expect(must(await post('b', { body: '敵の種類が豊富で飽きない' })).duplicateOf).toBeNull();
		});

		it('元のレビューを削除すると、印が外れて、集計に数えられる', async () => {
			const first = must(await post('a', { body: LONG }));
			clock.advance(60_000);
			const copy = must(await post('b', { body: LONG }));
			expect(copy.duplicateOf).toBe(first.reviewId);
			await deleteReview(db, first.reviewId, clock.now());
			expect(await db.prepare('SELECT duplicate_of AS d FROM reviews WHERE id = ?').bind(copy.reviewId).first()).toEqual({ d: null });
		});

		it('集計: 印のあるレビューは、数えない', async () => {
			// 偽の Clef は本文を JSON と読むので、重複の判定に使う文面は、読み取りには使えない。ここでは印だけを直接付けて確かめる。
			const a = must(await post('a'));
			const b = must(await post('b', { body: '{"gameplay":"negative"}' }));
			await read(a.revisionId);
			await read(b.revisionId);
			expect(await stats()).toEqual({ n_mention: 2 });
			await db.prepare('UPDATE reviews SET duplicate_of = ? WHERE id = ?').bind(a.reviewId, b.reviewId).run();
			await setHidden(db, 'none', false, clock.now());
			const { recomputeWorkStats } = await import('./stats');
			await recomputeWorkStats(db, workId, clock.now());
			expect(await stats()).toEqual({ n_mention: 1 });
		});
	});

	describe('編集', () => {
		it('3回まで。そのたびに版が増え、最新の版が読まれる', async () => {
			const first = must(await post('a'));
			await read(first.revisionId);
			const dev = await deviceTokenHash('a');
			const edit = (body: string) => editReview(db, { workId, deviceHash: dev, body, disclosure: 'none', disclosureNote: '' }, clock.now());
			for (let i = 1; i <= EDIT_MAX; i++) {
				const r = must(await edit(`{"gameplay":"${i % 2 ? 'negative' : 'positive'}"}`));
				expect(r.revisionId).not.toBeNull();
			}
			expect(await edit('{"gameplay":"mixed"}')).toEqual({ ok: false, error: 'edit_limit' });
			const own = (await findOwnReview(db, workId, dev, clock.now()))!;
			expect(own).toMatchObject({ editsUsed: 3, editsLeft: 0, body: '{"gameplay":"negative"}' });
			const revisions = await db.prepare('SELECT COUNT(*) AS n FROM review_revisions').first();
			expect(revisions).toEqual({ n: 4 });
		});

		it('本文が同じで、利害関係だけを直した場合は、回数に数えず、読み直さない。日付は変わらない', async () => {
			const first = must(await post('a'));
			await read(first.revisionId);
			const dev = await deviceTokenHash('a');
			const r = must(await editReview(db, { workId, deviceHash: dev, body: '{"gameplay":"positive"}', disclosure: 'developer', disclosureNote: '開発元の者です' }, clock.now()));
			expect(r.revisionId).toBeNull();
			expect(await findOwnReview(db, workId, dev, clock.now())).toMatchObject({ editsUsed: 0, writtenOn: '2026-11-17', disclosure: 'developer', disclosureNote: '開発元の者です' });
			// 利害関係ありになったので、集計から外れる。
			expect(await stats()).toEqual({ n_mention: 0 });
		});

		it('7日を過ぎると編集できない。ほかの端末や、レビューのない端末は編集できない', async () => {
			must(await post('a'));
			const dev = await deviceTokenHash('a');
			const e = { workId, body: '{"gameplay":"negative"}', disclosure: 'none', disclosureNote: '' };
			expect(await editReview(db, { ...e, deviceHash: await deviceTokenHash('b') }, clock.now())).toEqual({ ok: false, error: 'not_found' });
			clock.advance(EDIT_WINDOW_MS + 1);
			expect(await editReview(db, { ...e, deviceHash: dev }, clock.now())).toEqual({ ok: false, error: 'edit_expired' });
			expect((await findOwnReview(db, workId, dev, clock.now()))!.expired).toBe(true);
		});

		it('編集で、先にあるレビューとほぼ同じになったら、印が付く。直せば外れる', async () => {
			const first = must(await post('a', { body: LONG }));
			clock.advance(60_000);
			must(await post('b', { body: 'ロード時間が長く、起動のたびに待たされる。操作の説明もなく、最初は何をすればよいか分からなかった' }));
			const dev = await deviceTokenHash('b');
			const e = (body: string) => editReview(db, { workId, deviceHash: dev, body, disclosure: 'none', disclosureNote: '' }, clock.now());
			must(await e(LONG));
			const dup = () => db.prepare('SELECT duplicate_of AS d FROM reviews WHERE reviewer_id = (SELECT id FROM reviewers WHERE token_hash = ?)').bind(dev).first();
			expect(await dup()).toEqual({ d: first.reviewId });
			must(await e('操作の説明がなく、最初は何をすればよいか分からなかった。ただ、慣れれば快適に遊べて、ロードも速い'));
			expect(await dup()).toEqual({ d: null });
		});
	});

	describe('通報', () => {
		const report = async (device: string, reviewId: string, reason = 'spam', ipHash: string | null = null) =>
			reportReview(db, { reviewId, deviceHash: await deviceTokenHash(device), ipHash, reason, note: '' }, clock.now());

		it('通報を保存する。同じ端末は、同じレビューを2回通報できない。理由の種類を検証する', async () => {
			const r = must(await post('a'));
			expect(await report('b', r.reviewId, 'bogus')).toEqual({ ok: false, error: 'bad_reason' });
			expect(await report('b', 'missing')).toEqual({ ok: false, error: 'not_found' });
			expect(await report('b', r.reviewId)).toEqual({ ok: true });
			expect(await report('b', r.reviewId)).toEqual({ ok: false, error: 'already_reported' });
			expect(await report('c', r.reviewId, 'abuse')).toEqual({ ok: true });
			expect(await db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").first()).toEqual({ n: 2 });
		});

		it('端末ごとの1日の上限', async () => {
			const ids = [];
			for (let i = 0; i < 21; i++) ids.push(must(await post(`w${i}`)).reviewId);
			for (let i = 0; i < 20; i++) expect(await report('x', ids[i])).toEqual({ ok: true });
			expect(await report('x', ids[20])).toEqual({ ok: false, error: 'device_limit' });
		}, 60_000);

		it('非表示にすると、集計から外れ、通報は残る。戻すと数えられる。通報を閉じられる', async () => {
			const r = must(await post('a'));
			await read(r.revisionId);
			await report('b', r.reviewId);
			expect(await stats()).toEqual({ n_mention: 1 });
			expect(await setHidden(db, r.reviewId, true, clock.now())).toBe(true);
			expect(await stats()).toEqual({ n_mention: 0 });
			expect(await report('c', r.reviewId)).toEqual({ ok: false, error: 'not_found' });
			await setHidden(db, r.reviewId, false, clock.now());
			expect(await stats()).toEqual({ n_mention: 1 });
			await closeReports(db, r.reviewId);
			expect(await db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").first()).toEqual({ n: 0 });
		});

		it('削除すると、レビュー、版、読み取り結果、通報が消えて、集計が直る', async () => {
			const r = must(await post('a'));
			const other = must(await post('b', { body: '{"gameplay":"negative"}' }));
			await read(r.revisionId);
			await read(other.revisionId);
			await report('c', r.reviewId);
			expect(await deleteReview(db, r.reviewId, clock.now())).toBe(true);
			expect(await deleteReview(db, r.reviewId, clock.now())).toBe(false);
			for (const t of ['reviews', 'review_revisions', 'readings', 'reports']) {
				const row = (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()) as { n: number };
				expect(row.n, t).toBe(t === 'reports' ? 0 : 1);
			}
			expect(await db.prepare('SELECT COUNT(*) AS n FROM reading_answers').first()).toEqual({ n: 8 });
			expect(await stats()).toEqual({ n_mention: 1 });
		});

		it('存在しないレビューへの、非表示・削除は、何もせずに false を返す', async () => {
			expect(await setHidden(db, 'missing', true, clock.now())).toBe(false);
			expect(await deleteReview(db, 'missing', clock.now())).toBe(false);
		});
	});
});
