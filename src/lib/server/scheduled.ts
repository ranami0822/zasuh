import { bindingClient } from './clef';
import type { Env } from './env';
import { sweepReadings } from './sweep';

/** 定期実行（毎分）。読めていないレビューを拾って、読み直す。 */
export async function runScheduled(env: Env): Promise<void> {
	const result = await sweepReadings({ db: env.DB, clef: bindingClient(env.AI) });
	if (result.picked > 0) console.log(JSON.stringify({ event: 'sweep', ...result }));
}
