import { fail } from '@sveltejs/kit';
import { listMessages, setMessageStatus } from '#server/inbox';
import { database } from '#server/request';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const kind = url.searchParams.get('kind') ?? '';
	return { kind, items: await listMessages(database(), { kind }) };
};

export const actions: Actions = {
	status: async ({ request }) => {
		const form = await request.formData();
		const ok = await setMessageStatus(database(), String(form.get('id') ?? ''), form.get('status') === 'open' ? 'open' : 'closed');
		if (!ok) return fail(400, { error: '操作できませんでした。ページを開き直してください。' });
		return { ok: true };
	}
};
