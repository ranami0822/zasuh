import { json } from '@sveltejs/kit';
import { recoveryRegistrationOptions } from '#server/auth';
import { authContext, failure } from '#server/auth-request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { db, cfg, now } = await authContext(event);
	const options = await recoveryRegistrationOptions(db, cfg, event.params.token, now);
	if (!options) return failure('bad_token', 404);
	return json(options, { headers: { 'cache-control': 'no-store' } });
};
