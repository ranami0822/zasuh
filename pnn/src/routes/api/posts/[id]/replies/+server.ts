import { api, body, env } from '../../../../../lib/server/http';
import { reply } from '../../../../../lib/server/posts';
export const POST = (e) => api(async () => reply(env(e).DB, e.locals.viewer, e.params.id, (await body<{ body: unknown }>(e)).body, Date.now()));
