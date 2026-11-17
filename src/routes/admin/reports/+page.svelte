<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '@ui-sdk/svelte/button';
	import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@ui-sdk/svelte/dialog';
	import { DISCLOSURE_LABEL, REASON_LABEL } from '#messages';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

{#if form?.error}<p class="banner error" role="alert">{form.error}</p>{/if}

<h2>通報のあるレビュー · {data.reported.length}件</h2>
<div class="stack">
	{#each data.reported as r (r.id)}
		{@render item(r, true)}
	{:else}
		<p class="muted">通報はありません。</p>
	{/each}
</div>

<h2>非表示のレビュー · {data.hidden.length}件</h2>
<div class="stack">
	{#each data.hidden as r (r.id)}
		{@render item(r, false)}
	{:else}
		<p class="muted">非表示のレビューはありません。</p>
	{/each}
</div>

{#snippet item(r: (typeof data.reported)[number], showReports: boolean)}
	<article class="card stack" class:faded={r.hidden}>
		<p class="caption muted"><a href={`/works/${r.workSlug}`}>{r.workName}</a>{r.disclosure !== 'none' ? ` · ${DISCLOSURE_LABEL[r.disclosure]}` : ''}{r.duplicate ? ' · 文面がほぼ同じ' : ''}{r.hidden ? ' · 非表示' : ''}</p>
		<p style="white-space: pre-wrap; overflow-wrap: anywhere">{r.body}</p>
		{#if showReports}
			<div class="row">
				{#each r.reports as x, i (i)}<span class="tag" title={x.note ?? ''}>{REASON_LABEL[x.reason]}{x.note ? `：${x.note}` : ''}</span>{/each}
			</div>
		{/if}
		<div class="row">
			{#if r.hidden}
				{@render action(r.id, 'show', '戻す', false)}
			{:else}
				{@render action(r.id, 'hide', '非表示にする', false)}
			{/if}
			{#if showReports}{@render action(r.id, 'close', '問題なし（通報を閉じる）', false)}{/if}
			<Dialog>
				<DialogTrigger class="btn quiet">削除</DialogTrigger>
				<DialogBackdrop />
				<DialogContent>
					<form method="post" action="?/act" class="stack" use:enhance>
						<DialogTitle>削除する</DialogTitle>
						<DialogDescription>このレビューと、読み取り結果、通報が消えます。戻せません。</DialogDescription>
						<input type="hidden" name="id" value={r.id} />
						<input type="hidden" name="op" value="delete" />
						<div class="row" style="justify-content: flex-end">
							<DialogClose class="btn quiet">やめる</DialogClose>
							<Button type="submit" class="btn">削除する</Button>
						</div>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	</article>
{/snippet}

{#snippet action(id: string, op: string, label: string, _quiet: boolean)}
	<form method="post" action="?/act" use:enhance>
		<input type="hidden" name="id" value={id} />
		<input type="hidden" name="op" value={op} />
		<Button type="submit" class="btn quiet">{label}</Button>
	</form>
{/snippet}
