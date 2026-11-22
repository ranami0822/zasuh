<script lang="ts">
	/** 触れたタグと星（1〜5の連続値）。数字で伝える。地は、いちばん近い星の色を薄く敷く（色だけで伝えない）。 */
	let { label, star }: { label: string; star: number } = $props();
	const nearest = $derived(Math.min(5, Math.max(1, Math.round(star))));
</script>

<span class="tag star-tag s{nearest}">
	<i class="star-tag__dot" aria-hidden="true"></i>
	{label}
	<b class="num">星 {star.toFixed(1)}</b>
</span>
