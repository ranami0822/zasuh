import { json, type RequestEvent } from '@sveltejs/kit';
import { env as cf } from 'cloudflare:workers';
import { Problem } from './posts';
import type { Env } from './env';

/** Cloudflare の環境（SvelteKit 3 のアダプタは、cloudflare:workers から渡す） */
export function env(_e?: RequestEvent): Env {
	const v = cf as unknown as Env;
	if (!v?.DB) throw new Problem(500, 'no DB binding');
	return v;
}

/** JSON の本文を読む（JSON でなければ拒む） */
export async function body<T = Record<string, unknown>>(e: RequestEvent): Promise<T> {
	if (!e.request.headers.get('content-type')?.includes('application/json')) throw new Problem(415, 'json only');
	try { return (await e.request.json()) as T; } catch { throw new Problem(400, 'bad json'); }
}

/** 処理を包んで、Problem を HTTP の誤りにする */
export async function api(fn: () => Promise<unknown>): Promise<Response> {
	try {
		const out = await fn();
		return json(out ?? { ok: true });
	} catch (err) {
		if (err instanceof Problem) return json({ error: err.message }, { status: err.status });
		console.error(err);
		return json({ error: 'server error' }, { status: 500 });
	}
}
