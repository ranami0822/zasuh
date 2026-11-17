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

<div class="stack">
	{#each data.items as m (m.id)}
		<article class="panel" class:faded={m.status === 'closed'}>
			<p class="caption muted">{KIND_LABEL[m.kind]} · <span class="num">{m.createdAt.slice(0, 16).replace('T', ' ')} UTC</span>{m.status === 'closed' ? ' · 済み' : ''}</p>
			{#if m.kind === 'work_request'}
				<h3>{m.workName} <span class="tag">{CATEGORY_LABEL[m.category as 'game' | 'software']}</span></h3>
				{#if m.url}<p class="caption"><a href={m.url} rel="noopener noreferrer nofollow">{m.url}</a></p>{/if}
			{/if}
			<p style="white-space: pre-wrap; overflow-wrap: anywhere">{m.body}</p>
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
