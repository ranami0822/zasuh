<script lang="ts">
	/**
	 * 星の分布（星1〜5）。段階ごとの確率の合計（ソフトな件数。丸めない）を、左から星1、星2、…、星5 の順に並べる。
	 * 平均と幅（±）を添える。件数が少ないときは、文字ではなく、棒を細く・薄くして伝える。幅は、件数が少ないと出さない。
	 * size: hero は総合（大きい。平均・幅・割合を添える）、row は観点ごと（小さい。棒と平均と件数だけ）。
	 */
	let {
		n,
		soft,
		mean,
		se,
		size = 'row'
	}: { n: number; soft: number[]; mean: number | null; se: number | null; size?: 'hero' | 'row' } = $props();

	const total = $derived(soft.reduce((t, v) => t + v, 0));
	const pct = (v: number) => (total <= 0 ? 0 : Math.round((v / total) * 100));
	const meanText = $derived(mean === null ? '' : mean.toFixed(1));
	const spreadText = $derived(se === null ? '' : `± ${(1.96 * se).toFixed(1)}`);
	const label = $derived(
		n === 0 || mean === null
			? '言及なし'
			: `星1 ${pct(soft[0])}%、星2 ${pct(soft[1])}%、星3 ${pct(soft[2])}%、星4 ${pct(soft[3])}%、星5 ${pct(soft[4])}%。平均 ${meanText}${spreadText ? `（${spreadText}）` : ''}（${n}件）`
	);
	const thickness = $derived(size === 'hero' ? (n < 5 ? '8px' : '14px') : n < 5 ? '3px' : n < 20 ? '5px' : '7px');
	const opacity = $derived(n < 5 ? 0.55 : 1);
</script>

<div class="dist {size}" style:--bar={thickness} style:--bar-opacity={opacity}>
	{#if size === 'hero'}
		<p class="dist__caption">
			<span>言及 <span class="num">{n}</span>件</span>
			{#if mean !== null}
				<span class="dist__mean">平均 <b class="num">{meanText}</b>{#if spreadText}<span class="dist__spread num">{spreadText}</span>{/if}</span>
			{/if}
		</p>
	{/if}
	{#if n === 0}
		<div class="dist__bar empty" role="img" aria-label={label}></div>
	{:else}
		<div class="dist__bar" role="img" aria-label={label}>
			{#each soft as v, i (i)}
				<i class="s{i + 1}" style:flex={v} style:display={v > 0.001 ? 'block' : 'none'}></i>
			{/each}
		</div>
	{/if}
	{#if size === 'hero'}
		<p class="dist__legend" aria-hidden="true">
			{#each soft as v, i (i)}
				<span class="s{i + 1}">星{i + 1}<b>{n === 0 ? 0 : pct(v)}%</b></span>
			{/each}
		</p>
	{/if}
	{#if size === 'row'}
		{#if mean !== null}<span class="dist__mean num">{meanText}</span>{/if}
		<span class="dist__count num">{n}</span>
	{/if}
</div>
