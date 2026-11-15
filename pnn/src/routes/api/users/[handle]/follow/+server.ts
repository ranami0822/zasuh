import { api, env } from '../../../../../lib/server/http';
import { follow } from '../../../../../lib/server/posts';
export const POST = (e) => api(() => follow(env(e).DB, e.locals.viewer, e.params.handle, true, Date.now()));
export const DELETE = (e) => api(() => follow(env(e).DB, e.locals.viewer, e.params.handle, false, Date.now()));
