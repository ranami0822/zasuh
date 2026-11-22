import type { D1Database } from '@cloudflare/workers-types';
import type { Category } from './question-sets/types';
import { starSummary, type StarItem, type StarSummary } from './star-stats';
import { REGISTRY, type TagRegistry } from './tags';

/** 全タグの言及をまとめた行の tag_id。 */
export const OVERALL = '_overall';

/** 画面に出す星の集計。 */
export type StarStat = Pick<StarSummary, 'n' | 'soft' | 'mean' | 'se'>;

export const EMPTY_STAR_STAT: StarStat = { n: 0, soft: [0, 0, 0, 0, 0], mean: null, se: null };

/** aspect_star_stats の行（列の別名つきで読むときの形）。 */
export interface StarStatRow {
	n: number;
	soft1: number;
	soft2: number;
	soft3: number;
	soft4: number;
	soft5: number;
	mean: number | null;
	se: number | null;
}

/** SQL で、aspect_star_stats（別名 s）の列を、StarStatRow の形で読むための列の並び。LEFT JOIN のときも、n は 0 になる。 */
export const STAR_STAT_COLUMNS = `COALESCE(s.n_mention, 0) AS n,
	COALESCE(s.soft_1, 0) AS soft1, COALESCE(s.soft_2, 0) AS soft2, COALESCE(s.soft_3, 0) AS soft3,
	COALESCE(s.soft_4, 0) AS soft4, COALESCE(s.soft_5, 0) AS soft5, s.mean AS mean, s.se AS se`;

export function toStarStat(r: StarStatRow): StarStat {
	return { n: r.n, soft: [r.soft1, r.soft2, r.soft3, r.soft4, r.soft5], mean: r.mean, se: r.se };
}

/** 保存した星の答え（reading_answers の probs_json）から、段階ごとの確率を取り出す。読めなければ null。 */
function parseLevels(json: string | null): number[] | null {
	if (!json) return null;
	try {
		const levels = (JSON.parse(json) as { levels?: unknown }).levels;
		return Array.isArray(levels) && levels.length === 5 && levels.every((p) => typeof p === 'number' && p >= 0) &&
			levels.reduce((t: number, p: number) => t + p, 0) > 0
			? (levels as number[])
			: null;
	} catch {
		return null;
	}
}

/**
 * 1つの作品の集計を作り直す。
 * 数えるのは、各レビューの最新の版の、成功した読み取りのうち、言及あり（noul が 0.5 以上）の観点の星だけ。
 * 利害関係のあるレビューと、非表示のレビューは数えない。
 * 数えないレビュー: 利害関係のあるもの、非表示のもの、ほかのレビューと文面がほぼ同じもの。
 * タグの版や、一緒に聞いた質問の組が違う読み取りも、同じタグなら合算する。
 * 総合（_overall）は、分野のタグの答えだけで数える（追加のタグは作品ごとに違い、作品どうしを比べられなくなるため）。
 * 向き（direction）の答え（v1）は、数えない。星の答えがない読み取りは、集計に入らない。
 */
export async function recomputeWorkStats(
	db: D1Database,
	workId: string,
	now: Date,
	registry: TagRegistry = REGISTRY
): Promise<void> {
	const work = await db.prepare('SELECT category FROM works WHERE id = ?').bind(workId).first<{ category: Category }>();
	if (!work) return;
	const domain = new Set(registry.domainTags[work.category]);
	const { results } = await db
		.prepare(
			`SELECT s.tag_id AS tagId, s.probs_json AS probsJson
			   FROM reviews r
			   JOIN readings rd ON rd.revision_id = r.current_revision_id AND rd.status = 'ok'
			   JOIN reading_answers s ON s.reading_id = rd.id AND s.kind = 'star'
			   JOIN reading_answers m ON m.reading_id = rd.id AND m.kind = 'mention' AND m.tag_id = s.tag_id AND m.value = 'true'
			  WHERE r.work_id = ? AND r.hidden = 0 AND r.disclosure = 'none' AND r.duplicate_of IS NULL`
		)
		.bind(workId)
		.all<{ tagId: string; probsJson: string | null }>();

	const items = new Map<string, StarItem[]>();
	const overall: StarItem[] = [];
	for (const row of results) {
		const levels = parseLevels(row.probsJson);
		if (!levels) continue;
		const list = items.get(row.tagId) ?? [];
		list.push({ levels });
		items.set(row.tagId, list);
		if (domain.has(row.tagId)) overall.push({ levels });
	}
	items.set(OVERALL, overall);

	const updatedAt = now.toISOString();
	const insert = db.prepare(
		`INSERT INTO aspect_star_stats
		   (work_id, tag_id, n_mention, soft_1, soft_2, soft_3, soft_4, soft_5, mean, se, score_lower, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	await db.batch([
		db.prepare('DELETE FROM aspect_star_stats WHERE work_id = ?').bind(workId),
		...[...items].map(([tagId, list]) => {
			const t = starSummary(list);
			return insert.bind(workId, tagId, t.n, ...t.soft, t.mean, t.se, t.lower, updatedAt);
		})
	]);
}

export interface RankingRow extends StarStat {
	workId: string;
	slug: string;
	name: string;
	scoreLower: number;
}

/** 分野の中の順位。tagId を省くと総合順位（分野のタグの答えをまとめたもの）。言及のない作品は載らない。控えめな値の高い順。 */
export async function ranking(
	db: D1Database,
	category: Category,
	opts: { tagId?: string; limit?: number } = {}
): Promise<RankingRow[]> {
	const { results } = await db
		.prepare(
			`SELECT w.id AS workId, w.slug AS slug, w.name AS name, s.score_lower AS scoreLower, ${STAR_STAT_COLUMNS}
			   FROM aspect_star_stats s
			   JOIN works w ON w.id = s.work_id
			  WHERE w.category = ? AND s.tag_id = ?
			    AND w.status = 'active' AND s.score_lower IS NOT NULL
			  ORDER BY s.score_lower DESC, s.n_mention DESC, w.name ASC
			  LIMIT ?`
		)
		.bind(category, opts.tagId ?? OVERALL, opts.limit ?? 50)
		.all<StarStatRow & { workId: string; slug: string; name: string; scoreLower: number }>();
	return results.map((r) => ({ workId: r.workId, slug: r.slug, name: r.name, scoreLower: r.scoreLower, ...toStarStat(r) }));
}
