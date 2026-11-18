import { fail } from '@sveltejs/kit';
import { AUTH_MESSAGES } from '#messages';
import { accountEmail, authConfigFor, createRecoveryCode, deleteCredential, hasRecentStepup, listCredentials, logout, logoutEverywhere, recoveryCodeInfo, removeEmail, setEmail } from '#server/auth';
import { mailerFrom } from '#server/mail';
import { database, DEVICE_COOKIE, deviceFor, runtimeEnv, senderHash } from '#server/request';
import { findReviewer } from '#server/reviews';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, url }) => {
	const device = await deviceFor(cookies, url, false);
	const db = database();
	const reviewerId = device ? await findReviewer(db, device) : null;
	const base = { emailEnabled: mailerFrom(runtimeEnv()) !== null, recovered: url.searchParams.get('recovered') === '1' };
	if (!device || !reviewerId) return { ...base, account: false as const };
	const credentials = await listCredentials(db, reviewerId);
	if (credentials.length === 0) return { ...base, account: false as const };
	return {
		...base,
		account: true as const,
		credentials,
		email: await accountEmail(db, reviewerId),
		recoveryCode: await recoveryCodeInfo(db, reviewerId),
		stepup: await hasRecentStepup(db, device, new Date())
	};
};

/** ログイン中のアカウントと、直前（5分以内）の本人確認を、確かめる。 */
async function guard(event: { cookies: import('@sveltejs/kit').Cookies; url: URL }, needStepup: boolean) {
	const device = await deviceFor(event.cookies, event.url, false);
	const db = database();
	const now = new Date();
	const reviewerId = device ? await findReviewer(db, device, now) : null;
	if (!device || !reviewerId) return { error: AUTH_MESSAGES.not_found } as const;
	if (needStepup && !(await hasRecentStepup(db, device, now))) return { error: AUTH_MESSAGES.stepup_required } as const;
	return { db, now, device, reviewerId } as const;
}

export const actions: Actions = {
	setEmail: async (event) => {
		const g = await guard(event, true);
		if ('error' in g) return fail(403, { error: g.error });
		const email = String((await event.request.formData()).get('email') ?? '');
		const result = await setEmail(
			g.db,
			g.reviewerId,
			email,
			{ mailer: mailerFrom(runtimeEnv()), origin: (authConfigFor(event.url) ?? { origin: event.url.origin }).origin, ipHash: await senderHash(event, g.now) },
			g.now
		);
		if (!result.ok) return fail(400, { error: AUTH_MESSAGES[result.error] });
		return { emailSent: true };
	},
	removeEmail: async (event) => {
		const g = await guard(event, true);
		if ('error' in g) return fail(403, { error: g.error });
		await removeEmail(g.db, g.reviewerId);
		return { emailRemoved: true };
	},
	regenerateCode: async (event) => {
		const g = await guard(event, true);
		if ('error' in g) return fail(403, { error: g.error });
		return { recoveryCode: await createRecoveryCode(g.db, g.reviewerId, g.now) };
	},
	deleteCredential: async (event) => {
		const g = await guard(event, true);
		if ('error' in g) return fail(403, { error: g.error });
		const id = String((await event.request.formData()).get('id') ?? '');
		const result = await deleteCredential(g.db, g.reviewerId, id);
		if (!result.ok) return fail(400, { error: AUTH_MESSAGES[result.error] });
		return { credentialDeleted: true };
	},
	logout: async (event) => {
		const g = await guard(event, false);
		if (!('error' in g)) await logout(g.db, g.device);
		event.cookies.delete(DEVICE_COOKIE, { path: '/' });
		return { loggedOut: true };
	},
	logoutAll: async (event) => {
		const g = await guard(event, true);
		if ('error' in g) return fail(403, { error: g.error });
		await logoutEverywhere(g.db, g.reviewerId);
		event.cookies.delete(DEVICE_COOKIE, { path: '/' });
		return { loggedOut: true };
	}
};
