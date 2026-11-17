<script lang="ts">
	/** 向きの分布（否定 / 混在 / 肯定）。言及が少ないときは、文字ではなく、細く・薄くして伝える。 */
	let { nNeg, nMix, nPos }: { nNeg: number; nMix: number; nPos: number } = $props();

	const n = $derived(nNeg + nMix + nPos);
	const percent = (v: number) => (n === 0 ? '' : `${Math.round((v / n) * 100)}%`);
	const label = $derived(
		n === 0
			? '言及なし'
			: `否定 ${percent(nNeg)}、混在 ${percent(nMix)}、肯定 ${percent(nPos)}（${n}件）`
	);
	const bar = $derived(n < 5 ? '4px' : n < 20 ? '8px' : '12px');
	const opacity = $derived(n < 5 ? 0.5 : 1);
</script>

<div class="dist" style:--bar={bar} style:--bar-opacity={opacity}>
	<svg class="end-neg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="否定">
		<path d="M7 13v-8a1 1 0 0 0 -1 -1h-2a1 1 0 0 0 -1 1v7a1 1 0 0 0 1 1h3a4 4 0 0 1 4 4v1a2 2 0 0 0 4 0v-5h3a2 2 0 0 0 2 -2l-1 -5a2 3 0 0 0 -2 -2h-7a3 3 0 0 0 -3 3" />
	</svg>
	{#if n === 0}
		<div class="dist__bar empty" role="img" aria-label={label}></div>
	{:else}
		<div class="dist__bar" role="img" aria-label={label}>
			<i class="neg" style:flex={nNeg} style:display={nNeg ? 'block' : 'none'}></i>
			<i class="mix" style:flex={nMix} style:display={nMix ? 'block' : 'none'}></i>
			<i class="pos" style:flex={nPos} style:display={nPos ? 'block' : 'none'}></i>
		</div>
	{/if}
	<svg class="end-pos" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="肯定">
		<path d="M7 11v8a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1h3a4 4 0 0 0 4 -4v-1a2 2 0 0 1 4 0v5h3a2 2 0 0 1 2 2l-1 5a2 3 0 0 1 -2 2h-7a3 3 0 0 1 -3 -3" />
	</svg>
	<span class="dist__count">{n}</span>
</div>
