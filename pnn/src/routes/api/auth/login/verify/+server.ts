import { api, body, env } from '../../../../../lib/server/http';
import { loginVerify } from '../../../../../lib/server/webauthn';
export const POST = (e) => api(async () => loginVerify(env(e).DB, e.url, e.cookies, await body(e), Date.now()));
