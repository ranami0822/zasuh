import type { Ai, D1Database, Fetcher } from '@cloudflare/workers-types';

/** ワーカーのバインディング（wrangler.jsonc と対応）。 */
export interface Env {
	DB: D1Database;
	AI: Ai;
	ASSETS: Fetcher;
	/** オーナーの合言葉（Worker のシークレット）。なければ、管理画面は開かない。 */
	ADMIN_TOKEN?: string;
}
