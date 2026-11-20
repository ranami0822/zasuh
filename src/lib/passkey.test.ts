import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const webauthn = vi.hoisted(() => ({
	startRegistration: vi.fn(),
	startAuthentication: vi.fn(),
	browserSupportsWebAuthn: vi.fn()
}));
vi.mock('@simplewebauthn/browser', () => webauthn);

import { handOffRecoveryCode, loginWithPasskey, registerPasskey, stepupWithPasskey, supportsPasskeys, takeRecoveryCode } from './passkey';

/** サーバーの応答を、URL ごとに決める fetch。呼び出しも控える。 */
function stubFetch(routes: Record<string, { ok?: boolean; body?: unknown; raw?: string }>) {
	const calls: { url: string; body: unknown }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			calls.push({ url, body: init.body ? JSON.parse(init.body as string) : undefined });
			const route = routes[url];
			if (!route) throw new Error(`unexpected request: ${url}`);
			return new Response(route.raw ?? JSON.stringify(route.body ?? {}), { status: route.ok === false ? 400 : 200 });
		})
	);
	return calls;
}

const domError = (name: string) => Object.assign(new Error(name), { name });

describe('パスキーの、ブラウザ側の呼び出し', () => {
	beforeEach(() => {
		webauthn.startRegistration.mockReset();
		webauthn.startAuthentication.mockReset();
	});
	afterEach(() => vi.unstubAllGlobals());

	describe('ログイン', () => {
		it('オプションを取り、ブラウザの確認を経て、結果をサーバーに送る', async () => {
			const calls = stubFetch({
				'/auth/login/options': { body: { challenge: 'c' } },
				'/auth/login/verify': { body: { ok: true, next: '/me' } }
			});
			webauthn.startAuthentication.mockResolvedValue({ id: 'cred' });

			expect(await loginWithPasskey()).toEqual({ ok: true, data: { ok: true, next: '/me' } });
			expect(webauthn.startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'c' } });
			expect(calls.map((c) => c.url)).toEqual(['/auth/login/options', '/auth/login/verify']);
			expect(calls[1].body).toEqual({ response: { id: 'cred' } });
		});

		it('オプションの取得に失敗したら、サーバーの文を返す。ブラウザの確認は、開かない', async () => {
			stubFetch({ '/auth/login/options': { ok: false, body: { message: 'このアドレスでは、ログインを使えません。' } } });
			expect(await loginWithPasskey()).toEqual({ ok: false, message: 'このアドレスでは、ログインを使えません。' });
			expect(webauthn.startAuthentication).not.toHaveBeenCalled();
		});

		it('検証に失敗したら、サーバーの文を返す。文がなければ、決まった文を返す', async () => {
			stubFetch({ '/auth/login/options': { body: {} }, '/auth/login/verify': { ok: false, body: { message: '確認に失敗しました。' } } });
			webauthn.startAuthentication.mockResolvedValue({});
			expect(await loginWithPasskey()).toEqual({ ok: false, message: '確認に失敗しました。' });

			stubFetch({ '/auth/login/options': { body: {} }, '/auth/login/verify': { ok: false, raw: '<html>502</html>' } });
			expect(await loginWithPasskey()).toEqual({ ok: false, message: '失敗しました。もう一度、やり直してください。' });
		});

		it('利用者が確認画面を閉じたら（NotAllowedError）、キャンセルとして、静かに戻す', async () => {
			stubFetch({ '/auth/login/options': { body: {} } });
			webauthn.startAuthentication.mockRejectedValue(domError('NotAllowedError'));
			expect(await loginWithPasskey()).toEqual({ ok: false, message: 'キャンセルされました。' });
		});

		it('そのほかのエラーは、ブラウザの設定を確かめるよう案内する。通信の失敗も、例外にしない', async () => {
			stubFetch({ '/auth/login/options': { body: {} } });
			webauthn.startAuthentication.mockRejectedValue(new Error('boom'));
			const result = await loginWithPasskey();
			expect(result.ok).toBe(false);
			expect((result as { message: string }).message).toContain('ブラウザの設定');

			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
			expect((await loginWithPasskey()).ok).toBe(false);
		});
	});

	describe('登録', () => {
		it('既定の URL で登録する。ラベルも送る', async () => {
			const calls = stubFetch({ '/auth/register/options': { body: { challenge: 'r' } }, '/auth/register/verify': { body: { ok: true, recoveryCode: 'ABCD' } } });
			webauthn.startRegistration.mockResolvedValue({ id: 'new' });
			const result = await registerPasskey({ label: '手元のスマホ' });
			expect(result).toEqual({ ok: true, data: { ok: true, recoveryCode: 'ABCD' } });
			expect(webauthn.startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'r' } });
			expect(calls[1].body).toEqual({ response: { id: 'new' }, label: '手元のスマホ' });
		});

		it('復旧のときは、渡した URL を使う', async () => {
			const calls = stubFetch({ '/auth/recover/t/options': { body: {} }, '/auth/recover/t/verify': { body: { ok: true } } });
			webauthn.startRegistration.mockResolvedValue({});
			await registerPasskey({ optionsUrl: '/auth/recover/t/options', verifyUrl: '/auth/recover/t/verify' });
			expect(calls.map((c) => c.url)).toEqual(['/auth/recover/t/options', '/auth/recover/t/verify']);
		});

		it('すでに登録済みのパスキーを選んだら（InvalidStateError）、そのことを伝える', async () => {
			stubFetch({ '/auth/register/options': { body: {} } });
			webauthn.startRegistration.mockRejectedValue(domError('InvalidStateError'));
			expect(await registerPasskey()).toEqual({ ok: false, message: 'このパスキーは、すでに登録されています。' });
		});
	});

	describe('本人確認', () => {
		it('step-up の URL で、確認する', async () => {
			const calls = stubFetch({ '/auth/stepup/options': { body: {} }, '/auth/stepup/verify': { body: { ok: true } } });
			webauthn.startAuthentication.mockResolvedValue({ id: 'x' });
			expect((await stepupWithPasskey()).ok).toBe(true);
			expect(calls.map((c) => c.url)).toEqual(['/auth/stepup/options', '/auth/stepup/verify']);
		});
	});

	it('パスキーを使えるかは、ブラウザの判定のとおり', () => {
		webauthn.browserSupportsWebAuthn.mockReturnValue(false);
		expect(supportsPasskeys()).toBe(false);
		webauthn.browserSupportsWebAuthn.mockReturnValue(true);
		expect(supportsPasskeys()).toBe(true);
	});

	describe('復旧コードの受け渡し', () => {
		beforeEach(() => {
			const store = new Map<string, string>();
			vi.stubGlobal('sessionStorage', {
				getItem: (k: string) => store.get(k) ?? null,
				setItem: (k: string, v: string) => void store.set(k, v),
				removeItem: (k: string) => void store.delete(k)
			});
		});

		it('渡したコードは、1回だけ取り出せる（2回目は、null）', () => {
			handOffRecoveryCode('ABCD-EFGH');
			expect(takeRecoveryCode()).toBe('ABCD-EFGH');
			expect(takeRecoveryCode()).toBeNull();
		});

		it('文字列でない、または空のものは、置かない', () => {
			for (const bad of [undefined, null, 42, '', {}]) handOffRecoveryCode(bad);
			expect(takeRecoveryCode()).toBeNull();
		});
	});
});
