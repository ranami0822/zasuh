import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// ビルドの出力先は wrangler.sveltekit.jsonc で決める（wrangler.jsonc の冒頭を参照）。
			adapter: adapter({ config: 'wrangler.sveltekit.jsonc' })
		})
	],
	test: {
		include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
		environment: 'node',
		// `cloudflare:workers` は Workers の中でしか動かない。テストでは、差し替えられる代わりのものを読む。
		alias: { 'cloudflare:workers': fileURLToPath(new URL('./src/lib/server/testing/cloudflare-workers.ts', import.meta.url)) }
	}
});
