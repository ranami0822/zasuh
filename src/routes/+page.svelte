<script lang="ts">
	import StarDist from '#components/StarDist.svelte';
	import Meta from '#components/Meta.svelte';
	import { CATEGORY_LABEL } from '#messages';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const href = (c: string, t?: string | null) => `/?c=${c}${t ? `&t=${encodeURIComponent(t)}` : ''}`;
	/** ベントーのタイルの大きさ。一覧の中で、レビュー件数が多い作品ほど大きくする。 */
	const tier = (n: number, max: number) => (max > 0 && n >= max * 0.6 ? 'lg' : max > 0 && n >= max * 0.3 ? 'md' : 'sm');
	const maxWorks = $derived(Math.max(0, ...data.works.map((w) => w.stat.n)));
	const maxHits = $derived(Math.max(0, ...data.hits.map((w) => w.stat.n)));
</script>

<Meta description="人が書いた理由つきのレビューを、AIが観点ごとに読み取って、星の分布と件数で見せる。" />

<div class="page">
	<form method="get" action="/" role="search">
		<input class="input" type="search" name="q" value={data.q} placeholder="作品を探す" aria-label="作品を探す" maxlength="100" />
	</form>

	{#if data.q}
		{#if data.hits.length === 0}
			<p class="muted">見つかりませんでした。<a href="/contact?kind=work_request">載せてほしい作品を頼む</a></p>
		{:else}
			<div class="bento">
				{#each data.hits as w (w.slug)}
					{@const t = tier(w.stat.n, maxHits)}
					<a
						class="tile tile--{t}"
						class:band={!!w.band}
						href={`/works/${w.slug}`}
						style:--band-from={w.band?.from}
						style:--band-to={w.band?.to}
						style:--band-fg={w.band?.fg}
						style:--band-muted={w.band?.muted}
					>
						<h3>{w.name} <span class="tag">{CATEGORY_LABEL[w.category]}</span></h3>
						<div class="tile__foot">
							<StarDist {...w.stat} size={t === 'lg' ? 'hero' : 'row'} />
						</div>
					</a>
				{/each}
			</div>
		{/if}
	{/if}

	<nav class="stack" aria-label="絞り込み" style="gap: var(--space-2)">
		<div class="row scrollrow">
			{#each data.categories as c (c.id)}
				<a class="tag" href={href(c.id)} aria-current={c.id === data.category}>{c.label}</a>
			{/each}
		</div>
		<div class="row scrollrow">
			<a class="tag" href={href(data.category)} aria-current={data.tag === null}>総合</a>
			{#each data.tags as t (t.id)}
				<a class="tag" href={href(data.category, t.id)} aria-current={data.tag === t.id}>{t.label}</a>
			{/each}
		</div>
	</nav>

	{#if !data.q && data.works.length === 0}
		<p class="muted">まだ作品がありません。<a href="/contact?kind=work_request">載せてほしい作品を頼む</a></p>
	{:else if !data.q}
		<div class="bento">
			{#each data.works as w (w.slug)}
				{@const t = tier(w.stat.n, maxWorks)}
				<a
					class="tile tile--{t}"
					class:band={!!w.band}
					href={`/works/${w.slug}`}
					style:--band-from={w.band?.from}
					style:--band-to={w.band?.to}
					style:--band-fg={w.band?.fg}
					style:--band-muted={w.band?.muted}
				>
					<h3>
						{#if w.rank}<span class="tile__no">{w.rank}</span>{/if}{w.name}
					</h3>
					<div class="tile__foot">
						<StarDist {...w.stat} size={t === 'lg' ? 'hero' : 'row'} />
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
