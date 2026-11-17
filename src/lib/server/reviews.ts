import type { D1Database } from '@cloudflare/workers-types';
import { recomputeWorkStats } from './stats';
import {
	DUPLICATE_SCAN_LIMIT,
	DUPLICATE_THRESHOLD,
	jaccard,
	MIN_DUPLICATE_LENGTH,
	normalizeText,
	sha256Hex,
	shingles
} from './text';

export const BODY_MIN = 5;
export const BODY_MAX = 4000;
export const NOTE_MAX = 200;
export const EDIT_MAX = 3;
export const EDIT_WINDOW_MS = 7 * 24 * 3_600_000;
export const POSTS_PER_DEVICE_PER_DAY = 5;
export const POSTS_PER_IP_PER_DAY = 10;
export const REPORTS_PER_DEVICE_PER_DAY = 20;
export const REPORTS_PER_IP_PER_DAY = 40;
export const DISCLOSURES = ['none', 'developer', 'affiliated', 'other'] as const;
export type Disclosure = (typeof DISCLOSURES)[number];
export const REPORT_REASONS = ['abuse', 'spam', 'conflict', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const DAY_MS = 24 * 3_600_000;
const JST_OFFSET_MS = 9 * 3_600_000;

export type Failure =
	| 'work_not_found'
	| 'body_too_short'
	| 'body_too_long'
	| 'bad_date'
	| 'bad_disclosure'
	| 'note_too_long'
	| 'already_posted'
	| 'device_limit'
	| 'ip_limit'
	| 'not_found'
	| 'edit_limit'
	| 'edit_expired'
	| 'bad_reason'
	| 'already_reported';

export type Result<T> = ({ ok: true } & T) | { ok: false; error: Failure };

/** 日本時間の今日（YYYY-MM-DD）。 */
export function todayJst(now: Date): string {
	return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export async function deviceTokenHash(token: string): Promise<string> {
	return sha256Hex(`device:${token}`);
}

/** 送信元を、日ごとに変わる鍵でハッシュにする。IP そのものは保存しない。secret がなければ null（送信元の上限は働かない）。 */
export async function ipDayHash(ip: string | null, secret: string | undefined, now: Date): Promise<string | null> {
	if (!ip || !secret) return null;
	return sha256Hex(`ip:${secret}:${now.toISOString().slice(0, 10)}:${ip}`);
}

/** 端末のハッシュから、投稿者の行を取る。create が false なら、なければ null。 */
export async function findReviewer(db: D1Database, tokenHash: string): Promise<string | null> {
	const row = await db.prepare('SELECT id FROM reviewers WHERE token_hash = ?').bind(tokenHash).first<{ id: string }>();
	return row?.id ?? null;
}

async function ensureReviewer(db: D1Database, tokenHash: string, now: Date): Promise<string> {
	const existing = await findReviewer(db, tokenHash);
	if (existing) return existing;
	const id = crypto.randomUUID();
	await db
		.prepare("INSERT OR IGNORE INTO reviewers (id, kind, token_hash, created_at) VALUES (?, 'anon', ?, ?)")
		.bind(id, tokenHash, now.toISOString())
		.run();
	return (await findReviewer(db, tokenHash))!;
}

export interface PostInput {
	workId: string;
	deviceHash: string;
	ipHash: string | null;
	body: string;
	writtenOn: string;
	disclosure: string;
	disclosureNote: string;
}

function validateBody(body: string): Failure | null {
	const length = [...body.trim()].length;
	if (length < BODY_MIN) return 'body_too_short';
	if (length > BODY_MAX) return 'body_too_long';
	return null;
}

function validateDisclosure(disclosure: string, note: string): Failure | null {
	if (!(DISCLOSURES as readonly string[]).includes(disclosure)) return 'bad_disclosure';
	if ([...note].length > NOTE_MAX) return 'note_too_long';
	return null;
}

function validateDate(value: string, now: Date): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	// 2月31日のような、存在しない日付は、実在する日付に繰り上がるので、戻して一致するかを確かめる。
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
	return value >= '2000-01-01' && value <= todayJst(now);
}

/**
 * 同じ作品の、先に投稿された、別の投稿者のレビューのうち、文面がほぼ同じものを探す。
 * 見つかれば、そのレビューの id。ならした文面が短いものは、比べない。
 */
export async function findDuplicateOf(
	db: D1Database,
	opts: { workId: string; reviewerId: string; body: string; before: string; excludeReviewId?: string }
): Promise<string | null> {
	const mine = normalizeText(opts.body);
	if ([...mine].length < MIN_DUPLICATE_LENGTH) return null;
	const mineShingles = shingles(mine);
	const { results } = await db
		.prepare(
			`SELECT r.id AS id, v.body AS body
			   FROM reviews r
			   JOIN review_revisions v ON v.id = r.current_revision_id
			  WHERE r.work_id = ? AND r.reviewer_id != ? AND r.created_at < ? AND r.id != ?
			  ORDER BY r.created_at DESC
			  LIMIT ?`
		)
		.bind(opts.workId, opts.reviewerId, opts.before, opts.excludeReviewId ?? '', DUPLICATE_SCAN_LIMIT)
		.all<{ id: string; body: string }>();
	for (const row of results) {
		const other = normalizeText(row.body);
		if ([...other].length < MIN_DUPLICATE_LENGTH) continue;
		if (jaccard(mineShingles, shingles(other)) >= DUPLICATE_THRESHOLD) return row.id;
	}
	return null;
}

/** レビューを投稿する。読み取りは、呼び出した側が、保存のあとに始める。 */
export async function postReview(
	db: D1Database,
	input: PostInput,
	now: Date
): Promise<Result<{ reviewId: string; revisionId: string; duplicateOf: string | null }>> {
	const work = await db
		.prepare("SELECT id FROM works WHERE id = ? AND status = 'active'")
		.bind(input.workId)
		.first<{ id: string }>();
	if (!work) return { ok: false, error: 'work_not_found' };
	const bad = validateBody(input.body) ?? validateDisclosure(input.disclosure, input.disclosureNote);
	if (bad) return { ok: false, error: bad };
	if (!validateDate(input.writtenOn, now)) return { ok: false, error: 'bad_date' };

	const reviewerId = await ensureReviewer(db, input.deviceHash, now);
	const posted = await db
		.prepare('SELECT 1 AS x FROM reviews WHERE work_id = ? AND reviewer_id = ?')
		.bind(input.workId, reviewerId)
		.first();
	if (posted) return { ok: false, error: 'already_posted' };

	const since = new Date(now.getTime() - DAY_MS).toISOString();
	const device = await db
		.prepare('SELECT COUNT(*) AS n FROM reviews WHERE reviewer_id = ? AND created_at > ?')
		.bind(reviewerId, since)
		.first<{ n: number }>();
	if ((device?.n ?? 0) >= POSTS_PER_DEVICE_PER_DAY) return { ok: false, error: 'device_limit' };
	if (input.ipHash) {
		const ip = await db
			.prepare('SELECT COUNT(*) AS n FROM reviews WHERE ip_day_hash = ?')
			.bind(input.ipHash)
			.first<{ n: number }>();
		if ((ip?.n ?? 0) >= POSTS_PER_IP_PER_DAY) return { ok: false, error: 'ip_limit' };
	}

	const body = input.body.trim();
	const at = now.toISOString();
	const duplicateOf = await findDuplicateOf(db, { workId: input.workId, reviewerId, body, before: at });
	const reviewId = crypto.randomUUID();
	const revisionId = crypto.randomUUID();
	const note = input.disclosure === 'none' ? null : input.disclosureNote.trim() || null;
	try {
		await db.batch([
			db
				.prepare(
					`INSERT INTO reviews
					   (id, work_id, reviewer_id, current_revision_id, written_on, disclosure, disclosure_note,
					    source, text_hash, duplicate_of, ip_day_hash, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, 'site', ?, ?, ?, ?)`
				)
				.bind(
					reviewId,
					input.workId,
					reviewerId,
					revisionId,
					input.writtenOn,
					input.disclosure,
					note,
					await sha256Hex(normalizeText(body)),
					duplicateOf,
					input.ipHash,
					at
				),
			db
				.prepare('INSERT INTO review_revisions (id, review_id, body, created_at) VALUES (?, ?, ?, ?)')
				.bind(revisionId, reviewId, body, at)
		]);
	} catch {
		// 同じ端末の同時の2回目の送信（作品ごとに1人1件の制約）。
		return { ok: false, error: 'already_posted' };
	}
	return { ok: true, reviewId, revisionId, duplicateOf };
}

export interface OwnReview {
	reviewId: string;
	workId: string;
	body: string;
	writtenOn: string;
	disclosure: Disclosure;
	disclosureNote: string;
	editsUsed: number;
	editsLeft: number;
	editableUntil: string;
	expired: boolean;
}

/** 端末のハッシュに結びつく、その作品のレビュー。なければ null。 */
export async function findOwnReview(
	db: D1Database,
	workId: string,
	deviceHash: string,
	now: Date
): Promise<OwnReview | null> {
	const row = await db
		.prepare(
			`SELECT r.id AS reviewId, r.work_id AS workId, v.body AS body, r.written_on AS writtenOn,
			        r.disclosure AS disclosure, r.disclosure_note AS note, r.created_at AS createdAt,
			        (SELECT COUNT(*) FROM review_revisions x WHERE x.review_id = r.id) AS revisions
			   FROM reviews r
			   JOIN reviewers p ON p.id = r.reviewer_id
			   JOIN review_revisions v ON v.id = r.current_revision_id
			  WHERE r.work_id = ? AND p.token_hash = ?`
		)
		.bind(workId, deviceHash)
		.first<{
			reviewId: string;
			workId: string;
			body: string;
			writtenOn: string;
			disclosure: Disclosure;
			note: string | null;
			createdAt: string;
			revisions: number;
		}>();
	if (!row) return null;
	const until = new Date(Date.parse(row.createdAt) + EDIT_WINDOW_MS);
	const used = row.revisions - 1;
	return {
		reviewId: row.reviewId,
		workId: row.workId,
		body: row.body,
		writtenOn: row.writtenOn,
		disclosure: row.disclosure,
		disclosureNote: row.note ?? '',
		editsUsed: used,
		editsLeft: Math.max(0, EDIT_MAX - used),
		editableUntil: until.toISOString(),
		expired: now.getTime() > until.getTime()
	};
}

export interface EditInput {
	workId: string;
	deviceHash: string;
	body: string;
	writtenOn: string;
	disclosure: string;
	disclosureNote: string;
}

/** 自分のレビューを編集する（3回まで、投稿から7日以内）。新しい版を足して、最新の版にする。 */
export async function editReview(
	db: D1Database,
	input: EditInput,
	now: Date
): Promise<Result<{ reviewId: string; revisionId: string | null }>> {
	const own = await findOwnReview(db, input.workId, input.deviceHash, now);
	if (!own) return { ok: false, error: 'not_found' };
	if (own.expired) return { ok: false, error: 'edit_expired' };
	const bad = validateBody(input.body) ?? validateDisclosure(input.disclosure, input.disclosureNote);
	if (bad) return { ok: false, error: bad };
	if (!validateDate(input.writtenOn, now)) return { ok: false, error: 'bad_date' };

	const body = input.body.trim();
	const note = input.disclosure === 'none' ? null : input.disclosureNote.trim() || null;
	const bodyChanged = body !== own.body;
	if (bodyChanged && own.editsLeft <= 0) return { ok: false, error: 'edit_limit' };

	const meta = await db
		.prepare('SELECT reviewer_id AS reviewerId, created_at AS createdAt FROM reviews WHERE id = ?')
		.bind(own.reviewId)
		.first<{ reviewerId: string; createdAt: string }>();
	if (!meta) return { ok: false, error: 'not_found' };

	const duplicateOf = await findDuplicateOf(db, {
		workId: input.workId,
		reviewerId: meta.reviewerId,
		body,
		before: meta.createdAt,
		excludeReviewId: own.reviewId
	});
	const statements = [
		db
			.prepare(
				`UPDATE reviews SET written_on = ?, disclosure = ?, disclosure_note = ?, text_hash = ?, duplicate_of = ?
				  WHERE id = ?`
			)
			.bind(input.writtenOn, input.disclosure, note, await sha256Hex(normalizeText(body)), duplicateOf, own.reviewId)
	];
	let revisionId: string | null = null;
	if (bodyChanged) {
		revisionId = crypto.randomUUID();
		statements.push(
			db
				.prepare('INSERT INTO review_revisions (id, review_id, body, created_at) VALUES (?, ?, ?, ?)')
				.bind(revisionId, own.reviewId, body, now.toISOString()),
			db.prepare('UPDATE reviews SET current_revision_id = ? WHERE id = ?').bind(revisionId, own.reviewId)
		);
	}
	await db.batch(statements);
	await recomputeWorkStats(db, input.workId, now);
	return { ok: true, reviewId: own.reviewId, revisionId };
}

export async function reportReview(
	db: D1Database,
	input: { reviewId: string; deviceHash: string; ipHash: string | null; reason: string; note: string },
	now: Date
): Promise<Result<object>> {
	if (!(REPORT_REASONS as readonly string[]).includes(input.reason)) return { ok: false, error: 'bad_reason' };
	if ([...input.note].length > NOTE_MAX) return { ok: false, error: 'note_too_long' };
	const exists = await db
		.prepare('SELECT 1 AS x FROM reviews WHERE id = ? AND hidden = 0')
		.bind(input.reviewId)
		.first();
	if (!exists) return { ok: false, error: 'not_found' };

	const reporterId = await ensureReviewer(db, input.deviceHash, now);
	const already = await db
		.prepare('SELECT 1 AS x FROM reports WHERE review_id = ? AND reporter_id = ?')
		.bind(input.reviewId, reporterId)
		.first();
	if (already) return { ok: false, error: 'already_reported' };

	const since = new Date(now.getTime() - DAY_MS).toISOString();
	const device = await db
		.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?')
		.bind(reporterId, since)
		.first<{ n: number }>();
	if ((device?.n ?? 0) >= REPORTS_PER_DEVICE_PER_DAY) return { ok: false, error: 'device_limit' };
	if (input.ipHash) {
		const ip = await db
			.prepare('SELECT COUNT(*) AS n FROM reports WHERE ip_day_hash = ?')
			.bind(input.ipHash)
			.first<{ n: number }>();
		if ((ip?.n ?? 0) >= REPORTS_PER_IP_PER_DAY) return { ok: false, error: 'ip_limit' };
	}
	await db
		.prepare(
			'INSERT INTO reports (id, review_id, reporter_id, reason, note, ip_day_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
		)
		.bind(crypto.randomUUID(), input.reviewId, reporterId, input.reason, input.note.trim() || null, input.ipHash, now.toISOString())
		.run();
	return { ok: true };
}

// --- 管理（オーナー） ---

async function workOf(db: D1Database, reviewId: string): Promise<string | null> {
	const row = await db.prepare('SELECT work_id AS workId FROM reviews WHERE id = ?').bind(reviewId).first<{ workId: string }>();
	return row?.workId ?? null;
}

/** 非表示にする、または戻す。集計を作り直す。 */
export async function setHidden(db: D1Database, reviewId: string, hidden: boolean, now: Date): Promise<boolean> {
	const workId = await workOf(db, reviewId);
	if (!workId) return false;
	await db.prepare('UPDATE reviews SET hidden = ? WHERE id = ?').bind(hidden ? 1 : 0, reviewId).run();
	await recomputeWorkStats(db, workId, now);
	return true;
}

/** レビューと、その版・読み取り結果・通報を、すべて消す。戻せない。このレビューと文面がほぼ同じとされていたものは、印を外す。 */
export async function deleteReview(db: D1Database, reviewId: string, now: Date): Promise<boolean> {
	const workId = await workOf(db, reviewId);
	if (!workId) return false;
	await db.batch([
		db.prepare('UPDATE reviews SET duplicate_of = NULL WHERE duplicate_of = ?').bind(reviewId),
		db
			.prepare(
				`DELETE FROM reading_answers WHERE reading_id IN (
				   SELECT rd.id FROM readings rd JOIN review_revisions v ON v.id = rd.revision_id WHERE v.review_id = ?)`
			)
			.bind(reviewId),
		db
			.prepare('DELETE FROM readings WHERE revision_id IN (SELECT id FROM review_revisions WHERE review_id = ?)')
			.bind(reviewId),
		db.prepare('DELETE FROM reports WHERE review_id = ?').bind(reviewId),
		db.prepare('DELETE FROM review_revisions WHERE review_id = ?').bind(reviewId),
		db.prepare('DELETE FROM reviews WHERE id = ?').bind(reviewId)
	]);
	await recomputeWorkStats(db, workId, now);
	return true;
}

export async function closeReports(db: D1Database, reviewId: string): Promise<void> {
	await db.prepare("UPDATE reports SET status = 'closed' WHERE review_id = ?").bind(reviewId).run();
}
