import { finishRecovery, mergeAnonymous } from '#server/auth';
import { authContext, failure, success } from '#server/auth-request';
import { setDeviceCookie } from '#server/request';
import { findReviewer } from '#server/reviews';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { db, cfg, now, device } = await authContext(event);
	const body = (await event.request.json().catch(() => null)) as { response?: unknown } | null;
	if (!body?.response) return failure('verify_failed');
	const result = await finishRecovery(db, cfg, event.params.token, body.response as never, now);
	if (!result.ok) return failure(result.error);
	const anonymous = device ? await findReviewer(db, device, now) : null;
	if (anonymous && anonymous !== result.reviewerId) await mergeAnonymous(db, anonymous, result.reviewerId);
	setDeviceCookie(event.cookies, event.url, result.deviceToken);
	console.log(JSON.stringify({ event: 'passkey_recovered' }));
	return success({ recoveryCode: result.recoveryCode });
};
