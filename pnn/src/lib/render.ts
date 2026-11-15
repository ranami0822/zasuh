/**
 * 本文の表示。先に HTML の記号をすべて逃がしてから、エディタと同じ範囲の記法だけを HTML にする。
 * 属性やリンクは作らないので、スクリプトを埋め込めない（docs/pnn-server-design.md の第6節）。
 */
export function escape(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inline(s: string): string {
	return escape(s)
		.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
		.replace(/~~(.+?)~~/g, '<s>$1</s>')
		.replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>');
}

export function render(md: string): string {
	const out: string[] = [];
	let para: string[] = [];
	let list: string[] = [];
	let quote: string[] = [];
	const flush = () => {
		if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
		if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`);
		if (quote.length) out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
		para = []; list = []; quote = [];
	};
	for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
		let m: RegExpExecArray | null;
		if (line.trim() === '') { flush(); continue; }
		if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flush(); const n = Math.min(m[1].length, 3); out.push(`<h${n + 1}>${inline(m[2])}</h${n + 1}>`); continue; }
		if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
		if ((m = /^>\s?(.*)$/.exec(line))) { if (para.length || list.length) flush(); quote.push(m[1]); continue; }
		if ((m = /^[-*+]\s+(.*)$/.exec(line))) { if (para.length || quote.length) flush(); list.push(m[1]); continue; }
		if (list.length || quote.length) flush();
		para.push(line);
	}
	flush();
	return out.join('');
}

/** 一覧に出す抜き出し（記法の記号を取る） */
export function excerpt(md: string, n = 120): string {
	const t = md.replace(/^#{1,6}\s+/gm, '').replace(/^>\s?/gm, '').replace(/^[-*+]\s+/gm, '').replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, '')
		.replace(/\*\*|~~|\*/g, '').replace(/\s+/g, ' ').trim();
	return t.length > n ? t.slice(0, n) + '…' : t;
}
