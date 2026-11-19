import type { Env } from './env';

export interface Mailer {
	send(message: { to: string; subject: string; text: string }): Promise<void>;
}

/** Cloudflare Email Service の send_email バインディングで送る。バインディングか送信元がなければ、null（メールでの復旧は無効）。 */
export function mailerFrom(env: Pick<Env, 'EMAIL' | 'MAIL_FROM'>): Mailer | null {
	const { EMAIL, MAIL_FROM } = env;
	if (!EMAIL || !MAIL_FROM) return null;
	return {
		async send({ to, subject, text }) {
			await EMAIL.send({ from: MAIL_FROM, to, subject, text });
		}
	};
}

export function verifyMail(link: string): { subject: string; text: string } {
	return {
		subject: '【Zasuh】メールアドレスの確認',
		text: `Zasuh で、このアドレスを復旧用に登録しようとしています。次のリンクを1時間以内に開くと、登録が終わります。\n\n${link}\n\n心当たりがなければ、このメールは無視してください。`
	};
}

export function recoverMail(link: string): { subject: string; text: string } {
	return {
		subject: '【Zasuh】パスキーの復旧',
		text: `パスキーの復旧のリンクです。15分以内に開いて、新しいパスキーを登録してください。\n\n${link}\n\n新しいパスキーを登録すると、これまでのパスキーと、ログイン中の端末はすべて使えなくなります。\n心当たりがなければ、このメールは無視してください。リンクを開かなければ、何も変わりません。`
	};
}
