<script lang="ts">
	import { untrack as untracked } from 'svelte';
	import { Checkbox } from '@ui-sdk/svelte/checkbox';
	import { bandFor } from '#band';

	/** 作品ページのタイトルの帯の色（何から何へ）。指定しないときは、既定の灰色。管理画面の登録と編集で使う。 */
	let { from = null, to = null }: { from?: string | null; to?: string | null } = $props();

	let on = $state(untracked(() => Boolean(from && to)));
	let start = $state(untracked(() => from ?? '#f5f5f5'));
	let end = $state(untracked(() => to ?? '#a3a3a3'));
	const band = $derived(bandFor(start, end));
</script>

<div class="stack" style="gap: var(--space-2)">
	<span class="caption muted">タイトルの帯の色</span>
	<label class="choice" style="align-self: flex-start">
		<Checkbox checked={on} onCheckedChange={(v) => (on = v === true)} />色を指定する（しないと、灰色）
	</label>
	{#if on}
		<div class="row">
			<label class="check"><input type="color" name="bandFrom" bind:value={start} aria-label="はじめの色" /> から</label>
			<label class="check"><input type="color" name="bandTo" bind:value={end} aria-label="おわりの色" /> へ</label>
		</div>
		<div
			class="band"
			style:--band-from={start}
			style:--band-to={end}
			style:--band-fg={band?.fg ?? 'var(--band-fg)'}
			style:--band-muted={band?.muted ?? 'var(--band-muted)'}
			style="padding: var(--space-4) var(--space-6)"
		>
			<p style="font-weight: 700; margin: 0">見本</p>
		</div>
		{#if !band}<p class="banner error" role="alert">この組み合わせでは、文字が読みにくくなります。どちらかを、明るく（または暗く）してください。</p>{/if}
	{/if}
</div>
