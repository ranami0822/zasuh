import { describe, expect, it } from 'vitest';
import { excerpt, render } from './render';

describe('render', () => {
	it('エディタと同じ記法を HTML にする', () => {
		expect(render('# 見出し')).toBe('<h2>見出し</h2>');
		expect(render('**太**と*傾*と~~消~~')).toBe('<p><strong>太</strong>と<em>傾</em>と<s>消</s></p>');
		expect(render('> 引用\n> 続き')).toBe('<blockquote>引用<br>続き</blockquote>');
		expect(render('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
		expect(render('一\n二\n\n三')).toBe('<p>一<br>二</p><p>三</p>');
		expect(render('---')).toBe('<hr>');
	});
	it('HTML は、すべて文字として出す（スクリプトを埋め込めない）', () => {
		const bad = '<script>alert(1)</script><img src=x onerror=alert(1)> **<b onclick="x">y</b>**';
		const html = render(bad);
		expect(html).not.toMatch(/<script|<img|<b /);
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('&quot;x&quot;');
	});
	it('属性を作らない', () => {
		expect(render('# "x" onload=1\n*a"b*')).not.toMatch(/<\w+ /);
	});
	it('抜き出しは、記号を取って短くする', () => {
		expect(excerpt('# 題\n**本文**と> 引用', 100)).toBe('題 本文と> 引用');
		expect(excerpt('あ'.repeat(10), 5)).toBe('あああああ…');
	});
});
