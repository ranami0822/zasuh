import { fail } from '@sveltejs/kit';
import { INBOX_MESSAGES } from '#messages';
import { MESSAGE_KINDS, sendMessage } from '#server/inbox';
import { database, deviceFor, senderHash } from '#server/request';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const asked = url.searchParams.get('kind') ?? '';
	return { kind: (MESSAGE_KINDS as readonly string[]).includes(asked) ? asked : 'contact', sent: url.searchParams.get('sent') === '1' };
};

export const actions: Actions = {
	send: async (event) => {
		const form = await event.request.formData();
		const text = (name: string) => String(form.get(name) ?? '');
		const values = {
			kind: text('kind'),
			body: text('body'),
			contact: text('contact'),
			workName: text('workName'),
			category: text('category') || 'game',
			url: text('url')
		};
		const now = new Date();
		const result = await sendMessage(
			database(),
			{ ...values, deviceHash: (await deviceFor(event.cookies, event.url, true))!, ipHash: await senderHash(event, now) },
			now
		);
		if (!result.ok) return fail(400, { error: INBOX_MESSAGES[result.error], values });
		console.log(JSON.stringify({ event: 'message_sent', kind: values.kind }));
		return { sent: true, values: { ...values, body: '', workName: '', url: '' } };
	}
};
