import type { AuthError } from './server/auth';
import type { CriticSyncResult } from './server/critic-sync';
import type { CriticError } from './server/critics';
import type { InboxError } from './server/inbox';
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

export const INBOX_MESSAGES: Record<InboxError, string> = {
	bad_kind: '種類を選び直してください。',
	body_too_short: '内容が短すぎます。5文字以上で書いてください。',
	body_too_long: '内容が長すぎます。2,000文字以内にしてください。',
	contact_too_long: '連絡先が長すぎます。200文字以内にしてください。',
	bad_name: '作品名を、1〜100文字で書いてください。',
	bad_category: '分野を選んでください。',
	bad_url: 'リンクは、http か https で始まる URL にしてください。',
	device_limit: '今日の上限に達しました。明日、もう一度お試しください。',
	ip_limit: 'この回線からの今日の上限に達しました。明日、もう一度お試しください。',
	not_found: '対象が見つかりません。'
};

export const CRITIC_MESSAGES: Record<CriticError, string> = {
	bad_oc_id: 'OpenCritic の作品 ID は、正の整数で入力してください。',
	oc_id_taken: 'その OpenCritic の作品 ID は、別の作品に結びついています。',
	not_found: '対象が見つかりません。',
	not_game: 'OpenCritic の作品 ID は、ゲームの作品にだけ付けられます。'
};

/** 管理画面の「専門家を今すぐ取得」の結果（docs/mvp-design.md の 22.11）。nothing は、done で、取得する作品がなかったとき。日は UTC。 */
export const CRITIC_SYNC_MESSAGES: Record<CriticSyncResult['stopped'] | 'nothing' | 'no_key' | 'no_oc_id' | 'failed', string> = {
	done: 'この作品の、今日の分は、最後まで読みました。',
	nothing: '取得するものはありませんでした。今日（UTC の日付）に読み終えた作品は、次の日まで取得しません。',
	budget: '1回分の上限まで読みました。まだ残りがあります。もう一度押してください。',
	already_ran: 'いま取得したばかりです。1分たってから、もう一度押してください。',
	daily_limit: '今日（UTC の日付）の取得の上限に達しました。次の日に、もう一度押してください。',
	stopped_today: '今日（UTC の日付）の取得は、止まっています（鍵が受け付けられないか、利用枠の残りが少ないため）。次の日に、もう一度押してください。',
	unauthorized: 'OpenCritic が、鍵（OPENCRITIC_API_KEY）を受け付けませんでした。鍵を確かめてください。今日の取得は、ここで止まります。',
	rate_limited: 'OpenCritic か、読み取り（Clef）の利用枠を超えました。今日の取得は、ここで止まります。次の日に、もう一度押してください。',
	clef_failed: '読み取り（Clef）が、続けて失敗しました。この作品は、今日はもう取得しません。',
	no_key: 'OpenCritic の鍵（OPENCRITIC_API_KEY）が設定されていないため、取得できません。',
	no_oc_id: 'OpenCritic の作品 ID がないため、取得できません。先に ID を保存してください。',
	failed: '取得の途中で、失敗しました。少し待ってから、もう一度押してください。'
};

export const KIND_LABEL: Record<string, string> = {
	work_request: '作品の追加依頼',
	contact: 'お問い合わせ',
	dispute: '異議申し立て・削除の依頼'
};

export const AUTH_MESSAGES: Record<AuthError, string> = {
	config: 'このアドレスでは、ログインを使えません。',
	challenge: '確認に失敗しました。もう一度、やり直してください。',
	verify_failed: '確認に失敗しました。もう一度、やり直してください。',
	duplicate_credential: 'このパスキーは、すでに登録されています。',
	unknown_credential: 'このパスキーは、登録されていません。別のパスキーを選ぶか、メールで復旧してください。',
	not_found: '対象が見つかりません。ページを開き直してください。',
	last_credential: '最後のパスキーは、削除できません。先に、別のパスキーを登録してください。',
	stepup_required: '先に、パスキーで本人確認をしてください。',
	bad_email: 'メールアドレスの形が正しくありません。',
	email_disabled: 'メールでの復旧は、まだ使えません。',
	email_taken: 'このメールアドレスは、使えません。',
	bad_code: 'コードが正しくありません。入力を確かめてください（1日の入力回数にも、上限があります）。',
	bad_token: 'このリンクは、使えません（期限切れか、使用済みです）。もう一度、メールを送ってください。'
};
