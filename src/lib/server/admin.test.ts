import { describe, expect, it } from 'vitest';
import { ADMIN_SESSION_MS, isAdmin, loginAdmin, safeEqual } from './admin';

const now = new Date('2026-11-17T00:00:00Z');

describe('管理の認証', () => {
	it('合言葉が合えば、印を渡す。印に合言葉は入らない', async () => {
		const cookie = (await loginAdmin('s3cret-token', 's3cret-token', now))!;
		expect(cookie).toBeTruthy();
		expect(cookie).not.toContain('s3cret');
		expect(await isAdmin('s3cret-token', cookie, now)).toBe(true);
	});

	it('合言葉が違う、または設定されていなければ、入れない', async () => {
		expect(await loginAdmin('s3cret-token', 'wrong', now)).toBeNull();
		expect(await loginAdmin('s3cret-token', '', now)).toBeNull();
		expect(await loginAdmin(undefined, 'anything', now)).toBeNull();
		expect(await loginAdmin('', '', now)).toBeNull();
		const cookie = (await loginAdmin('s3cret-token', 's3cret-token', now))!;
		expect(await isAdmin(undefined, cookie, now)).toBe(false);
	});

	it('期限切れ、改ざん、別の合言葉で作った印は、通らない', async () => {
		const cookie = (await loginAdmin('s3cret-token', 's3cret-token', now))!;
		expect(await isAdmin('s3cret-token', cookie, new Date(now.getTime() + ADMIN_SESSION_MS + 1))).toBe(false);
		const [expires, sig] = cookie.split('.');
		expect(await isAdmin('s3cret-token', `${Number(expires) + 99999999}.${sig}`, now)).toBe(false);
		expect(await isAdmin('s3cret-token', `${expires}.${sig.replace(/.$/, sig.endsWith('0') ? '1' : '0')}`, now)).toBe(false);
		expect(await isAdmin('another-token', cookie, now)).toBe(false);
		expect(await isAdmin('s3cret-token', undefined, now)).toBe(false);
		expect(await isAdmin('s3cret-token', 'garbage', now)).toBe(false);
	});

	it('比較: 同じ文字列だけが等しい', () => {
		expect(safeEqual('abc', 'abc')).toBe(true);
		expect(safeEqual('abc', 'abd')).toBe(false);
		expect(safeEqual('abc', 'abcd')).toBe(false);
		expect(safeEqual('', '')).toBe(true);
	});
});
