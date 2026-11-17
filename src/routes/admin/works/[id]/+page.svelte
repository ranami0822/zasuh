<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '@ui-sdk/svelte/button';
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
