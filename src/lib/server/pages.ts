import type { D1Database } from '@cloudflare/workers-types';
import type { Category } from './question-sets/types';
import { EMPTY_STAR_STAT, OVERALL, STAR_STAT_COLUMNS, toStarStat, type StarStat, type StarStatRow } from './stats';
import { latest, REGISTRY, type TagRegistry } from './tags';
import type { Work } from './works';

export const PAGE_SIZE = 30;

export interface TagOption {
	id: string;
	label: string;
	domain: boolean;
}

/** 分野の中で選べるタグ: 分野のタグと、その分野の作品のどれかに付いている追加のタグ。 */
export async function tagOptions(db: D1Database, category: Category, registry: TagRegistry = REGISTRY): Promise<TagOption[]> {
	const { results } = await db
		.prepare(
			`SELECT DISTINCT t.tag_id AS id FROM work_tags t JOIN works w ON w.id = t.work_id
			  WHERE w.category = ? AND w.status = 'active'`
		)
		.bind(category)
		.all<{ id: string }>();
	const used = new Set(results.map((r) => r.id));
	const ids = [...registry.domainTags[category], ...registry.extraTags[category].filter((id) => used.has(id))];
	return ids.map((id) => ({ id, label: latest(registry, id).label, domain: registry.domainTags[category].includes(id) }));
}

export interface RankedWork {
	slug: string;
	name: string;
	stat: StarStat;
	/** 順位の番号。言及のない作品は null（番号を付けずに、後ろに並べる）。 */
	rank: number | null;
}

/** 分野の中の並び（控えめな値の高い順）。タグを省くと総合。言及のない作品は、番号なしで後ろに並べる。 */
export async function rankedWorks(db: D1Database, category: Category, tagId?: string): Promise<RankedWork[]> {
	const { results } = await db
		.prepare(
			`SELECT w.slug AS slug, w.name AS name, s.score_lower AS scoreLower, ${STAR_STAT_COLUMNS}
			   FROM works w
			   LEFT JOIN aspect_star_stats s ON s.work_id = w.id AND s.tag_id = ?
			  WHERE w.category = ? AND w.status = 'active'
			  ORDER BY (s.score_lower IS NULL), s.score_lower DESC, COALESCE(s.n_mention, 0) DESC, w.name ASC`
		)
		.bind(tagId ?? OVERALL, category)
		.all<StarStatRow & { slug: string; name: string; scoreLower: number | null }>();
	let rank = 0;
	return results.map((r) => ({
		slug: r.slug,
		name: r.name,
		stat: toStarStat(r),
		rank: r.scoreLower === null || r.n === 0 ? null : ++rank
	}));
}

export interface TagStat {
	tagId: string;
	label: string;
	domain: boolean;
	stat: StarStat;
}

/** 月ごとの、分野のタグの星の分布。soft は、段階ごとの確率の合計（星1〜5）。 */
export interface MonthBucket {
	month: string;
	n: number;
	soft: number[];
}

export interface ReviewRow {
	id: string;
	body: string;
	writtenOn: string;
	disclosure: string;
	disclosureNote: string | null;
	duplicate: boolean;
	edited: boolean;
	/** 読み取り結果: 触れたタグと星（1〜5の連続値）。読み取りが済んでいなければ空。 */
	reads: { tagId: string; label: string; star: number }[];
}

export interface WorkPage {
	work: Work;
	tags: TagStat[];
	overall: StarStat;
	months: MonthBucket[];
	reviews: ReviewRow[];
	disclosed: ReviewRow[];
	total: number;
	page: number;
	pageCount: number;
}

const VISIBLE = 'r.hidden = 0';

/** 保存した星の答え（probs_json）の、段階ごとの確率（合計 1 に直す）。読めなければ null。 */
function parseStarLevels(json: string | null): number[] | null {
	if (!json) return null;
	try {
		const levels = (JSON.parse(json) as { levels?: unknown }).levels;
		if (!Array.isArray(levels) || levels.length !== 5 || !levels.every((p) => typeof p === 'number' && p >= 0)) return null;
		const total = (levels as number[]).reduce((t, p) => t + p, 0);
		return total > 0 ? (levels as number[]).map((p) => p / total) : null;
	} catch {
		return null;
	}
}

/** 保存した星の答え（probs_json）の、連続値（1〜5）。読めなければ null。 */
function parseStarScore(json: string | null): number | null {
	if (!json) return null;
	try {
		const score = (JSON.parse(json) as { score?: unknown }).score;
		return typeof score === 'number' && Number.isFinite(score) ? score : null;
	} catch {
		return null;
	}
}

async function reviewRows(
	db: D1Database,
	rows: { id: string; revisionId: string; body: string; writtenOn: string; disclosure: string; note: string | null; duplicate: number; revisions: number }[],
	registry: TagRegistry
): Promise<ReviewRow[]> {
	if (rows.length === 0) return [];
	const { results } = await db
		.prepare(
			`SELECT rd.revision_id AS revisionId, a.tag_id AS tagId, a.probs_json AS probsJson
			   FROM readings rd
			   JOIN reading_answers a ON a.reading_id = rd.id AND a.kind = 'star'
			   JOIN reading_answers m ON m.reading_id = rd.id AND m.kind = 'mention' AND m.tag_id = a.tag_id AND m.value = 'true'
			  WHERE rd.status = 'ok' AND rd.revision_id IN (${rows.map(() => '?').join(', ')})
			  ORDER BY a.rowid`
		)
		.bind(...rows.map((r) => r.revisionId))
		.all<{ revisionId: string; tagId: string; probsJson: string | null }>();
	const label = (id: string) => {
		try {
			return latest(registry, id).label;
		} catch {
			return id;
		}
	};
	return rows.map((r) => ({
		id: r.id,
		body: r.body,
		writtenOn: r.writtenOn,
		disclosure: r.disclosure,
		disclosureNote: r.note,
		duplicate: r.duplicate === 1,
		edited: r.revisions > 1,
		reads: results.flatMap((x) => {
			// 集計と同じく、段階ごとの確率が読めた答えだけを出す（棒と、レビューごとの星が食い違わないように）。
			const star = x.revisionId === r.revisionId && parseStarLevels(x.probsJson) ? parseStarScore(x.probsJson) : null;
			return star === null ? [] : [{ tagId: x.tagId, label: label(x.tagId), star }];
		})
	}));
}

const REVIEW_COLUMNS = `r.id AS id, r.current_revision_id AS revisionId, v.body AS body, r.written_on AS writtenOn,
	r.disclosure AS disclosure, r.disclosure_note AS note, (r.duplicate_of IS NOT NULL) AS duplicate,
	(SELECT COUNT(*) FROM review_revisions x WHERE x.review_id = r.id) AS revisions`;

export async function workPage(
	db: D1Database,
	work: Work,
	opts: { tag?: string; page?: number },
	registry: TagRegistry = REGISTRY
): Promise<WorkPage> {
	const page = Math.max(1, Math.floor(opts.page ?? 1));
	const tagFilter = opts.tag
		? `AND EXISTS (SELECT 1 FROM readings rd JOIN reading_answers a ON a.reading_id = rd.id
		                WHERE rd.revision_id = r.current_revision_id AND rd.status = 'ok'
		                  AND a.kind = 'mention' AND a.value = 'true' AND a.tag_id = ?)`
		: '';
	const tagBind = opts.tag ? [opts.tag] : [];

	const [stats, months, count, rows, disclosed] = await Promise.all([
		db
			.prepare(`SELECT s.tag_id AS tagId, ${STAR_STAT_COLUMNS} FROM aspect_star_stats s WHERE s.work_id = ?`)
			.bind(work.id)
			.all<StarStatRow & { tagId: string }>(),
		db
			.prepare(
				`SELECT substr(r.written_on, 1, 7) AS month, a.probs_json AS probsJson
				   FROM reviews r
				   JOIN readings rd ON rd.revision_id = r.current_revision_id AND rd.status = 'ok'
				   JOIN reading_answers a ON a.reading_id = rd.id AND a.kind = 'star'
				   JOIN reading_answers m ON m.reading_id = rd.id AND m.kind = 'mention' AND m.tag_id = a.tag_id AND m.value = 'true'
				  WHERE r.work_id = ? AND ${VISIBLE} AND r.disclosure = 'none' AND r.duplicate_of IS NULL
				    AND a.tag_id IN (${registry.domainTags[work.category].map(() => '?').join(', ')})
				  ORDER BY month`
			)
			.bind(work.id, ...registry.domainTags[work.category])
			.all<{ month: string; probsJson: string | null }>(),
		db
			.prepare(`SELECT COUNT(*) AS n FROM reviews r WHERE r.work_id = ? AND ${VISIBLE} AND r.disclosure = 'none' ${tagFilter}`)
			.bind(work.id, ...tagBind)
			.first<{ n: number }>(),
		db
			.prepare(
				`SELECT ${REVIEW_COLUMNS}
				   FROM reviews r JOIN review_revisions v ON v.id = r.current_revision_id
				  WHERE r.work_id = ? AND ${VISIBLE} AND r.disclosure = 'none' ${tagFilter}
				  ORDER BY r.written_on DESC, r.created_at DESC LIMIT ? OFFSET ?`
			)
			.bind(work.id, ...tagBind, PAGE_SIZE, (page - 1) * PAGE_SIZE)
			.all<Parameters<typeof reviewRows>[1][number]>(),
		db
			.prepare(
				`SELECT ${REVIEW_COLUMNS}
				   FROM reviews r JOIN review_revisions v ON v.id = r.current_revision_id
				  WHERE r.work_id = ? AND ${VISIBLE} AND r.disclosure != 'none'
				  ORDER BY r.written_on DESC, r.created_at DESC LIMIT 30`
			)
			.bind(work.id)
			.all<Parameters<typeof reviewRows>[1][number]>()
	]);

	const byMonth = new Map<string, MonthBucket>();
	for (const m of months.results) {
		const levels = parseStarLevels(m.probsJson);
		if (!levels) continue;
		const b = byMonth.get(m.month) ?? { month: m.month, n: 0, soft: [0, 0, 0, 0, 0] };
		b.n += 1;
		levels.forEach((p, i) => (b.soft[i] += p));
		byMonth.set(m.month, b);
	}

	const domain = registry.domainTags[work.category];
	const selected = (await db.prepare('SELECT tag_id FROM work_tags WHERE work_id = ? ORDER BY position').bind(work.id).all<{ tag_id: string }>()).results.map((r) => r.tag_id);
	const statOf = new Map(stats.results.map((s) => [s.tagId, s]));
	const tags: TagStat[] = [...domain, ...selected.filter((id) => !domain.includes(id))].map((id) => {
		const s = statOf.get(id);
		return { tagId: id, label: latest(registry, id).label, domain: domain.includes(id), stat: s ? toStarStat(s) : EMPTY_STAR_STAT };
	});
	const o = statOf.get(OVERALL);

	const total = count?.n ?? 0;
	return {
		work,
		tags,
		overall: o ? toStarStat(o) : EMPTY_STAR_STAT,
		months: byMonth.size >= 2 ? [...byMonth.values()] : [],
		reviews: await reviewRows(db, rows.results, registry),
		disclosed: await reviewRows(db, disclosed.results, registry),
		total,
		page,
		pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE))
	};
}

export interface ReadingStatus {
	/** pending: まだ読んでいない。ok: 読めた。failed: 読み取りに失敗していて、あとで自動でやり直す。 */
	status: 'pending' | 'ok' | 'failed';
	reads: ReviewRow['reads'];
	duplicate: boolean;
	disclosed: boolean;
}

/** レビューの最新の版の読み取りの状況。投稿した直後に、結果を見せるために使う。 */
export async function readingStatus(db: D1Database, reviewId: string, registry: TagRegistry = REGISTRY): Promise<ReadingStatus | null> {
	const row = await db
		.prepare(
			`SELECT r.current_revision_id AS revisionId, v.body AS body, r.written_on AS writtenOn, r.disclosure AS disclosure,
			        r.disclosure_note AS note, (r.duplicate_of IS NOT NULL) AS duplicate,
			        (SELECT COUNT(*) FROM review_revisions x WHERE x.review_id = r.id) AS revisions,
			        (SELECT rd.status FROM readings rd WHERE rd.revision_id = r.current_revision_id
			          ORDER BY (rd.status = 'ok') DESC, rd.updated_at DESC LIMIT 1) AS readStatus
			   FROM reviews r JOIN review_revisions v ON v.id = r.current_revision_id
			  WHERE r.id = ?`
		)
		.bind(reviewId)
		.first<{ revisionId: string; body: string; writtenOn: string; disclosure: string; note: string | null; duplicate: number; revisions: number; readStatus: string | null }>();
	if (!row) return null;
	const [full] = await reviewRows(db, [{ id: reviewId, ...row }], registry);
	return {
		status: row.readStatus === 'ok' ? 'ok' : row.readStatus === 'error' ? 'failed' : 'pending',
		reads: full.reads,
		duplicate: row.duplicate === 1,
		disclosed: row.disclosure !== 'none'
	};
}

export interface SearchHit {
	slug: string;
	name: string;
	category: Category;
	stat: StarStat;
}

/** 検索のために、大文字小文字、全角半角、空白の違いをなくす。 */
export function foldForSearch(text: string): string {
	return text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/** 作品名の部分一致。分野をまたぐ。表示中の作品だけ。名前の短い順（近い順）、同じなら、言及の多い順。 */
export async function searchWorks(db: D1Database, query: string, limit = 30): Promise<SearchHit[]> {
	const needle = foldForSearch(query);
	if (needle === '') return [];
	const { results } = await db
		.prepare(
			`SELECT w.slug AS slug, w.name AS name, w.category AS category, ${STAR_STAT_COLUMNS}
			   FROM works w LEFT JOIN aspect_star_stats s ON s.work_id = w.id AND s.tag_id = ?
			  WHERE w.status = 'active'`
		)
		.bind(OVERALL)
		.all<StarStatRow & { slug: string; name: string; category: Category }>();
	return results
		.map((r) => ({ slug: r.slug, name: r.name, category: r.category, stat: toStarStat(r) }))
		.filter((w) => foldForSearch(w.name).includes(needle))
		.sort((a, b) => a.name.length - b.name.length || b.stat.n - a.stat.n || a.name.localeCompare(b.name, 'ja'))
		.slice(0, limit);
}
