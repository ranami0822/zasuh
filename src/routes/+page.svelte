<script lang="ts">
	import Dist from '#components/Dist.svelte';
	import Header from '#components/Header.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const href = (c: string, t?: string | null) => `/?c=${c}${t ? `&t=${encodeURIComponent(t)}` : ''}`;
</script>

<div class="page">
	<Header />
	<h1>言葉で読む、作品の評価</h1>

	<nav class="stack" aria-label="絞り込み">
		<div class="row">
			{#each data.categories as c (c.id)}
				<a class="tag" href={href(c.id)} aria-current={c.id === data.category}>{c.label}</a>
			{/each}
		</div>
		<div class="row">
			<a class="tag" href={href(data.category)} aria-current={data.tag === null}>総合</a>
			{#each data.tags as t (t.id)}
				<a class="tag" href={href(data.category, t.id)} aria-current={data.tag === t.id}>{t.label}</a>
			{/each}
		</div>
	</nav>

	{#if data.works.length === 0}
		<p class="muted">まだ作品がありません。</p>
	{:else}
		<div class="stack">
			{#each data.works as w (w.slug)}
				<a class="card rank" href={`/works/${w.slug}`} style="color: inherit; text-decoration: none">
					<span class="rank__no">{w.rank ?? ''}</span>
					<div class="stack" style="gap: var(--space-2)">
						<h3>{w.name}</h3>
						<Dist nNeg={w.nNeg} nMix={w.nMix} nPos={w.nPos} />
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
