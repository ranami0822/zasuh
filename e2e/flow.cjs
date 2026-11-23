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
  ok(await pub.isVisible('a.tile:has-text("星屑の鉄道")'), 'search finds the work');
  await pub.goto(BASE + '/?q=' + encodeURIComponent('存在しない'));
  ok(await pub.isVisible('text=見つかりませんでした'), 'search shows the empty state with a request link');
  for (const [path, word] of [['/about', 'それは評価じゃない'], ['/terms', 'してはいけないこと'], ['/privacy', '保存する情報'], ['/me', '投稿したレビューは、ありません']]) {
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

  // 星の分布の棒（本番の読み取りは AI が要るので、集計の行を、ローカルの D1 に直接入れて確かめる）。
  // 前提: 環境変数 E2E_D1_DIR（wrangler dev の --persist-to と同じディレクトリ）。なければ、この確認は飛ばす。
  if (process.env.E2E_D1_DIR) {
    const sql = (tag, n, soft, mean, se, lower) =>
      "INSERT OR REPLACE INTO aspect_star_stats (work_id, tag_id, n_mention, soft_1, soft_2, soft_3, soft_4, soft_5, mean, se, score_lower, updated_at) " +
      "SELECT id, '" + tag + "', " + n + ', ' + soft.join(', ') + ', ' + mean + ', ' + se + ', ' + lower + ", '2026-11-22T00:00:00.000Z' FROM works WHERE slug = 'star-line';";
    const statements = [
      sql('_overall', 12, [1.2, 2.1, 3.4, 3.0, 2.3], 3.2, 0.31, 2.6),
      sql('game/gameplay', 9, [0.5, 1.0, 2.5, 3.0, 2.0], 3.6, 0.35, 2.9),
      sql('game/music', 3, [0, 0.2, 0.8, 1.5, 0.5], 3.8, 'NULL', 1.9)
    ].join(' ');
    const reading = [
      "INSERT OR IGNORE INTO question_sets (hash, model, definition_json, created_at) VALUES ('e2e', 'clef-flash', '{}', '2026-11-22T00:00:00.000Z');",
      "INSERT OR REPLACE INTO readings (id, revision_id, question_set_id, model, status, attempts, created_at, updated_at) SELECT 'e2e-rd', r.current_revision_id, (SELECT id FROM question_sets WHERE hash = 'e2e'), 'clef-flash', 'ok', 1, '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z' FROM reviews r JOIN works w ON w.id = r.work_id WHERE w.slug = 'star-line' LIMIT 1;",
      "DELETE FROM reading_answers WHERE reading_id = 'e2e-rd';",
      "INSERT INTO reading_answers (reading_id, question_key, tag_id, tag_version, kind, value, prob, probs_json) VALUES ('e2e-rd', 'gameplay_noul', 'game/gameplay', 2, 'mention', 'true', 0.9, NULL), ('e2e-rd', 'gameplay_star', 'game/gameplay', 2, 'star', '5', 0.6, '{\"score\":4.6,\"levels\":[0,0.02,0.08,0.3,0.6],\"confidence\":0.5}'), ('e2e-rd', 'music_noul', 'game/music', 2, 'mention', 'true', 0.9, NULL), ('e2e-rd', 'music_star', 'game/music', 2, 'star', '2', 0.5, '{\"score\":2.2,\"levels\":[0.2,0.5,0.2,0.1,0]}');"
    ].join(' ');
    require('child_process').execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', process.env.E2E_D1_DIR, '--config', 'wrangler.local.jsonc', '--command', statements + ' ' + reading], { stdio: 'pipe' });
    await a.goto(BASE + '/works/star-line', { waitUntil: 'networkidle' });
    const hero = await a.$$eval('.dist.hero .dist__bar > i', (els) => els.map((e) => getComputedStyle(e).backgroundColor));
    ok(hero.length === 5 && new Set(hero).size === 5, 'hero bar has 5 distinct star colours: ' + hero.join(' '));
    ok(hero[0] === 'rgb(230, 0, 18)' && hero[4] === 'rgb(0, 166, 62)', 'star 1 is red and star 5 is green');
    const caption = await a.textContent('.dist.hero .dist__caption');
    ok(/平均\s*3\.2/.test(caption) && /±\s*0\.6/.test(caption), 'hero shows the mean and the spread: ' + caption.replace(/\s+/g, ' ').trim());
    const chips = await a.$$eval('article .star-tag', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    ok(chips.length === 2 && /星 ?4\.6 ゲーム性・内容/.test(chips[0]) && /星 ?2\.2 音楽・音/.test(chips[1]), 'the review shows how it was read (star icon, number, aspect): ' + chips.join(' | '));
    const chipLook = await a.$$eval('article .star-tag', (els) => els.map((e) => { const sc = e.querySelector('.star-tag__score'), lb = e.querySelector('.star-tag__label'); return { box: getComputedStyle(e).backgroundColor, text: getComputedStyle(e).color, svg: !!sc.querySelector('svg'), first: sc.getBoundingClientRect().left < lb.getBoundingClientRect().left, labelOpacity: getComputedStyle(lb).opacity }; }));
    ok(chipLook.length === 2 && chipLook.every((c) => c.svg && c.first && c.labelOpacity !== '1'), 'the tag: star icon and number first, the aspect name fainter: ' + JSON.stringify(chipLook.map((c) => [c.svg, c.first, c.labelOpacity])));
    ok(chipLook[0].box === 'rgb(223, 245, 230)' && chipLook[1].box === 'rgb(208, 197, 196)' && chipLook[0].box !== chipLook[1].box, 'the whole tag is painted with the colour of the nearest star (star 5 green, star 2 red-grey): ' + chipLook.map((c) => c.box).join(' | '));
    const legend = await a.textContent('.dist__legend');
    ok(/星1.*星2.*星3.*星4.*星5/.test(legend), 'legend lists stars 1 to 5');
    const rows = await a.$$eval('.tagrow', (els) => els.map((e) => ({ text: e.textContent.replace(/\s+/g, ' ').trim(), height: e.querySelector('.dist__bar') && getComputedStyle(e.querySelector('.dist__bar')).height, opacity: e.querySelector('.dist__bar') && getComputedStyle(e.querySelector('.dist__bar')).opacity })));
    const music = rows.find((r) => r.text.startsWith('音楽'));
    const gameplay = rows.find((r) => r.text.startsWith('ゲーム性'));
    ok(music && music.opacity !== '1' && music.height === '3px', 'few mentions (3): the bar is thin and faint: ' + JSON.stringify(music));
    ok(gameplay && gameplay.opacity === '1' && gameplay.height === '5px', 'more mentions (9): the bar is normal: ' + JSON.stringify(gameplay));
    ok(!/±/.test(music.text) && /3\.8/.test(music.text) && /3\.6/.test(gameplay.text), 'rows show the mean');
    const bars = await a.$$eval('.dist__bar:not(.empty)', (els) => els.map((e) => ({ clip: getComputedStyle(e).overflow, radius: getComputedStyle(e).borderTopLeftRadius })));
    ok(bars.length >= 3 && bars.every((b) => b.clip === 'hidden' && b.radius === '0px'), 'bars are square and clip their segments (' + bars.length + ' bars)');
    await a.screenshot({ path: OUT + '/work-stars.png', fullPage: true });
  } else {
    console.log('SKIP star bars (set E2E_D1_DIR to check them)');
  }

  // 一覧
  const h = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await h.goto(BASE + '/');
  ok(await h.isVisible('a.tile:has-text("星屑の鉄道")'), 'work listed on home');
  if (process.env.E2E_D1_DIR) {
    await h.goto(BASE + '/', { waitUntil: 'networkidle' });
    ok((await h.textContent('a.tile:has-text("星屑の鉄道") .tile__no')).trim() === '1', 'home: the work with mentions has rank 1');
    ok((await h.$$('a.tile:has-text("星屑の鉄道") .dist__bar > i')).length === 5, 'home: the row bar has 5 star segments');
  }
  await h.screenshot({ path: OUT + '/home.png', fullPage: true });
  await a.screenshot({ path: OUT + '/work.png', fullPage: true });
  // スマホの幅: 総合だけ見せて、観点ごとはたたむ。説明が長ければ、たたむ。投稿の欄は、書き始めるまで小さい。
  if (process.env.E2E_D1_DIR) {
    const long = '夜行列車を走らせる運転シミュレーション。' + '路線は、実在の夜行列車をもとにしていて、車両の細かい動きまで再現している。'.repeat(3);
    require('child_process').execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', process.env.E2E_D1_DIR, '--config', 'wrangler.local.jsonc', '--command', "UPDATE works SET summary = '" + long + "' WHERE slug = 'star-line';"], { stdio: 'pipe' });
    const mctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
    const m = await mctx.newPage();
    await m.goto(BASE + '/works/star-line', { waitUntil: 'networkidle' });
    ok(await m.isVisible('.rating .dist.hero'), 'phone: the overall bar is shown');
    ok(!(await m.isVisible('.tagrow:visible')), 'phone: the per-aspect rows are folded');
    await m.click('.rating__fold summary');
    ok(await m.isVisible('.tagrow:visible'), 'phone: the rows open when asked');
    const summaryHeight = await m.$eval('.work-summary', (e) => e.getBoundingClientRect().height);
    ok(await m.isVisible('button[aria-controls="work-summary"]'), 'phone: a long description has an icon button to open it');
    ok((await m.textContent('button[aria-controls="work-summary"]')).trim() === '' && (await m.getAttribute('button[aria-controls="work-summary"]', 'aria-label')).length > 0 && (await m.$eval('.rating__fold summary', (e) => e.textContent.trim())) === '', 'phone: the toggles are icons with labels for screen readers, not words');
    await m.click('button[aria-controls="work-summary"]');
    const openHeight = await m.$eval('.work-summary', (e) => e.getBoundingClientRect().height);
    ok(openHeight > summaryHeight, 'phone: the description opens (' + Math.round(summaryHeight) + ' -> ' + Math.round(openHeight) + 'px)');
    const pg = await m.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); return { band: r('.band'), rating: r('.rating'), h1: parseFloat(getComputedStyle(document.querySelector('.band h1')).fontSize), width: window.innerWidth }; });
    ok(pg.band.left >= 12 && pg.width - pg.band.right >= 12 && pg.rating.left >= 12 && pg.width - pg.rating.right >= 12, 'phone: the title band and the rating keep the page margins, as before (' + Math.round(pg.band.left) + 'px)');
    ok(pg.h1 <= 32, 'phone: the title keeps its original size (' + pg.h1 + 'px)');
    await m.screenshot({ path: OUT + '/phone-work.png', fullPage: true });
    // 投稿の欄（別の端末として開く。投稿済みの端末では、欄がない）
    const m2 = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    await m2.goto(BASE + '/works/star-line', { waitUntil: 'networkidle' });
    const compact = await m2.$eval('.compose textarea', (e) => e.getBoundingClientRect().height);
    ok(compact < 60 && !(await m2.isVisible('.compose__foot')), 'phone: the post box starts small, without the footer (' + Math.round(compact) + 'px)');
    await m2.click('.compose textarea');
    ok(await m2.isVisible('.compose__foot'), 'phone: tapping the box shows the footer');
    await m2.fill('.compose textarea', 'x');
    await m2.click('h1');
    ok(await m2.isVisible('.compose__foot'), 'phone: with text in it, the box stays open');
    const wide = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
    await wide.goto(BASE + '/works/star-line', { waitUntil: 'networkidle' });
    const wideBox = await wide.$eval('.compose textarea', (e) => e.getBoundingClientRect().height);
    ok(wideBox > 60 && !(await wide.isVisible('.rating__fold')) && (await wide.isVisible('.tagrow:visible')), 'desktop: the post box is full size, and the rows are not folded');
    const geo = await wide.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); return { band: r('.band'), rating: r('.rating'), main: r('.main'), lastCard: r('.main > section:last-child'), footer: r('.footer'), brand: r('.header .brand'), login: r('.header .tag'), width: window.innerWidth, h1: parseFloat(getComputedStyle(document.querySelector('.band h1')).fontSize) }; });
    ok(geo.band.left === 0 && Math.round(geo.band.right) === geo.width, 'desktop: the title band is full width');
    ok(geo.rating.left === 0 && geo.rating.right < geo.main.left && geo.rating.top >= geo.band.bottom, 'desktop: the gray aside is on the left (flush with the screen edge), under the title band');
    ok(geo.rating.top - geo.band.bottom >= 16 && geo.main.left - geo.rating.right >= 20, 'desktop: space between the band and the aside (' + Math.round(geo.rating.top - geo.band.bottom) + 'px), and between the aside and the reviews (' + Math.round(geo.main.left - geo.rating.right) + 'px)');
    ok(Math.abs(geo.rating.bottom - geo.footer.top) < 1.5, 'desktop: the aside runs down to the footer (' + Math.round(geo.rating.bottom) + ' / ' + Math.round(geo.footer.top) + ')');
    ok(geo.width - geo.lastCard.right >= 24, 'desktop: the reviews keep a margin on the right (' + Math.round(geo.width - geo.lastCard.right) + 'px)');
    ok(geo.h1 <= 40.5, 'desktop: the title keeps its original size (' + geo.h1 + 'px)');
    ok(geo.brand.left < 40 && geo.width - geo.login.right < 40, 'desktop: the header is full width (logo ' + Math.round(geo.brand.left) + 'px from the left, login ' + Math.round(geo.width - geo.login.right) + 'px from the right)');
    ok(!(await wide.isVisible('button[aria-controls="work-summary"]')), 'desktop: no toggle buttons (everything is open)');
    await wide.screenshot({ path: OUT + '/desktop-work.png', fullPage: true });

    // 専門家の欄（22.10）。読み取りは AI が要るので、結果の行を、ローカルの D1 に直接入れる（上の確認のあとに入れる。総合の棒が2本になるため）。
    const critic = (n, outlet, on, levels, score) => [
      "INSERT INTO critic_reviews (id, work_id, oc_review_id, outlet, url, published_on, question_set_id, read_at) SELECT 'e2e-cr-" + n + "', id, 'e2e-oc-" + n + "', '" + outlet + "', 'https://example.com/critic/" + n + "', " + (on ? "'" + on + "'" : 'NULL') + ", (SELECT id FROM question_sets WHERE hash = 'e2e'), '2026-11-22T00:00:00.000Z' FROM works WHERE slug = 'star-line';",
      "INSERT INTO critic_answers (critic_review_id, question_key, aspect, kind, value, prob, probs_json) VALUES ('e2e-cr-" + n + "', 'overall_choice', 'overall', 'direction', 'positive', 0.9, NULL), ('e2e-cr-" + n + "', 'overall_star', 'overall', 'star', '" + (levels.indexOf(Math.max(...levels)) + 1) + "', " + Math.max(...levels) + ", '{\"score\":" + score + ',\"levels\":[' + levels.join(',') + "]}');"
    ].join(' ');
    const criticSql = [
      "INSERT OR IGNORE INTO question_sets (hash, model, definition_json, created_at) VALUES ('e2e', 'clef-flash', '{}', '2026-11-22T00:00:00.000Z');",
      "DELETE FROM critic_answers WHERE critic_review_id IN ('e2e-cr-1', 'e2e-cr-2', 'e2e-cr-3');",
      "DELETE FROM critic_reviews WHERE id IN ('e2e-cr-1', 'e2e-cr-2', 'e2e-cr-3');",
      critic(1, 'Example Weekly', '2026-11-01', [0, 0.05, 0.1, 0.55, 0.3], 4.1),
      critic(2, 'Sample Games Review', '2026-10-15', [0.05, 0.1, 0.35, 0.4, 0.1], 3.4),
      critic(3, 'Test Critic Online', null, [0, 0, 0.05, 0.25, 0.7], 4.6)
    ].join(' ');
    require('child_process').execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', process.env.E2E_D1_DIR, '--config', 'wrangler.local.jsonc', '--command', criticSql], { stdio: 'pipe' });
    await wide.goto(BASE + '/works/star-line', { waitUntil: 'networkidle' });
    ok(await wide.isVisible('.rating .critic h2:has-text("専門家")'), 'critics: the pane with the heading is in the gray aside');
    ok((await wide.textContent('.critic__ai')).includes('AI'), 'critics: the heading has the AI mark');
    const entries = await wide.$$eval('.critic__ticker .critic__set:not([aria-hidden]) a', (els) => els.map((e) => ({ href: e.getAttribute('href'), target: e.target, rel: e.rel, text: e.textContent.replace(/\s+/g, ' ').trim() })));
    ok(entries.length === 3 && entries.every((e) => e.href.startsWith('https://example.com/critic/') && e.target === '_blank' && /nofollow/.test(e.rel)), 'critics: each band entry links to its article in a new tab: ' + JSON.stringify(entries.map((e) => e.text)));
    const copies = await wide.$$eval('.critic__ticker .critic__set[aria-hidden="true"] a', (els) => els.map((e) => e.getAttribute('tabindex')));
    ok(copies.every((t) => t === '-1'), 'critics: the copied set (if any) is hidden from readers and not focusable (' + copies.length + ' links)');
    const toggle = 'button.critic__toggle';
    ok((await wide.isVisible('.critic__list')) && !(await wide.isVisible(toggle)), 'critics: on a wide screen the list is always open, with no accordion toggle');
    const listRows = await wide.$$eval('.critic__list a', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    ok(listRows.length === 3 && /2026-11/.test(listRows[0]), 'critics: the list has one row per review, with the month: ' + listRows.join(' | '));
    const srcBox = await wide.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); return { list: r('.critic__list'), foot: r('.critic__foot') }; });
    ok(srcBox.foot.top >= srcBox.list.bottom - 1, 'critics: on a wide screen the source line comes after the list');
    ok(/レビュー\s*3\s*件/.test(await wide.textContent('.critic .dist__caption')), 'critics: the overall shows the count');
    ok(await wide.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'critics: the wide page does not scroll sideways');
    await wide.screenshot({ path: OUT + '/desktop-critics.png', fullPage: true });
    const mc = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    await mc.goto(BASE + '/works/star-line', { waitUntil: 'networkidle' });
    const order = await mc.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); return { hero: r('.rating .dist.hero'), critic: r('.critic'), compose: r('.compose') }; });
    ok(order.critic.top > order.hero.bottom && order.critic.bottom < order.compose.top, 'phone: the critics pane is under the readers\' summary and above the post box');
    ok((await mc.getAttribute(toggle, 'aria-expanded')) === 'false' && !(await mc.isVisible('.critic__list')), 'phone: the critics list starts closed');
    ok((await mc.textContent(toggle)).trim() === '' && (await mc.getAttribute(toggle, 'aria-label')).length > 0, 'phone: the toggle is an icon with a label for screen readers');
    await mc.click(toggle);
    ok((await mc.getAttribute(toggle, 'aria-expanded')) === 'true' && (await mc.isVisible('.critic__list')), 'phone: the icon opens the list');
    ok(await mc.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'phone: the page with the critics pane does not scroll sideways');
    await mc.screenshot({ path: OUT + '/phone-critics.png', fullPage: true });
  }
  await browser.close();
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
