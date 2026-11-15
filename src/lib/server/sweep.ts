import { resolveQuestionSet } from './question-sets';
import type { Category } from './question-sets/types';
import { MAX_ATTEMPTS, readRevision, type ReadingDeps } from './reading';

const CATEGORIES: Category[] = ['game', 'software'];

export interface SweepResult {
	picked: number;
	ok: number;
	error: number;
	skipped: number;
}

/**
 * 読めていないレビューを拾って、読み直す（定期実行から呼ぶ）。
 * 拾うのは、表示中の作品の、非表示でないレビューの、最新の版のうち、次のどちらか。
 * - 読み取りの記録がないまま、猶予（graceMs）を過ぎたもの。投稿の直後の読み取りが動かなかった場合にあたる。
 * - 失敗したか、読み取り中のまま止まっていて、次に試す時刻を過ぎたもの（回数の上限まで）。
 * 質問セットが新しくなったときは、古い版でしか読んでいないレビューも、ここで拾われる。
 */
export async function sweepReadings(
	deps: ReadingDeps,
	opts: { limit?: number; graceMs?: number } = {}
): Promise<SweepResult> {
	const now = deps.now ?? (() => new Date());
	const limit = opts.limit ?? 10;
	const graceMs = opts.graceMs ?? 2 * 60_000;
	const result: SweepResult = { picked: 0, ok: 0, error: 0, skipped: 0 };

	for (const category of CATEGORIES) {
		const remaining = limit - result.picked;
		if (remaining <= 0) break;

		const at = now();
		const questionSet = await resolveQuestionSet(deps.db, category, at, deps.questionSets);
		if (!questionSet) continue;

		const { results } = await deps.db
			.prepare(
				`SELECT v.id AS revisionId
				   FROM reviews r
				   JOIN works w ON w.id = r.work_id
				   JOIN review_revisions v ON v.id = r.current_revision_id
				   LEFT JOIN readings rd ON rd.revision_id = v.id AND rd.question_set_id = ?1
				  WHERE w.category = ?2 AND w.status = 'active' AND r.hidden = 0
				    AND (
				      (rd.id IS NULL AND v.created_at <= ?3)
				      OR (rd.status != 'ok' AND rd.attempts < ?4 AND rd.next_attempt_at <= ?5)
				    )
				  ORDER BY v.created_at ASC
				  LIMIT ?6`
			)
			.bind(
				questionSet.id,
				category,
				new Date(at.getTime() - graceMs).toISOString(),
				MAX_ATTEMPTS,
				at.toISOString(),
				remaining
			)
			.all<{ revisionId: string }>();

		for (const { revisionId } of results) {
			result.picked++;
			try {
				const outcome = await readRevision(deps, revisionId);
				result[outcome.status]++;
			} catch (e) {
				// 1件の失敗で、残りを止めない。
				result.error++;
				console.error('sweep: 読み取りに失敗しました', revisionId, e);
			}
		}
	}
	return result;
}
