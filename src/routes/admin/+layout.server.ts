import { redirect } from '@sveltejs/kit';
import { runtimeEnv } from '#server/request';
import { ADMIN_COOKIE, isAdmin } from '#server/admin';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies, url }) => {
	const secret = runtimeEnv().ADMIN_TOKEN;
	const signedIn = await isAdmin(secret, cookies.get(ADMIN_COOKIE), new Date());
	if (url.pathname === '/admin/login') return { signedIn, configured: Boolean(secret) };
	if (!signedIn) redirect(303, '/admin/login');
	return { signedIn, configured: true };
};
