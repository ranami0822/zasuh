<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '@ui-sdk/svelte/button';
	import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@ui-sdk/svelte/dialog';
	import { Field, FieldLabel } from '@ui-sdk/svelte/field';
	import { Input } from '@ui-sdk/svelte/input';
	import { Radio, RadioGroup } from '@ui-sdk/svelte/radio';
	import { Textarea } from '@ui-sdk/svelte/textarea';
	import Dist from '#components/Dist.svelte';
	import Direction from '#components/Direction.svelte';
	import Header from '#components/Header.svelte';
	import { DISCLOSURE_LABEL, REASON_LABEL } from '#messages';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form?: ActionData } = $props();

	const postFailed = $derived(form && 'form' in form && form.form === 'post' ? form : null);
	let disclosure = $state('none');
	let reportOpen = $state<string | null>(null);
	let reported = $state<Record<string, boolean>>({});
	let reportError = $state('');

	const link = (t: string | null, p = 1) => `/works/${data.work.slug}${t || p > 1 ? '?' : ''}${[t ? `t=${encodeURIComponent(t)}` : '', p > 1 ? `p=${p}` : ''].filter(Boolean).join('&')}`;
	const maxMonth = $derived(Math.max(1, ...data.months.map((m: { nNeg: number; nMix: number; nPos: number }) => m.nNeg + m.nMix + m.nPos)));
</script>

<div class="page">
	<Header />

	<div class="stack">
		<h1>{data.work.name}</h1>
		{#if data.work.summary}<p class="muted">{data.work.summary}</p>{/if}
		{#if data.work.url}<p class="caption"><a href={data.work.url} rel="noopener noreferrer nofollow">{data.work.url}</a></p>{/if}
	</div>

	{#if data.done === 'posted'}
		<p class="banner success" role="status">投稿しました。</p>
	{:else if data.done === 'edited'}
		<p class="banner success" role="status">直しました。</p>
	{/if}

	<section class="card stack" aria-label="観点ごとの向き">
		{#if data.overall}
			<Dist nNeg={data.overall.nNeg} nMix={data.overall.nMix} nPos={data.overall.nPos} />
		{/if}
		{#each data.tags as t (t.tagId)}
			<div class="stack" style="gap: var(--space-1)">
				<a class="caption" href={link(data.tag === t.tagId ? null : t.tagId)} aria-current={data.tag === t.tagId}>
					<span class="tag" aria-current={data.tag === t.tagId}>{t.label}</span>
				</a>
				<Dist nNeg={t.nNeg} nMix={t.nMix} nPos={t.nPos} />
			</div>
		{/each}
	</section>

	{#if data.months.length > 0}
		<section class="card" aria-label="月ごとの変化">
			<div class="months">
				{#each data.months as m (m.month)}
					{@const total = m.nNeg + m.nMix + m.nPos}
					<div class="months__col" style:height="{Math.max(12, (total / maxMonth) * 100)}%" title={m.month} role="img" aria-label="{m.month}: 否定{m.nNeg}、混在{m.nMix}、肯定{m.nPos}">
						<i class="pos" style:flex={m.nPos}></i>
						<i class="mix" style:flex={m.nMix}></i>
						<i class="neg" style:flex={m.nNeg}></i>
					</div>
				{/each}
			</div>
			<div class="row caption muted" style="justify-content: space-between; margin-top: var(--space-1)">
				<span class="num">{data.months[0].month}</span>
				<span class="num">{data.months[data.months.length - 1].month}</span>
			</div>
		</section>
	{/if}

	<section class="card stack" aria-label="レビューを書く">
		{#if data.own}
			<div class="spread">
				<p>この作品には、すでに投稿しています。</p>
				<a class="btn quiet" href={`/works/${data.work.slug}/edit`}>編集する</a>
			</div>
		{:else}
			<form
				method="post"
				action="?/post"
				class="stack"
				use:enhance={() => async ({ update }) => {
					await update({ reset: false });
				}}
			>
				{#if postFailed}<p class="banner error" role="alert">{postFailed.error}</p>{/if}
				<Field name="body">
					<FieldLabel>レビュー</FieldLabel>
					<Textarea
						class="input"
						rows={5}
						required
						minlength={5}
						maxlength={4000}
						placeholder="何が、どうだったか。具体的に書くほど、読み取りやすくなります。"
						defaultValue={postFailed?.values.body ?? ''}
					/>
				</Field>
				<div class="field">
					<label for="writtenOn">日付</label>
					<input class="input" id="writtenOn" name="writtenOn" type="date" required min="2000-01-01" max={data.today} value={postFailed?.values.writtenOn ?? data.today} />
				</div>
				<Field>
					<FieldLabel>利害関係</FieldLabel>
					<RadioGroup name="disclosure" bind:value={disclosure} defaultValue={postFailed?.values.disclosure ?? 'none'} class="row">
						{#each Object.entries(DISCLOSURE_LABEL) as [id, text] (id)}
							<label class="choice"><Radio value={id} />{text}</label>
						{/each}
					</RadioGroup>
				</Field>
				{#if disclosure !== 'none'}
					<Field name="disclosureNote">
						<FieldLabel>メモ</FieldLabel>
						<Input class="input" maxlength={200} defaultValue={postFailed?.values.disclosureNote ?? ''} />
					</Field>
				{/if}
				<div class="row"><Button type="submit" class="btn">投稿する</Button></div>
			</form>
		{/if}
	</section>

	<section class="stack" id="reviews" aria-label="レビュー">
		{#if data.tag}
			<div class="row"><a class="tag" href={link(null)} aria-current="true">{data.tags.find((t) => t.tagId === data.tag)?.label} ×</a></div>
		{/if}
		{#each data.reviews as r (r.id)}
			{@render review(r)}
		{/each}

		{#if data.pageCount > 1}
			<div class="row">
				{#each Array.from({ length: data.pageCount }, (_, i) => i + 1) as p (p)}
					<a class="tag" href={link(data.tag, p)} aria-current={p === data.page}>{p}</a>
				{/each}
			</div>
		{/if}
	</section>

	{#if data.disclosed.length > 0}
		<section class="region" aria-label="関係者のレビュー">
			<p class="caption">関係者 · {data.disclosed.length}件</p>
			{#each data.disclosed as r (r.id)}
				{@render review(r)}
			{/each}
		</section>
	{/if}
</div>

{#snippet review(r: (typeof data.reviews)[number])}
	<article class="card stack" class:faded={r.duplicate}>
		<div class="row">
			{#each r.reads as x (x.tagId)}
				<Direction label={x.label} value={x.value} />
			{/each}
		</div>
		<p style="white-space: pre-wrap; overflow-wrap: anywhere">{r.body}</p>
		<div class="spread">
			<p class="caption muted">
				<span class="num">{r.writtenOn}</span>
				{#if r.edited} · 編集済み{/if}
				{#if r.disclosure !== 'none'} · {DISCLOSURE_LABEL[r.disclosure]}{r.disclosureNote ? `（${r.disclosureNote}）` : ''}{/if}
			</p>
			{#if reported[r.id]}
				<span class="caption muted">通報しました</span>
			{:else}
				<Dialog open={reportOpen === r.id} onOpenChange={(open) => { reportOpen = open ? r.id : null; reportError = ''; }}>
					<DialogTrigger class="btn quiet small">通報</DialogTrigger>
					<DialogBackdrop />
					<DialogContent>
						<form
							method="post"
							action="?/report"
							class="stack"
							use:enhance={() => async ({ result, update }) => {
								if (result.type === 'success') {
									reported[r.id] = true;
									reportOpen = null;
								} else if (result.type === 'failure') {
									reportError = String(result.data?.error ?? '通報できませんでした。');
								} else {
									await update();
								}
							}}
						>
							<DialogTitle>通報</DialogTitle>
							{#if reportError}<p class="banner error" role="alert">{reportError}</p>{/if}
							<input type="hidden" name="reviewId" value={r.id} />
							<Field>
								<FieldLabel>理由</FieldLabel>
								<RadioGroup name="reason" defaultValue="abuse" required class="stack">
									{#each Object.entries(REASON_LABEL) as [id, text] (id)}
										<label class="choice"><Radio value={id} />{text}</label>
									{/each}
								</RadioGroup>
							</Field>
							<Field name="note">
								<FieldLabel>メモ</FieldLabel>
								<Input class="input" maxlength={200} />
							</Field>
							<div class="row" style="justify-content: flex-end">
								<DialogClose class="btn quiet">閉じる</DialogClose>
								<Button type="submit" class="btn">通報する</Button>
							</div>
						</form>
					</DialogContent>
				</Dialog>
			{/if}
		</div>
	</article>
{/snippet}
