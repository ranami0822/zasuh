import type { D1Database } from '@cloudflare/workers-types';

export interface Env {
	DB: D1Database;
	/** 仮名を作る秘密の鍵（wrangler secret） */
	PNN_SECRET: string;
}
