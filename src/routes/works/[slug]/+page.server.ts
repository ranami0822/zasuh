import type { CriticPane } from '#critic-pane';
import { error, fail, redirect } from '@sveltejs/kit';
import { bandFor } from '#band';
import { MESSAGES } from '#messages';
import { workPage } from '#server/pages';
import { shareMeta } from '#server/share';
import { readRevision } from '#server/reading';
import { bindingClient } from '#server/clef';
import { database, deviceFor, runAfter, runtimeEnv, senderHash } from '#server/request';
import { findOwnReview, postReview, reportReview } from '#server/reviews';
import { getWork } from '#server/works';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, cookies }) => {
	const db = database();
	const work = await getWork(db, { slug: params.slug });
	if (!work || work.status !== 'active') error(404, '作品が見つかりません');
	const now = new Date();
	const asked = url.searchParams.get('t');
	const page = Number(url.searchParams.get('p') ?? '1');
	const data = await workPage(db, work, { tag: asked ?? undefined, page: Number.isFinite(page) ? page : 1 });
	const tag = data.tags.some((t) => t.tagId === asked) ? asked : null;
	const view = tag === asked ? data : await workPage(db, work, { page: 1 });
	const device = await deviceFor(cookies, url, false);
	const own = device ? await findOwnReview(db, work.id, device, now) : null;
	return {
		...view,
		tag,
		/** 作品ごとの帯の色（指定がなければ null で、既定の灰色）。 */
		band: work.bandFrom && work.bandTo ? bandFor(work.bandFrom, work.bandTo) : null,
		own: own ? { editsLeft: own.editsLeft, expired: own.expired } : null,
		done: url.searchParams.get('done'),
		share: shareMeta({ slug: work.slug, overall: data.overall }, url.origin),
		/** 専門家の欄のデータ。専門家のレビューがない作品は null（欄ごと出さない）。 */
		criticPane: null as CriticPane | null
	};
};

const text = (form: FormData, name: string) => String(form.get(name) ?? '');

export const actions: Actions = {
	post: async (event) => {
		const { request, params, cookies, url } = event;
		const db = database();
		const work = await getWork(db, { slug: params.slug });
		if (!work) error(404, '作品が見つかりません');
		const form = await request.formData();
		const values = {
			body: text(form, 'body'),
			disclosure: text(form, 'disclosure') || 'none',
			disclosureNote: text(form, 'disclosureNote')
		};
		const now = new Date();
		const result = await postReview(
			db,
			{
				workId: work.id,
				deviceHash: (await deviceFor(cookies, url, true))!,
				ipHash: await senderHash(event, now),
				...values
			},
			now
		);
		if (!result.ok) return fail(400, { form: 'post' as const, error: MESSAGES[result.error], values });
		if (runtimeEnv().AI) {
			runAfter(readRevision({ db, clef: bindingClient(runtimeEnv().AI) }, result.revisionId));
		}
		console.log(JSON.stringify({ event: 'review_posted', work: work.slug, duplicate: result.duplicateOf !== null }));
		redirect(303, `/works/${work.slug}?done=posted`);
	},

	report: async (event) => {
		const { request, params, cookies, url } = event;
		const db = database();
		const form = await request.formData();
		const reviewId = text(form, 'reviewId');
		const now = new Date();
		const result = await reportReview(
			db,
			{
				reviewId,
				deviceHash: (await deviceFor(cookies, url, true))!,
				ipHash: await senderHash(event, now),
				reason: text(form, 'reason'),
				note: text(form, 'note')
			},
			now
		);
		if (!result.ok) return fail(400, { form: 'report' as const, reviewId, error: MESSAGES[result.error] });
		console.log(JSON.stringify({ event: 'review_reported', work: params.slug }));
		return { form: 'report' as const, reviewId, reported: true };
	}
};

