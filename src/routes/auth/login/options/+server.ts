import { json } from '@sveltejs/kit';
import { loginOptions } from '#server/auth';
import { authContext } from '#server/auth-request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { db, cfg, now } = await authContext(event);
	return json(await loginOptions(db, cfg, now), { headers: { 'cache-control': 'no-store' } });
};
