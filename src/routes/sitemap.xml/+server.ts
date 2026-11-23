import { database } from '#server/request';
import type { RequestHandler } from './$types';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: RequestHandler = async ({ url }) => {
	const { results } = await database().prepare("SELECT slug FROM works WHERE status = 'active' ORDER BY created_at DESC LIMIT 5000").all<{ slug: string }>();
	const pages = ['/', '/about', '/terms', '/privacy', '/contact', ...results.map((w) => `/works/${w.slug}`)];
	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
		.map((p) => `<url><loc>${escape(url.origin + p)}</loc></url>`)
		.join('\n')}\n</urlset>\n`;
	return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
};
