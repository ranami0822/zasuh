/**
 * 作品の候補を見つけて、承認で作品にする（docs/mvp-design.md の 25 章）。
 * 見つける: OpenCritic の一覧（人気・新作・公開予定）の作品のうち、まだ作品にも候補にもなっていないものを、候補に入れる。
 *   日本語版 Wikipedia の要約が取れれば、候補に添える（承認すると、紹介文になる）。
 * 承認: 作品を作り（分野はゲーム）、OpenCritic の ID と紹介文の出典を結びつける。作品の自動生成はしない（22.1）。承認が唯一の入口。
 */
import type { D1Database } from '@cloudflare/workers-types';
import { linkOpenCritic } from './critics';
import { LIST_KINDS, type ListKind, type OcError, type OcInfo, type OpenCriticListing } from './opencritic';
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

/**
 * ゲームの作品を作り、OpenCritic の ID を結びつける（承認と、自動の取り込みで共通）。
 * 紹介文と出典は、あるときだけ（Wikipedia の要約）。名前は、OpenCritic のもの（あとで、管理画面で直せる）。
 */
async function createGameWork(
	db: D1Database,
	input: { ocId: number; name: string; wiki: { extract: string; title: string | null; url: string | null } | null; autoAdded: boolean },
	now: Date
): Promise<{ ok: true; workId: string } | { ok: false; error: DiscoveryError }> {
	const { ocId, name, wiki } = input;
	if (await db.prepare('SELECT 1 FROM works WHERE opencritic_id = ?').bind(ocId).first()) return { ok: false, error: 'oc_id_taken' };

	const base = slugFor(name);
	// 英数字がない名前、または、すでに使われている名前は、ID を付ける。
	for (const slug of [base, base ? `${base}-${ocId}` : '', `oc-${ocId}`]) {
		if (!slug) continue;
		const created = await createWork(db, { slug, name, category: 'game', url: '', summary: wiki?.extract ?? '' }, now);
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
		await db
			.prepare('UPDATE works SET summary_source_title = ?, summary_source_url = ?, auto_added = ? WHERE id = ?')
			.bind(wiki ? wiki.title : null, wiki ? wiki.url : null, input.autoAdded ? 1 : 0, created.id)
			.run();
		return { ok: true, workId: created.id };
	}
	return { ok: false, error: 'failed' };
}

/** OpenCritic の作品情報を保存する。 */
export async function saveOcInfo(db: D1Database, workId: string, info: OcInfo, now: Date): Promise<void> {
	await db.prepare('UPDATE works SET oc_info = ?, oc_info_at = ? WHERE id = ?').bind(JSON.stringify(info), now.toISOString(), workId).run();
}

/** 承認: 作品を作る。oc があれば、OpenCritic の作品情報も取って保存する（取れなくても、承認は成功）。 */
export async function approveWorkCandidate(
	db: D1Database,
	ocId: number,
	now: Date,
	oc?: Pick<OpenCriticListing, 'gameById'>
): Promise<{ ok: true; workId: string } | { ok: false; error: DiscoveryError }> {
	const c = await db
		.prepare(`SELECT name, wiki_title AS wikiTitle, wiki_extract AS wikiExtract, wiki_url AS wikiUrl FROM work_candidates WHERE oc_id = ? AND status = 'open'`)
		.bind(ocId)
		.first<{ name: string; wikiTitle: string | null; wikiExtract: string | null; wikiUrl: string | null }>();
	if (!c) return { ok: false, error: 'not_found' };
	const created = await createGameWork(
		db,
		{ ocId, name: c.name, wiki: c.wikiExtract ? { extract: c.wikiExtract, title: c.wikiTitle, url: c.wikiUrl } : null, autoAdded: false },
		now
	);
	if (!created.ok) return created;
	await db.prepare(`UPDATE work_candidates SET status = 'approved' WHERE oc_id = ?`).bind(ocId).run();
	if (oc) {
		const detail = await oc.gameById(ocId);
		if (detail.ok) await saveOcInfo(db, created.workId, detail.value.info, now);
	}
	return created;
}

/** 1 日に、自動で作る作品の数（専門家の取得が、1 日の呼び出しを共有するため。docs/mvp-design.md の 26.3）。 */
export const AUTO_IMPORT_LIMIT = 3;

export interface AutoImportResult {
	/** 一覧で見えた作品の数。 */
	listed: number;
	/** 作った作品の数。 */
	added: number;
	/** 作品ではない種類（DLC など）として、飛ばした数。 */
	skipped: number;
	error: OcError | null;
	more: boolean;
}

/**
 * 人気の一覧から、まだ作品にも候補にもなっていないゲームを、承認なしで作品にする（1 回に limit 件まで）。Wikipedia は使わない。
 * DLC・エピソード・拡張は、作品にせず、却下した候補として記録する（毎日、また取らないため）。
 * 作った作品は、auto_added = 1。OpenCritic の ID が付くので、専門家の取得が、そのまま始まる。
 */
export async function autoImportPopular(deps: { db: D1Database; oc: OpenCriticListing; now: Date; limit?: number }): Promise<AutoImportResult> {
	const { db, oc, now } = deps;
	const limit = deps.limit ?? AUTO_IMPORT_LIMIT;
	const result: AutoImportResult = { listed: 0, added: 0, skipped: 0, error: null, more: false };

	const list = await oc.listGames('popular');
	if (!list.ok) return { ...result, error: list.error };
	result.listed = list.value.length;

	const known = new Set<number>();
	const { results: rows } = await db
		.prepare('SELECT opencritic_id AS id FROM works WHERE opencritic_id IS NOT NULL UNION SELECT oc_id AS id FROM work_candidates')
		.all<{ id: number }>();
	for (const r of rows) known.add(r.id);

	for (const game of list.value) {
		if (known.has(game.id)) continue;
		if (result.added >= limit) {
			result.more = true;
			break;
		}
		const detail = await oc.gameById(game.id);
		if (!detail.ok) {
			result.error = detail.error;
			break;
		}
		const d = detail.value;
		if (d.type !== null && d.type !== 'BASE' && d.type !== 'REMAKE' && d.type !== 'REMASTER') {
			await db
				.prepare(`INSERT OR IGNORE INTO work_candidates (oc_id, name, source, status, created_at) VALUES (?, ?, 'auto-skip', 'rejected', ?)`)
				.bind(game.id, d.name, now.toISOString())
				.run();
			result.skipped += 1;
			continue;
		}
		const created = await createGameWork(db, { ocId: game.id, name: d.name, wiki: null, autoAdded: true }, now);
		if (!created.ok) continue;
		await saveOcInfo(db, created.workId, d.info, now);
		result.added += 1;
	}
	return result;
}

const DISCOVERY_HOUR_UTC = 16;
const DISCOVERY_MINUTES_UTC = [10, 11, 12];

/** 自動の取り込みの時間帯（UTC 16:10〜16:12）なら、その日（YYYY-MM-DD）。外なら null。専門家の取得（17:00〜）の前に、作品を作っておくため。 */
export function discoveryDay(now: Date): string | null {
	if (now.getUTCHours() !== DISCOVERY_HOUR_UTC || !DISCOVERY_MINUTES_UTC.includes(now.getUTCMinutes())) return null;
	return now.toISOString().slice(0, 10);
}

/** その日の権利を取る。取れたら true（その日、最初の 1 回）。 */
export async function claimDiscoveryDay(db: D1Database, day: string, now: Date): Promise<boolean> {
	const r = await db.prepare('INSERT OR IGNORE INTO discovery_runs (day, started_at) VALUES (?, ?)').bind(day, now.toISOString()).run();
	return (r.meta.changes ?? 0) > 0;
}

/** 取り込みが失敗して、1 件も作れなかったとき、権利を戻す（時間帯の次の分に、やり直す）。 */
export async function releaseDiscoveryDay(db: D1Database, day: string): Promise<void> {
	await db.prepare('DELETE FROM discovery_runs WHERE day = ?').bind(day).run();
}

export async function rejectWorkCandidate(db: D1Database, ocId: number): Promise<boolean> {
	const r = await db.prepare(`UPDATE work_candidates SET status = 'rejected' WHERE oc_id = ? AND status = 'open'`).bind(ocId).run();
	return (r.meta.changes ?? 0) > 0;
}
