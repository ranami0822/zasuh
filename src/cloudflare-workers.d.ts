// SvelteKit 3 のアダプタは、event.platform を渡さない。バインディングと waitUntil は、cloudflare:workers から読む。
declare module 'cloudflare:workers' {
	export const env: import('./lib/server/env').Env;
	export function waitUntil(promise: Promise<unknown>): void;
}
