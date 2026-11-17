import { error, fail, redirect } from '@sveltejs/kit';
import { MESSAGES } from '#messages';
import { bindingClient } from '#server/clef';
import { readRevision } from '#server/reading';
import { database, deviceFor, runAfter } from '#server/request';
import { editReview, findOwnReview, todayJst } from '#server/reviews';
import { getWork } from '#server/works';
import type { Actions, PageServerLoad } from './$types';

async function context(event: { params: { slug: string }; platform: App.Platform | undefined; cookies: import('@sveltejs/kit').Cookies; url: URL }) {
	const db = database(event.platform);
	const work = await getWork(db, { slug: event.params.slug });
	if (!work || work.status !== 'active') error(404, '作品が見つかりません');
	const device = await deviceFor(event.cookies, event.url, false);
	return { db, work, device };
}

export const load: PageServerLoad = async (event) => {
	const { db, work, device } = await context(event);
	const now = new Date();
	const own = device ? await findOwnReview(db, work.id, device, now) : null;
	if (!own) redirect(303, `/works/${work.slug}`);
	return { work: { slug: work.slug, name: work.name }, own, today: todayJst(now) };
};

export const actions: Actions = {
	save: async (event) => {
		const { db, work, device } = await context(event);
		if (!device) redirect(303, `/works/${work.slug}`);
		const form = await event.request.formData();
		const text = (name: string) => String(form.get(name) ?? '');
		const values = {
			body: text('body'),
			writtenOn: text('writtenOn'),
			disclosure: text('disclosure') || 'none',
			disclosureNote: text('disclosureNote')
		};
		const result = await editReview(db, { workId: work.id, deviceHash: device, ...values }, new Date());
		if (!result.ok) return fail(400, { error: MESSAGES[result.error], values });
		if (result.revisionId && event.platform?.env?.AI) {
			runAfter(event.platform, readRevision({ db, clef: bindingClient(event.platform.env.AI) }, result.revisionId));
		}
		redirect(303, `/works/${work.slug}?done=edited`);
	}
};
