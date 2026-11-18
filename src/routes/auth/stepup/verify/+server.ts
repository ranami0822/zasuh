import { finishLogin, markStepup } from '#server/auth';
import { authContext, failure, success } from '#server/auth-request';
import { findReviewer } from '#server/reviews';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { db, cfg, now, device } = await authContext(event);
	const reviewerId = device ? await findReviewer(db, device, now) : null;
	const body = (await event.request.json().catch(() => null)) as { response?: unknown } | null;
	if (!reviewerId || !body?.response) return failure('not_found', 404);
	const result = await finishLogin(db, cfg, body.response as never, now, { purpose: 'stepup', reviewerId });
	if (!result.ok) return failure(result.error);
	await markStepup(db, device!, now);
	return success();
};
