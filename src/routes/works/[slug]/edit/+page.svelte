<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '@ui-sdk/svelte/button';
	import { Field, FieldLabel } from '@ui-sdk/svelte/field';
	import { Input } from '@ui-sdk/svelte/input';
	import { Radio, RadioGroup } from '@ui-sdk/svelte/radio';
	import { Textarea } from '@ui-sdk/svelte/textarea';
	import { DISCLOSURE_LABEL } from '#messages';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const start = $derived(form?.values ?? { body: data.own.body, disclosure: data.own.disclosure, disclosureNote: data.own.disclosureNote });
	let disclosure = $state('none');
	$effect.pre(() => {
		disclosure = start.disclosure;
	});
	const locked = $derived(data.own.expired);
</script>

<div class="page">
	<div class="stack">
		<h1>{data.work.name}</h1>
		<p class="muted">
			編集できるのは、あと <span class="num">{data.own.editsLeft}</span> 回。{locked ? '期間（投稿から7日）を過ぎています。' : ''}
		</p>
	</div>

	<form method="post" action="?/save" class="panel" use:enhance>
		{#if form?.error}<p class="banner error" role="alert">{form.error}</p>{/if}
		<Field name="body">
			<FieldLabel>レビュー</FieldLabel>
			<Textarea class="input" rows={6} required minlength={5} maxlength={4000} disabled={locked} defaultValue={start.body} />
		</Field>
		<Field>
			<FieldLabel>利害関係</FieldLabel>
			<RadioGroup name="disclosure" bind:value={disclosure} defaultValue={start.disclosure} disabled={locked} class="row">
				{#each Object.entries(DISCLOSURE_LABEL) as [id, text] (id)}
					<label class="choice"><Radio value={id} />{text}</label>
				{/each}
			</RadioGroup>
		</Field>
		{#if disclosure !== 'none'}
			<Field name="disclosureNote">
				<FieldLabel>メモ</FieldLabel>
				<Input class="input" maxlength={200} disabled={locked} defaultValue={start.disclosureNote} />
			</Field>
		{/if}
		<div class="row">
			<Button type="submit" class="btn" disabled={locked}>直す</Button>
			<a class="btn quiet" href={`/works/${data.work.slug}`}>戻る</a>
		</div>
	</form>
</div>
