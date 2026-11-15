import { syntaxTree } from '@codemirror/language';
import type { Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';

class Bullet extends WidgetType {
	toDOM() {
		const s = document.createElement('span');
		s.className = 'cm-bullet';
		s.textContent = '・';
		return s;
	}
	eq() {
		return true;
	}
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new Bullet() });

/**
 * 書いた記法を、その場で整形して見せる。
 * 記号は、カーソルがそこ（インラインは、その範囲。行頭の記号は、その行）にあるときだけ見える。
 * 文書は素の Markdown のまま。見た目だけを変える。
 */
function build(view: EditorView): DecorationSet {
	const { state } = view;
	const out: Range<Decoration>[] = [];
	const sel = state.selection.ranges;
	const touches = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from);
	const lineTouch = (pos: number) => {
		const l = state.doc.lineAt(pos);
		return touches(l.from, l.to);
	};
	const withSpace = (to: number) => (state.doc.sliceString(to, to + 1) === ' ' ? to + 1 : to);

	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter: (n) => {
				const name = n.name;
				if (/^ATXHeading[1-6]$/.test(name)) {
					const level = Math.min(+name.slice(-1), 3);
					out.push(Decoration.line({ class: `cm-h cm-h${level}` }).range(state.doc.lineAt(n.from).from));
				} else if (name === 'HeaderMark') {
					if (n.node.parent?.name.startsWith('ATXHeading') && !lineTouch(n.from)) out.push(hide.range(n.from, withSpace(n.to)));
				} else if (name === 'StrongEmphasis') {
					out.push(Decoration.mark({ class: 'cm-strong' }).range(n.from, n.to));
				} else if (name === 'Emphasis') {
					out.push(Decoration.mark({ class: 'cm-em' }).range(n.from, n.to));
				} else if (name === 'Strikethrough') {
					out.push(Decoration.mark({ class: 'cm-strike' }).range(n.from, n.to));
				} else if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
					const p = n.node.parent;
					if (p && !touches(p.from, p.to)) out.push(hide.range(n.from, n.to));
				} else if (name === 'Blockquote') {
					const a = state.doc.lineAt(n.from).number;
					const b = state.doc.lineAt(n.to).number;
					for (let i = a; i <= b; i++) out.push(Decoration.line({ class: 'cm-quote' }).range(state.doc.line(i).from));
				} else if (name === 'QuoteMark') {
					if (!lineTouch(n.from)) out.push(hide.range(n.from, withSpace(n.to)));
				} else if (name === 'ListMark') {
					const isBullet = n.node.parent?.parent?.name === 'BulletList';
					if (isBullet && !lineTouch(n.from)) out.push(bullet.range(n.from, withSpace(n.to)));
				} else if (name === 'HorizontalRule') {
					const l = state.doc.lineAt(n.from);
					out.push(Decoration.line({ class: lineTouch(n.from) ? 'cm-hr cm-hr-on' : 'cm-hr' }).range(l.from));
				}
			}
		});
	}
	return Decoration.set(out, true);
}

export const live = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = build(view);
		}
		update(u: ViewUpdate) {
			if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
				this.decorations = build(u.view);
			}
		}
	},
	{ decorations: (v) => v.decorations }
);

/** 色や大きさは、デザインシステムの変数から取る（ライトとダークは、変数が切り替える） */
export const liveTheme = EditorView.theme({
	'&': { height: '100%', backgroundColor: 'transparent', color: 'var(--ink)', fontSize: 'var(--t-body)' },
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': { fontFamily: 'var(--font)', lineHeight: 'var(--lh-write)', overflow: 'auto' },
	'.cm-content': { caretColor: 'var(--card-red)', padding: 'var(--s2) 0 var(--s7)' },
	'.cm-line': { padding: '0' },
	'.cm-cursor': { borderLeftColor: 'var(--card-red)', borderLeftWidth: '2px' },
	'.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgb(var(--glow) / .35) !important' },
	'.cm-h': { lineHeight: 'var(--lh-title)' },
	'.cm-h1': { fontSize: 'var(--t-title)', padding: 'var(--s4) 0 var(--s1)' },
	'.cm-h2': { fontSize: 'var(--t-title)', color: 'var(--soft)', padding: 'var(--s3) 0 var(--s1)' },
	'.cm-h3': { fontSize: 'var(--t-body)', backgroundImage: 'linear-gradient(transparent 62%, rgb(var(--glow) / .45) 62%)', backgroundSize: 'fit-content 100%', backgroundRepeat: 'no-repeat' },
	// ピクセルの書体は太字を持たないので、1px 重ねて太く見せる
	'.cm-strong': { textShadow: '1px 0 0 currentColor' },
	'.cm-em': { fontStyle: 'italic', color: 'var(--soft)' },
	'.cm-strike': { textDecoration: 'line-through' },
	// 線を使わず、面で引用を示す
	'.cm-quote': { backgroundColor: 'var(--ring)', padding: '0 var(--s4)', color: 'var(--ink)' },
	'.cm-bullet': { color: 'var(--card-red)' },
	'.cm-hr': { color: 'transparent', userSelect: 'none', backgroundImage: 'linear-gradient(var(--card), var(--card))', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', backgroundSize: 'var(--s8) var(--s1)', borderRadius: 'var(--r-pill)' },
	'.cm-hr-on': { color: 'var(--soft)', backgroundImage: 'none' }
});
