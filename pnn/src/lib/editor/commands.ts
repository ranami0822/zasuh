import { EditorSelection, type EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';

/** EditorView でも、テスト用の入れ物でも使えるようにする */
export interface Target {
	state: EditorState;
	dispatch(spec: TransactionSpec | Transaction): void;
}

/** 太字・傾き・取り消しのように、選んだ文字を記号ではさむ（もう一度で外す） */
export function toggleWrap(t: Target, mark: string): void {
	const m = mark.length;
	const doc = t.state.doc;
	const spec = t.state.changeByRange((range) => {
		const { from, to } = range;
		const before = doc.sliceString(Math.max(0, from - m), from);
		const after = doc.sliceString(to, Math.min(doc.length, to + m));
		const beyond = doc.sliceString(Math.max(0, from - m - 1), Math.max(0, from - m));
		// 「**太字**」の中で「*」を押したとき、太字の記号を傾きと見間違えない
		const embedded = mark === '*' && beyond === '*';
		if (before === mark && after === mark && !embedded) {
			return {
				changes: [{ from: from - m, to: from }, { from: to, to: to + m }],
				range: EditorSelection.range(from - m, to - m)
			};
		}
		const sel = doc.sliceString(from, to);
		if (sel.length >= 2 * m && sel.startsWith(mark) && sel.endsWith(mark) && mark !== '*') {
			return {
				changes: [{ from, to: from + m }, { from: to - m, to }],
				range: EditorSelection.range(from, to - 2 * m)
			};
		}
		return {
			changes: [{ from, insert: mark }, { from: to, insert: mark }],
			range: from === to ? EditorSelection.cursor(from + m) : EditorSelection.range(from + m, to + m)
		};
	});
	t.dispatch({ ...spec, scrollIntoView: true, userEvent: 'input' });
}

/** 行頭の記号（見出し・引用・箇条）を、選んだ行すべてで付ける／外す */
export function toggleLinePrefix(t: Target, prefix: string): void {
	const doc = t.state.doc;
	const seen = new Set<number>();
	const lines: { from: number; text: string }[] = [];
	for (const r of t.state.selection.ranges) {
		const a = doc.lineAt(r.from).number;
		const b = doc.lineAt(r.to).number;
		for (let n = a; n <= b; n++) {
			if (seen.has(n)) continue;
			seen.add(n);
			const l = doc.line(n);
			lines.push({ from: l.from, text: l.text });
		}
	}
	const isHeading = prefix.startsWith('#');
	const has = (text: string) => text.startsWith(prefix);
	const allHave = lines.every((l) => has(l.text));
	const changes = lines.map((l) => {
		if (allHave) return { from: l.from, to: l.from + prefix.length };
		if (isHeading) {
			const other = /^#{1,6} /.exec(l.text);
			if (other) return { from: l.from, to: l.from + other[0].length, insert: prefix };
		}
		if (has(l.text)) return { from: l.from, insert: '' };
		return { from: l.from, insert: prefix };
	});
	t.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
}

/** 選んだ範囲を text で置き換える。caret は、挿入した文字の先頭からの位置（省略で末尾） */
export function insertText(t: Target, text: string, caret?: number): void {
	const spec = t.state.changeByRange((range) => ({
		changes: { from: range.from, to: range.to, insert: text },
		range: EditorSelection.cursor(range.from + (caret ?? text.length))
	}));
	t.dispatch({ ...spec, scrollIntoView: true, userEvent: 'input' });
}

/** 区切り線。いまの行が空でなければ、次の行に入れる */
export function insertRule(t: Target): void {
	const line = t.state.doc.lineAt(t.state.selection.main.head);
	if (line.text.trim() === '') {
		t.dispatch({
			changes: { from: line.from, to: line.to, insert: '---\n' },
			selection: EditorSelection.cursor(line.from + 4),
			scrollIntoView: true,
			userEvent: 'input'
		});
	} else {
		const insert = '\n\n---\n';
		t.dispatch({
			changes: { from: line.to, insert },
			selection: EditorSelection.cursor(line.to + insert.length),
			scrollIntoView: true,
			userEvent: 'input'
		});
	}
}

export function today(d = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}
