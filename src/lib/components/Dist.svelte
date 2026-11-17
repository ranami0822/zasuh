<script lang="ts">
	/**
	 * 向きの分布（否定 / 混在 / 肯定）。言及が少ないときは、文字ではなく、細く・薄くして伝える。
	 * size: hero は総合（大きい。割合を添える）、row は観点ごと（小さい。棒と件数だけ）。
	 */
	let { nNeg, nMix, nPos, size = 'row' }: { nNeg: number; nMix: number; nPos: number; size?: 'hero' | 'row' } = $props();

	const n = $derived(nNeg + nMix + nPos);
	const pct = (v: number) => (n === 0 ? 0 : Math.round((v / n) * 100));
	const label = $derived(n === 0 ? '言及なし' : `否定 ${pct(nNeg)}%、混在 ${pct(nMix)}%、肯定 ${pct(nPos)}%（${n}件）`);
	const thickness = $derived(size === 'hero' ? (n < 5 ? '10px' : '18px') : n < 5 ? '3px' : n < 20 ? '5px' : '7px');
	const opacity = $derived(n < 5 ? 0.55 : 1);
</script>

<div class="dist {size}" style:--bar={thickness} style:--bar-opacity={opacity}>
	{#if size === 'hero'}
		<div class="dist__top">
			<span class="dist__total num">{n}</span>
			<span class="dist__split num" aria-hidden="true">
				<span class="neg">否定 {pct(nNeg)}%</span>
				<span class="mix">混在 {pct(nMix)}%</span>
				<span class="pos">肯定 {pct(nPos)}%</span>
			</span>
		</div>
	{/if}
	{#if n === 0}
		<div class="dist__bar empty" role="img" aria-label={label}></div>
	{:else}
		<div class="dist__bar" role="img" aria-label={label}>
			<i class="neg" style:flex={nNeg} style:display={nNeg ? 'block' : 'none'}></i>
			<i class="mix" style:flex={nMix} style:display={nMix ? 'block' : 'none'}></i>
			<i class="pos" style:flex={nPos} style:display={nPos ? 'block' : 'none'}></i>
		</div>
	{/if}
	{#if size === 'row'}<span class="dist__count num">{n}</span>{/if}
</div>
