import type { D1Database } from '@cloudflare/workers-types';
import { bandFor } from '#band';
import { readOcInfo, type OcInfo } from './opencritic';
import type { Category } from './question-sets/types';
import { REGISTRY, setWorkTags, type TagRegistry } from './tags';

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const CATEGORIES: readonly Category[] = ['game', 'software'];
export { CATEGORY_LABEL } from '../messages';

export interface Work {
	id: string;
	slug: string;
	name: string;
	category: Category;
	url: string | null;
	summary: string | null;
	/** 紹介文の出典（Wikipedia の記事名と URL）。自分で書いた紹介文なら、どちらも null。 */
	summarySourceTitle: string | null;
	summarySourceUrl: string | null;
	/** OpenCritic の作品情報（自動の取り込みと、承認のときに入る）。なければ null。 */
	ocInfo: OcInfo | null;
	/** タイトルの帯の色（#rrggbb）。どちらも null なら、既定の灰色。 */
	bandFrom: string | null;
	bandTo: string | null;
	status: 'active' | 'hidden';
}

export type WorkError = 'bad_slug' | 'slug_taken' | 'bad_name' | 'bad_category' | 'bad_url' | 'summary_too_long' | 'not_found' | 'bad_tags' | 'bad_band';

export interface WorkInput {
	slug: string;
	name: string;
	category: string;
	url: string;
	summary: string;
	/** 空なら、既定の灰色。指定するときは、2つとも。 */
	bandFrom?: string;
	bandTo?: string;
}

function validate(input: WorkInput): WorkError | null {
	if (!SLUG_PATTERN.test(input.slug)) return 'bad_slug';
	const name = input.name.trim();
	if (name.length === 0 || [...name].length > 100) return 'bad_name';
	if (!(CATEGORIES as readonly string[]).includes(input.category)) return 'bad_category';
	if (input.url.trim()) {
		try {
			const u = new URL(input.url.trim());
			if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'bad_url';
		} catch {
			return 'bad_url';
		}
	}
	if ([...input.summary].length > 500) return 'summary_too_long';
	const from = input.bandFrom?.trim() ?? '';
	const to = input.bandTo?.trim() ?? '';
	if ((from || to) && !bandFor(from, to)) return 'bad_band';
	return null;
}

/** 帯の色を、保存する形（小文字の #rrggbb。指定がなければ、2つとも null）にそろえる。validate のあとに呼ぶ。 */
function bandColumns(input: { bandFrom?: string; bandTo?: string }): [string | null, string | null] {
	const from = input.bandFrom?.trim().toLowerCase() ?? '';
	const to = input.bandTo?.trim().toLowerCase() ?? '';
	return from && to ? [from, to] : [null, null];
}

export async function createWork(db: D1Database, input: WorkInput, now: Date): Promise<{ ok: true; id: string } | { ok: false; error: WorkError }> {
	const bad = validate(input);
	if (bad) return { ok: false, error: bad };
	const id = crypto.randomUUID();
	try {
		await db
			.prepare('INSERT INTO works (id, slug, name, category, url, summary, band_from, band_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
			.bind(id, input.slug, input.name.trim(), input.category, input.url.trim() || null, input.summary.trim() || null, ...bandColumns(input), now.toISOString())
			.run();
	} catch {
		return { ok: false, error: 'slug_taken' };
	}
	return { ok: true, id };
}

export async function getWork(db: D1Database, by: { id: string } | { slug: string }): Promise<Work | null> {
	const [column, value] = 'id' in by ? ['id', by.id] : ['slug', by.slug];
	const row = await db
		.prepare(
			`SELECT id, slug, name, category, url, summary, summary_source_title AS summarySourceTitle, summary_source_url AS summarySourceUrl,
			        band_from AS bandFrom, band_to AS bandTo, status, oc_info AS ocInfo
			   FROM works WHERE ${column} = ?`
		)
		.bind(value)
		.first<Omit<Work, 'ocInfo'> & { ocInfo: string | null }>();
	return row ? { ...row, ocInfo: readOcInfo(row.ocInfo) } : null;
}

/** 名前、リンク、紹介文、表示の状態を直す。slug と分野は変えない（URL と、付いているタグが変わってしまうため）。 */
export async function updateWork(
	db: D1Database,
	id: string,
	input: { name: string; url: string; summary: string; status: string; bandFrom?: string; bandTo?: string },
	tagIds: string[],
	now: Date,
	registry: TagRegistry = REGISTRY
): Promise<{ ok: true } | { ok: false; error: WorkError }> {
	const work = await getWork(db, { id });
	if (!work) return { ok: false, error: 'not_found' };
	const bad = validate({ slug: work.slug, category: work.category, ...input });
	if (bad) return { ok: false, error: bad };
	const allowed = new Set(registry.extraTags[work.category]);
	if (tagIds.some((t) => !allowed.has(t))) return { ok: false, error: 'bad_tags' };
	try {
		await setWorkTags(db, work, tagIds, now, registry);
	} catch {
		return { ok: false, error: 'bad_tags' };
	}
	await db
		// 紹介文の出典は、紹介文が空になったときだけ消す（手を入れても、Wikipedia の文を元にしている）。
		.prepare(
			`UPDATE works SET name = ?, url = ?, summary = ?, band_from = ?, band_to = ?, status = ?,
			        summary_source_title = CASE WHEN ? THEN summary_source_title END,
			        summary_source_url = CASE WHEN ? THEN summary_source_url END
			  WHERE id = ?`
		)
		.bind(
			input.name.trim(),
			input.url.trim() || null,
			input.summary.trim() || null,
			...bandColumns(input),
			input.status === 'hidden' ? 'hidden' : 'active',
			input.summary.trim() ? 1 : 0,
			input.summary.trim() ? 1 : 0,
			id
		)
		.run();
	return { ok: true };
}

export async function selectedTagIds(db: D1Database, workId: string): Promise<string[]> {
	const { results } = await db
		.prepare('SELECT tag_id FROM work_tags WHERE work_id = ? ORDER BY position')
		.bind(workId)
		.all<{ tag_id: string }>();
	return results.map((r) => r.tag_id);
}
