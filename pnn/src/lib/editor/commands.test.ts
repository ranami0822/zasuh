import { EditorSelection, EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { insertRule, insertText, toggleLinePrefix, toggleWrap, today, type Target } from './commands';

/** 画面なしで、命令を試す入れ物 */
function make(doc: string, anchor: number, head = anchor) {
	const t: Target & { state: EditorState } = {
		state: EditorState.create({ doc, selection: EditorSelection.single(anchor, head) }),
		dispatch(spec: TransactionSpec | Transaction) {
			t.state = (spec as Transaction).state ?? t.state.update(spec as TransactionSpec).state;
		}
	};
	return t;
}
const text = (t: { state: EditorState }) => t.state.doc.toString();
const sel = (t: { state: EditorState }) => [t.state.selection.main.from, t.state.selection.main.to];

describe('toggleWrap', () => {
	it('選んだ文字を、記号ではさむ', () => {
		const t = make('あいう', 1, 2);
		toggleWrap(t, '**');
		expect(text(t)).toBe('あ**い**う');
		expect(sel(t)).toEqual([3, 4]);
	});
	it('もう一度で外す', () => {
		const t = make('あ**い**う', 3, 4);
		toggleWrap(t, '**');
		expect(text(t)).toBe('あいう');
		expect(sel(t)).toEqual([1, 2]);
	});
	it('選んでいないときは、記号を入れて、間にカーソルを置く', () => {
		const t = make('あ', 1);
		toggleWrap(t, '~~');
		expect(text(t)).toBe('あ~~~~');
		expect(sel(t)).toEqual([3, 3]);
	});
	it('記号ごと選んでいても外せる', () => {
		const t = make('**い**', 0, 5);
		toggleWrap(t, '**');
		expect(text(t)).toBe('い');
	});
	it('太字の中で傾きを押しても、太字の記号を壊さない', () => {
		const t = make('**い**', 2, 3);
		toggleWrap(t, '*');
		expect(text(t)).toBe('***い***');
	});
});

describe('toggleLinePrefix', () => {
	it('行頭に付ける', () => {
		const t = make('あ\nい', 0);
		toggleLinePrefix(t, '> ');
		expect(text(t)).toBe('> あ\nい');
	});
	it('選んだ複数行に付けて、もう一度で全部外す', () => {
		const t = make('あ\nい\nう', 0, 5);
		toggleLinePrefix(t, '- ');
		expect(text(t)).toBe('- あ\n- い\n- う');
		toggleLinePrefix(t, '- ');
		expect(text(t)).toBe('あ\nい\nう');
	});
	it('一部の行にだけ付いているときは、足りない行に付ける', () => {
		const t = make('- あ\nい', 0, 5);
		toggleLinePrefix(t, '- ');
		expect(text(t)).toBe('- あ\n- い');
	});
	it('見出しは、別の見出しの記号を置き換える', () => {
		const t = make('### あ', 0);
		toggleLinePrefix(t, '# ');
		expect(text(t)).toBe('# あ');
	});
});

describe('insertText / insertRule', () => {
	it('選んだ範囲を置き換え、カーソルを指定の位置に置く', () => {
		const t = make('あいう', 1, 2);
		insertText(t, '「」', 1);
		expect(text(t)).toBe('あ「」う');
		expect(sel(t)).toEqual([2, 2]);
	});
	it('区切り線は、空でない行のあとに入れる', () => {
		const t = make('あ', 1);
		insertRule(t);
		expect(text(t)).toBe('あ\n\n---\n');
		expect(sel(t)).toEqual([text(t).length, text(t).length]);
	});
	it('空の行なら、その行を区切り線にする', () => {
		const t = make('あ\n\nい', 2);
		insertRule(t);
		expect(text(t)).toBe('あ\n---\n\nい');
	});
	it('日付の形', () => {
		expect(today(new Date(2026, 10, 5))).toBe('2026.11.05');
	});
});
