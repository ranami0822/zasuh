import type { Ai, D1Database, Fetcher } from '@cloudflare/workers-types';

/** ワーカーのバインディング（wrangler.jsonc と対応）。 */
export interface Env {
	DB: D1Database;
	AI: Ai;
	ASSETS: Fetcher;
}
