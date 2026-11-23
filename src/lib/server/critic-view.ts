import type { D1Database } from '@cloudflare/workers-types';
import { type CriticAspect, type CriticItem, type CriticPane, criticDisagrees } from '#critic-pane';
import { CRITIC_ITEMS_MAX } from '#server/critics';
import { STAR_COUNT, starSummary } from '#server/star-stats';

/**
 * 作品ページの専門家の欄（型は #critic-pane）。D1 への問い合わせは、多くて 2 回。
 * 対象は、総合の星（overall_star）が、段階ごとの確率まで読めたレビューだけ。そのうち、
 * 総合の向き（overall_choice）が「言及なし」のもの（星の質問には「言及なし」がなく、小さな不満に引っ張られる）と、
 * 媒体の点数と大きくずれたもの（criticDisagrees）は、並べず、数えない。
 */

/** 観点（critic-v1 の質問の key の頭）と、画面に出す名前。この順で並べる。 */
const ASPECTS: { key: CriticAspect['key']; label: string }[] = [
	{ key: 'gameplay', label: 'ゲーム性' },
	{ key: 'music', label: '音楽' },
	{ key: 'comfort', label: '快適さ' },
	{ key: 'price', label: '価格' }
];
const ASPECT_KEYS = ASPECTS.flatMap((a) => [`${a.key}_noul`, `${a.key}_star`]);

/**
 * OpenCritic の作品ページ。/game/<id> だけでは 404 で、/game/<id>/<名前> の名前の部分は、何でも同じページになる
 * （2026-11-23 に確かめた。名前は保存していないので、'-' を置く）。
 */
const OPENCRITIC = 'https://opencritic.com';

interface Star {
	score: number;
	levels: number[] | null;
}

function parseStar(json: string | null): Star | null {
	if (!json) return null;
	const v = JSON.parse(json) as { score?: unknown; levels?: unknown };
	if (typeof v.score !== 'number') return null;
	const levels = Array.isArray(v.levels) && v.levels.length === STAR_COUNT ? (v.levels as number[]) : null;
	return { score: v.score, levels };
}

export async function getCriticPane(db: D1Database, workId: string): Promise<CriticPane | null> {
	const { results: reviews } = await db
		.prepare(
			`SELECT r.id, r.outlet, r.url, r.published_on AS publishedOn, r.oc_score AS ocScore,
			        a.probs_json AS probsJson, c.value AS overallChoice, w.opencritic_id AS ocId
			   FROM critic_reviews r
			   JOIN critic_answers a ON a.critic_review_id = r.id AND a.question_key = 'overall_star'
			   LEFT JOIN critic_answers c ON c.critic_review_id = r.id AND c.question_key = 'overall_choice'
			   JOIN works w ON w.id = r.work_id
			  WHERE r.work_id = ?
			  ORDER BY r.published_on IS NULL, r.published_on DESC, r.read_at DESC, r.id`
		)
		.bind(workId)
		.all<{
			id: string;
			outlet: string;
			url: string;
			publishedOn: string | null;
			ocScore: number | null;
			probsJson: string | null;
			overallChoice: string | null;
			ocId: number | null;
		}>();

	// 段階ごとの確率がないと、集計（starSummary）に入れられないので、読めていないものとして扱う。
	// 総合の向きの行がないものは、判断できないので、入れる。
	const read = reviews.flatMap((r) => {
		const star = parseStar(r.probsJson);
		if (!star?.levels || r.overallChoice === 'none' || criticDisagrees(star.score, r.ocScore)) return [];
		return [{ ...r, score: star.score, levels: star.levels }];
	});
	if (read.length === 0) return null;

	const shown = read.slice(0, CRITIC_ITEMS_MAX);
	const { results: rows } = await db
		.prepare(
			`SELECT a.critic_review_id AS reviewId, a.question_key AS questionKey, a.value, a.probs_json AS probsJson
			   FROM critic_answers a JOIN critic_reviews r ON r.id = a.critic_review_id
			  WHERE r.work_id = ? AND a.question_key IN (${ASPECT_KEYS.map(() => '?').join(', ')})`
		)
		.bind(workId, ...ASPECT_KEYS)
		.all<{ reviewId: string; questionKey: string; value: string; probsJson: string | null }>();
	const answers = new Map(rows.map((row) => [`${row.reviewId}/${row.questionKey}`, row]));

	const items: CriticItem[] = shown.map((r) => ({
		outlet: r.outlet,
		publishedOn: r.publishedOn,
		url: r.url,
		stars: r.score,
		aspects: ASPECTS.flatMap(({ key, label }) => {
			if (answers.get(`${r.id}/${key}_noul`)?.value !== 'true') return [];
			const star = parseStar(answers.get(`${r.id}/${key}_star`)?.probsJson ?? null);
			return star ? [{ key, label, stars: star.score }] : [];
		})
	}));

	const { n, soft, mean, se } = starSummary(read);
	const ocId = read[0].ocId;
	return { n, soft, mean, se, items, sourceUrl: ocId === null ? OPENCRITIC : `${OPENCRITIC}/game/${ocId}/-` };
}
