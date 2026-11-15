import type { D1Database } from '@cloudflare/workers-types';
import type { QuestionSetDefinition } from './question-sets/types';

/** 全観点の言及をまとめた行の aspect。 */
export const OVERALL = '_overall';

/** 信頼水準 95% の z 値（初期値。docs/design.md の7章）。 */
const Z95 = 1.959964;

/**
 * Wilson 信頼区間の下限。少数のレビューで順位が暴れないよう、肯定率そのものではなく、これで並べる。
 * successes は小数でもよい（混在を 0.5 として数えるため）。n が 0 なら null。
 */
export function wilsonLower(successes: number, n: number, z = Z95): number | null {
	if (n <= 0) return null;
	const p = successes / n;
	const z2 = z * z;
	const centre = p + z2 / (2 * n);
	const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
	return Math.max(0, (centre - margin) / (1 + z2 / n));
}

export interface AspectCounts {
	nPos: number;
	nNeg: number;
	nMix: number;
}

/** 言及数（肯定 + 否定 + 混在）と、肯定を 1、混在を 0.5、否定を 0 とした下限。 */
export function scoreCounts(c: AspectCounts): { nMention: number; scoreLower: number | null } {
	const nMention = c.nPos + c.nNeg + c.nMix;
	return { nMention, scoreLower: wilsonLower(c.nPos + 0.5 * c.nMix, nMention) };
}

/**
 * 1つの作品の集計を作り直す。
 * 数えるのは、各レビューの最新の版の、成功した読み取りだけ。
 * 利害関係のあるレビューと、非表示のレビューは数えない。
 */
export async function recomputeWorkStats(
	db: D1Database,
	workId: string,
	questionSet: { id: number; definition: QuestionSetDefinition },
	now: Date
): Promise<void> {
	const { results } = await db
		.prepare(
			`SELECT a.aspect AS aspect, a.value AS value, COUNT(*) AS n
			   FROM reviews r
			   JOIN readings rd
			     ON rd.revision_id = r.current_revision_id
			    AND rd.question_set_id = ?1
			    AND rd.status = 'ok'
			   JOIN reading_answers a ON a.reading_id = rd.id AND a.kind = 'direction'
			  WHERE r.work_id = ?2 AND r.hidden = 0 AND r.disclosure = 'none'
			  GROUP BY a.aspect, a.value`
		)
		.bind(questionSet.id, workId)
		.all<{ aspect: string; value: string; n: number }>();

	const counts = new Map<string, AspectCounts>();
	for (const a of questionSet.definition.aspects) counts.set(a.key, { nPos: 0, nNeg: 0, nMix: 0 });
	const overall: AspectCounts = { nPos: 0, nNeg: 0, nMix: 0 };
	for (const row of results) {
		const c = counts.get(row.aspect);
		if (!c) continue;
		const field = row.value === 'positive' ? 'nPos' : row.value === 'negative' ? 'nNeg' : row.value === 'mixed' ? 'nMix' : null;
		if (!field) continue;
		c[field] += row.n;
		overall[field] += row.n;
	}
	counts.set(OVERALL, overall);

	const updatedAt = now.toISOString();
	const insert = db.prepare(
		`INSERT INTO aspect_stats
		   (work_id, question_set_id, aspect, n_mention, n_pos, n_neg, n_mix, score_lower, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	await db.batch([
		db
			.prepare('DELETE FROM aspect_stats WHERE work_id = ? AND question_set_id = ?')
			.bind(workId, questionSet.id),
		...[...counts].map(([aspect, c]) => {
			const { nMention, scoreLower } = scoreCounts(c);
			return insert.bind(workId, questionSet.id, aspect, nMention, c.nPos, c.nNeg, c.nMix, scoreLower, updatedAt);
		})
	]);
}

export interface RankingRow {
	workId: string;
	slug: string;
	name: string;
	nMention: number;
	nPos: number;
	nNeg: number;
	nMix: number;
	scoreLower: number;
}

/** 順位。aspect を省くと総合順位（全観点の言及をまとめたもの）。言及のない作品は載らない。 */
export async function ranking(
	db: D1Database,
	questionSetId: number,
	opts: { aspect?: string; limit?: number } = {}
): Promise<RankingRow[]> {
	const { results } = await db
		.prepare(
			`SELECT w.id AS workId, w.slug AS slug, w.name AS name,
			        s.n_mention AS nMention, s.n_pos AS nPos, s.n_neg AS nNeg, s.n_mix AS nMix,
			        s.score_lower AS scoreLower
			   FROM aspect_stats s
			   JOIN works w ON w.id = s.work_id
			  WHERE s.question_set_id = ? AND s.aspect = ?
			    AND w.status = 'active' AND s.score_lower IS NOT NULL
			  ORDER BY s.score_lower DESC, s.n_mention DESC, w.name ASC
			  LIMIT ?`
		)
		.bind(questionSetId, opts.aspect ?? OVERALL, opts.limit ?? 50)
		.all<RankingRow>();
	return results;
}
