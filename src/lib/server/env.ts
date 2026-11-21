import type { Ai, D1Database, Fetcher } from '@cloudflare/workers-types';

/** ワーカーのバインディング（wrangler.jsonc と対応）。 */
export interface Env {
	DB: D1Database;
	AI: Ai;
	ASSETS: Fetcher;
	/** オーナーの合言葉（Worker のシークレット）。なければ、管理画面は開かない。 */
	ADMIN_TOKEN?: string;
	/** OpenCritic の API（RapidAPI）のキー（Worker のシークレット）。なければ、専門家の欄の取得は動かない。 */
	OPENCRITIC_API_KEY?: string;
	/** メールの送信（Cloudflare Email Service の send_email バインディング）。なければ、メールでの復旧は無効。 */
	EMAIL?: { send(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> };
	/** メールの送信元（例: noreply@anami.party）。送信元のドメインは、Cloudflare に登録しておく。 */
	MAIL_FROM?: string;
}
