import type { Failure } from './server/reviews';

/** 画面に出す文。「何が起きたか」と「次にどうすればよいか」を書く。 */
export const MESSAGES: Record<Failure, string> = {
	work_not_found: 'この作品には投稿できません。一覧から選び直してください。',
	body_too_short: '本文が短すぎます。5文字以上で、具体的に書いてください。',
	body_too_long: '本文が長すぎます。4,000文字以内にしてください。',
	bad_disclosure: '利害関係の選択が正しくありません。選び直してください。',
	note_too_long: 'メモが長すぎます。200文字以内にしてください。',
	already_posted: 'この作品には、すでに投稿しています。直すときは、編集してください。',
	device_limit: '今日の上限に達しました。明日、もう一度お試しください。',
	ip_limit: 'この回線からの今日の上限に達しました。明日、もう一度お試しください。',
	not_found: '対象が見つかりません。ページを開き直してください。',
	edit_limit: '編集できる回数（3回）を使い切りました。',
	edit_expired: '編集できる期間（投稿から7日）を過ぎました。',
	bad_reason: '理由を選び直してください。',
	already_reported: 'このレビューは、すでに通報しています。'
};

export const DISCLOSURE_LABEL: Record<string, string> = {
	none: 'なし',
	developer: '開発者',
	affiliated: '関係者',
	other: 'その他'
};

export const REASON_LABEL: Record<string, string> = {
	abuse: '誹謗中傷・荒らし',
	spam: '宣伝・スパム',
	conflict: '利害関係の未申告',
	other: 'その他'
};

export const CATEGORY_LABEL: Record<'game' | 'software', string> = { game: 'ゲーム', software: 'ソフトウェア' };
