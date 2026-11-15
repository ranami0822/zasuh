import { api, env } from '../../../../lib/server/http';
import { profile } from '../../../../lib/server/posts';
export const GET = (e) => api(() => profile(env(e).DB, e.locals.viewer, e.params.handle));
