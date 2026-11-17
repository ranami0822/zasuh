import type { D1Database } from '@cloudflare/workers-types';
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
	status: 'active' | 'hidden';
}

export type WorkError = 'bad_slug' | 'slug_taken' | 'bad_name' | 'bad_category' | 'bad_url' | 'summary_too_long' | 'not_found' | 'bad_tags';

export interface WorkInput {
	slug: string;
	name: string;
	category: string;
	url: string;
	summary: string;
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
	return null;
}

export async function createWork(db: D1Database, input: WorkInput, now: Date): Promise<{ ok: true; id: string } | { ok: false; error: WorkError }> {
	const bad = validate(input);
	if (bad) return { ok: false, error: bad };
	const id = crypto.randomUUID();
	try {
		await db
			.prepare('INSERT INTO works (id, slug, name, category, url, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
			.bind(id, input.slug, input.name.trim(), input.category, input.url.trim() || null, input.summary.trim() || null, now.toISOString())
			.run();
	} catch {
		return { ok: false, error: 'slug_taken' };
	}
	return { ok: true, id };
}

export async function getWork(db: D1Database, by: { id: string } | { slug: string }): Promise<Work | null> {
	const [column, value] = 'id' in by ? ['id', by.id] : ['slug', by.slug];
	return db
		.prepare(`SELECT id, slug, name, category, url, summary, status FROM works WHERE ${column} = ?`)
		.bind(value)
		.first<Work>();
}

/** 名前、リンク、紹介文、表示の状態を直す。slug と分野は変えない（URL と、付いているタグが変わってしまうため）。 */
export async function updateWork(
	db: D1Database,
	id: string,
	input: { name: string; url: string; summary: string; status: string },
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
		.prepare('UPDATE works SET name = ?, url = ?, summary = ?, status = ? WHERE id = ?')
		.bind(input.name.trim(), input.url.trim() || null, input.summary.trim() || null, input.status === 'hidden' ? 'hidden' : 'active', id)
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
