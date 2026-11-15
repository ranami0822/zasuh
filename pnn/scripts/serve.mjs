/**
 * ビルド結果（.svelte-kit/cloudflare）を、きれいな URL（/design → design.html）で配る簡易サーバー。
 * 検査（audit / e2e）用。使い方: `npm run serve`（ポート 4173）
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = new URL('../.svelte-kit/cloudflare/', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const port = +(process.env.PORT ?? 4173);

createServer((req, res) => {
	const url = new URL(req.url ?? '/', 'http://x');
	let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
	let file = join(root, path);
	if (path.endsWith('/')) file = join(file, 'index.html');
	else if (!extname(path) && existsSync(file + '.html')) file += '.html';
	if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
	res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
	res.end(readFileSync(file));
}).listen(port, () => console.log(`http://localhost:${port}/`));
