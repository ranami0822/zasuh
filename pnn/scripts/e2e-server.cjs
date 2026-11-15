/**
 * 公開の場の通し確認（docs/pnn-server-design.md）。passkey は、ブラウザの仮想の認証器で作る。
 * 使い方: wrangler dev（npm run dev:worker）を動かしてから `npm run e2e:server`。
 * 書く人と読む人の2人で、登録 → 公開 → いいね・保存・返信 → 隠す → フォロー → 取り下げ、を確かめる。
 */
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require((process.env.NODE_PATH ?? '') + '/playwright')); }
const BASE = process.env.BASE ?? 'http://localhost:8787';
let fails = 0;
const check = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) fails++; };

async function person(browser) {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
	const page = await ctx.newPage();
	page.on('pageerror', (e) => console.log('  pageerror:', e.message));
	const cdp = await ctx.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
	return { ctx, page };
}
const tick = (p, ms = 400) => p.waitForTimeout(ms);
const json = (p, path) => p.evaluate(async (u) => (await fetch(u)).json(), path);

(async () => {
	const browser = await chromium.launch();
	const w = await person(browser);
	const r = await person(browser);
	const tag = Date.now().toString(36);

	// ---- 書く人: 書いて、公開する（ログインは、その場で passkey を作る） ----
	await w.page.goto(BASE + '/');
	await w.page.waitForSelector('.cm-content');
	await w.page.keyboard.type('夜中にしか書けない ' + tag);
	await w.page.keyboard.press('Enter');
	await w.page.keyboard.type('恥ずかしいのに、**消したくない**。');
	await tick(w.page);
	await w.page.click('button[aria-label="状態"]');
	await w.page.click('dialog[open] button:has-text("公開")');
	await w.page.waitForSelector('dialog[open] h2:has-text("だれ？")');
	check(true, 'ログインしていないと、公開の前に「だれ？」が出る');
	await w.page.click('dialog[open] button:has-text("はじめる")');
	await w.page.waitForSelector('dialog[open] h2:has-text("公開？")', { timeout: 15000 });
	check(true, 'passkey を作ると、公開の確認に進む');
	await w.page.click('dialog[open] button[aria-pressed]:has-text("名乗る")');
	await w.page.click('dialog[open] button:has-text("公開する")');
	await w.page.waitForFunction(() => !document.querySelector('.dot.saving'), null, { timeout: 15000 });
	const feed1 = await json(w.page, '/api/feed');
	const post = feed1.posts.find((p) => p.title.includes(tag));
	check(!!post, '公開すると、フィードに出る');
	check(post && post.author === null, '名乗るを入れても、閾値までは匿名');

	// 書き足すと、送り直される
	await w.page.click('.cm-content');
	await w.page.keyboard.press('Control+End');
	await w.page.keyboard.type('書き足し');
	await w.page.waitForTimeout(3000);
	await w.page.waitForFunction(() => !document.querySelector('.dot.saving'), null, { timeout: 15000 });
	const after = await json(w.page, `/api/posts/${post.id}`);
	check(after.post.body.includes('書き足し'), '公開中に書き足すと、送り直される');
	check(after.own && after.own.reveal === true && after.own.threshold === 20, '書いた人には、名乗るの状態と閾値が見える');

	// ---- 読む人: 登録して、いいね・保存・返信 ----
	await r.page.goto(BASE + '/me');
	await r.page.click('button:has-text("はじめる")');
	await r.page.waitForSelector('button:has-text("出る")', { timeout: 15000 });
	check(true, '読む人も、/me で passkey を作れる');
	await r.page.goto(BASE + '/feed');
	await r.page.waitForSelector(`a.card-link:has-text("${tag}")`);
	await r.page.click(`a.card-link:has-text("${tag}")`);
	await r.page.waitForSelector('.prose');
	check((await r.page.innerHTML('.prose')).includes('<strong>消したくない</strong>'), '投稿の頁で、本文が整形される');
	check(!(await r.page.textContent('main')).includes('名乗る'), '書いた人でない人には、名乗るの状態が見えない');
	await r.page.click('button[aria-label="いいね"]'); await tick(r.page);
	await r.page.click('button[aria-label="保存"]'); await tick(r.page);
	await r.page.fill('textarea[aria-label="返信"]', 'わかる。<script>alert(1)</script>');
	await r.page.click('button[aria-label="返信する"]'); await tick(r.page, 800);
	const rd = await json(r.page, `/api/posts/${post.id}`);
	check(rd.liked && rd.post.likes === 1, 'いいねできる（数は公開）');
	check(rd.saved, '保存できる');
	check(rd.replies.length === 1 && rd.replies[0].mine, '返信できる');
	check(!(await r.page.innerHTML('main')).includes('<script>alert'), '返信の HTML は、文字として出る');
	const saves = await json(r.page, '/api/saves');
	check(saves.some((p) => p.id === post.id), '保存した投稿が、自分の一覧に出る');

	// ---- 書く人: 返信を隠す。自分の投稿には、いいねできない ----
	await w.page.goto(`${BASE}/p/${post.id}`);
	await w.page.waitForSelector('.reply');
	check(await w.page.isDisabled('button[aria-label="いいね"]'), '自分の投稿には、いいねできない');
	await w.page.click('.reply button:has-text("隠す")'); await tick(w.page, 800);
	const hiddenForReader = await json(r.page, `/api/posts/${post.id}`);
	const anon = await (await browser.newContext()).newPage();
	await anon.goto(BASE + '/feed');
	const hiddenForOthers = await json(anon, `/api/posts/${post.id}`);
	check(hiddenForOthers.replies.length === 0, '隠した返信は、他の人には見えない');
	check(hiddenForReader.replies.length === 1 && hiddenForReader.replies[0].hidden, '返信した本人には、隠されたことが分かる形で残る');

	// ---- 名前を決めて、フォローされる。フォロワーの数は本人だけ ----
	const handle = 'w' + tag.slice(-8);
	await w.page.goto(BASE + '/me');
	await w.page.waitForSelector('button:has-text("出る")');
	await w.page.fill('input[placeholder="名前（英数字）"]', handle);
	await w.page.fill('input[placeholder="表示名"]', '書く人');
	await w.page.click('button:has-text("保存")'); await tick(w.page, 800);
	await r.page.goto(`${BASE}/u/${handle}`);
	await r.page.waitForSelector('h1:has-text("書く人")');
	await r.page.click('button:has-text("フォロー")'); await tick(r.page, 800);
	check((await r.page.textContent('main')).includes('フォロー中'), 'フォローできる');
	check(!(await r.page.textContent('main')).includes('フォロワー'), '他の人の頁には、フォロワーの数が出ない');
	await w.page.reload(); await w.page.waitForSelector('button:has-text("出る")');
	check((await w.page.textContent('main')).includes('フォロワー 1'), '本人の頁には、フォロワーの数が出る');

	// ---- 出て、passkey で入り直す ----
	await w.page.click('button:has-text("出る")'); await tick(w.page);
	await w.page.click('button:has-text("入る")');
	await w.page.waitForSelector('button:has-text("出る")', { timeout: 15000 });
	check(true, '出て、同じ passkey で入り直せる');

	// ---- 下書きに戻すと、取り下げる ----
	await w.page.goto(BASE + '/');
	await w.page.waitForSelector('.cm-content');
	await w.page.click('button[aria-label="状態"]');
	await w.page.click('dialog[open] button:has-text("下書き")');
	await w.page.waitForFunction(() => !document.querySelector('.dot.saving'), null, { timeout: 15000 });
	await tick(w.page, 800);
	const gone = await w.page.evaluate(async (id) => (await fetch(`/api/posts/${id}`)).status, post.id);
	check(gone === 404, '下書きに戻すと、サーバーから消える');

	// ---- 別のサイトからの書き込みは拒む ----
	const forged = await anon.evaluate(async () => (await fetch('/api/me', { method: 'PATCH', headers: { 'content-type': 'text/plain' }, body: '{}' })).status);
	check(forged === 401 || forged === 415, 'ログインなし・JSON でない書き込みは拒む');

	await browser.close();
	console.log(fails ? `\n${fails} 件の失敗` : '\nすべて通った');
	process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
