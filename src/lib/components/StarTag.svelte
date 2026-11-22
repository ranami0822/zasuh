<script lang="ts">
	/**
	 * 触れた観点と星（1〜5の連続値）。「星アイコン 数字 観点名」を、左から並べる。
	 * タグ全体を、いちばん近い星の色で塗る（棒と同じ系統。色だけで伝えず、数字も出す）。星と数字だけ濃く、観点名は薄い。
	 */
	let { label, star }: { label: string; star: number } = $props();
	const nearest = $derived(Math.min(5, Math.max(1, Math.round(star))));
</script>

<span class="star-tag s{nearest}">
	<span class="star-tag__score">
		<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
			<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.2-5.9 3.2 1.2-6.5L2.5 9.4l6.6-.9z" />
		</svg>
		<b class="num"><span class="sr-only">星</span>{star.toFixed(1)}</b>
	</span>
	<span class="star-tag__label">{label}</span>
</span>
