import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setEnv, waitUntil } from '#server/testing/cloudflare-workers';

import { database, DEVICE_COOKIE, deviceFor, runAfter, senderHash, setDeviceCookie } from './request';
import { deviceTokenHash } from './reviews';

/** Cookie の入れ物の代わり。set の引数も控える。 */
function fakeCookies(initial: Record<string, string> = {}) {
	const jar = new Map(Object.entries(initial));
	const sets: { name: string; value: string; opts: Record<string, unknown> }[] = [];
	const cookies = {
		get: (name: string) => jar.get(name),
		set: (name: string, value: string, opts: Record<string, unknown>) => {
			jar.set(name, value);
			sets.push({ name, value, opts });
		}
	} as unknown as Cookies;
	return { cookies, sets };
}

const NOW = new Date('2026-11-17T03:00:00Z');

describe('リクエストの補助', () => {
	beforeEach(() => {
		setEnv({});
		waitUntil.mockReset();
	});

	describe('端末の Cookie', () => {
		it('https では Secure を付け、JS から読めず、1年残す', () => {
			const { cookies, sets } = fakeCookies();
			setDeviceCookie(cookies, new URL('https://review.anami.party/'), 'tok');
			expect(sets[0]).toMatchObject({ name: DEVICE_COOKIE, value: 'tok', opts: { path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 31_536_000 } });
		});

		it('http（ローカル）では Secure を付けない', () => {
			const { cookies, sets } = fakeCookies();
			setDeviceCookie(cookies, new URL('http://localhost:8787/'), 'tok');
			expect(sets[0].opts.secure).toBe(false);
		});

		it('Cookie があれば、そのハッシュを返す。新しくは作らない', async () => {
			const { cookies, sets } = fakeCookies({ [DEVICE_COOKIE]: 'existing' });
			expect(await deviceFor(cookies, new URL('https://x.test/'), true)).toBe(await deviceTokenHash('existing'));
			expect(sets).toHaveLength(0);
		});

		it('Cookie がなく、作らないなら、null', async () => {
			const { cookies, sets } = fakeCookies();
			expect(await deviceFor(cookies, new URL('https://x.test/'), false)).toBeNull();
			expect(sets).toHaveLength(0);
		});

		it('Cookie がなく、作るなら、推測されにくい値を作って、そのハッシュを返す', async () => {
			const { cookies, sets } = fakeCookies();
			const hash = await deviceFor(cookies, new URL('https://x.test/'), true);
			expect(sets).toHaveLength(1);
			const token = sets[0].value;
			expect(token).toMatch(/^[A-Za-z0-9]{40,}$/); // 32バイト分。URL や Cookie で扱いにくい記号は除く
			expect(hash).toBe(await deviceTokenHash(token));
			// 作り直すたびに、別の値になる
			const other = fakeCookies();
			await deviceFor(other.cookies, new URL('https://x.test/'), true);
			expect(other.sets[0].value).not.toBe(token);
		});
	});

	describe('送り主のハッシュ', () => {
		const event = (ip: string | (() => never)) => ({ getClientAddress: typeof ip === 'function' ? ip : () => ip });

		it('同じ IP・同じ日なら同じ値。IP か日が違えば別の値。IP そのものは含まない', async () => {
			setEnv({ ADMIN_TOKEN: 'secret' });
			const a = await senderHash(event('203.0.113.7'), NOW);
			expect(a).toBe(await senderHash(event('203.0.113.7'), NOW));
			expect(a).not.toBe(await senderHash(event('203.0.113.8'), NOW));
			expect(a).not.toBe(await senderHash(event('203.0.113.7'), new Date('2026-11-19T03:00:00Z')));
			expect(a).not.toContain('203.0.113.7');
		});

		it('IP が取れなければ、null（上限の判定は、端末だけで行う）', async () => {
			setEnv({ ADMIN_TOKEN: 'secret' });
			expect(
				await senderHash(
					event(() => {
						throw new Error('no address');
					}),
					NOW
				)
			).toBeNull();
		});
	});

	describe('データベースと、あとからの処理', () => {
		it('DB のバインディングがなければ、500', () => {
			expect(() => database()).toThrowError(expect.objectContaining({ status: 500 }));
		});

		it('DB のバインディングがあれば、それを返す', () => {
			const db = {};
			setEnv({ DB: db });
			expect(database()).toBe(db);
		});

		it('runAfter は、waitUntil に渡す。失敗しても、未処理の拒否にせず、記録だけ残す', async () => {
			const log = vi.spyOn(console, 'error').mockImplementation(() => {});
			runAfter(Promise.reject(new Error('boom')));
			expect(waitUntil).toHaveBeenCalledTimes(1);
			await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
			expect(log).toHaveBeenCalledWith(expect.stringContaining('background_failed'));
			log.mockRestore();
		});
	});
});
