import { api, body, env } from '../../../../lib/server/http';
import { publishDoc, unpublishDoc } from '../../../../lib/server/posts';
export const PUT = (e) => api(async () => publishDoc(env(e).DB, e.locals.viewer, e.params.docId, await body(e), Date.now()));
export const DELETE = (e) => api(() => unpublishDoc(env(e).DB, e.locals.viewer, e.params.docId));
