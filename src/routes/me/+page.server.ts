import { database, deviceFor } from '#server/request';
import { EDIT_MAX, EDIT_WINDOW_MS } from '#server/reviews';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, url }) => {
	const device = await deviceFor(cookies, url, false);
	if (!device) return { reviews: [] };
	const { results } = await database()
		.prepare(
			`SELECT w.slug AS slug, w.name AS name, r.written_on AS writtenOn, r.created_at AS createdAt, r.hidden AS hidden,
			        v.body AS body,
			        (SELECT COUNT(*) FROM review_revisions x WHERE x.review_id = r.id) AS revisions,
			        (SELECT rd.status FROM readings rd WHERE rd.revision_id = r.current_revision_id
			          ORDER BY (rd.status = 'ok') DESC, rd.updated_at DESC LIMIT 1) AS readStatus
			   FROM reviews r
			   JOIN reviewers p ON p.id = r.reviewer_id
			   JOIN works w ON w.id = r.work_id
			   JOIN review_revisions v ON v.id = r.current_revision_id
			  WHERE p.token_hash = ?
			  ORDER BY r.created_at DESC LIMIT 100`
		)
		.bind(device)
		.all<{ slug: string; name: string; writtenOn: string; createdAt: string; hidden: number; body: string; revisions: number; readStatus: string | null }>();
	const now = Date.now();
	return {
		reviews: results.map((r) => ({
			slug: r.slug,
			name: r.name,
			writtenOn: r.writtenOn,
			body: r.body,
			hidden: r.hidden === 1,
			read: r.readStatus === 'ok' ? 'ok' : r.readStatus === 'error' ? 'failed' : 'pending',
			canEdit: r.revisions - 1 < EDIT_MAX && now <= Date.parse(r.createdAt) + EDIT_WINDOW_MS
		}))
	};
};
