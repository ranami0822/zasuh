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
		text: `Zasuh の復旧用のメールアドレスとして登録するため、次のリンクを開いて、確認してください（1時間有効）。\n\n${link}\n\n心当たりがなければ、このメールは、無視してください。`
	};
}

export function recoverMail(link: string): { subject: string; text: string } {
	return {
		subject: '【Zasuh】パスキーの復旧',
		text: `パスキーを使えなくなったときの復旧のリンクです。15分以内に開いて、新しいパスキーを登録してください。\n\n${link}\n\n登録すると、これまでのパスキーと、ログイン中の端末は、すべて使えなくなります。\n心当たりがなければ、このメールは、無視してください（リンクを開かなければ、何も変わりません）。`
	};
}
