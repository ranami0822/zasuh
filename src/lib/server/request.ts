import { error, type Cookies, type RequestEvent } from '@sveltejs/kit';
import type { D1Database } from '@cloudflare/workers-types';
import { env, waitUntil } from 'cloudflare:workers';
import type { Env } from './env';
import { deviceTokenHash, ipDayHash } from './reviews';

export const DEVICE_COOKIE = 'zs_device';

export function runtimeEnv(): Env {
	return env;
}

export function database(): D1Database {
	if (!env?.DB) error(500, 'データベースに接続できません');
	return env.DB;
}

/** 端末の Cookie から、端末のハッシュを作る。create が true で Cookie がなければ、作って渡す。なければ null。 */
export async function deviceFor(cookies: Cookies, url: URL, create: boolean): Promise<string | null> {
	let token = cookies.get(DEVICE_COOKIE);
	if (!token && create) {
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		token = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '');
		cookies.set(DEVICE_COOKIE, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: 60 * 60 * 24 * 365
		});
	}
	return token ? deviceTokenHash(token) : null;
}

export async function senderHash(event: Pick<RequestEvent, 'getClientAddress'>, now: Date): Promise<string | null> {
	let ip: string | null = null;
	try {
		ip = event.getClientAddress();
	} catch {
		ip = null;
	}
	return ipDayHash(ip, env?.ADMIN_TOKEN, now);
}

/** 保存のあとに、応答を待たずに、AIの読み取りを始める。 */
export function runAfter(task: Promise<unknown>): void {
	waitUntil(task.catch((e) => console.error(JSON.stringify({ event: 'background_failed', message: String(e) }))));
}
