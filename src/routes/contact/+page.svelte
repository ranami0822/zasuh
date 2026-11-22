<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from '@ui-sdk/svelte/toast';
	import { Button } from '@ui-sdk/svelte/button';
	import { Field, FieldLabel } from '@ui-sdk/svelte/field';
	import { Input } from '@ui-sdk/svelte/input';
	import { Radio, RadioGroup } from '@ui-sdk/svelte/radio';
	import { Textarea } from '@ui-sdk/svelte/textarea';
	import Meta from '#components/Meta.svelte';
	import { KIND_LABEL } from '#messages';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	// svelte-ignore state_referenced_locally
	let kind = $state(form?.values?.kind ?? data.kind);
</script>

<Meta title="お問い合わせ" description="作品の追加依頼、お問い合わせ、異議申し立て・削除の依頼を受け付けます。" />

<div class="page">
	<h1>{KIND_LABEL[kind]}</h1>

	<form
		method="post"
		action="?/send"
		class="panel"
		use:enhance={() => async ({ result, update }) => {
			if (result.type === 'success') toast('受け付けました', { description: '内容を確認します。返事は、連絡先を書いた場合だけ、できます。', duration: 8000 });
			await update({ reset: result.type === 'success' });
		}}
	>
		{#if form?.error}<p class="banner error" role="alert">{form.error}</p>{/if}
		<Field>
			<FieldLabel>種類</FieldLabel>
			<RadioGroup name="kind" bind:value={kind} class="row">
				{#each Object.entries(KIND_LABEL) as [id, text] (id)}
					<label class="choice"><Radio value={id} />{text}</label>
				{/each}
			</RadioGroup>
		</Field>

		{#if kind === 'work_request'}
			<Field name="workName"><FieldLabel>作品名</FieldLabel><Input class="input" required maxlength={100} defaultValue={form?.values?.workName ?? ''} /></Field>
			<Field>
				<FieldLabel>分野</FieldLabel>
				<RadioGroup name="category" defaultValue={form?.values?.category ?? 'game'} class="row">
					<label class="choice"><Radio value="game" />ゲーム</label>
					<label class="choice"><Radio value="software" />ソフトウェア</label>
				</RadioGroup>
			</Field>
			<Field name="url"><FieldLabel>リンク（公式サイトなど）</FieldLabel><Input class="input" type="url" defaultValue={form?.values?.url ?? ''} /></Field>
		{/if}

		<Field name="body">
			<FieldLabel>{kind === 'dispute' ? '対象のページと、内容' : '内容'}</FieldLabel>
			<Textarea class="input" rows={6} required minlength={5} maxlength={2000} defaultValue={form?.values?.body ?? ''} />
		</Field>
		<Field name="contact">
			<FieldLabel>連絡先（返事がほしいときだけ。メールなど）</FieldLabel>
			<Input class="input" maxlength={200} defaultValue={form?.values?.contact ?? ''} />
		</Field>
		<div class="row"><Button type="submit" class="btn">送る</Button></div>
	</form>
</div>
