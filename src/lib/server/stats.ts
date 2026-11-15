import type { D1Database } from '@cloudflare/workers-types';
import type { Category } from './question-sets/types';

/** 全タグの言及をまとめた行の tag_id。 */
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
 * タグの版や、一緒に聞いた質問の組が違う読み取りも、同じタグなら合算する。
 */
export async function recomputeWorkStats(db: D1Database, workId: string, now: Date): Promise<void> {
	const { results } = await db
		.prepare(
			`SELECT a.tag_id AS tagId, a.value AS value, COUNT(*) AS n
			   FROM reviews r
			   JOIN readings rd ON rd.revision_id = r.current_revision_id AND rd.status = 'ok'
			   JOIN reading_answers a ON a.reading_id = rd.id AND a.kind = 'direction'
			  WHERE r.work_id = ? AND r.hidden = 0 AND r.disclosure = 'none'
			  GROUP BY a.tag_id, a.value`
		)
		.bind(workId)
		.all<{ tagId: string; value: string; n: number }>();

	const counts = new Map<string, AspectCounts>();
	const overall: AspectCounts = { nPos: 0, nNeg: 0, nMix: 0 };
	for (const row of results) {
		let c = counts.get(row.tagId);
		if (!c) counts.set(row.tagId, (c = { nPos: 0, nNeg: 0, nMix: 0 }));
		const field = row.value === 'positive' ? 'nPos' : row.value === 'negative' ? 'nNeg' : row.value === 'mixed' ? 'nMix' : null;
		if (!field) continue;
		c[field] += row.n;
		overall[field] += row.n;
	}
	counts.set(OVERALL, overall);

	const updatedAt = now.toISOString();
	const insert = db.prepare(
		`INSERT INTO aspect_stats (work_id, tag_id, n_mention, n_pos, n_neg, n_mix, score_lower, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	);
	await db.batch([
		db.prepare('DELETE FROM aspect_stats WHERE work_id = ?').bind(workId),
		...[...counts].map(([tagId, c]) => {
			const { nMention, scoreLower } = scoreCounts(c);
			return insert.bind(workId, tagId, nMention, c.nPos, c.nNeg, c.nMix, scoreLower, updatedAt);
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

/** 分野の中の順位。tagId を省くと総合順位（全タグの言及をまとめたもの）。言及のない作品は載らない。 */
export async function ranking(
	db: D1Database,
	category: Category,
	opts: { tagId?: string; limit?: number } = {}
): Promise<RankingRow[]> {
	const { results } = await db
		.prepare(
			`SELECT w.id AS workId, w.slug AS slug, w.name AS name,
			        s.n_mention AS nMention, s.n_pos AS nPos, s.n_neg AS nNeg, s.n_mix AS nMix,
			        s.score_lower AS scoreLower
			   FROM aspect_stats s
			   JOIN works w ON w.id = s.work_id
			  WHERE w.category = ? AND s.tag_id = ?
			    AND w.status = 'active' AND s.score_lower IS NOT NULL
			  ORDER BY s.score_lower DESC, s.n_mention DESC, w.name ASC
			  LIMIT ?`
		)
		.bind(category, opts.tagId ?? OVERALL, opts.limit ?? 50)
		.all<RankingRow>();
	return results;
}
