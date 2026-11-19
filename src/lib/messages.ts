import type { AuthError } from './server/auth';
import type { InboxError } from './server/inbox';
import type { Failure } from './server/reviews';

/** 画面に出す文。「何が起きたか」と「次にどうすればよいか」を書く。 */
export const MESSAGES: Record<Failure, string> = {
	work_not_found: 'この作品には投稿できません。一覧から作品を選んでください。',
	body_too_short: '本文が短すぎます。5文字以上で書いてください。',
	body_too_long: '本文は4,000文字までです。',
	bad_disclosure: '作品との関係を選び直してください。',
	note_too_long: 'メモは200文字までです。',
	already_posted: 'この作品にはもう投稿しています。内容を直すときは、編集してください。',
	device_limit: '今日はこれ以上できません。明日また試してください。',
	ip_limit: 'この回線からは、今日はこれ以上できません。明日また試してください。',
	not_found: '見つかりませんでした。ページを開き直してください。',
	edit_limit: '編集できるのは3回までで、もう使い切りました。',
	edit_expired: '編集できるのは投稿から7日までで、もう過ぎています。',
	bad_reason: '通報の理由を選んでください。',
	already_reported: 'このレビューは通報済みです。'
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

export const INBOX_MESSAGES: Record<InboxError, string> = {
	bad_kind: '問い合わせの種類を選んでください。',
	body_too_short: '内容は5文字以上で書いてください。',
	body_too_long: '内容は2,000文字までです。',
	contact_too_long: '連絡先は200文字までです。',
	bad_name: '作品名は1〜100文字で書いてください。',
	bad_category: '分野を選んでください。',
	bad_url: 'リンクは http:// か https:// で始まる URL にしてください。',
	device_limit: '今日はこれ以上できません。明日また試してください。',
	ip_limit: 'この回線からは、今日はこれ以上できません。明日また試してください。',
	not_found: '見つかりませんでした。'
};

export const KIND_LABEL: Record<string, string> = {
	work_request: '作品の追加依頼',
	contact: 'お問い合わせ',
	dispute: '異議申し立て・削除の依頼'
};

export const AUTH_MESSAGES: Record<AuthError, string> = {
	config: 'このページのアドレスでは、ログインできません。',
	challenge: '確認できませんでした。もう一度試してください。',
	verify_failed: '確認できませんでした。もう一度試してください。',
	duplicate_credential: 'このパスキーは登録済みです。',
	unknown_credential: 'このパスキーは登録されていません。別のパスキーを選ぶか、「パスキーを使えない」から復旧してください。',
	not_found: '見つかりませんでした。ページを開き直してください。',
	last_credential: 'パスキーが1つしかないので、削除できません。先に別のパスキーを登録してください。',
	stepup_required: 'この操作の前に、パスキーで本人確認をしてください。',
	bad_email: 'メールアドレスの書き方を確かめてください。',
	email_disabled: 'メールでの復旧は、いまは使えません。',
	email_taken: 'このメールアドレスは使えません。',
	bad_code: 'コードが違います。入力を確かめてください。1日に試せる回数には上限があります。',
	bad_token: 'このリンクは期限切れか、使用済みです。もう一度メールを送ってください。'
};
