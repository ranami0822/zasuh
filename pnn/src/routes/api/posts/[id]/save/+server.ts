import { api, env } from '../../../../../lib/server/http';
import { save, unsave } from '../../../../../lib/server/posts';
export const POST = (e) => api(() => save(env(e).DB, e.locals.viewer, e.params.id, Date.now()));
export const DELETE = (e) => api(() => unsave(env(e).DB, e.locals.viewer, e.params.id));
