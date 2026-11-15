import { api, env } from '../../../../../lib/server/http';
import { loginOptions } from '../../../../../lib/server/webauthn';
export const POST = (e) => api(() => loginOptions(env(e).DB, e.url, e.cookies, Date.now()));
