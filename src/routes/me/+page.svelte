<script lang="ts">
	import Header from '#components/Header.svelte';
	import Meta from '#components/Meta.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const READ = { ok: '読み取り済み', pending: '読み取り待ち', failed: '読み取りに失敗（自動でやり直します）' } as const;
</script>

<Meta title="自分のレビュー" description="この端末から投稿したレビュー。" />

<div class="page">
	<Header />
	<h1>自分のレビュー</h1>

	{#if data.reviews.length === 0}
		<p class="muted">この端末から投稿したレビューは、ありません。</p>
	{:else}
		<div class="panel flush reviews">
			{#each data.reviews as r (r.slug)}
				<article class:faded={r.hidden}>
					<div class="spread">
						<h3><a href={`/works/${r.slug}`}>{r.name}</a></h3>
						{#if r.canEdit}<a class="btn quiet small" href={`/works/${r.slug}/edit`}>編集</a>{/if}
					</div>
					<p class="reading">{r.body}</p>
					<p class="review__meta"><span><span class="num">{r.writtenOn}</span> · {r.hidden ? '非表示' : READ[r.read as keyof typeof READ]}</span></p>
				</article>
			{/each}
		</div>
	{/if}
</div>
