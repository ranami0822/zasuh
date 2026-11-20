import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setEnv } from '#server/testing/cloudflare-workers';

import { ADMIN_COOKIE, loginAdmin } from '#server/admin';
import { handle } from './hooks.server';

const SECRET = 'test-secret';

/** handle に渡す最小のイベント。resolve は、呼ばれたかどうかを控える。 */
async function run(path: string, opts: { method?: string; cookie?: string } = {}) {
	const resolve = vi.fn(async () => new Response('ok'));
	const event = {
		url: new URL(`https://review.anami.party${path}`),
		request: new Request(`https://review.anami.party${path}`, { method: opts.method ?? 'GET' }),
		cookies: { get: (name: string) => (name === ADMIN_COOKIE ? opts.cookie : undefined) }
	};
	try {
		const response = await handle({ event, resolve } as never);
		return { response, resolve, redirect: null as null | { status: number; location: string } };
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (r.location) return { response: null, resolve, redirect: { status: r.status!, location: r.location } };
		throw e;
	}
}

describe('/admin の守り', () => {
	let signedIn: string;
	beforeEach(async () => {
		setEnv({ ADMIN_TOKEN: SECRET });
		signedIn = (await loginAdmin(SECRET, SECRET, new Date()))!;
	});

	it('ログインしていなければ、GET は /admin/login へ。ページの処理は、呼ばれない', async () => {
		for (const path of ['/admin', '/admin/', '/admin/works/x', '/admin/reviews']) {
			const r = await run(path);
			expect(r.redirect, path).toEqual({ status: 303, location: '/admin/login' });
			expect(r.resolve, path).not.toHaveBeenCalled();
		}
	});

	it('ログインしていなければ、フォームの送信（POST など）は、403。処理は、呼ばれない', async () => {
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			const r = await run('/admin/works?/create', { method });
			expect(r.response!.status, method).toBe(403);
			expect(r.resolve, method).not.toHaveBeenCalled();
		}
	});

	it('合言葉が設定されていなければ、だれも入れない', async () => {
		setEnv({});
		const r = await run('/admin', { cookie: signedIn });
		expect(r.redirect?.location).toBe('/admin/login');
	});

	it('改ざんした印、別の合言葉で作った印は、通らない', async () => {
		const bad = signedIn.replace(/.$/, signedIn.endsWith('0') ? '1' : '0');
		expect((await run('/admin', { cookie: bad })).redirect?.status).toBe(303);
		const other = (await loginAdmin('another', 'another', new Date()))!;
		expect((await run('/admin', { cookie: other })).redirect?.status).toBe(303);
		expect((await run('/admin', { method: 'POST', cookie: 'garbage' })).response!.status).toBe(403);
	});

	it('ログイン済みなら、通す。キャッシュさせない', async () => {
		const r = await run('/admin/works', { cookie: signedIn });
		expect(r.resolve).toHaveBeenCalledTimes(1);
		expect(r.response!.headers.get('cache-control')).toBe('no-store');
		const post = await run('/admin/works?/create', { method: 'POST', cookie: signedIn });
		expect(post.resolve).toHaveBeenCalledTimes(1);
	});

	it('/admin/login は、ログインなしで開ける（ログインのため）', async () => {
		const r = await run('/admin/login');
		expect(r.resolve).toHaveBeenCalledTimes(1);
		expect(r.response!.headers.get('cache-control')).toBe('no-store');
		expect((await run('/admin/login', { method: 'POST' })).resolve).toHaveBeenCalledTimes(1);
	});

	it('/admin に似た別のパスは、守りの対象にしない（/administrator、/adminx）', async () => {
		for (const path of ['/administrator', '/adminx', '/works/admin']) {
			const r = await run(path);
			expect(r.resolve, path).toHaveBeenCalledTimes(1);
			expect(r.response!.headers.get('cache-control'), path).toBeNull();
		}
	});

	it('どの応答にも、安全のためのヘッダーを付ける', async () => {
		for (const path of ['/', '/works/x', '/admin/login']) {
			const { response } = await run(path);
			expect(response!.headers.get('x-content-type-options'), path).toBe('nosniff');
			expect(response!.headers.get('x-frame-options'), path).toBe('DENY');
			expect(response!.headers.get('referrer-policy'), path).toBe('strict-origin-when-cross-origin');
		}
	});

	it('ログインしていない人に見せる 403 の本文に、合言葉や署名は入らない', async () => {
		const r = await run('/admin/works', { method: 'POST' });
		const text = await r.response!.text();
		expect(text).not.toContain(SECRET);
	});
});
