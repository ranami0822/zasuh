import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	accountEmail,
	checkEmailToken,
	confirmEmail,
	deleteCredential,
	finishLogin,
	finishRecovery,
	finishRegistration,
	hasRecentStepup,
	issueDevice,
	listCredentials,
	loginOptions,
	logout,
	logoutEverywhere,
	normalizeEmail,
	removeEmail,
	markStepup,
	mergeAnonymous,
	recoveryRegistrationOptions,
	registrationOptions,
	requestRecovery,
	setEmail,
	adoptDevice,
	authConfigFor,
	createRecoveryCode,
	generateRecoveryCode,
	normalizeRecoveryCode,
	recoveryCodeInfo,
	redeemRecoveryCode,
	CHALLENGE_TTL_MS,
	STEPUP_TTL_MS,
	type AuthConfig
} from './auth';
import type { Mailer } from './mail';
import { DEVICE_TTL_MS, deviceTokenHash, findReviewer, ipDayHash } from './reviews';
import { TestAuthenticator } from './testing/authenticator';
import { addWork, createClock, createTestDb } from './testing/db';

const cfg: AuthConfig = { rpID: 'localhost', rpName: 'Zasuh', origin: 'http://localhost:8787' };

describe('パスキーと、メールでの復旧', () => {
	let db: D1Database;
	let dispose: () => Promise<void>;
	let clock: ReturnType<typeof createClock>;
	let sent: { to: string; subject: string; text: string }[];
	let mailer: Mailer;

	beforeEach(async () => {
		({ db, dispose } = await createTestDb());
		clock = createClock('2026-11-18T03:00:00.000Z');
		sent = [];
		mailer = { send: async (m) => void sent.push(m) };
	});
	afterEach(() => dispose());

	const reviewer = async (kind: 'anon' | 'passkey' = 'anon', tokenHash: string | null = null) => {
		const id = crypto.randomUUID();
		await db.prepare('INSERT INTO reviewers (id, kind, token_hash, created_at) VALUES (?, ?, ?, ?)').bind(id, kind, tokenHash, clock.now().toISOString()).run();
		return id;
	};
	const register = async (reviewerId: string, auth = new TestAuthenticator()) => {
		const options = await registrationOptions(db, cfg, reviewerId, clock.now());
		const result = await finishRegistration(db, cfg, reviewerId, await auth.register(options), clock.now());
		return { auth, options, result };
	};
	const login = async (auth: TestAuthenticator, over: Parameters<TestAuthenticator['authenticate']>[1] = {}) => {
		const options = await loginOptions(db, cfg, clock.now());
		return finishLogin(db, cfg, await auth.authenticate(options, over), clock.now());
	};
	const link = (text: string) => text.match(/https?:\/\/\S+/)![0];
	const tokenOf = (text: string) => link(text).split(/[=/]/).pop()!;

	describe('登録', () => {
		it('オプション: ES256 だけ、発見可能な資格情報を必須、証明なし、RP ID はホスト名そのもの', async () => {
			const id = await reviewer();
			const o = await registrationOptions(db, cfg, id, clock.now());
			expect(o.rp.id).toBe('localhost');
			expect(o.pubKeyCredParams.map((p) => p.alg)).toEqual([-7]);
			expect(o.authenticatorSelection).toMatchObject({ residentKey: 'required' });
			expect(o.attestation).toBe('none');
			expect(o.excludeCredentials).toEqual([]);
			expect(o.user.name).not.toContain('@');
		});

		it('登録できる。投稿者が、パスキーのアカウントになる。公開鍵と、同期できる印を保存する', async () => {
			const id = await reviewer();
			const { result, auth } = await register(id, new TestAuthenticator({ backedUp: true }));
			expect(result).toMatchObject({ ok: true, credentialId: auth.id });
			expect(await db.prepare('SELECT kind, user_handle FROM reviewers WHERE id = ?').bind(id).first()).toMatchObject({ kind: 'passkey' });
			const [c] = await listCredentials(db, id);
			expect(c).toMatchObject({ id: auth.id, deviceType: 'multiDevice', backedUp: true });
			const row = await db.prepare('SELECT public_key FROM credentials').first<{ public_key: string }>();
			expect(row!.public_key.length).toBeGreaterThan(40);
		});

		it('同じ応答の使い回し（リプレイ）は、チャレンジが消えているので、通らない', async () => {
			const id = await reviewer();
			const auth = new TestAuthenticator();
			const options = await registrationOptions(db, cfg, id, clock.now());
			const response = await auth.register(options);
			expect((await finishRegistration(db, cfg, id, response, clock.now())).ok).toBe(true);
			expect(await finishRegistration(db, cfg, id, response, clock.now())).toEqual({ ok: false, error: 'verify_failed' });
		});

		it('origin が違う、RP ID が違う、チャレンジの期限切れ、ほかのアカウントのチャレンジは、通らない', async () => {
			const id = await reviewer();
			const other = await reviewer();
			const a = new TestAuthenticator();
			let o = await registrationOptions(db, cfg, id, clock.now());
			expect(await finishRegistration(db, cfg, id, await a.register(o, { origin: 'https://evil.example' }), clock.now())).toEqual({ ok: false, error: 'verify_failed' });
			o = await registrationOptions(db, cfg, id, clock.now());
			expect(await finishRegistration(db, cfg, id, await a.register(o, { rpID: 'evil.example' }), clock.now())).toEqual({ ok: false, error: 'verify_failed' });
			o = await registrationOptions(db, cfg, id, clock.now());
			clock.advance(CHALLENGE_TTL_MS + 1);
			expect(await finishRegistration(db, cfg, id, await a.register(o), clock.now())).toEqual({ ok: false, error: 'verify_failed' });
			o = await registrationOptions(db, cfg, id, clock.now());
			expect(await finishRegistration(db, cfg, other, await a.register(o), clock.now())).toEqual({ ok: false, error: 'verify_failed' });
			expect(await listCredentials(db, id)).toEqual([]);
		});

		it('同じクレデンシャル ID は、別のアカウントに、上書きして登録できない。もとのパスキーは、変わらない', async () => {
			const a = await reviewer();
			const b = await reviewer();
			const { auth } = await register(a);
			const before = await db.prepare('SELECT public_key FROM credentials WHERE id = ?').bind(auth.id).first();
			const options = await registrationOptions(db, cfg, b, clock.now());
			expect(await finishRegistration(db, cfg, b, await auth.register(options), clock.now())).toEqual({ ok: false, error: 'duplicate_credential' });
			expect(await db.prepare('SELECT public_key, reviewer_id FROM credentials WHERE id = ?').bind(auth.id).first()).toEqual({ ...before, reviewer_id: a });
			expect(await listCredentials(db, b)).toEqual([]);
		});

		it('2つ目のパスキーを足せる。登録済みのものは、excludeCredentials に入る', async () => {
			const id = await reviewer();
			const { auth } = await register(id);
			const options = await registrationOptions(db, cfg, id, clock.now());
			expect(options.excludeCredentials?.map((c) => c.id)).toEqual([auth.id]);
			expect((await finishRegistration(db, cfg, id, await new TestAuthenticator().register(options), clock.now())).ok).toBe(true);
			expect(await listCredentials(db, id)).toHaveLength(2);
		});
	});

	describe('乱用への備え', () => {
		it('ログインの開始は、誰でも呼べるので、有効なチャレンジは、新しい 4,000 件に収まる', async () => {
			const values = Array.from({ length: 4010 }, (_, i) => `('c${i}', 'login', NULL, NULL, '2099-01-01T00:00:00.000Z', '2026-11-18T03:00:${String(Math.floor(i / 100)).padStart(2, '0')}.${String(i % 100).padStart(3, '0')}Z')`);
			for (let i = 0; i < values.length; i += 500) {
				await db.prepare(`INSERT INTO challenges (challenge, purpose, reviewer_id, ref, expires_at, created_at) VALUES ${values.slice(i, i + 500).join(',')}`).run();
			}
			await loginOptions(db, cfg, new Date('2026-11-18T04:00:00.000Z'));
			const row = await db.prepare('SELECT COUNT(*) AS n FROM challenges').first<{ n: number }>();
			expect(row!.n).toBeLessThanOrEqual(4000);
			expect((await db.prepare("SELECT COUNT(*) AS n FROM challenges WHERE challenge = 'c4009'").first<{ n: number }>())!.n).toBe(1); // 新しいものは、残る
		}, 60_000);
	});

	describe('ログインと、本人確認', () => {
		it('パスキーで、ログインできる。署名の回数が進み、最後に使った日が付く', async () => {
			const id = await reviewer();
			const { auth } = await register(id);
			clock.advance(60_000);
			expect(await login(auth)).toEqual({ ok: true, reviewerId: id });
			const [c] = await listCredentials(db, id);
			expect(c.lastUsedAt).toBe(clock.now().toISOString());
			expect(await db.prepare('SELECT counter FROM credentials').first()).toEqual({ counter: 1 });
		});

		it('知らないパスキー、署名の改ざん、リプレイ、違う origin は、通らない', async () => {
			const id = await reviewer();
			const { auth } = await register(id);
			expect(await login(new TestAuthenticator())).toEqual({ ok: false, error: 'unknown_credential' });
			expect(await login(auth, { origin: 'https://evil.example' })).toEqual({ ok: false, error: 'verify_failed' });

			// 署名を改ざんした応答は、通らない。チャレンジは、失敗しても消える（同じチャレンジで、何度も試せない）。
			const options = await loginOptions(db, cfg, clock.now());
			const response = await auth.authenticate(options);
			const tampered = { ...response, response: { ...response.response, signature: response.response.signature.replace(/.$/, response.response.signature.endsWith('A') ? 'B' : 'A') } };
			expect(await finishLogin(db, cfg, tampered, clock.now())).toEqual({ ok: false, error: 'verify_failed' });
			expect(await finishLogin(db, cfg, response, clock.now())).toEqual({ ok: false, error: 'verify_failed' });

			// 正しい応答は、1回だけ通る。同じ応答の2回目（リプレイ）は、通らない。
			const valid = await auth.authenticate(await loginOptions(db, cfg, clock.now()));
			expect((await finishLogin(db, cfg, valid, clock.now())).ok).toBe(true);
			expect(await finishLogin(db, cfg, valid, clock.now())).toEqual({ ok: false, error: 'verify_failed' });
		});

		it('用途の違うチャレンジは、使えない（本人確認のチャレンジで、ログインはできない）', async () => {
			const id = await reviewer();
			const { auth } = await register(id);
			const stepup = await loginOptions(db, cfg, clock.now(), { purpose: 'stepup', reviewerId: id });
			expect(await finishLogin(db, cfg, await auth.authenticate(stepup), clock.now())).toEqual({ ok: false, error: 'verify_failed' });
		});

		it('本人確認は、そのアカウントのパスキーだけ。直前（5分以内）の認証が、端末に記録される', async () => {
			const a = await reviewer();
			const b = await reviewer();
			const { auth: authA } = await register(a);
			const { auth: authB } = await register(b);
			const options = await loginOptions(db, cfg, clock.now(), { purpose: 'stepup', reviewerId: a });
			expect(await finishLogin(db, cfg, await authB.authenticate(options), clock.now(), { purpose: 'stepup', reviewerId: a })).toEqual({ ok: false, error: 'unknown_credential' });
			const ok = await finishLogin(db, cfg, await authA.authenticate(await loginOptions(db, cfg, clock.now(), { purpose: 'stepup', reviewerId: a })), clock.now(), { purpose: 'stepup', reviewerId: a });
			expect(ok).toEqual({ ok: true, reviewerId: a });

			const token = await issueDevice(db, a, clock.now());
			const hash = await deviceTokenHash(token);
			expect(await hasRecentStepup(db, hash, clock.now())).toBe(false);
			await markStepup(db, hash, clock.now());
			expect(await hasRecentStepup(db, hash, clock.now())).toBe(true);
			clock.advance(STEPUP_TTL_MS + 1);
			expect(await hasRecentStepup(db, hash, clock.now())).toBe(false);
		});
	});

	describe('ログイン中の端末', () => {
		it('端末の印で、アカウントを見つけられる。期限が切れたら、ログインなしに戻る。使うと、期限が延びる', async () => {
			const id = await reviewer('passkey');
			const token = await issueDevice(db, id, clock.now());
			const hash = await deviceTokenHash(token);
			expect(await findReviewer(db, hash, clock.now())).toBe(id);
			clock.advance(DEVICE_TTL_MS - 60_000);
			expect(await findReviewer(db, hash, clock.now())).toBe(id);
			clock.advance(DEVICE_TTL_MS - 60_000); // 延びているので、まだ有効
			expect(await findReviewer(db, hash, clock.now())).toBe(id);
			clock.advance(DEVICE_TTL_MS + 1);
			expect(await findReviewer(db, hash, clock.now())).toBeNull();
			expect(await db.prepare('SELECT COUNT(*) AS n FROM device_tokens').first()).toEqual({ n: 0 });
		});

		it('ログアウト、全端末のログアウト', async () => {
			const id = await reviewer('passkey');
			const t1 = await deviceTokenHash(await issueDevice(db, id, clock.now()));
			const t2 = await deviceTokenHash(await issueDevice(db, id, clock.now()));
			await logout(db, t1);
			expect(await findReviewer(db, t1, clock.now())).toBeNull();
			expect(await findReviewer(db, t2, clock.now())).toBe(id);
			await logoutEverywhere(db, id);
			expect(await findReviewer(db, t2, clock.now())).toBeNull();
		});

		it('登録のとき、この端末の「ログインなしの印」が、アカウントの端末になる。投稿済みのレビューは、そのまま自分のもの', async () => {
			const hash = await deviceTokenHash('anon-cookie');
			const id = await reviewer('anon', hash);
			const work = await addWork(db);
			await db
				.prepare('INSERT INTO reviews (id, work_id, reviewer_id, current_revision_id, written_on, created_at) VALUES (?, ?, ?, ?, ?, ?)')
				.bind('r1', work, id, 'v1', '2026-11-17', '2026-11-17T00:00:00Z')
				.run();
			await adoptDevice(db, id, hash, clock.now());
			expect(await findReviewer(db, hash, clock.now())).toBe(id);
			expect(await db.prepare('SELECT token_hash FROM reviewers WHERE id = ?').bind(id).first()).toEqual({ token_hash: null });
			await logoutEverywhere(db, id);
			expect(await findReviewer(db, hash, clock.now())).toBeNull(); // 取り消したので、もう、この印では入れない
		});

		it('別の端末でログインしたとき、その端末の、ログインなしの投稿を、アカウントにまとめる。同じ作品に両方あれば、まとめない', async () => {
			const account = await reviewer('passkey');
			const anon = await reviewer('anon', 'h');
			const [w1, w2] = [await addWork(db), await addWork(db)];
			const put = (id: string, work: string, reviewer: string) =>
				db.prepare('INSERT INTO reviews (id, work_id, reviewer_id, current_revision_id, written_on, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, work, reviewer, `v-${id}`, '2026-11-17', '2026-11-17T00:00:00Z').run();
			await put('mine1', w1, account);
			await put('anon1', w1, anon); // 同じ作品: まとめない
			await put('anon2', w2, anon);
			await mergeAnonymous(db, anon, account);
			const { results } = await db.prepare('SELECT id, reviewer_id FROM reviews ORDER BY id').all();
			expect(results).toEqual([
				{ id: 'anon1', reviewer_id: anon },
				{ id: 'anon2', reviewer_id: account },
				{ id: 'mine1', reviewer_id: account }
			]);
			// アカウント同士は、まとめない。
			const other = await reviewer('passkey');
			await put('x', await addWork(db), other);
			await mergeAnonymous(db, other, account);
			expect(await db.prepare("SELECT reviewer_id FROM reviews WHERE id = 'x'").first()).toEqual({ reviewer_id: other });
		});
	});

	describe('パスキーの削除', () => {
		it('最後の1つは、削除できない。ほかのアカウントのものも、削除できない', async () => {
			const a = await reviewer();
			const b = await reviewer();
			const { auth: first } = await register(a);
			const { auth: second } = await register(a);
			const { auth: theirs } = await register(b);
			expect(await deleteCredential(db, a, theirs.id)).toEqual({ ok: false, error: 'not_found' });
			expect(await deleteCredential(db, a, first.id)).toEqual({ ok: true });
			expect(await deleteCredential(db, a, second.id)).toEqual({ ok: false, error: 'last_credential' });
			expect((await listCredentials(db, a)).map((c) => c.id)).toEqual([second.id]);
			expect(await listCredentials(db, b)).toHaveLength(1);
		});
	});

	describe('メールの確認', () => {
		it('登録すると、確認のリンクが届く。リンクを開いただけでは、使い切らない。確認すると、有効になる。2回目は、使えない', async () => {
			const id = await reviewer();
			expect(await setEmail(db, id, ' Me@Example.COM ', { mailer, origin: cfg.origin, ipHash: null }, clock.now())).toEqual({ ok: true });
			expect(sent).toHaveLength(1);
			expect(sent[0].to).toBe('me@example.com');
			expect(sent[0].text).toContain(`${cfg.origin}/auth/verify?token=`);
			expect(await accountEmail(db, id)).toEqual({ email: 'me@example.com', verified: false });
			const token = tokenOf(sent[0].text);
			expect(await checkEmailToken(db, token, 'verify', clock.now())).toBe(true);
			expect(await checkEmailToken(db, token, 'verify', clock.now())).toBe(true); // 開いただけでは、変わらない
			expect(await confirmEmail(db, token, clock.now())).toEqual({ ok: true });
			expect(await accountEmail(db, id)).toEqual({ email: 'me@example.com', verified: true });
			expect(await confirmEmail(db, token, clock.now())).toEqual({ ok: false, error: 'bad_token' });
		});

		it('入力の検証、メールの口がないとき、期限切れ、別のアドレスに変えたあとの古いリンク', async () => {
			const id = await reviewer();
			expect(await setEmail(db, id, 'not an email', { mailer, origin: cfg.origin, ipHash: null }, clock.now())).toEqual({ ok: false, error: 'bad_email' });
			expect(await setEmail(db, id, 'a@b.example', { mailer: null, origin: cfg.origin, ipHash: null }, clock.now())).toEqual({ ok: false, error: 'email_disabled' });
			await setEmail(db, id, 'old@example.com', { mailer, origin: cfg.origin, ipHash: null }, clock.now());
			const oldToken = tokenOf(sent[0].text);
			await setEmail(db, id, 'new@example.com', { mailer, origin: cfg.origin, ipHash: null }, clock.now());
			expect(await confirmEmail(db, oldToken, clock.now())).toEqual({ ok: false, error: 'bad_token' });
			clock.advance(61 * 60_000);
			expect(await confirmEmail(db, tokenOf(sent[1].text), clock.now())).toEqual({ ok: false, error: 'bad_token' });
		});

		it('アドレスは、全角・大文字・前後の空白をそろえて、同じものとして扱う', () => {
			expect(normalizeEmail('  Me@Example.COM ')).toBe('me@example.com');
			expect(normalizeEmail('ｍｅ＠ｅｘａｍｐｌｅ．ｃｏｍ')).toBe('me@example.com');
		});

		it('入力の検証: 空、@ がない、ドットがない、空白を含む、長すぎるアドレスは、断る（メールは送らない）', async () => {
			const id = await reviewer();
			const opts = { mailer, origin: cfg.origin, ipHash: null };
			for (const bad of ['', 'plain', 'a@b', '@b.example', 'a@.', 'a b@c.example', `${'a'.repeat(250)}@b.example`]) {
				expect(await setEmail(db, id, bad, opts, clock.now()), bad).toEqual({ ok: false, error: 'bad_email' });
			}
			expect(sent).toHaveLength(0);
			expect(await accountEmail(db, id)).toBeNull();
		});

		it('アドレスを外すと、結びつきが消える。外したアドレスの、確認のリンクは、使えない。もう一度外しても、何も起きない', async () => {
			const id = await reviewer();
			await setEmail(db, id, 'me@example.com', { mailer, origin: cfg.origin, ipHash: null }, clock.now());
			await removeEmail(db, id);
			expect(await accountEmail(db, id)).toBeNull();
			expect(await confirmEmail(db, tokenOf(sent[0].text), clock.now())).toEqual({ ok: false, error: 'bad_token' });
			await expect(removeEmail(db, id)).resolves.toBeUndefined();
		});

		it('確認済みのアドレスは、別のアカウントに、結びつけられない', async () => {
			const a = await reviewer();
			const b = await reviewer();
			await setEmail(db, a, 'same@example.com', { mailer, origin: cfg.origin, ipHash: null }, clock.now());
			await confirmEmail(db, tokenOf(sent[0].text), clock.now());
			// b の応答は、a と同じ（登録の有無を教えない）。確認のときに、断る。
			expect(await setEmail(db, b, 'same@example.com', { mailer, origin: cfg.origin, ipHash: null }, clock.now())).toEqual({ ok: true });
			expect(await confirmEmail(db, tokenOf(sent[1].text), clock.now())).toEqual({ ok: false, error: 'email_taken' });
			expect(await accountEmail(db, b)).toMatchObject({ verified: false });
		});
	});

	describe('メールでの復旧', () => {
		const verified = async (email: string) => {
			const id = await reviewer();
			const { auth } = await register(id);
			await setEmail(db, id, email, { mailer, origin: cfg.origin, ipHash: null }, clock.now());
			await confirmEmail(db, tokenOf(sent.at(-1)!.text), clock.now());
			sent.length = 0;
			return { id, auth };
		};
		const ask = (email: string, ipHash: string | null = null) => requestRecovery(db, email, { mailer, origin: cfg.origin, ipHash }, clock.now());

		it('確認済みのアドレスなら、リンクが届く。登録されていない、確認していないアドレスでも、応答は同じで、何も送らない', async () => {
			await verified('me@example.com');
			expect(await ask('nobody@example.com')).toEqual({ ok: true });
			expect(sent).toEqual([]);
			const unverified = await reviewer();
			await setEmail(db, unverified, 'pending@example.com', { mailer, origin: cfg.origin, ipHash: null }, clock.now());
			sent.length = 0;
			expect(await ask('pending@example.com')).toEqual({ ok: true });
			expect(sent).toEqual([]);
			expect(await ask('ME@example.com')).toEqual({ ok: true });
			expect(sent).toHaveLength(1);
			expect(sent[0].text).toContain(`${cfg.origin}/recover/`);
			expect(sent[0].text).toContain('15分');
		});

		it('復旧は、アドレスごとに1時間3通まで。超えても、応答は同じ。確認のメールも、アドレスごとに1時間3通まで', async () => {
			const spam = await reviewer();
			for (let i = 0; i < 5; i++) expect(await setEmail(db, spam, 'victim@example.com', { mailer, origin: cfg.origin, ipHash: null }, clock.now())).toEqual({ ok: true });
			expect(sent).toHaveLength(3);
			sent.length = 0;
			await verified('me@example.com');
			for (let i = 0; i < 5; i++) expect(await ask('me@example.com')).toEqual({ ok: true });
			expect(sent).toHaveLength(3);
			clock.advance(61 * 60_000);
			await ask('me@example.com');
			expect(sent).toHaveLength(4);
		});

		it('新しいパスキーを登録すると、それまでのパスキーと、ログイン中の端末が、すべて取り消され、新しいものだけが残る。リンクは、1回だけ', async () => {
			const { id, auth: oldAuth } = await verified('me@example.com');
			const oldDevice = await deviceTokenHash(await issueDevice(db, id, clock.now()));
			await ask('me@example.com');
			const token = tokenOf(sent[0].text);

			const options = (await recoveryRegistrationOptions(db, cfg, token, clock.now()))!;
			expect(options.excludeCredentials?.map((c) => c.id)).toEqual([oldAuth.id]);
			const fresh = new TestAuthenticator();
			const done = await finishRecovery(db, cfg, token, await fresh.register(options), clock.now());
			expect(done).toMatchObject({ ok: true, reviewerId: id });
			expect((await listCredentials(db, id)).map((c) => c.id)).toEqual([fresh.id]);
			expect(await findReviewer(db, oldDevice, clock.now())).toBeNull();
			expect(await findReviewer(db, await deviceTokenHash((done as { deviceToken: string }).deviceToken), clock.now())).toBe(id);
			expect(await login(oldAuth)).toEqual({ ok: false, error: 'unknown_credential' });
			expect(await login(fresh)).toEqual({ ok: true, reviewerId: id });

			expect(await recoveryRegistrationOptions(db, cfg, token, clock.now())).toBeNull(); // 使い切った
			expect(await finishRecovery(db, cfg, token, await fresh.register(options), clock.now())).toEqual({ ok: false, error: 'bad_token' });
		});

		it('リンクの期限切れ、でたらめなリンク、検証に失敗した登録（リンクは、そのまま使える）、別の用途のチャレンジ', async () => {
			const { id, auth: oldAuth } = await verified('me@example.com');
			await ask('me@example.com');
			const token = tokenOf(sent[0].text);
			expect(await recoveryRegistrationOptions(db, cfg, 'garbage', clock.now())).toBeNull();

			const options = (await recoveryRegistrationOptions(db, cfg, token, clock.now()))!;
			const bad = await finishRecovery(db, cfg, token, await new TestAuthenticator().register(options, { origin: 'https://evil.example' }), clock.now());
			expect(bad).toEqual({ ok: false, error: 'verify_failed' });
			expect((await listCredentials(db, id)).map((c) => c.id)).toEqual([oldAuth.id]); // 何も取り消されていない

			// 普通の登録のチャレンジを、復旧の登録に使えない。
			const plain = await registrationOptions(db, cfg, id, clock.now());
			expect(await finishRecovery(db, cfg, token, await new TestAuthenticator().register(plain), clock.now())).toEqual({ ok: false, error: 'verify_failed' });

			clock.advance(16 * 60_000);
			expect(await recoveryRegistrationOptions(db, cfg, token, clock.now())).toBeNull();
		});

		it('ほかのアカウントの復旧のリンクのチャレンジは、使えない', async () => {
			const a = await verified('a@example.com');
			const b = await verified('b@example.com');
			await ask('a@example.com');
			await ask('b@example.com');
			const [tokenA, tokenB] = [tokenOf(sent[0].text), tokenOf(sent[1].text)];
			const optionsB = (await recoveryRegistrationOptions(db, cfg, tokenB, clock.now()))!;
			expect(await finishRecovery(db, cfg, tokenA, await new TestAuthenticator().register(optionsB), clock.now())).toEqual({ ok: false, error: 'verify_failed' });
			expect((await listCredentials(db, a.id)).map((c) => c.id)).toEqual([a.auth.id]);
			expect((await listCredentials(db, b.id)).map((c) => c.id)).toEqual([b.auth.id]);
		});
	});

	describe('復旧コード', () => {
		const withCode = async () => {
			const id = await reviewer();
			const { auth } = await register(id);
			const code = await createRecoveryCode(db, id, clock.now());
			return { id, auth, code };
		};

		it('コードは、24文字（120ビット）を、4文字ずつに区切った形。紛らわしい文字（0、O、1、I）を含まない。毎回、違う', () => {
			const codes = new Set(Array.from({ length: 200 }, () => generateRecoveryCode()));
			expect(codes.size).toBe(200);
			for (const c of codes) {
				expect(c).toMatch(/^([A-HJ-NP-Z2-9]{4}-){5}[A-HJ-NP-Z2-9]{4}$/);
			}
			expect(normalizeRecoveryCode(' abcd-efgh jklm\nnpqr-stuv-wxyz ')).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ');
		});

		it('保存するのは、ハッシュだけ。作り直すと、古いコードは、使えなくなる', async () => {
			const { id, code } = await withCode();
			const stored = await db.prepare('SELECT code_hash FROM recovery_codes WHERE reviewer_id = ?').bind(id).first<{ code_hash: string }>();
			expect(stored!.code_hash).not.toContain(normalizeRecoveryCode(code));
			expect(stored!.code_hash).toMatch(/^[0-9a-f]{64}$/);
			const fresh = await createRecoveryCode(db, id, clock.now());
			expect(fresh).not.toBe(code);
			expect(await redeemRecoveryCode(db, code, null, clock.now())).toEqual({ ok: false, error: 'bad_code' });
			expect(await redeemRecoveryCode(db, fresh, null, clock.now())).toMatchObject({ ok: true });
			expect(await recoveryCodeInfo(db, id)).toEqual({ createdAt: clock.now().toISOString() });
		});

		it('コードで復旧できる。小文字や区切りの違いは、許す。新しいパスキーだけが残り、古いパスキーと端末は取り消され、コードは新しくなる', async () => {
			const { id, auth: oldAuth, code } = await withCode();
			const oldDevice = await deviceTokenHash(await issueDevice(db, id, clock.now()));
			const redeemed = await redeemRecoveryCode(db, code.toLowerCase().replaceAll('-', ' '), null, clock.now());
			expect(redeemed.ok).toBe(true);
			const token = (redeemed as { token: string }).token;

			const options = (await recoveryRegistrationOptions(db, cfg, token, clock.now()))!;
			const fresh = new TestAuthenticator();
			const done = await finishRecovery(db, cfg, token, await fresh.register(options), clock.now());
			expect(done).toMatchObject({ ok: true, reviewerId: id });
			expect((await listCredentials(db, id)).map((c) => c.id)).toEqual([fresh.id]);
			expect(await findReviewer(db, oldDevice, clock.now())).toBeNull();
			expect(await login(oldAuth)).toEqual({ ok: false, error: 'unknown_credential' });

			const newCode = (done as { recoveryCode: string }).recoveryCode;
			expect(newCode).not.toBe(code);
			expect(await redeemRecoveryCode(db, code, null, clock.now())).toEqual({ ok: false, error: 'bad_code' }); // 使ったコードは、もう使えない
			expect(await redeemRecoveryCode(db, newCode, null, clock.now())).toMatchObject({ ok: true });
		});

		it('間違ったコード、短いコード、空のコードは、理由を教えずに、断る。復旧のリンクの印は、15分で切れる', async () => {
			const { code } = await withCode();
			for (const bad of ['', 'ABCD', 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A')]) {
				expect(await redeemRecoveryCode(db, bad, null, clock.now())).toEqual({ ok: false, error: 'bad_code' });
			}
			const redeemed = (await redeemRecoveryCode(db, code, null, clock.now())) as { token: string };
			clock.advance(16 * 60_000);
			expect(await recoveryRegistrationOptions(db, cfg, redeemed.token, clock.now())).toBeNull();
		});

		it('送信元ごとに、1日20回まで。超えると、正しいコードでも、通らない。翌日の送信元は、数え直す', async () => {
			const { code } = await withCode();
			const ip = await ipDayHash('198.51.100.7', 'secret', clock.now());
			for (let i = 0; i < 20; i++) expect(await redeemRecoveryCode(db, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', ip, clock.now())).toEqual({ ok: false, error: 'bad_code' });
			expect(await redeemRecoveryCode(db, code, ip, clock.now())).toEqual({ ok: false, error: 'bad_code' });
			const tomorrow = await ipDayHash('198.51.100.7', 'secret', new Date('2026-11-19T03:00:00Z'));
			expect(await redeemRecoveryCode(db, code, tomorrow, clock.now())).toMatchObject({ ok: true });
		});

		it('メールでの復旧のあとも、コードは新しくなる（古いコードは、使えない）', async () => {
			const id = await reviewer();
			await register(id);
			const old = await createRecoveryCode(db, id, clock.now());
			await setEmail(db, id, 'me@example.com', { mailer, origin: cfg.origin, ipHash: null }, clock.now());
			await confirmEmail(db, tokenOf(sent.at(-1)!.text), clock.now());
			await requestRecovery(db, 'me@example.com', { mailer, origin: cfg.origin, ipHash: null }, clock.now());
			const token = tokenOf(sent.at(-1)!.text);
			const options = (await recoveryRegistrationOptions(db, cfg, token, clock.now()))!;
			const done = await finishRecovery(db, cfg, token, await new TestAuthenticator().register(options), clock.now());
			expect(done).toMatchObject({ ok: true });
			expect(await redeemRecoveryCode(db, old, null, clock.now())).toEqual({ ok: false, error: 'bad_code' });
		});
	});

	describe('設定', () => {
		it('許したホスト名だけ。RP ID は、ホスト名そのもの（親ドメインにしない）', () => {
			expect(authConfigFor(new URL('https://review.anami.party/login'))).toEqual({ rpID: 'review.anami.party', rpName: 'Zasuh', origin: 'https://review.anami.party' });
			expect(authConfigFor(new URL('http://localhost:8788/'))).toMatchObject({ rpID: 'localhost', origin: 'http://localhost:8788' });
			expect(authConfigFor(new URL('https://anami.party/'))).toBeNull();
			expect(authConfigFor(new URL('https://evil.review.anami.party/'))).toBeNull();
			expect(authConfigFor(new URL('https://evil.example/'))).toBeNull();
		});
	});
});
