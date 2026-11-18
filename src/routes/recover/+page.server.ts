import { fail, redirect } from '@sveltejs/kit';
import { AUTH_MESSAGES } from '#messages';
import { authConfigFor, redeemRecoveryCode, requestRecovery } from '#server/auth';
import { mailerFrom } from '#server/mail';
import { database, runtimeEnv, senderHash } from '#server/request';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ emailEnabled: mailerFrom(runtimeEnv()) !== null });

export const actions: Actions = {
	code: async (event) => {
		const form = await event.request.formData();
		const code = String(form.get('code') ?? '');
		const result = await redeemRecoveryCode(database(), code, await senderHash(event, new Date()), new Date());
		if (!result.ok) return fail(400, { error: AUTH_MESSAGES[result.error], form: 'code' as const });
		redirect(303, `/recover/${result.token}`);
	},

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
		if (!result.ok) return fail(400, { error: AUTH_MESSAGES[result.error], email, form: 'email' as const });
		// 登録されたアドレスかどうかに関わらず、同じ応答にする。
		return { sent: true, email, form: 'email' as const };
	}
};
