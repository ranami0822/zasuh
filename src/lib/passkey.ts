import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';

export type PasskeyResult = { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

async function post(url: string, body: unknown = {}): Promise<{ ok: boolean; data: Record<string, unknown> }> {
	const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const failure = (data: Record<string, unknown>): PasskeyResult => ({ ok: false, message: String(data.message ?? 'うまくいきませんでした。もう一度試してください。') });

/** ブラウザの確認画面を、利用者が閉じたとき（NotAllowedError）は、静かに戻す。 */
function describe(e: unknown): string {
	if (e instanceof Error && e.name === 'NotAllowedError') return 'キャンセルされました。';
	if (e instanceof Error && e.name === 'InvalidStateError') return 'このパスキーは登録済みです。';
	return 'パスキーを使えませんでした。ブラウザの設定を確かめてください。';
}

export const supportsPasskeys = (): boolean => browserSupportsWebAuthn();

/** パスキーを登録する。復旧のときは、リンクごとの URL を渡す。 */
export async function registerPasskey(opts: { optionsUrl?: string; verifyUrl?: string; label?: string } = {}): Promise<PasskeyResult> {
	try {
		const options = await post(opts.optionsUrl ?? '/auth/register/options');
		if (!options.ok) return failure(options.data);
		const response = await startRegistration({ optionsJSON: options.data as never });
		const verified = await post(opts.verifyUrl ?? '/auth/register/verify', { response, label: opts.label });
		return verified.ok ? { ok: true, data: verified.data } : failure(verified.data);
	} catch (e) {
		return { ok: false, message: describe(e) };
	}
}

export async function loginWithPasskey(): Promise<PasskeyResult> {
	try {
		const options = await post('/auth/login/options');
		if (!options.ok) return failure(options.data);
		const response = await startAuthentication({ optionsJSON: options.data as never });
		const verified = await post('/auth/login/verify', { response });
		return verified.ok ? { ok: true, data: verified.data } : failure(verified.data);
	} catch (e) {
		return { ok: false, message: describe(e) };
	}
}

/** 追加・削除などの前に、直前の本人確認をする。 */
export async function stepupWithPasskey(): Promise<PasskeyResult> {
	try {
		const options = await post('/auth/stepup/options');
		if (!options.ok) return failure(options.data);
		const response = await startAuthentication({ optionsJSON: options.data as never });
		const verified = await post('/auth/stepup/verify', { response });
		return verified.ok ? { ok: true, data: verified.data } : failure(verified.data);
	} catch (e) {
		return { ok: false, message: describe(e) };
	}
}

const CODE_KEY = 'zs_recovery_code';

/** 復旧コードを、次の画面で、1回だけ見せるために、このタブの中だけに、一時的に置く（サーバーや、ほかのタブには、送らない）。 */
export function handOffRecoveryCode(code: unknown): void {
	if (typeof code === 'string' && code) sessionStorage.setItem(CODE_KEY, code);
}

export function takeRecoveryCode(): string | null {
	const code = sessionStorage.getItem(CODE_KEY);
	sessionStorage.removeItem(CODE_KEY);
	return code;
}
