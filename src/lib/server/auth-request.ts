import { error, json, type RequestEvent } from '@sveltejs/kit';
import type { D1Database } from '@cloudflare/workers-types';
import { AUTH_MESSAGES } from '#messages';
import { authConfigFor, type AuthConfig, type AuthError } from './auth';
import { database, deviceFor } from './request';

export interface AuthContext {
	db: D1Database;
	cfg: AuthConfig;
	now: Date;
	/** 端末のハッシュ（Cookie がなければ、null。create なら、作る）。 */
	device: string | null;
}

/**
 * ログインの JSON の要求を受ける前の確認: 許したホスト名で、Origin が同じであること。
 * （JSON の POST は、ほかのサイトから、フォームでは送れないが、念のため、Origin も確かめる。）
 */
export async function authContext(event: Pick<RequestEvent, 'request' | 'url' | 'cookies'>, opts: { create?: boolean } = {}): Promise<AuthContext> {
	const cfg = authConfigFor(event.url);
	if (!cfg) error(400, AUTH_MESSAGES.config);
	if (event.request.headers.get('origin') !== cfg.origin) error(403, '許可されていない送信元です');
	return { db: database(), cfg, now: new Date(), device: await deviceFor(event.cookies, event.url, opts.create ?? false) };
}

export const failure = (code: AuthError, status = 400) => json({ ok: false, error: code, message: AUTH_MESSAGES[code] }, { status, headers: { 'cache-control': 'no-store' } });
export const success = (body: object = {}) => json({ ok: true, ...body }, { headers: { 'cache-control': 'no-store' } });
