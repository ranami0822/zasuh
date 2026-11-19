<script lang="ts">
	import type { Snippet } from 'svelte';

	/** 関係者のレビューを分ける面。上の縁は、seed（作品の識別子）で決まる形のギザギザ（飾り。読み上げない）。 */
	let { seed, label, children }: { seed: string; label: string; children: Snippet } = $props();

	const W = 1000;
	const H = 16;
	const BASE = 8;
	const AMP = 4;

	function hash(text: string): number {
		let x = 2166136261;
		for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 16777619);
		return x >>> 0;
	}
	function mulberry(seed: number): () => number {
		let a = seed;
		return () => {
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	const points = $derived.by(() => {
		const rand = mulberry(hash(seed));
		const y = () => +(BASE + (rand() - 0.5) * AMP * 2).toFixed(1);
		const edge: [number, number][] = [[0, y()]];
		let x = 0;
		while (x < W) {
			x = Math.min(W, x + 14 + rand() * 18);
			edge.push([+x.toFixed(1), y()]);
		}
		edge.push([W, H], [0, H]);
		return edge.map((p) => p.join(',')).join(' ');
	});
</script>

<section class="glacier" aria-label={label}>
	<svg class="glacier__edge" viewBox="0 0 {W} {H}" preserveAspectRatio="xMinYMid slice" aria-hidden="true" focusable="false">
		<polygon fill="currentColor" {points} />
	</svg>
	<div class="glacier__body reviews">
		{@render children()}
	</div>
</section>
