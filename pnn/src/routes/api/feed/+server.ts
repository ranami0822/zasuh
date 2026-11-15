import { api, env } from '../../../lib/server/http';
import { feed } from '../../../lib/server/posts';
export const GET = (e) => api(() => { const b = e.url.searchParams.get('before'); return feed(env(e).DB, b ? +b : null); });
