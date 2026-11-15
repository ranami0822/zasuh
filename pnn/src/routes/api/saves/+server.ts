import { api, env } from '../../../lib/server/http';
import { saves } from '../../../lib/server/posts';
export const GET = (e) => api(() => saves(env(e).DB, e.locals.viewer));
