import { bindingClient } from './clef';
import { syncCritics } from './critic-sync';
import type { Env } from './env';
import { createOpenCriticClient, normalizeKey } from './opencritic';
import { sweepReadings } from './sweep';

/**
 * 専門家（批評家）の取得を呼ぶ時刻。毎分の定期実行のうち、UTC の 18:17〜18:19（日本時間の 03:17〜03:19）。
 * 専用の cron は足さない（docs/critics-plan.md の 1.7）。3 回呼ばれても、同じ作品は、20 時間以内には取得し直さない。
 */
export function isCriticSyncTime(now: Date): boolean {
	return now.getUTCHours() === 18 && now.getUTCMinutes() >= 17 && now.getUTCMinutes() <= 19;
}

/** 定期実行（毎分）。読めていないレビューを拾って、読み直す。決まった時刻には、専門家の評価の取得もする。 */
export async function runScheduled(env: Env, now: Date = new Date(), deps: { fetch?: typeof fetch } = {}): Promise<void> {
	const result = await sweepReadings({ db: env.DB, clef: bindingClient(env.AI) });
	if (result.picked > 0) console.log(JSON.stringify({ event: 'sweep', ...result }));

	const key = normalizeKey(env.OPENCRITIC_API_KEY);
	if (!key || !isCriticSyncTime(now)) return;
	try {
		await syncCritics({
			db: env.DB,
			clef: bindingClient(env.AI),
			oc: createOpenCriticClient({ key, fetch: deps.fetch }),
			now: () => now
		});
	} catch (e) {
		// 失敗しても、定期実行は、例外を投げない（次の日に、やり直す）。メッセージに、本文やキーは含まれない。
		console.error(JSON.stringify({ event: 'critic_sync_failed', message: String(e).slice(0, 200) }));
	}
}
