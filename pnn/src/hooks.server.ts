import type { Handle } from '@sveltejs/kit/hooks';
import { viewerFromToken } from './lib/server/auth';
import { env } from './lib/server/http';

import { SESSION_COOKIE } from './lib/server/webauthn';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.viewer = null;
	const { pathname } = event.url;
	if (pathname.startsWith('/api/')) {
		// 別のサイトからの書き込みを拒む（Origin が付いていて、違うとき）
		const origin = event.request.headers.get('origin');
		if (event.request.method !== 'GET' && origin && origin !== event.url.origin) {
			return new Response('forbidden', { status: 403 });
		}
		const e = env();
		event.locals.viewer = await viewerFromToken(e.DB, e.PNN_SECRET, event.cookies.get(SESSION_COOKIE), Date.now());
	}
	const res = await resolve(event);
	if (pathname.startsWith('/api/')) res.headers.set('cache-control', 'no-store');
	return res;
};
