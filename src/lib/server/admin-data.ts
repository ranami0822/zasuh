import type { D1Database } from '@cloudflare/workers-types';
import { openMessageCount } from './inbox';
import { MAX_ATTEMPTS } from './reading';

export interface AdminWork {
	id: string;
	slug: string;
	name: string;
	category: string;
	status: string;
	reviews: number;
}

export async function adminOverview(db: D1Database) {
	const [works, pending, failed, openReports, openMessages] = await Promise.all([
		db
			.prepare(
				`SELECT w.id AS id, w.slug AS slug, w.name AS name, w.category AS category, w.status AS status,
				        (SELECT COUNT(*) FROM reviews r WHERE r.work_id = w.id) AS reviews
				   FROM works w ORDER BY w.created_at DESC`
			)
			.all<AdminWork>(),
		db
			.prepare(
				`SELECT COUNT(*) AS n FROM reviews r
				  WHERE r.hidden = 0
				    AND NOT EXISTS (SELECT 1 FROM readings rd WHERE rd.revision_id = r.current_revision_id AND rd.status = 'ok')`
			)
			.first<{ n: number }>(),
		db
			.prepare(
				`SELECT COUNT(*) AS n FROM reviews r
				  WHERE EXISTS (SELECT 1 FROM readings rd WHERE rd.revision_id = r.current_revision_id AND rd.status = 'error' AND rd.attempts >= ?)`
			)
			.bind(MAX_ATTEMPTS)
			.first<{ n: number }>(),
		db.prepare("SELECT COUNT(DISTINCT review_id) AS n FROM reports WHERE status = 'open'").first<{ n: number }>(),
		openMessageCount(db)
	]);
	return {
		works: works.results,
		pendingReadings: pending?.n ?? 0,
		failedReadings: failed?.n ?? 0,
		openReports: openReports?.n ?? 0,
		openMessages
	};
}

export interface ReportedReview {
	id: string;
	workName: string;
	workSlug: string;
	body: string;
	hidden: boolean;
	disclosure: string;
	duplicate: boolean;
	reports: { reason: string; note: string | null; createdAt: string }[];
}

/** 通報のあるレビュー（開いた通報があるもの）と、非表示のレビュー。 */
export async function reviewsForModeration(db: D1Database): Promise<{ reported: ReportedReview[]; hidden: ReportedReview[] }> {
	const base = `SELECT r.id AS id, w.name AS workName, w.slug AS workSlug, v.body AS body, r.hidden AS hidden,
	                     r.disclosure AS disclosure, (r.duplicate_of IS NOT NULL) AS duplicate
	                FROM reviews r JOIN works w ON w.id = r.work_id JOIN review_revisions v ON v.id = r.current_revision_id`;
	type Row = Omit<ReportedReview, 'reports' | 'hidden' | 'duplicate'> & { hidden: number; duplicate: number };
	const [reported, hidden, reports] = await Promise.all([
		db
			.prepare(`${base} WHERE r.id IN (SELECT review_id FROM reports WHERE status = 'open') ORDER BY r.created_at DESC LIMIT 100`)
			.all<Row>(),
		db.prepare(`${base} WHERE r.hidden = 1 ORDER BY r.created_at DESC LIMIT 50`).all<Row>(),
		db
			.prepare("SELECT review_id AS reviewId, reason, note, created_at AS createdAt FROM reports WHERE status = 'open' ORDER BY created_at")
			.all<{ reviewId: string; reason: string; note: string | null; createdAt: string }>()
	]);
	const make = (r: Row): ReportedReview => ({
		...r,
		hidden: r.hidden === 1,
		duplicate: r.duplicate === 1,
		reports: reports.results.filter((x) => x.reviewId === r.id)
	});
	return { reported: reported.results.map(make), hidden: hidden.results.map(make) };
}
