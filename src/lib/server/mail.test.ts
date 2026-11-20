import { describe, expect, it, vi } from 'vitest';
import { mailerFrom, recoverMail, verifyMail } from './mail';

describe('メール', () => {
	it('送信のバインディングか送信元がなければ、null（メールでの復旧は無効）', () => {
		expect(mailerFrom({})).toBeNull();
		expect(mailerFrom({ MAIL_FROM: 'noreply@example.com' })).toBeNull();
		expect(mailerFrom({ EMAIL: { send: vi.fn() } })).toBeNull();
		expect(mailerFrom({ EMAIL: { send: vi.fn() }, MAIL_FROM: '' })).toBeNull();
	});

	it('バインディングと送信元があれば、送信元を付けて、バインディングに渡す', async () => {
		const send = vi.fn().mockResolvedValue(undefined);
		const mailer = mailerFrom({ EMAIL: { send }, MAIL_FROM: 'noreply@example.com' });
		expect(mailer).not.toBeNull();
		await mailer!.send({ to: 'a@example.com', subject: '件名', text: '本文' });
		expect(send).toHaveBeenCalledWith({ from: 'noreply@example.com', to: 'a@example.com', subject: '件名', text: '本文' });
	});

	it('送信の失敗は、握りつぶさずに、呼び出し元へ伝える', async () => {
		const mailer = mailerFrom({ EMAIL: { send: vi.fn().mockRejectedValue(new Error('rejected')) }, MAIL_FROM: 'noreply@example.com' });
		await expect(mailer!.send({ to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow('rejected');
	});

	it('確認と復旧のメールの文面に、リンクと有効期間が入る', () => {
		const link = 'https://review.anami.party/auth/verify?token=abc';
		const verify = verifyMail(link);
		expect(verify.subject).toContain('Zasuh');
		expect(verify.text).toContain(link);
		expect(verify.text).toContain('1時間');

		const recover = recoverMail('https://review.anami.party/recover/xyz');
		expect(recover.subject).toContain('Zasuh');
		expect(recover.text).toContain('https://review.anami.party/recover/xyz');
		expect(recover.text).toContain('15分');
	});
});
