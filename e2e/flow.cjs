// ブラウザでの通しの確認（AI を使わない）。使い方は docs/mvp-design.md の13章。
// 前提: ローカルで wrangler dev が動いていて（npm run dev:worker）、.dev.vars に ADMIN_TOKEN=local-test-token があり、データベースが空であること。
// playwright は、依存に入れていない（グローバルに入っているものを使う）。
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8787';
const OUT = process.env.OUT_DIR || require('os').tmpdir();
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch();
  const owner = await browser.newContext({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1 });
  const p = await owner.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });

  // 管理: ログインなしで、フォームの処理を直接呼べないこと
  const anon = await (await browser.newContext()).request;
  for (const [path, data] of [['/admin?/create', { name: 'X', slug: 'hack', category: 'game' }], ['/admin/reports?/act', { id: 'x', op: 'delete' }]]) {
    const r = await anon.post(BASE + path, { form: data, headers: { origin: BASE }, maxRedirects: 0 });
    ok(r.status() === 403, 'anonymous POST ' + path + ' is refused (' + r.status() + ')');
  }

  // 管理: ログイン
  await p.goto(BASE + '/admin');
  ok(p.url().endsWith('/admin/login'), 'admin redirects to login');
  await p.fill('input[type=password]', 'wrong');
  await p.click('button[type=submit]');
  await p.waitForSelector('.banner.error');
  ok((await p.textContent('.banner.error')).includes('合言葉が合いません'), 'wrong token rejected');
  await p.fill('input[type=password]', 'local-test-token');
  await p.click('button[type=submit]');
  await p.waitForURL(BASE + '/admin');
  ok(true, 'admin login ok');

  // 作品を登録
  await p.fill('input[name=name]', '星屑の鉄道');
  await p.fill('input[name=slug]', 'star-line');
  await p.fill('input[name=url]', 'https://example.com/star');
  await p.fill('textarea[name=summary]', '夜行列車を走らせる運転シミュレーション。');
  await p.click('form[action="?/create"] button[type=submit]');
  await p.waitForURL(/\/admin\/works\/.+/);
  ok(true, 'work created');
  // タグを選ぶ
  const labels = await p.$$eval('label.choice', (els) => els.map((e) => e.textContent.trim()));
  console.log('choices:', labels.join(' | '));
  await p.click('label.choice:has-text("物語")');
  await p.click('label.choice:has-text("見た目")');
  await p.click('button:has-text("保存する")');
  await p.waitForSelector('.banner.success');
  ok(true, 'work saved with tags');
  await p.reload();
  const checked = await p.$$eval('label.choice:has([data-checked])', (els) => els.map((e) => e.textContent.trim()));
  ok(checked.includes('物語') && checked.includes('見た目') && !checked.includes('マルチプレイ'), 'tag selection persisted: ' + checked.join(','));
  await p.screenshot({ path: OUT + '/admin-work.png', fullPage: true });

  // 読者A: 投稿
  const a = await (await browser.newContext({ viewport: { width: 900, height: 1100 } })).newPage();
  a.on('pageerror', (e) => console.log('PAGEERROR A', e.message));
  await a.goto(BASE + '/works/star-line');
  await a.screenshot({ path: OUT + '/work-empty.png', fullPage: true });
  await a.fill('textarea[name=body]', '運転台の操作が丁寧に作り込まれていて、夜景の見た目も美しい。ただ、ロードが長いのが残念。');
  ok(!(await a.$('input[type=date]')), 'there is no date field (the server decides the date)');
  await a.click('button:has-text("投稿する")');
  await a.waitForSelector('[data-slot=toast]');
  ok((await a.textContent('[data-slot=toast]')).includes('投稿しました'), 'toast shown after posting');
  ok(!a.url().includes('done='), 'the done flag is removed from the URL');
  ok(await a.isVisible('text=この作品には、すでに投稿しています'), 'form replaced by edit link');
  ok(await a.isVisible('article:has-text("運転台の操作")'), 'review shown');

  // 短すぎる本文（別端末）
  const b = await (await browser.newContext({ viewport: { width: 900, height: 1100 } })).newPage();
  await b.goto(BASE + '/works/star-line');
  await b.fill('textarea[name=body]', 'あ');
  await b.$eval('textarea[name=body]', (e) => e.removeAttribute('minlength'));
  await b.click('button:has-text("投稿する")');
  await b.waitForSelector('.banner.error');
  ok((await b.textContent('.banner.error')).includes('短すぎ'), 'short body rejected with message');

  // 読者A: 編集
  await a.click('a:has-text("編集する")');
  await a.waitForURL(/\/edit$/);
  await a.fill('textarea[name=body]', '運転台の操作が丁寧に作り込まれていて、夜景の見た目も美しい。ロードも速くなった。');
  await a.click('button:has-text("直す")');
  ok(await a.waitForSelector('[data-slot=toast]:has-text("直しました")', { timeout: 10000 }).then(() => true, () => false), 'toast shown after editing');
  ok(await a.waitForSelector('text=編集済み', { timeout: 10000 }).then(() => true, () => false), 'edited mark shown');
  await a.goto(BASE + '/works/star-line/edit');
  ok((await a.textContent('p.muted')).includes('あと'), 'edits left shown: ' + (await a.textContent('p.muted')).trim());

  // 読者B: 通報
  await b.goto(BASE + '/works/star-line');
  await b.click('article:has-text("運転台の操作") >> button:has-text("通報")');
  await b.waitForSelector('[data-slot=dialog-content]');
  await b.screenshot({ path: OUT + '/report-dialog.png' });
  await b.click('[data-slot=dialog-content] label.choice:has-text("宣伝")');
  await b.click('[data-slot=dialog-content] button:has-text("通報する")');
  await b.waitForSelector('text=通報しました');
  ok(true, 'report submitted');

  // 管理: 通報の一覧
  await p.goto(BASE + '/admin/reports');
  ok(await p.isVisible('article:has-text("運転台の操作")'), 'reported review listed in admin');
  ok(await p.isVisible('.tag:has-text("宣伝・スパム")'), 'reason shown');
  await p.screenshot({ path: OUT + '/admin-reports.png', fullPage: true });
  await p.click('article:has-text("運転台の操作") >> button:has-text("非表示にする")');
  await p.waitForSelector('text=非表示のレビュー · 1件');
  await a.goto(BASE + '/works/star-line');
  ok(!(await a.isVisible('article:has-text("運転台の操作")')), 'hidden review gone from the public page');
  await p.click('article:has-text("運転台の操作") >> button:has-text("戻す")');
  await p.waitForSelector('text=非表示のレビュー · 0件');
  await a.reload();
  ok(await a.isVisible('article:has-text("運転台の操作")'), 'review back after un-hiding');


  // 検索、周辺のページ、受信箱
  const pub = await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage();
  await pub.goto(BASE + '/?q=' + encodeURIComponent('星屑'));
  ok(await pub.isVisible('a.rank:has-text("星屑の鉄道")'), 'search finds the work');
  await pub.goto(BASE + '/?q=' + encodeURIComponent('存在しない'));
  ok(await pub.isVisible('text=見つかりませんでした'), 'search shows the empty state with a request link');
  for (const [path, word] of [['/terms', 'してはいけないこと'], ['/privacy', '保存する情報'], ['/me', '投稿したレビューは、ありません']]) {
    await pub.goto(BASE + path);
    ok(await pub.isVisible('text=' + word), path + ' opens');
  }
  const title = await (async () => { await pub.goto(BASE + '/works/star-line'); return pub.title(); })();
  ok(title === '星屑の鉄道 · Zasuh', 'work page has its own title: ' + title);
  ok((await pub.getAttribute('meta[property="og:title"]', 'content')) === '星屑の鉄道 · Zasuh', 'og:title is set');
  const sitemap = await (await pub.request.get(BASE + '/sitemap.xml')).text();
  ok(sitemap.includes('/works/star-line') && !sitemap.includes('/admin'), 'sitemap lists the work');
  ok((await (await pub.request.get(BASE + '/robots.txt')).text()).includes('Disallow: /admin'), 'robots.txt hides /admin');

  await pub.goto(BASE + '/contact?kind=work_request');
  await pub.fill('input[name=workName]', '夜の図書館');
  await pub.fill('input[name=url]', 'https://example.com/library');
  await pub.fill('textarea[name=body]', '静かな探索ゲームです。載せてほしいです。');
  await pub.fill('input[name=contact]', 'me@example.com');
  await pub.click('button:has-text("送る")');
  ok(await pub.waitForSelector('[data-slot=toast]:has-text("受け付けました")', { timeout: 10000 }).then(() => true, () => false), 'toast after sending a request');
  await p.goto(BASE + '/admin/inbox');
  ok(await p.isVisible('article:has-text("夜の図書館")') && await p.isVisible('text=me@example.com'), 'request shows in the admin inbox');
  await p.click('a:has-text("作品として登録する")');
  ok((await p.inputValue('input[name=name]')) === '夜の図書館' && (await p.inputValue('input[name=url]')) === 'https://example.com/library', 'registration form is prefilled from the request');
  await p.goto(BASE + '/admin/inbox');
  await p.click('article:has-text("夜の図書館") >> button:has-text("済みにする")');
  ok(await p.waitForSelector('article.faded:has-text("夜の図書館")', { timeout: 10000 }).then(() => true, () => false), 'request can be closed');
  await a.goto(BASE + '/me');
  ok(await a.isVisible('a:has-text("星屑の鉄道")') && await a.isVisible('a:has-text("編集")'), '/me lists my review with an edit link');

  // 評価の棒: 両端の角は、棒全体で切り抜く（区間ごとの角丸だと、先頭の区間が非表示のとき、左端が四角くなる）
  const bars = await a.$$eval('.dist__bar:not(.empty)', (els) => els.map((e) => ({ clip: getComputedStyle(e).overflow, radius: getComputedStyle(e).borderTopLeftRadius, kids: [...e.children].every((c) => getComputedStyle(c).borderTopLeftRadius === '0px') })));
  ok(bars.every((b) => b.clip === 'hidden' && b.radius !== '0px' && b.kids), 'rating bars clip both ends on the container (' + bars.length + ' non-empty bars checked)');

  // 一覧
  const h = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await h.goto(BASE + '/');
  ok(await h.isVisible('a.rank:has-text("星屑の鉄道")'), 'work listed on home');
  await h.screenshot({ path: OUT + '/home.png', fullPage: true });
  await a.screenshot({ path: OUT + '/work.png', fullPage: true });
  await browser.close();
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
