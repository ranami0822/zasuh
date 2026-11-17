<script lang="ts">
	import { Button } from '@ui-sdk/svelte/button';
	import { Field, FieldLabel } from '@ui-sdk/svelte/field';
	import { Input } from '@ui-sdk/svelte/input';
	import { Radio, RadioGroup } from '@ui-sdk/svelte/radio';
	import { Textarea } from '@ui-sdk/svelte/textarea';
	import { CATEGORY_LABEL } from '#messages';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const v = $derived(form?.values ?? data.prefill);
</script>

<div class="row">
	<a class="card stack" href="/admin/reports" style="gap: 0; color: inherit; text-decoration: none"><span class="caption muted">通報のあるレビュー</span><span class="num" style="font-size: 32px">{data.openReports}</span></a>
	<a class="card stack" href="/admin/inbox" style="gap: 0; color: inherit; text-decoration: none"><span class="caption muted">受信箱（未対応）</span><span class="num" style="font-size: 32px">{data.openMessages}</span></a>
	<div class="card stack" style="gap: 0"><span class="caption muted">読み取り待ち</span><span class="num" style="font-size: 32px">{data.pendingReadings}</span></div>
	<div class="card stack" style="gap: 0"><span class="caption muted">読み取りの失敗が続いている</span><span class="num" style="font-size: 32px">{data.failedReadings}</span></div>
</div>

<h2>作品</h2>
<div class="stack">
	{#each data.works as w (w.id)}
		<a class="card spread" href={`/admin/works/${w.id}`} style="color: inherit; text-decoration: none" class:faded={w.status === 'hidden'}>
			<div><h3>{w.name}</h3><p class="caption muted">/{w.slug} · {CATEGORY_LABEL[w.category as 'game' | 'software']}{w.status === 'hidden' ? ' · 非表示' : ''}</p></div>
			<span class="caption muted num">{w.reviews}件</span>
		</a>
	{/each}
</div>

<h2>作品を登録する</h2>
<form method="post" action="?/create" class="card stack">
	{#if form?.error}<p class="banner error" role="alert">{form.error}</p>{/if}
	<Field name="name"><FieldLabel>名前</FieldLabel><Input class="input" required maxlength={100} defaultValue={v.name} /></Field>
	<Field name="slug"><FieldLabel>URL 用の名前（小文字の英数字とハイフン）</FieldLabel><Input class="input" required pattern="[a-z0-9][a-z0-9\-]{'{0,62}'}" defaultValue={v.slug} /></Field>
	<Field>
		<FieldLabel>分野</FieldLabel>
		<RadioGroup name="category" defaultValue={v.category} class="row">
			<label class="choice"><Radio value="game" />ゲーム</label>
			<label class="choice"><Radio value="software" />ソフトウェア</label>
		</RadioGroup>
	</Field>
	<Field name="url"><FieldLabel>リンク</FieldLabel><Input class="input" type="url" defaultValue={v.url} /></Field>
	<Field name="summary"><FieldLabel>紹介文</FieldLabel><Textarea class="input" rows={3} maxlength={500} defaultValue={v.summary} /></Field>
	<div class="row"><Button type="submit" class="btn">登録する</Button></div>
</form>
