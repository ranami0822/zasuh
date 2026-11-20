import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env, setEnv } from '#server/testing/cloudflare-workers';

import { AUTH_MESSAGES } from '#messages';
import { authContext, failure, success } from './auth-request';
import { DEVICE_COOKIE } from './request';
import { deviceTokenHash } from './reviews';

const ORIGIN = 'https://review.anami.party';

function event(opts: { url?: string; origin?: string | null; cookie?: string } = {}) {
	const url = new URL(opts.url ?? `${ORIGIN}/auth/login/options`);
	const headers = new Headers();
	if (opts.origin !== null) headers.set('origin', opts.origin ?? ORIGIN);
	const sets: string[] = [];
	const cookies = {
		get: (name: string) => (name === DEVICE_COOKIE ? opts.cookie : undefined),
		set: (_: string, value: string) => void sets.push(value)
	} as unknown as Cookies;
	return { event: { request: new Request(url, { method: 'POST', headers }), url, cookies }, sets };
}

const status = async (promise: Promise<unknown>) => ((await promise.catch((e) => e)) as { status?: number }).status;

describe('ログインの JSON の要求の入口', () => {
	beforeEach(() => {
		setEnv({ DB: {} });
	});

	it('許したホスト名で、Origin が同じなら、設定と端末のハッシュを返す', async () => {
		const ctx = await authContext(event({ cookie: 'tok' }).event);
		expect(ctx.cfg).toEqual({ rpID: 'review.anami.party', rpName: 'Zasuh', origin: ORIGIN });
		expect(ctx.device).toBe(await deviceTokenHash('tok'));
		expect(ctx.db).toBe(env.DB);
	});

	it('許していないホスト名は、400（別のドメインで、パスキーを使わせない）', async () => {
		expect(await status(authContext(event({ url: 'https://evil.example/auth/login/options', origin: 'https://evil.example' }).event))).toBe(400);
	});

	it('Origin がない、または違うなら、403', async () => {
		expect(await status(authContext(event({ origin: null }).event))).toBe(403);
		expect(await status(authContext(event({ origin: 'https://evil.example' }).event))).toBe(403);
		expect(await status(authContext(event({ origin: 'http://review.anami.party' }).event))).toBe(403); // 方式が違う
	});

	it('localhost は、ポートが変わっても通す（wrangler dev）', async () => {
		const url = 'http://localhost:8788/auth/login/options';
		const ctx = await authContext(event({ url, origin: 'http://localhost:8788' }).event);
		expect(ctx.cfg.origin).toBe('http://localhost:8788');
		expect(await status(authContext(event({ url, origin: 'http://localhost:8787' }).event))).toBe(403);
	});

	it('create を指定したときだけ、Cookie がなければ作る', async () => {
		const without = event();
		expect((await authContext(without.event)).device).toBeNull();
		expect(without.sets).toHaveLength(0);

		const withCreate = event();
		expect((await authContext(withCreate.event, { create: true })).device).not.toBeNull();
		expect(withCreate.sets).toHaveLength(1);
	});

	it('失敗の応答は、コードと文を持ち、キャッシュさせない。成功の応答も同じ', async () => {
		const bad = failure('bad_code');
		expect(bad.status).toBe(400);
		expect(bad.headers.get('cache-control')).toBe('no-store');
		expect(await bad.json()).toEqual({ ok: false, error: 'bad_code', message: AUTH_MESSAGES.bad_code });
		expect(failure('stepup_required', 403).status).toBe(403);

		const ok = success({ n: 1 });
		expect(ok.status).toBe(200);
		expect(ok.headers.get('cache-control')).toBe('no-store');
		expect(await ok.json()).toEqual({ ok: true, n: 1 });
		expect(await success().json()).toEqual({ ok: true });
	});
});
