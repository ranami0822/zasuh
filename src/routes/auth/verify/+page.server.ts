import { confirmEmail, checkEmailToken } from '#server/auth';
import { AUTH_MESSAGES } from '#messages';
import { database } from '#server/request';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/** リンクを開いただけでは、確認しない（メールの自動の確認に、先に開かれても、使い切らないよう、ボタンを押したときに確認する）。 */
export const load: PageServerLoad = async ({ url }) => {
	const token = url.searchParams.get('token') ?? '';
	return { token, valid: token !== '' && (await checkEmailToken(database(), token, 'verify', new Date())) };
};

export const actions: Actions = {
	confirm: async ({ request }) => {
		const form = await request.formData();
		const result = await confirmEmail(database(), String(form.get('token') ?? ''), new Date());
		if (!result.ok) return fail(400, { error: AUTH_MESSAGES[result.error] });
		return { confirmed: true };
	}
};
