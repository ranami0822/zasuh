/**
 * 作品の候補を見つけて、承認で作品にする（docs/mvp-design.md の 25 章）。
 * 見つける: OpenCritic の一覧（人気・新作・公開予定）の作品のうち、まだ作品にも候補にもなっていないものを、候補に入れる。
 *   日本語版 Wikipedia の要約が取れれば、候補に添える（承認すると、紹介文になる）。
 * 承認: 作品を作り（分野はゲーム）、OpenCritic の ID と紹介文の出典を結びつける。作品の自動生成はしない（22.1）。承認が唯一の入口。
 */
import type { D1Database } from '@cloudflare/workers-types';
import { linkOpenCritic } from './critics';
import { LIST_KINDS, type ListKind, type OcError, type OpenCriticListing } from './opencritic';
import type { WikipediaClient } from './wikipedia';
import { createWork } from './works';

/** 1回の操作で、候補にする作品の数。Wikipedia へ 1 件 2 回、一覧へ 3 回で、無料の Workers の通信数（50 と記憶。未確認）に収まる。 */
export const DISCOVER_LIMIT = 8;

export type DiscoveryError = 'not_found' | 'oc_id_taken' | 'failed';

export interface DiscoverResult {
	/** 一覧で見えた作品の数（重なりは数えない）。 */
	listed: number;
	/** 新しく、候補に入れた数。 */
	added: number;
	/** そのうち、Wikipedia の要約が付いた数。 */
	withSummary: number;
	/** 一覧の取得で止まったとき、その理由。 */
	error: OcError | null;
	/** 上限で、まだ残りがあるか。 */
	more: boolean;
}

/** 紹介文は 500 文字まで（works の決まり）。文の切れ目（。）で切り、なければ、499 文字と「…」。 */
export function fitSummary(text: string, max = 500): string {
	const chars = [...text.trim()];
	if (chars.length <= max) return chars.join('');
	const head = chars.slice(0, max).join('');
	const cut = head.lastIndexOf('。');
	return cut >= 0 ? head.slice(0, cut + 1) : `${chars.slice(0, max - 1).join('')}…`;
}

/** URL 用の名前の案。英数字だけ残す。空（日本語だけの名前など）なら、呼び出し側が ID を使う。 */
export function slugFor(name: string): string {
	return name
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60)
		.replace(/-+$/, '');
}

export async function discoverCandidates(deps: {
	db: D1Database;
	oc: OpenCriticListing;
	wiki: WikipediaClient;
	now: Date;
	kinds?: readonly ListKind[];
	limit?: number;
}): Promise<DiscoverResult> {
	const { db, oc, wiki, now } = deps;
	const limit = deps.limit ?? DISCOVER_LIMIT;
	const result: DiscoverResult = { listed: 0, added: 0, withSummary: 0, error: null, more: false };

	const seen = new Map<number, { name: string; source: ListKind }>();
	for (const kind of deps.kinds ?? LIST_KINDS) {
		const r = await oc.listGames(kind);
		if (!r.ok) {
			result.error = r.error;
			break;
		}
		for (const g of r.value) if (!seen.has(g.id)) seen.set(g.id, { name: g.name, source: kind });
	}
	result.listed = seen.size;
	if (seen.size === 0) return result;

	// 作品になっている、または候補になっている ID は、飛ばす（却下したものも、また出さない）。
	const known = new Set<number>();
	const { results: rows } = await db
		.prepare('SELECT opencritic_id AS id FROM works WHERE opencritic_id IS NOT NULL UNION SELECT oc_id AS id FROM work_candidates')
		.all<{ id: number }>();
	for (const r of rows) known.add(r.id);

	for (const [id, game] of seen) {
		if (known.has(id)) continue;
		if (result.added >= limit) {
			result.more = true;
			break;
		}
		const wikiSummary = await wiki.findSummary(game.name);
		await db
			.prepare('INSERT OR IGNORE INTO work_candidates (oc_id, name, source, wiki_title, wiki_extract, wiki_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
			.bind(id, game.name, game.source, wikiSummary?.title ?? null, wikiSummary ? fitSummary(wikiSummary.extract) : null, wikiSummary?.url ?? null, now.toISOString())
			.run();
		result.added += 1;
		if (wikiSummary) result.withSummary += 1;
	}
	return result;
}

export interface WorkCandidate {
	ocId: number;
	name: string;
	source: string;
	wikiTitle: string | null;
	wikiExtract: string | null;
	wikiUrl: string | null;
}

export async function openWorkCandidates(db: D1Database): Promise<WorkCandidate[]> {
	const { results } = await db
		.prepare(
			`SELECT oc_id AS ocId, name, source, wiki_title AS wikiTitle, wiki_extract AS wikiExtract, wiki_url AS wikiUrl
			   FROM work_candidates WHERE status = 'open' ORDER BY created_at, oc_id`
		)
		.all<WorkCandidate>();
	return results;
}

/** 承認: 作品を作る。紹介文は、Wikipedia の要約（なければ空）。名前は、OpenCritic のもの（承認のあとに、管理画面で直せる）。 */
export async function approveWorkCandidate(db: D1Database, ocId: number, now: Date): Promise<{ ok: true; workId: string } | { ok: false; error: DiscoveryError }> {
	const c = await db
		.prepare(`SELECT name, wiki_title AS wikiTitle, wiki_extract AS wikiExtract, wiki_url AS wikiUrl FROM work_candidates WHERE oc_id = ? AND status = 'open'`)
		.bind(ocId)
		.first<{ name: string; wikiTitle: string | null; wikiExtract: string | null; wikiUrl: string | null }>();
	if (!c) return { ok: false, error: 'not_found' };
	if (await db.prepare('SELECT 1 FROM works WHERE opencritic_id = ?').bind(ocId).first()) return { ok: false, error: 'oc_id_taken' };

	const base = slugFor(c.name);
	// 英数字がない名前、または、すでに使われている名前は、ID を付ける。
	for (const slug of [base, base ? `${base}-${ocId}` : '', `oc-${ocId}`]) {
		if (!slug) continue;
		const created = await createWork(db, { slug, name: c.name, category: 'game', url: '', summary: c.wikiExtract ?? '' }, now);
		if (!created.ok) {
			if (created.error === 'slug_taken') continue;
			return { ok: false, error: 'failed' };
		}
		const linked = await linkOpenCritic(db, created.id, String(ocId), now);
		if (!linked.ok) {
			// 作りかけの作品を残さない（このとき、作品は作ったばかりで、レビューも何もない）。
			await db.prepare('DELETE FROM works WHERE id = ?').bind(created.id).run();
			return { ok: false, error: linked.error === 'oc_id_taken' ? 'oc_id_taken' : 'failed' };
		}
		await db.batch([
			db.prepare('UPDATE works SET summary_source_title = ?, summary_source_url = ? WHERE id = ?').bind(c.wikiExtract ? c.wikiTitle : null, c.wikiExtract ? c.wikiUrl : null, created.id),
			db.prepare(`UPDATE work_candidates SET status = 'approved' WHERE oc_id = ?`).bind(ocId)
		]);
		return { ok: true, workId: created.id };
	}
	return { ok: false, error: 'failed' };
}

export async function rejectWorkCandidate(db: D1Database, ocId: number): Promise<boolean> {
	const r = await db.prepare(`UPDATE work_candidates SET status = 'rejected' WHERE oc_id = ? AND status = 'open'`).bind(ocId).run();
	return (r.meta.changes ?? 0) > 0;
}
