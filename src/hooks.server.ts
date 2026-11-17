import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { ADMIN_COOKIE, isAdmin } from '#server/admin';
import { runtimeEnv } from '#server/request';

/**
 * /admin の下は、ログインしたオーナーだけ。
 * ページの load ではなく、ここで確かめる。フォームの処理（actions）は、レイアウトの load を通らずに、直接呼べるため。
 * /admin/login だけは、ログインのために開ける。
 */
export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	const inAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
	if (inAdmin && pathname !== '/admin/login') {
		const signedIn = await isAdmin(runtimeEnv().ADMIN_TOKEN, event.cookies.get(ADMIN_COOKIE), new Date());
		if (!signedIn) {
			if (event.request.method === 'GET' || event.request.method === 'HEAD') redirect(303, '/admin/login');
			return new Response('ログインが必要です', { status: 403 });
		}
	}

	const response = await resolve(event);
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('x-frame-options', 'DENY');
	response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	if (inAdmin) response.headers.set('cache-control', 'no-store');
	return response;
};
