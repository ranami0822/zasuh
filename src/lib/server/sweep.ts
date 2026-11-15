import { MAX_ATTEMPTS, readRevision, type ReadingDeps } from './reading';
import { REGISTRY } from './tags';

export interface SweepResult {
	picked: number;
	ok: number;
	error: number;
	skipped: number;
}

/**
 * 読めていないレビューを拾って、読む（定期実行から呼ぶ）。
 * 拾うのは、表示中の作品の、非表示でないレビューの、最新の版のうち、まだ一度も読めていないもので、次のどちらか。
 * - 読み取りの記録がないまま、猶予（graceMs）を過ぎたもの。投稿の直後の読み取りが動かなかった場合にあたる。
 * - 失敗したか、読み取り中のまま止まっていて、次に試す時刻を過ぎたもの（回数の上限まで）。
 * 一度読めた版は、タグが変わっても拾わない。タグのない作品のレビューも拾わない。
 */
export async function sweepReadings(
	deps: ReadingDeps,
	opts: { limit?: number; graceMs?: number } = {}
): Promise<SweepResult> {
	const at = (deps.now ?? (() => new Date()))();
	const registry = deps.registry ?? REGISTRY;
	const result: SweepResult = { picked: 0, ok: 0, error: 0, skipped: 0 };

	// 分野のタグがある分野。それ以外の分野の作品は、タグを選んでいるものだけを読む。
	const categories = Object.entries(registry.domainTags)
		.filter(([, ids]) => ids.length > 0)
		.map(([category]) => category);
	const inCategories = categories.length > 0 ? `w.category IN (${categories.map(() => '?').join(', ')})` : '0';

	const { results } = await deps.db
		.prepare(
			`SELECT v.id AS revisionId
			   FROM reviews r
			   JOIN works w ON w.id = r.work_id
			   JOIN review_revisions v ON v.id = r.current_revision_id
			  WHERE w.status = 'active' AND r.hidden = 0
			    AND (${inCategories} OR EXISTS (SELECT 1 FROM work_tags t WHERE t.work_id = w.id))
			    AND NOT EXISTS (SELECT 1 FROM readings rd WHERE rd.revision_id = v.id AND rd.status = 'ok')
			    AND NOT EXISTS (
			      SELECT 1 FROM readings rd
			       WHERE rd.revision_id = v.id AND rd.status = 'running' AND rd.next_attempt_at > ?
			    )
			    AND (
			      (NOT EXISTS (SELECT 1 FROM readings rd WHERE rd.revision_id = v.id) AND v.created_at <= ?)
			      OR EXISTS (
			        SELECT 1 FROM readings rd
			         WHERE rd.revision_id = v.id AND rd.attempts < ? AND rd.next_attempt_at <= ?
			      )
			    )
			  ORDER BY v.created_at ASC
			  LIMIT ?`
		)
		.bind(
			...categories,
			at.toISOString(),
			new Date(at.getTime() - (opts.graceMs ?? 2 * 60_000)).toISOString(),
			MAX_ATTEMPTS,
			at.toISOString(),
			opts.limit ?? 10
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
	return result;
}
