import { json } from '@sveltejs/kit';
import { listCredentials, loginOptions } from '#server/auth';
import { authContext, failure } from '#server/auth-request';
import { findReviewer } from '#server/reviews';
import type { RequestHandler } from './$types';

/** 追加・削除などの前の、本人確認。ログイン中のアカウントの、パスキーだけが使える。 */
export const POST: RequestHandler = async (event) => {
	const { db, cfg, now, device } = await authContext(event);
	const reviewerId = device ? await findReviewer(db, device, now) : null;
	if (!reviewerId || (await listCredentials(db, reviewerId)).length === 0) return failure('not_found', 404);
	return json(await loginOptions(db, cfg, now, { purpose: 'stepup', reviewerId }), { headers: { 'cache-control': 'no-store' } });
};
