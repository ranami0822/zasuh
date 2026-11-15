import { api, env } from '../../../../../lib/server/http';
import { registerOptions } from '../../../../../lib/server/webauthn';
export const POST = (e) => api(() => registerOptions(env(e).DB, e.url, e.cookies, Date.now()));
