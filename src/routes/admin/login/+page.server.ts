import { fail, redirect } from '@sveltejs/kit';
import { ADMIN_COOKIE, ADMIN_SESSION_MS, loginAdmin } from '#server/admin';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { signedIn } = await parent();
	if (signedIn) redirect(303, '/admin');
};

export const actions: Actions = {
	login: async ({ request, cookies, platform, url }) => {
		const form = await request.formData();
		const session = await loginAdmin(platform?.env?.ADMIN_TOKEN, String(form.get('token') ?? ''), new Date());
		if (!session) return fail(400, { error: '合言葉が合いません。もう一度入力してください。' });
		cookies.set(ADMIN_COOKIE, session, {
			path: '/admin',
			httpOnly: true,
			sameSite: 'strict',
			secure: url.protocol === 'https:',
			maxAge: ADMIN_SESSION_MS / 1000
		});
		redirect(303, '/admin');
	},
	logout: async ({ cookies }) => {
		cookies.delete(ADMIN_COOKIE, { path: '/admin' });
		redirect(303, '/admin/login');
	}
};
