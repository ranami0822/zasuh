<script lang="ts">
	import Dist from '#components/Dist.svelte';
	import Footer from '#components/Footer.svelte';
	import Header from '#components/Header.svelte';
	import Meta from '#components/Meta.svelte';
	import { CATEGORY_LABEL } from '#messages';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const href = (c: string, t?: string | null) => `/?c=${c}${t ? `&t=${encodeURIComponent(t)}` : ''}`;
</script>

<Meta description="人が書いた理由つきのレビューを、AIが観点ごとに読み取って、向きと件数で見せる。点数はありません。" />

<div class="page">
	<Header />
	<h1>言葉で読む、作品の評価</h1>

	<form method="get" action="/" role="search">
		<input class="input" type="search" name="q" value={data.q} placeholder="作品を探す" aria-label="作品を探す" maxlength="100" />
	</form>

	{#if data.q}
		{#if data.hits.length === 0}
			<p class="muted">見つかりませんでした。<a href="/contact?kind=work_request">載せてほしい作品を頼む</a></p>
		{:else}
			<div class="panel flush">
				{#each data.hits as w (w.slug)}
					<a class="rank" href={`/works/${w.slug}`}>
						<span class="rank__no"></span>
						<div class="rank__body">
							<h3>{w.name} <span class="tag">{CATEGORY_LABEL[w.category]}</span></h3>
							<Dist nNeg={w.nNeg} nMix={w.nMix} nPos={w.nPos} />
						</div>
					</a>
				{/each}
			</div>
		{/if}
	{/if}

	<nav class="stack" aria-label="絞り込み" style="gap: var(--space-2)">
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

	{#if !data.q && data.works.length === 0}
		<p class="muted">まだ作品がありません。</p>
	{:else if !data.q}
		<div class="panel flush">
			{#each data.works as w (w.slug)}
				<a class="rank" href={`/works/${w.slug}`}>
					<span class="rank__no">{w.rank ?? ''}</span>
					<div class="rank__body">
						<h3>{w.name}</h3>
						<Dist nNeg={w.nNeg} nMix={w.nMix} nPos={w.nPos} />
					</div>
				</a>
			{/each}
		</div>
	{/if}
	<Footer />
</div>
