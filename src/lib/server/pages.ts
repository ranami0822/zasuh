import type { D1Database } from '@cloudflare/workers-types';
import type { Category } from './question-sets/types';
import { OVERALL } from './stats';
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
	nMention: number;
	nPos: number;
	nNeg: number;
	nMix: number;
	/** 順位の番号。言及のない作品は null（番号を付けずに、後ろに並べる）。 */
	rank: number | null;
}

/** 分野の中の並び。タグを省くと総合。言及のない作品は、番号なしで後ろに並べる。 */
export async function rankedWorks(db: D1Database, category: Category, tagId?: string): Promise<RankedWork[]> {
	const { results } = await db
		.prepare(
			`SELECT w.slug AS slug, w.name AS name,
			        COALESCE(s.n_mention, 0) AS nMention, COALESCE(s.n_pos, 0) AS nPos,
			        COALESCE(s.n_neg, 0) AS nNeg, COALESCE(s.n_mix, 0) AS nMix, s.score_lower AS scoreLower
			   FROM works w
			   LEFT JOIN aspect_stats s ON s.work_id = w.id AND s.tag_id = ?
			  WHERE w.category = ? AND w.status = 'active'
			  ORDER BY (s.score_lower IS NULL), s.score_lower DESC, COALESCE(s.n_mention, 0) DESC, w.name ASC`
		)
		.bind(tagId ?? OVERALL, category)
		.all<Omit<RankedWork, 'rank'> & { scoreLower: number | null }>();
	let rank = 0;
	return results.map(({ scoreLower, ...row }) => ({ ...row, rank: scoreLower === null || row.nMention === 0 ? null : ++rank }));
}

export interface FeaturedWork {
	slug: string;
	name: string;
	category: Category;
	summary: string | null;
	nReviews: number;
	nMention: number;
	nPos: number;
	nNeg: number;
	nMix: number;
}

/**
 * トップで大きく見せる作品。直近7日に、いちばん多くレビューが投稿された作品。
 * 投稿が1件もなければ、いちばん新しく登録された作品。表示中の作品がなければ null。
 * 公開直後の作品（まだレビューがない）が、そのまま前に出る。
 */
export async function featuredWork(db: D1Database, now: Date): Promise<FeaturedWork | null> {
	const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
	return db
		.prepare(
			`SELECT w.slug AS slug, w.name AS name, w.category AS category, w.summary AS summary,
			        (SELECT COUNT(*) FROM reviews r WHERE r.work_id = w.id AND r.hidden = 0 AND r.disclosure = 'none') AS nReviews,
			        COALESCE(s.n_mention, 0) AS nMention, COALESCE(s.n_pos, 0) AS nPos,
			        COALESCE(s.n_neg, 0) AS nNeg, COALESCE(s.n_mix, 0) AS nMix
			   FROM works w LEFT JOIN aspect_stats s ON s.work_id = w.id AND s.tag_id = ?
			  WHERE w.status = 'active'
			  ORDER BY (SELECT COUNT(*) FROM reviews r WHERE r.work_id = w.id AND r.hidden = 0 AND r.created_at >= ?) DESC,
			           w.created_at DESC
			  LIMIT 1`
		)
		.bind(OVERALL, since)
		.first<FeaturedWork>();
}

export interface TagStat {
	tagId: string;
	label: string;
	domain: boolean;
	nMention: number;
	nPos: number;
	nNeg: number;
	nMix: number;
}

export interface MonthBucket {
	month: string;
	nPos: number;
	nNeg: number;
	nMix: number;
}

export interface ReviewRow {
	id: string;
	body: string;
	writtenOn: string;
	disclosure: string;
	disclosureNote: string | null;
	duplicate: boolean;
	edited: boolean;
	/** 読み取り結果: 触れたタグと向き。読み取りが済んでいなければ空。 */
	reads: { tagId: string; label: string; value: 'positive' | 'negative' | 'mixed' }[];
}

export interface WorkPage {
	work: Work;
	tags: TagStat[];
	overall: { nMention: number; nPos: number; nNeg: number; nMix: number } | null;
	months: MonthBucket[];
	reviews: ReviewRow[];
	disclosed: ReviewRow[];
	total: number;
	page: number;
	pageCount: number;
}

const VISIBLE = 'r.hidden = 0';

async function reviewRows(
	db: D1Database,
	rows: { id: string; revisionId: string; body: string; writtenOn: string; disclosure: string; note: string | null; duplicate: number; revisions: number }[],
	registry: TagRegistry
): Promise<ReviewRow[]> {
	if (rows.length === 0) return [];
	const { results } = await db
		.prepare(
			`SELECT rd.revision_id AS revisionId, a.tag_id AS tagId, a.value AS value
			   FROM readings rd JOIN reading_answers a ON a.reading_id = rd.id
			  WHERE rd.status = 'ok' AND a.kind = 'direction' AND a.value != 'none'
			    AND rd.revision_id IN (${rows.map(() => '?').join(', ')})
			  ORDER BY a.rowid`
		)
		.bind(...rows.map((r) => r.revisionId))
		.all<{ revisionId: string; tagId: string; value: 'positive' | 'negative' | 'mixed' }>();
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
		reads: results.filter((x) => x.revisionId === r.revisionId).map((x) => ({ tagId: x.tagId, label: label(x.tagId), value: x.value }))
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
		                  AND a.kind = 'direction' AND a.value != 'none' AND a.tag_id = ?)`
		: '';
	const tagBind = opts.tag ? [opts.tag] : [];

	const [stats, months, count, rows, disclosed] = await Promise.all([
		db
			.prepare('SELECT tag_id AS tagId, n_mention AS nMention, n_pos AS nPos, n_neg AS nNeg, n_mix AS nMix FROM aspect_stats WHERE work_id = ?')
			.bind(work.id)
			.all<{ tagId: string; nMention: number; nPos: number; nNeg: number; nMix: number }>(),
		db
			.prepare(
				`SELECT substr(r.written_on, 1, 7) AS month, a.value AS value, COUNT(*) AS n
				   FROM reviews r
				   JOIN readings rd ON rd.revision_id = r.current_revision_id AND rd.status = 'ok'
				   JOIN reading_answers a ON a.reading_id = rd.id AND a.kind = 'direction'
				  WHERE r.work_id = ? AND ${VISIBLE} AND r.disclosure = 'none' AND r.duplicate_of IS NULL
				    AND a.tag_id IN (${registry.domainTags[work.category].map(() => '?').join(', ')})
				  GROUP BY month, a.value ORDER BY month`
			)
			.bind(work.id, ...registry.domainTags[work.category])
			.all<{ month: string; value: string; n: number }>(),
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
		const b = byMonth.get(m.month) ?? { month: m.month, nPos: 0, nNeg: 0, nMix: 0 };
		if (m.value === 'positive') b.nPos += m.n;
		else if (m.value === 'negative') b.nNeg += m.n;
		else if (m.value === 'mixed') b.nMix += m.n;
		byMonth.set(m.month, b);
	}

	const domain = registry.domainTags[work.category];
	const selected = (await db.prepare('SELECT tag_id FROM work_tags WHERE work_id = ? ORDER BY position').bind(work.id).all<{ tag_id: string }>()).results.map((r) => r.tag_id);
	const statOf = new Map(stats.results.map((s) => [s.tagId, s]));
	const tags: TagStat[] = [...domain, ...selected.filter((id) => !domain.includes(id))].map((id) => {
		const s = statOf.get(id);
		return {
			tagId: id,
			label: latest(registry, id).label,
			domain: domain.includes(id),
			nMention: s?.nMention ?? 0,
			nPos: s?.nPos ?? 0,
			nNeg: s?.nNeg ?? 0,
			nMix: s?.nMix ?? 0
		};
	});
	const o = statOf.get(OVERALL);

	const total = count?.n ?? 0;
	return {
		work,
		tags,
		overall: o ? { nMention: o.nMention, nPos: o.nPos, nNeg: o.nNeg, nMix: o.nMix } : null,
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
	nMention: number;
	nPos: number;
	nNeg: number;
	nMix: number;
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
			`SELECT w.slug AS slug, w.name AS name, w.category AS category,
			        COALESCE(s.n_mention, 0) AS nMention, COALESCE(s.n_pos, 0) AS nPos,
			        COALESCE(s.n_neg, 0) AS nNeg, COALESCE(s.n_mix, 0) AS nMix
			   FROM works w LEFT JOIN aspect_stats s ON s.work_id = w.id AND s.tag_id = ?
			  WHERE w.status = 'active'`
		)
		.bind(OVERALL)
		.all<SearchHit>();
	return results
		.filter((w) => foldForSearch(w.name).includes(needle))
		.sort((a, b) => a.name.length - b.name.length || b.nMention - a.nMention || a.name.localeCompare(b.name, 'ja'))
		.slice(0, limit);
}
