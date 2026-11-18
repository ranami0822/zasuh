import { finishLogin, issueDevice, mergeAnonymous } from '#server/auth';
import { authContext, failure, success } from '#server/auth-request';
import { setDeviceCookie } from '#server/request';
import { findReviewer } from '#server/reviews';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { db, cfg, now, device } = await authContext(event);
	const body = (await event.request.json().catch(() => null)) as { response?: unknown } | null;
	if (!body?.response) return failure('verify_failed');
	const result = await finishLogin(db, cfg, body.response as never, now);
	if (!result.ok) return failure(result.error);
	// この端末で、ログインなしで投稿していたレビューを、アカウントにまとめる。
	const anonymous = device ? await findReviewer(db, device, now) : null;
	if (anonymous) await mergeAnonymous(db, anonymous, result.reviewerId);
	setDeviceCookie(event.cookies, event.url, await issueDevice(db, result.reviewerId, now, { stepup: true }));
	console.log(JSON.stringify({ event: 'passkey_login' }));
	return success();
};
