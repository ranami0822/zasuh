import { api, env } from '../../../../lib/server/http';
import { getPost } from '../../../../lib/server/posts';
export const GET = (e) => api(() => getPost(env(e).DB, e.locals.viewer, e.params.id));
