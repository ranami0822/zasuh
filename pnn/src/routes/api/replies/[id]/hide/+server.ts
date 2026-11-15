import { api, body, env } from '../../../../../lib/server/http';
import { hideReply } from '../../../../../lib/server/posts';
export const POST = (e) => api(async () => hideReply(env(e).DB, e.locals.viewer, e.params.id, (await body<{ hidden: unknown }>(e)).hidden === true));
