import { api, body, env } from '../../../../../lib/server/http';
import { registerVerify } from '../../../../../lib/server/webauthn';
export const POST = (e) => api(async () => registerVerify(env(e).DB, e.url, e.cookies, await body(e), Date.now()));
