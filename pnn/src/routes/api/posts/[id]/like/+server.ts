import { api, env } from '../../../../../lib/server/http';
import { like, unlike } from '../../../../../lib/server/posts';
export const POST = (e) => api(() => like(env(e).DB, e.locals.viewer, e.params.id, Date.now()));
export const DELETE = (e) => api(() => unlike(env(e).DB, e.locals.viewer, e.params.id));
