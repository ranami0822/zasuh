<script lang="ts">
	/**
	 * 氷の縁（Glacier）。関係者のレビューの面の、上の縁をギザギザにする。デザインシステム「Review Platform」の GlacierDivider と同じ作り方
	 * （振れ幅 ±4px、刻み 14〜32px、種つきの乱数）。上下は逆（面が下にある）。
	 * 種は作品の識別子なので、同じ作品は、いつ見ても同じ形になる（サーバーとブラウザで、同じ形になる）。
	 */
	let { seed }: { seed: string } = $props();

	const W = 1000; // 画面の幅より広く取り、はみ出した分は切る（拡大せず、刻みを 14〜32px のままにする）
	const H = 16;
	const BASE = 8;
	const AMP = 4;

	function hash(text: string): number {
		let h = 2166136261;
		for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
		return h >>> 0;
	}
	function mulberry32(a: number) {
		return () => {
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}
	const points = $derived.by(() => {
		const rand = mulberry32(hash(seed));
		const y = () => +(BASE + (rand() - 0.5) * AMP * 2).toFixed(1);
		const edge: [number, number][] = [[0, y()]];
		let x = 0;
		while (x < W) {
			x = Math.min(W, x + 14 + rand() * 18);
			edge.push([+x.toFixed(1), y()]);
		}
		return [...edge, [W, H], [0, H]].map(([px, py]) => `${px},${py}`).join(' ');
	});
</script>

<svg class="glacier__edge" viewBox="0 0 {W} {H}" preserveAspectRatio="xMinYMid slice" aria-hidden="true" focusable="false">
	<polygon {points} fill="currentColor" />
</svg>
