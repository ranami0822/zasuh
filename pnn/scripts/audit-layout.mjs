/**
 * 見切れと間隔の検査。docs/pnn-design-system.md の第10節。
 * 使い方: npm run build してから、`npm run audit`（4つの画面サイズで、ライトとダークを調べる）。
 * playwright は、別に入れておく（ブラウザは、環境にあるものを使う）。
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(`${process.env.NODE_PATH ?? ''}/playwright`)); }

const sizes = [['se', 320, 568], ['phone', 390, 844], ['tablet', 820, 1180], ['desktop', 1280, 800]];
const fails = [];
const fail = (m) => { fails.push(m); console.log('FAIL', m); };
const ok = (m) => console.log('OK  ', m);

// ---- 1. px の直書きを探す（値は tokens.css だけに置く） ----
const lint = [
	['src/routes/+page.svelte', (s) => s.slice(s.indexOf('<style>'))],
	['src/lib/editor/live.ts', (s) => s.slice(s.indexOf('liveTheme'))]
];
for (const [f, pick] of lint) {
	const body = pick(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
	const bad = [...body.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px/g)].map((m) => m[0]).filter((v) => !['1px', '2px', '0px'].includes(v));
	bad.length ? fail(`${f}: px の直書き ${[...new Set(bad)].join(', ')}`) : ok(`${f}: px の直書きなし`);
}

// ---- 2. 画面の検査 ----
const base = process.env.AUDIT_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch();
for (const [name, w, h] of sizes) {
	for (const theme of ['light', 'dark']) {
		const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, serviceWorkers: 'block', colorScheme: theme });
		const p = await ctx.newPage();
		await p.goto(base);
		await p.waitForSelector('.cm-content');
		await p.keyboard.type('夜中にしか書けない、とても長い題の例。ずっと続いて、画面の幅を超えても切れない');
		await p.keyboard.press('Enter');
		await p.keyboard.type('# 見出し\n本文の**太字**と*傾き*。\n> 引用\n- 箇条');
		await p.waitForTimeout(300);
		const r = await p.evaluate(() => {
			const q = (s) => [...document.querySelectorAll(s)];
			const rect = (e) => e.getBoundingClientRect();
			const W = innerWidth;
			const out = { overflow: [], wrap: [], small: [], clipped: [] };
			for (const e of q('.top > *, .title, .bar .chip, .col')) {
				const b = rect(e);
				if (b.width && (b.right > W + 0.5 || b.left < -0.5) && !e.closest('.bar')) out.overflow.push(`${e.className} ${Math.round(b.left)}..${Math.round(b.right)}`);
			}
			for (const e of q('.chip, .btn')) {
				const b = rect(e);
				if (!b.width && !b.height) continue; // 閉じたダイアログの中
				if (b.height > 48) out.wrap.push(`${e.textContent.trim()} h${Math.round(b.height)}`);
				if (b.height < 44 - 0.5 || b.width < 44 - 0.5) out.small.push(`${e.textContent.trim()} ${Math.round(b.width)}x${Math.round(b.height)}`);
			}
			const t = document.querySelector('.title');
			if (t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1) out.clipped.push('title');
			const bar = document.querySelector('.bar');
			out.barScrolls = bar.scrollWidth > bar.clientWidth + 1;
			out.barMask = getComputedStyle(bar).maskImage !== 'none' || getComputedStyle(bar).webkitMaskImage !== 'none';
			out.docOverflow = document.documentElement.scrollWidth > innerWidth;
			const top = document.querySelector('.top'); out.topFits = top.scrollWidth <= top.clientWidth + 1;
			return out;
		});
		const tag = `${name} ${w}px ${theme}`;
		const problems = [];
		if (r.docOverflow) problems.push('ページが横にはみ出す');
		if (r.overflow.length) problems.push('はみ出し: ' + r.overflow.join(' | '));
		if (r.wrap.length) problems.push('折り返し: ' + r.wrap.join(' | '));
		if (r.small.length) problems.push('押せる大きさ未満: ' + r.small.join(' | '));
		if (r.clipped.length) problems.push('切れている: ' + r.clipped.join(','));
		if (!r.topFits) problems.push('上の列が収まらない');
		if (r.barScrolls && !r.barMask) problems.push('帯が続くのに、端のぼかしがない');
		problems.length ? fail(`${tag}: ${problems.join(' ; ')}`) : ok(`${tag}`);
		if (theme === 'light') await p.screenshot({ path: new URL(`../.svelte-kit/audit-${name}.png`, import.meta.url).pathname });
		await ctx.close();
	}
}
await browser.close();
console.log(fails.length ? `\n${fails.length} 件の問題` : '\n問題なし');
process.exit(fails.length ? 1 : 0);
