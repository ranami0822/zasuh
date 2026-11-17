import { fail } from '@sveltejs/kit';
import { reviewsForModeration } from '#server/admin-data';
import { database } from '#server/request';
import { closeReports, deleteReview, setHidden } from '#server/reviews';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => reviewsForModeration(database(platform));

export const actions: Actions = {
	act: async ({ request, platform }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const op = String(form.get('op') ?? '');
		const db = database(platform);
		const now = new Date();
		let done = false;
		if (op === 'hide') done = await setHidden(db, id, true, now);
		else if (op === 'show') done = await setHidden(db, id, false, now);
		else if (op === 'delete') done = await deleteReview(db, id, now);
		else if (op === 'close') {
			await closeReports(db, id);
			done = true;
		}
		if (!done) return fail(400, { error: '操作できませんでした。ページを開き直してください。' });
		return { ok: true };
	}
};
