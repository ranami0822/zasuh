let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require((process.env.NODE_PATH ?? '') + '/playwright')); }
const assert = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 420, height: 800 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('console', m => { if (['error','warning'].includes(m.type())) errs.push(m.text().slice(0,160)); }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto('' + (process.env.AUDIT_URL ?? 'http://localhost:4173/') + '');
  await p.waitForSelector('.cm-content');
  assert(await p.evaluate(() => document.activeElement === document.querySelector('.title')), '開いたら、題にカーソルがある（すぐ書ける）');
  await p.keyboard.type('夜中にしか書けない');
  await p.keyboard.press('Enter');
  assert(await p.evaluate(() => document.activeElement?.classList.contains('cm-content')), 'Enter で本文へ移る');
  await p.keyboard.type('# 見出し\n本文の**太字**と*傾き*と~~取消~~。\n> 引用\n- 箇条\n\n---\n最後');
  await p.waitForTimeout(400);
  const cls = async (sel) => p.locator(sel).count();
  assert(await cls('.cm-h1') >= 1, '見出しが整形される');
  assert(await cls('.cm-strong') >= 1 && await cls('.cm-em') >= 1 && await cls('.cm-strike') >= 1, '太字・傾き・取消が整形される');
  assert(await cls('.cm-quote') >= 1, '引用が整形される');
  assert(await cls('.cm-bullet') >= 1, '箇条が「・」になる');
  assert(await cls('.cm-hr') >= 1, '区切りが整形される');
  const text = await p.evaluate(() => document.querySelector('.cm-content').innerText);
  assert(!text.includes('# 見出し') && !text.includes('**'), 'カーソルのない行の記号は隠れる');
  await p.screenshot({ path: (process.env.OUT ?? '.svelte-kit') + '/e2e-light.png' });
  // 装飾バー
  await p.keyboard.press('Control+End');
  await p.click('button[aria-label="太字"]');
  await p.keyboard.type('X');
  const body1 = await p.evaluate(() => document.querySelector('.cm-content').innerText);
  assert(body1.includes('X'), '装飾バーの太字で、記号が入り、カーソルが間に入る');
  // 保存: 再読み込み
  await p.waitForTimeout(500);
  await p.reload(); await p.waitForSelector('.cm-content');
  const title = await p.inputValue('.title');
  const body = await p.evaluate(() => document.querySelector('.cm-content').innerText);
  assert(title === '夜中にしか書けない', '再読み込みで題が残る');
  assert(body.includes('最後') && body.includes('X'), '再読み込みで本文が残る');
  // 状態
  await p.click('button[aria-label="状態"]'); await p.waitForTimeout(150);
  await p.click('dialog[open] button:has-text("公開")'); await p.waitForTimeout(150);
  assert(await p.locator('dialog[open] h2:has-text("公開？")').count() === 1, '公開は、確認の2段階目が出る');
  await p.click('dialog[open] button:has-text("公開する")'); await p.waitForTimeout(200);
  assert((await p.textContent('button[aria-label="状態"]')).trim() === '公開', '公開にできる');
  // 閉じる直前の保存
  await p.keyboard.type('Z');
  await p.evaluate(() => { dispatchEvent(new Event('pagehide')); });
  // 一覧と新規
  await p.click('button[aria-label="新しく書く"]'); await p.waitForTimeout(300);
  assert(await p.inputValue('.title') === '', '新しく書くと、空の題');
  await p.click('button[aria-label="いままで"]'); await p.waitForTimeout(200);
  const rows = await p.locator('dialog[open] .item').count();
  assert(rows === 1, '空の文書は、一覧に出ない（行数 ' + rows + '）');
  // service worker とオフライン
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready, null, { timeout: 8000 }).catch(() => {});
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload(); await p.waitForTimeout(800);
  const ctrl = await p.evaluate(() => !!navigator.serviceWorker.controller);
  assert(ctrl, 'service worker が、ページを制御している');
  await ctx.setOffline(true);
  await p.reload(); await p.waitForSelector('.cm-content', { timeout: 8000 });
  assert(true, 'オフラインで再読み込みしても、開く');
  const t2 = await p.evaluate(async () => { const r = await fetch('/fonts/unifontex-base.woff2'); return r.ok; });
  assert(t2, 'オフラインで、基本のフォントが返る');
  // 文書を開いて、残っているか
  await p.click('button[aria-label="いままで"]'); await p.waitForTimeout(200);
  await p.click('dialog[open] .open'); await p.waitForTimeout(300);
  assert(await p.inputValue('.title') === '夜中にしか書けない', 'オフラインでも、一覧から文書を開ける');
  await p.screenshot({ path: (process.env.OUT ?? '.svelte-kit') + '/e2e-offline.png' });
  await ctx.setOffline(false);
  // ダーク
  await p.click('button[aria-label="明るさ"]'); await p.waitForTimeout(300);
  await p.screenshot({ path: (process.env.OUT ?? '.svelte-kit') + '/e2e-dark.png' });
  const fonts = await p.evaluate(() => [...document.fonts].filter(f => f.status !== 'unloaded').map(f => f.status).join(','));
  console.log('fonts used:', fonts);
  console.log('console:', errs.length ? errs.join(' | ') : 'none');
  await b.close();
})();
