import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api, ApiError, type Me } from './api';

/** ログインしていなければ null */
export async function getMe(): Promise<Me | null> {
	try { return await api<Me>('GET', '/api/me'); }
	catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e; }
}

/** passkey を作って、新しいアカウントで入る */
export async function register(): Promise<void> {
	const optionsJSON = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('POST', '/api/auth/register/options', {});
	const res = await startRegistration({ optionsJSON });
	await api('POST', '/api/auth/register/verify', res);
}

/** 持っている passkey で入る */
export async function login(): Promise<void> {
	const optionsJSON = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('POST', '/api/auth/login/options', {});
	const res = await startAuthentication({ optionsJSON });
	await api('POST', '/api/auth/login/verify', res);
}

export async function logout(): Promise<void> {
	await api('POST', '/api/auth/logout', {});
}
