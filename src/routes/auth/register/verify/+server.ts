import { adoptDevice, finishRegistration, hasRecentStepup, listCredentials, markStepup } from '#server/auth';
import { authContext, failure, success } from '#server/auth-request';
import { mailerFrom } from '#server/mail';
import { runtimeEnv } from '#server/request';
import { ensureReviewer } from '#server/reviews';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { db, cfg, now, device } = await authContext(event, { create: true });
	const body = (await event.request.json().catch(() => null)) as { response?: unknown; label?: unknown } | null;
	if (!body?.response) return failure('verify_failed');
	const reviewerId = await ensureReviewer(db, device!, now);
	const hadCredentials = (await listCredentials(db, reviewerId)).length > 0;
	if (hadCredentials && !(await hasRecentStepup(db, device!, now))) return failure('stepup_required', 403);
	const result = await finishRegistration(db, cfg, reviewerId, body.response as never, now, { label: typeof body.label === 'string' ? body.label : undefined });
	if (!result.ok) return failure(result.error);
	// この端末の「ログインなしの印」が、そのまま、アカウントの端末になる。登録は、直前の本人確認にもなる。
	await adoptDevice(db, reviewerId, device!, now);
	await markStepup(db, device!, now);
	console.log(JSON.stringify({ event: 'passkey_registered', first: !hadCredentials }));
	return success({ first: !hadCredentials, emailEnabled: mailerFrom(runtimeEnv()) !== null });
};
