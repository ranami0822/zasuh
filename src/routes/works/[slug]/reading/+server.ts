import { error, json } from '@sveltejs/kit';
import { readingStatus } from '#server/pages';
import { database, deviceFor } from '#server/request';
import { findOwnReview } from '#server/reviews';
import { getWork } from '#server/works';
import type { RequestHandler } from './$types';

/** 自分のレビューの、読み取りの状況。投稿の直後に、画面が結果を知るために、数秒おきに呼ぶ。 */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const db = database();
	const work = await getWork(db, { slug: params.slug });
	if (!work) error(404, '作品が見つかりません');
	const device = await deviceFor(cookies, url, false);
	const own = device ? await findOwnReview(db, work.id, device, new Date()) : null;
	if (!own) error(404, 'レビューが見つかりません');
	const status = await readingStatus(db, own.reviewId);
	if (!status) error(404, 'レビューが見つかりません');
	return json(status, { headers: { 'cache-control': 'no-store' } });
};
