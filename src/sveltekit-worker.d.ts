// 'sveltekit-worker' は、wrangler.jsonc の alias で、SvelteKit のビルドの出力
// （.svelte-kit/cloudflare/_worker.js）を指す。ビルドの出力を型チェックに巻き込まないよう、型だけここで宣言する。
declare module 'sveltekit-worker' {
	const worker: {
		fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
	};
	export default worker;
}
