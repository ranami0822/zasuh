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
			adapter: adapter({ config: 'wrangler.sveltekit.jsonc' }),

			// content-security-policy。インラインのスクリプトには、SvelteKit が nonce を付ける。
			// 外部への通信は、書体（Google Fonts）だけ。style の 'unsafe-inline' は、画面の部品が style 属性を使うため。
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
					'font-src': ['self', 'https://fonts.gstatic.com'],
					'img-src': ['self', 'data:'],
					'connect-src': ['self'],
					'form-action': ['self'],
					'base-uri': ['self'],
					'object-src': ['none'],
					'frame-ancestors': ['none']
				}
			}
		})
	],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
