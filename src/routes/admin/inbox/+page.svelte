<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '@ui-sdk/svelte/button';
	import { CATEGORY_LABEL, KIND_LABEL } from '#messages';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="row">
	<a class="tag" href="/admin/inbox" aria-current={data.kind === ''}>すべて</a>
	{#each Object.entries(KIND_LABEL) as [id, label] (id)}
		<a class="tag" href={`/admin/inbox?kind=${id}`} aria-current={data.kind === id}>{label}</a>
	{/each}
</div>

{#if form?.error}<p class="banner error" role="alert">{form.error}</p>{/if}

<h2>新しい作品の候補</h2>
<p class="caption muted">OpenCritic の人気・新作・公開予定から探します。承認すると作品になり、OpenCritic の ID と紹介文（Wikipedia の要約。あれば）が入ります。</p>
{#if form?.discoverError}<p class="banner error" role="alert">{form.discoverError}</p>{/if}
{#if form?.discovered}
	<p class="banner success" role="status">
		一覧で見えた作品: {form.discovered.listed}件 / 候補に足した作品: {form.discovered.added}件（Wikipedia の要約つき: {form.discovered.withSummary}件）{form.discovered.more ? '。まだ残りがあります。もう一度押してください。' : ''}{form.discovered.error ? '。一覧の一部が取れませんでした。' : ''}
	</p>
{/if}
<form method="post" action="?/discoverWorks" use:enhance>
	<Button type="submit" class="btn">新しい作品の候補を探す</Button>
</form>
<div class="stack">
	{#each data.workCandidates as c (c.ocId)}
		<article class="panel">
			<h3>{c.name} <span class="caption muted num">（OpenCritic ID {c.ocId}）</span></h3>
			{#if c.wikiExtract}
				<p class="caption muted">Wikipedia「<a href={c.wikiUrl} rel="noopener noreferrer nofollow">{c.wikiTitle}</a>」。別の記事に当たっていないか、確かめてください。</p>
				<p class="reading">{c.wikiExtract}</p>
			{:else}
				<p class="caption muted">Wikipedia の要約は、見つかりませんでした（承認のあと、紹介文を自分で書けます）。</p>
			{/if}
			<div class="row">
				<form method="post" action="?/approveWork" use:enhance>
					<input type="hidden" name="ocId" value={c.ocId} />
					<Button type="submit" class="btn">作品にする</Button>
				</form>
				<form method="post" action="?/rejectWork" use:enhance>
					<input type="hidden" name="ocId" value={c.ocId} />
					<Button type="submit" class="btn quiet">却下</Button>
				</form>
			</div>
		</article>
	{:else}
		<p class="muted">候補はありません。</p>
	{/each}
</div>

<h2>専門家の欄の候補</h2>
{#if form?.candidateError}<p class="banner error" role="alert">{form.candidateError}</p>{/if}
{#if form?.candidateDecided}<p class="banner success" role="status">処理しました。</p>{/if}
<div class="stack">
	{#each data.candidates as c (c.workId)}
		<article class="panel">
			<h3>{c.workName}</h3>
			<p class="caption">{c.ocName} <span class="num">（ID {c.ocId}）</span></p>
			<div class="row">
				<form method="post" action="?/approveCandidate" use:enhance>
					<input type="hidden" name="workId" value={c.workId} />
					<Button type="submit" class="btn">承認</Button>
				</form>
				<form method="post" action="?/rejectCandidate" use:enhance>
					<input type="hidden" name="workId" value={c.workId} />
					<Button type="submit" class="btn quiet">却下</Button>
				</form>
			</div>
		</article>
	{:else}
		<p class="muted">候補はありません。</p>
	{/each}
</div>

<div class="stack">
	{#each data.items as m (m.id)}
		<article class="panel" class:faded={m.status === 'closed'}>
			<p class="caption muted">{KIND_LABEL[m.kind]} · <span class="num">{m.createdAt.slice(0, 16).replace('T', ' ')} UTC</span>{m.status === 'closed' ? ' · 済み' : ''}</p>
			{#if m.kind === 'work_request'}
				<h3>{m.workName} <span class="tag">{CATEGORY_LABEL[m.category as 'game' | 'software']}</span></h3>
				{#if m.url}<p class="caption"><a href={m.url} rel="noopener noreferrer nofollow">{m.url}</a></p>{/if}
			{/if}
			<p class="reading">{m.body}</p>
			{#if m.contact}<p class="caption muted">連絡先: {m.contact}</p>{/if}
			<div class="row">
				{#if m.kind === 'work_request'}
					<a class="btn quiet" href={`/admin?name=${encodeURIComponent(m.workName ?? '')}&category=${m.category}&url=${encodeURIComponent(m.url ?? '')}`}>作品として登録する</a>
				{/if}
				<form method="post" action="?/status" use:enhance>
					<input type="hidden" name="id" value={m.id} />
					<input type="hidden" name="status" value={m.status === 'open' ? 'closed' : 'open'} />
					<Button type="submit" class="btn quiet">{m.status === 'open' ? '済みにする' : '未対応に戻す'}</Button>
				</form>
			</div>
		</article>
	{:else}
		<p class="muted">受信箱は、空です。</p>
	{/each}
</div>
