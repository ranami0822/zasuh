import { deleteSession } from '../../../../lib/server/auth';
import { api, env } from '../../../../lib/server/http';
import { SESSION_COOKIE } from '../../../../lib/server/webauthn';
export const POST = (e) =>
	api(async () => {
		const t = e.cookies.get(SESSION_COOKIE);
		if (t) await deleteSession(env(e).DB, t);
		e.cookies.delete(SESSION_COOKIE, { path: '/' });
	});
