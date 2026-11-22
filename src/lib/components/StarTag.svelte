<script lang="ts">
	/** 触れたタグと星（1〜5の連続値）。数字で伝える。色の点は、いちばん近い星の色（色だけで伝えない）。 */
	let { label, star }: { label: string; star: number } = $props();
	const nearest = $derived(Math.min(5, Math.max(1, Math.round(star))));
</script>

<span class="tag star-tag">
	<i class="star-tag__dot s{nearest}" aria-hidden="true"></i>
	{label}
	<span class="num">星 {star.toFixed(1)}</span>
</span>
