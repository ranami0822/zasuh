// ワーカーの入口。SvelteKit のアダプタが出力するワーカーに、定期実行（scheduled）を足す。
// アダプタには定期実行の仕組みがないので、ここで薄く包んでいる。
import sveltekit from 'sveltekit-worker';
import type { Env } from './lib/server/env';
import { runScheduled } from './lib/server/scheduled';

interface Ctx {
	waitUntil(promise: Promise<unknown>): void;
}

export default {
	fetch: (request: Request, env: Env, ctx: Ctx) => sveltekit.fetch(request, env, ctx),
	async scheduled(_controller: unknown, env: Env, ctx: Ctx): Promise<void> {
		ctx.waitUntil(runScheduled(env));
	}
};
