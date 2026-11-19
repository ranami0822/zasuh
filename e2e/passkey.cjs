// パスキーのログインと、メールでの復旧の、ブラウザでの通しの確認（仮想の認証器を使う。AI は使わない）。
// 前提: flow.cjs と同じ（空のデータベース、ローカルの wrangler dev）。メールの送信は、wrangler dev の模擬（ログ）で受ける。
// 環境変数 WRANGLER_LOG に、wrangler dev の出力を書き出したファイルの場所を渡す。
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE_URL || 'http://localhost:8787';
const LOG = process.env.WRANGLER_LOG;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withAuthenticator(context, page) {
  const client = await context.newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true }
  });
  return { client, authenticatorId };
}

/**
 * 模擬のメール（wrangler dev は、本文を、ファイルに書き出し、その場所を、ログに出す）から、最新のリンクを取り出す。
 * after は、そのときのログの長さ。それ以降の分だけを見る。
 */
async function latestLink(pattern, after) {
  for (let i = 0; i < 40; i++) {
    const text = fs.readFileSync(LOG, 'utf8').slice(after);
    const files = [...text.matchAll(/^Text: (\S+\.txt)$/gm)].map((m) => m[1]);
    for (const file of files.reverse()) {
      if (!fs.existsSync(file)) continue;
      const m = [...fs.readFileSync(file, 'utf8').matchAll(pattern)];
      if (m.length) return { link: m.at(-1)[0] };
    }
    await sleep(500);
  }
  return null;
}

/** 新しく送られた模擬のメールの数。 */
const sentSince = (after) => [...fs.readFileSync(LOG, 'utf8').slice(after).matchAll(/^Text: \S+\.txt$/gm)].length;

(async () => {
  const browser = await chromium.launch();
  const owner = await (await browser.newContext()).newPage();
  await owner.goto(BASE + '/admin/login');
  await owner.fill('input[type=password]', 'local-test-token');
  await owner.click('button[type=submit]');
  await owner.waitForURL(BASE + '/admin');
  for (const [name, slug] of [['パスキーの試験 1', 'pk-one'], ['パスキーの試験 2', 'pk-two']]) {
    await owner.goto(BASE + '/admin');
    await owner.fill('input[name=name]', name);
    await owner.fill('input[name=slug]', slug);
    await owner.click('form[action="?/create"] button[type=submit]');
    await owner.waitForURL(/\/admin\/works\/.+/);
  }

  // 端末A: ログインなしで投稿 → パスキーを登録（投稿が、そのまま、自分のものになる）
  const ctxA = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const a = await ctxA.newPage();
  a.on('pageerror', (e) => console.log('PAGEERROR A', e.message));
  const authA = await withAuthenticator(ctxA, a);
  await a.goto(BASE + '/works/pk-one');
  await a.fill('textarea[name=body]', '戦闘のテンポが良くて、敵の種類も豊富で飽きない。');
  await a.click('button:has-text("投稿する")');
  ok(await a.waitForSelector('[data-slot=toast]:has-text("投稿しました")', { timeout: 10000 }).then(() => true, () => false), 'A: posted without logging in');
  ok(await a.waitForSelector('[data-slot=toast]:has-text("パスキーを登録すると")', { timeout: 60000 }).then(() => true, () => false), 'A: the passkey suggestion appears after posting');
  await a.goto(BASE + '/me/security');
  await a.click('button:has-text("パスキーを登録する")');
  ok(await a.waitForSelector('section[aria-label="パスキー"]', { timeout: 15000 }).then(() => true, () => false), 'A: registered a passkey');
  ok(await a.isVisible('a.tag:has-text("アカウント")'), 'A: the header shows the account link');
  const recoveryCode = (await a.textContent('[data-testid=recovery-code]').catch(() => '')) || '';
  ok(/^([A-HJ-NP-Z2-9]{4}-){5}[A-HJ-NP-Z2-9]{4}$/.test(recoveryCode.trim()), 'A: a recovery code is shown once after registering: ' + recoveryCode.trim().slice(0, 4) + '-…');
  await a.click('button:has-text("保存しました")');
  ok(!(await a.isVisible('[data-testid=recovery-code]')), 'A: the code disappears after confirming');
  await a.reload();
  ok(!(await a.isVisible('[data-testid=recovery-code]')) && await a.isVisible('text=コードは、保存していません'), 'A: the code is never shown again (only that it is set)');
  await a.goto(BASE + '/me');
  ok(await a.isVisible('a:has-text("パスキーの試験 1")'), 'A: the review posted before registering is still mine');
  await a.goto(BASE + '/me/security');
  ok(!(await a.isVisible('button:has-text("削除")')), 'A: the only passkey cannot be deleted (no delete button)');

  // ブラウザの外の、直接の呼び出しが、通らないこと
  const anon = (await browser.newContext()).request;
  let r = await anon.post(BASE + '/auth/register/options', { headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, data: {} });
  ok(r.status() === 403, 'registration options with a foreign Origin are refused (' + r.status() + ')');
  r = await anon.post(BASE + '/auth/stepup/options', { headers: { origin: BASE, 'content-type': 'application/json' }, data: {} });
  ok(r.status() === 404, 'step-up without a login is refused (' + r.status() + ')');

  // 端末B: 同期されたパスキー（A の資格情報を、B の認証器に入れる）。B で、ログインなしで別の作品に投稿してから、ログイン
  const { credentials } = await authA.client.send('WebAuthn.getCredentials', { authenticatorId: authA.authenticatorId });
  ok(credentials.length === 1 && credentials[0].isResidentCredential, 'A: the virtual authenticator holds one resident credential');
  const ctxB = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const b = await ctxB.newPage();
  const authB = await withAuthenticator(ctxB, b);
  await authB.client.send('WebAuthn.addCredential', { authenticatorId: authB.authenticatorId, credential: credentials[0] });
  await b.goto(BASE + '/works/pk-two');
  await b.fill('textarea[name=body]', 'ロードが長くて、起動のたびに待たされるのが不満。');
  await b.click('button:has-text("投稿する")');
  await b.waitForSelector('[data-slot=toast]:has-text("投稿しました")');
  await b.goto(BASE + '/login');
  await b.click('button:has-text("パスキーでログイン")');
  await b.waitForURL(BASE + '/me', { timeout: 15000 });
  ok(await b.isVisible('a:has-text("パスキーの試験 1")') && await b.isVisible('a:has-text("パスキーの試験 2")'), 'B: logged in with the synced passkey, and both reviews (including the one posted before logging in) are listed');

  // メールの登録と確認
  await b.goto(BASE + '/me/security');
  await b.fill('input[name=email]', 'Me@Example.com');
  let mark = fs.readFileSync(LOG, 'utf8').length;
  await b.click('button:has-text("確認のメールを送る")');
  ok(await b.waitForSelector('.banner.success:has-text("確認のメールを送りました")', { timeout: 20000 }).then(() => true, () => false), 'B: the verification mail is sent');
  let found = await latestLink(/https?:\/\/[^\s"\\]*\/auth\/verify\?token=[A-Za-z0-9_-]+/g, mark);
  ok(!!found, 'the verification link appears in the (simulated) mail');
  const verifier = await (await browser.newContext()).newPage();
  await verifier.goto(found.link);
  await verifier.click('button:has-text("このメールアドレスを確認する")');
  ok(await verifier.waitForSelector('.banner.success:has-text("確認しました")', { timeout: 10000 }).then(() => true, () => false), 'the email is verified from a clean browser (button press)');
  await verifier.goto(found.link);
  ok(await verifier.isVisible('text=このリンクは期限切れか、使用済みです'), 'the verification link cannot be used twice');
  await b.reload();
  ok(await b.isVisible('text=確認済み'), 'B: the account page shows the verified email');

  // 復旧（コード）: 端末D が、A で見せた復旧コードで復旧する。小文字でも通る。使ったコードは、使えなくなる
  const ctxD = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const d = await ctxD.newPage();
  await withAuthenticator(ctxD, d);
  await d.goto(BASE + '/recover', { waitUntil: 'networkidle' });
  await d.fill('input[name=code]', 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA');
  await d.click('button:has-text("復旧する")');
  ok(await d.waitForSelector('.banner.error:has-text("コードが違います")', { timeout: 10000 }).then(() => true, () => false), 'D: a wrong code is refused');
  await d.fill('input[name=code]', recoveryCode.trim().toLowerCase());
  await d.click('button:has-text("復旧する")');
  await d.waitForURL(/\/recover\/[A-Za-z0-9_-]{20,}/, { timeout: 10000 });
  ok(await d.isVisible('text=これまでのパスキーと、ログイン中の端末はすべて使えなくなります'), 'D: the right code leads to the recovery page (with the revocation warning)');
  await d.click('button:has-text("新しいパスキーを登録する")');
  await d.waitForURL(/\/me\/security\?recovered=1/, { timeout: 15000 });
  const newCode = ((await d.textContent('[data-testid=recovery-code]').catch(() => '')) || '').trim();
  ok(/^([A-HJ-NP-Z2-9]{4}-){5}[A-HJ-NP-Z2-9]{4}$/.test(newCode) && newCode !== recoveryCode.trim(), 'D: recovered, and a new recovery code is shown');
  await d.goto(BASE + '/recover', { waitUntil: 'networkidle' });
  await d.fill('input[name=code]', recoveryCode.trim());
  await d.click('button:has-text("復旧する")');
  ok(await d.waitForSelector('.banner.error:has-text("コードが違います")', { timeout: 10000 }).then(() => true, () => false), 'D: the used code no longer works');
  await a.goto(BASE + '/me/security');
  ok(await a.isVisible('button:has-text("パスキーを登録する")') && !(await a.isVisible('section[aria-label="パスキー"]')), 'A: the old device is logged out after the code recovery');

  // 復旧: パスキーを失った端末C から、メールで復旧する
  const ctxC = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const c = await ctxC.newPage();
  await withAuthenticator(ctxC, c);
  await c.goto(BASE + '/recover');
  await c.fill('input[name=email]', 'nobody@example.com');
  mark = fs.readFileSync(LOG, 'utf8').length;
  await c.click('button:has-text("リンクを送る")');
  ok(await c.waitForSelector('.banner.success:has-text("登録されているアドレスなら")', { timeout: 10000 }).then(() => true, () => false), 'an unknown address gets the same neutral answer');
  await sleep(1500);
  ok(sentSince(mark) === 0, 'no mail is sent to an unknown address');
  await c.goto(BASE + '/recover');
  await c.fill('input[name=email]', 'me@example.com');
  mark = fs.readFileSync(LOG, 'utf8').length;
  await c.click('button:has-text("リンクを送る")');
  found = await latestLink(/https?:\/\/[^\s"\\]*\/recover\/[A-Za-z0-9_-]{20,}/g, mark);
  ok(!!found, 'the recovery link appears in the (simulated) mail');
  await c.goto(found.link);
  ok(await c.isVisible('text=これまでのパスキーと、ログイン中の端末はすべて使えなくなります'), 'the recovery page warns that old passkeys and devices are revoked');
  await c.click('button:has-text("新しいパスキーを登録する")');
  await c.waitForURL(/\/me\/security\?recovered=1/, { timeout: 15000 });
  ok(await c.waitForSelector('[data-slot=toast]:has-text("復旧しました")', { timeout: 10000 }).then(() => true, () => false), 'C: recovered with a new passkey');
  ok((await c.$$('section[aria-label="パスキー"] .spread')).length === 1, 'C: exactly one passkey remains (the new one)');
  await c.goto(found.link);
  ok(await c.isVisible('text=このリンクは期限切れか、使用済みです'), 'the recovery link cannot be used twice');

  // 取り消し: 端末B は、ログインが取り消され、古いパスキーでは、ログインできない
  await b.goto(BASE + '/me/security');
  ok(await b.isVisible('button:has-text("パスキーを登録する")') && !(await b.isVisible('section[aria-label="パスキー"]')), 'B: the old device is logged out after recovery');
  await b.goto(BASE + '/login');
  await b.click('button:has-text("パスキーでログイン")');
  ok(await b.waitForSelector('.banner.error', { timeout: 10000 }).then(() => true, () => false), 'B: the old passkey no longer logs in');
  await c.goto(BASE + '/me');
  ok(await c.isVisible('a:has-text("パスキーの試験 1")'), 'C: the reviews stay with the account after recovery');

  // ログアウト
  await c.goto(BASE + '/me/security');
  await c.click('button:has-text("ログアウト")');
  await c.waitForURL(BASE + '/');
  ok(await c.isVisible('a.tag:has-text("ログイン")'), 'C: logged out');
  await browser.close();
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
