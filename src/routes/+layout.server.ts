import { database, deviceFor } from '#server/request';
import { findReviewer } from '#server/reviews';
import type { LayoutServerLoad } from './$types';

/** ログインしているか（パスキーのアカウントの端末か）。ヘッダーの表示に使う。 */
export const load: LayoutServerLoad = async ({ cookies, url }) => {
	const device = await deviceFor(cookies, url, false);
	if (!device) return { account: false };
	const db = database();
	const reviewerId = await findReviewer(db, device);
	if (!reviewerId) return { account: false };
	const row = await db.prepare('SELECT kind FROM reviewers WHERE id = ?').bind(reviewerId).first<{ kind: string }>();
	return { account: row?.kind === 'passkey' };
};
