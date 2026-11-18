import { authContext, failure } from '#server/auth-request';
import { hasRecentStepup, listCredentials, registrationOptions } from '#server/auth';
import { ensureReviewer } from '#server/reviews';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** パスキーの登録を始める。すでにパスキーがあるアカウントは、直前の本人確認が要る。 */
export const POST: RequestHandler = async (event) => {
	const { db, cfg, now, device } = await authContext(event, { create: true });
	const reviewerId = await ensureReviewer(db, device!, now);
	if ((await listCredentials(db, reviewerId)).length > 0 && !(await hasRecentStepup(db, device!, now))) return failure('stepup_required', 403);
	return json(await registrationOptions(db, cfg, reviewerId, now), { headers: { 'cache-control': 'no-store' } });
};
