import { api, body, env } from '../../../lib/server/http';
import { me, updateMe } from '../../../lib/server/posts';
export const GET = (e) => api(() => me(env(e).DB, e.locals.viewer));
export const PATCH = (e) => api(async () => { await updateMe(env(e).DB, e.locals.viewer, await body(e)); return me(env(e).DB, e.locals.viewer); });
