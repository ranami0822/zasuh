/**
 * 触ったときの動き（ンっ…）。docs/pnn-design-system.md の第6節。
 * 押すと沈み、少しずつ深く沈んで、小さく震える。離すと「ぷるっ」と戻る。
 * 文字は、下へつぶれて、下から見上げるように寄る。
 * 対象は、`.p` クラスで、中の文字を `.f` で包んだ要素。
 */
const down = { x: 0.95, y: 0.89 };
const deep = { x: 0.92, y: 0.83 };
const inMs = 110;
const sinkAt = 160;
const sinkMs = 700;
const tremble = 0.7;
const rel: [number, number, number][] = [
	[0.3, 1.06, 0.95],
	[0.55, 0.985, 1.02],
	[0.78, 1.015, 0.99],
	[1, 1, 1]
];
const relMs = 640;

export function press(node: HTMLElement, opts: { k?: number } = {}) {
	let k = opts.k ?? 1;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
	const s = (v: number) => 1 - (1 - v) * k;

	function start() {
		node.getAnimations().forEach((a) => a.cancel());
		clearTimeout(timer);
		node.classList.remove('rel', 'deep', 'shake');
		const r = reduced();
		const d = r ? { x: 0.97, y: 0.97 } : down;
		const p = r ? { x: 0.97, y: 0.97 } : deep;
		const set = (n: string, v: string | number) => node.style.setProperty(n, String(v));
		set('--in', (r ? 80 : inMs) + 'ms');
		set('--dx', s(d.x)); set('--dy', s(d.y)); set('--sx', s(p.x)); set('--sy', s(p.y));
		set('--sink', sinkMs + 'ms');
		const g = Math.min(k, 1.3);
		set('--fx', 1 - 0.06 * g); set('--fy', 5 * g + '%');
		set('--fx2', 1 - 0.12 * g); set('--fsy2', 1 - 0.26 * g); set('--fy2', 11 * g + '%');
		node.classList.add('down');
		if (r) return;
		timer = setTimeout(() => {
			if (!node.classList.contains('down')) return;
			node.classList.add('deep');
			set('--tr', tremble + 'px');
			node.classList.add('shake');
		}, sinkAt);
	}

	function end() {
		clearTimeout(timer);
		if (!node.classList.contains('down')) return;
		const from = getComputedStyle(node).transform;
		node.classList.add('rel');
		node.classList.remove('down', 'deep', 'shake');
		if (reduced()) { node.classList.remove('rel'); return; }
		const frames: Keyframe[] = [{ transform: from === 'none' ? 'scale(1)' : from, offset: 0 }];
		for (const [o, x, y] of rel) frames.push({ transform: `scale(${1 + (x - 1) * k},${1 + (y - 1) * k})`, offset: o });
		const a = node.animate(frames, { duration: relMs, easing: 'ease-out' });
		a.onfinish = a.oncancel = () => node.classList.remove('rel');
	}

	const onDown = (e: PointerEvent) => { if (e.button > 0) return; try { node.setPointerCapture(e.pointerId); } catch {} start(); };
	const onKeyDown = (e: KeyboardEvent) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) start(); };
	const onKeyUp = (e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') end(); };
	node.classList.add('p');
	node.addEventListener('pointerdown', onDown);
	node.addEventListener('pointerup', end);
	node.addEventListener('pointercancel', end);
	node.addEventListener('keydown', onKeyDown);
	node.addEventListener('keyup', onKeyUp);
	node.addEventListener('contextmenu', (e) => e.preventDefault());
	return {
		update(o: { k?: number } = {}) { k = o.k ?? 1; },
		destroy() {
			clearTimeout(timer);
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('pointerup', end);
			node.removeEventListener('pointercancel', end);
			node.removeEventListener('keydown', onKeyDown);
			node.removeEventListener('keyup', onKeyUp);
		}
	};
}
