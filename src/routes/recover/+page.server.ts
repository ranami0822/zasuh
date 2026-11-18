import { fail } from '@sveltejs/kit';
import { AUTH_MESSAGES } from '#messages';
import { authConfigFor, requestRecovery } from '#server/auth';
import { mailerFrom } from '#server/mail';
import { database, runtimeEnv, senderHash } from '#server/request';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ emailEnabled: mailerFrom(runtimeEnv()) !== null });

export const actions: Actions = {
	send: async (event) => {
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '');
		const now = new Date();
		const result = await requestRecovery(
			database(),
			email,
			{ mailer: mailerFrom(runtimeEnv()), origin: (authConfigFor(event.url) ?? { origin: event.url.origin }).origin, ipHash: await senderHash(event, now) },
			now
		);
		if (!result.ok) return fail(400, { error: AUTH_MESSAGES[result.error], email });
		// 登録されたアドレスかどうかに関わらず、同じ応答にする。
		return { sent: true, email };
	}
};
