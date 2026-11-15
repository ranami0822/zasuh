/// <reference lib="webworker" />
import { assets, immutable, prerendered } from '$app/manifest';
import { version } from '$app/env';

declare const self: ServiceWorkerGlobalScope;

const SHELL = `pnn-shell-${version}`;
const RUNTIME = 'pnn-runtime';

// 先に取り込むのは、アプリ本体と、よく使うフォントの塊だけ。
// 重い塊（第2水準、絵文字、残りすべて）は、使った時点でキャッシュする。
const heavy = /unifontex-(kanji2|emoji|rest)\.woff2$/;
const precache = [...immutable, ...assets, ...prerendered].map((e) => e.path).filter((p) => !heavy.test(p));

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(SHELL);
			await cache.addAll(precache);
			await cache.add('/');
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== SHELL && key !== RUNTIME) await caches.delete(key);
			}
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== location.origin) return;
	if (url.pathname.startsWith('/api/')) return; // API は、いつもネットワークへ

	event.respondWith(
		(async () => {
			const shell = await caches.open(SHELL);
			const hit = await shell.match(req, { ignoreSearch: req.mode === 'navigate' });
			if (hit) return hit;

			// 画面の移動は、オフラインでも、アプリ本体を返す
			if (req.mode === 'navigate') {
				try {
					return await fetch(req);
				} catch {
					return (await shell.match('/')) ?? Response.error();
				}
			}

			const runtime = await caches.open(RUNTIME);
			const cached = await runtime.match(req);
			if (cached) return cached;
			try {
				const res = await fetch(req);
				if (res.ok && heavy.test(url.pathname)) await runtime.put(req, res.clone());
				return res;
			} catch {
				return Response.error();
			}
		})()
	);
});
