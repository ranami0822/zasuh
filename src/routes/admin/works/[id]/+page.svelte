<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '@ui-sdk/svelte/button';
	import BandFields from '#components/BandFields.svelte';
	import { Checkbox } from '@ui-sdk/svelte/checkbox';
	import { Field, FieldLabel } from '@ui-sdk/svelte/field';
	import { Input } from '@ui-sdk/svelte/input';
	import { Radio, RadioGroup } from '@ui-sdk/svelte/radio';
	import { Textarea } from '@ui-sdk/svelte/textarea';
	import { CATEGORY_LABEL } from '#messages';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="stack">
	<h1>{data.work.name}</h1>
	<p class="caption muted">/{data.work.slug} · {CATEGORY_LABEL[data.work.category]} · <a href={`/works/${data.work.slug}`}>ページを開く</a></p>
</div>

<form method="post" action="?/save" class="card stack" use:enhance={() => async ({ update }) => update({ reset: false })}>
	{#if form?.error}<p class="banner error" role="alert">{form.error}</p>{/if}
	{#if form?.saved}<p class="banner success" role="status">保存しました。</p>{/if}
	<Field name="name"><FieldLabel>名前</FieldLabel><Input class="input" required maxlength={100} defaultValue={data.work.name} /></Field>
	<Field name="url"><FieldLabel>リンク</FieldLabel><Input class="input" type="url" defaultValue={data.work.url ?? ''} /></Field>
	<Field name="summary"><FieldLabel>紹介文</FieldLabel><Textarea class="input" rows={3} maxlength={500} defaultValue={data.work.summary ?? ''} /></Field>

	<BandFields from={data.work.bandFrom} to={data.work.bandTo} />

	<div class="stack" style="gap: var(--space-2)">
		<span class="caption muted">分野のタグ（自動で付く）</span>
		<div class="row">{#each data.domain as label (label)}<span class="tag">{label}</span>{/each}</div>
	</div>

	<div class="stack" style="gap: var(--space-2)">
		<span class="caption muted">追加のタグ（付けたあとに投稿されたレビューから、読み取りに使われる）</span>
		<div class="row">
			{#each data.extras as t (t.id)}
				<label class="choice"><Checkbox name="tags" value={t.id} defaultChecked={data.selected.includes(t.id)} />{t.label}</label>
			{/each}
		</div>
	</div>

	<Field>
		<FieldLabel>表示</FieldLabel>
		<RadioGroup name="status" defaultValue={data.work.status} class="row">
			<label class="choice"><Radio value="active" />表示する</label>
			<label class="choice"><Radio value="hidden" />非表示にする</label>
		</RadioGroup>
	</Field>
	<div class="row"><Button type="submit" class="btn">保存する</Button></div>
</form>

{#if data.withoutStars > 0 || form?.reread}
	<form method="post" action="?/rereadStars" class="card stack" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<h2>星のないレビュー</h2>
		<p class="caption muted">星を入れる前に読んだレビューを、いまの質問で読み直します。1回に、{data.rereadLimit}件まで読みます。</p>
		{#if form?.reread}
			<p class="banner {form.reread.error > 0 ? 'error' : 'success'}" role="status">
				読めた: {form.reread.ok}件、見送り: {form.reread.skipped}件、失敗: {form.reread.error}件
			</p>
		{/if}
		{#if data.withoutStars > 0}<div class="row"><Button type="submit" class="btn">星で読み直す（{data.withoutStars}件）</Button></div>{/if}
	</form>
{/if}

{#if data.work.category === 'game'}
	<form method="post" action="?/linkCritic" class="card stack" use:enhance={() => async ({ update }) => update({ reset: false })}>
		<h2>OpenCritic の作品 ID</h2>
		<p class="caption muted">空にして保存すると、結びつきを外します。ID を変えると、これまでの専門家の結果は消えます。</p>
		{#if form?.criticError}<p class="banner error" role="alert">{form.criticError}</p>{/if}
		{#if form?.criticLinked}<p class="banner success" role="status">保存しました。</p>{/if}
		<Field name="ocId"><FieldLabel>OpenCritic の作品 ID</FieldLabel><Input class="input" type="number" defaultValue={form?.ocId ?? String(data.openCriticId ?? '')} /></Field>
		<div class="row"><Button type="submit" class="btn">保存する</Button></div>
	</form>
	{#if data.openCriticId !== null}
		<form method="post" action="?/refreshOcInfo" class="card stack" use:enhance={() => async ({ update }) => update({ reset: false })}>
			<h2>OpenCritic の作品情報</h2>
			<p class="caption muted">発売日、機種、ジャンル、開発元、販売元、Steam の ID、英語の説明を、取り直します（1回の呼び出し）。</p>
			{#if form?.ocInfoError}<p class="banner error" role="alert">{form.ocInfoError}</p>{/if}
			{#if form?.ocInfoRefreshed}
				<p class="banner success" role="status">
					取り直しました。空だった項目: {form.ocInfoRefreshed.empty}
					<br />OpenCritic の応答の項目: {form.ocInfoRefreshed.fields}
				</p>
			{/if}
			<div class="row"><Button type="submit" class="btn quiet">作品情報を取り直す</Button></div>
		</form>
		<form method="post" action="?/syncCritics" class="card stack" use:enhance={() => async ({ update }) => update({ reset: false })}>
			<h2>専門家の取得</h2>
			<p class="caption muted">決まった時間帯（毎日 UTC 17:00〜21:00）を待たずに、この作品の専門家のレビューを取得します。1回に、{data.criticReadLimit}件まで読みます。1日の上限に数えます。</p>
			{#if form?.criticSyncError}<p class="banner error" role="alert">{form.criticSyncError}</p>{/if}
			{#if form?.criticSync}
				<p class="banner {form.criticSync.ok ? 'success' : 'error'}" role="status">
					読めた: {form.criticSync.read}件、OpenCritic の呼び出し: {form.criticSync.calls}回、失敗: {form.criticSync.failed}件。{form.criticSync.message}
					<br />{form.criticSync.scores}
					<br />{form.criticSync.fields}
				</p>
			{/if}
			<div class="row"><Button type="submit" class="btn">専門家を今すぐ取得</Button></div>
		</form>
	{/if}
{/if}
