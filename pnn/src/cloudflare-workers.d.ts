// cloudflare:workers の型（使うのは env だけ）
declare module 'cloudflare:workers' {
	export const env: unknown;
}
