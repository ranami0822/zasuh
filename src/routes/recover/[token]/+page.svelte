<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { Button } from '@ui-sdk/svelte/button';
	import { onMount } from 'svelte';
	import Meta from '#components/Meta.svelte';
	import { handOffRecoveryCode, registerPasskey } from '#passkey';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let ready = $state(false);
	let busy = $state(false);
	let message = $state('');

	onMount(() => {
		ready = true;
	});

	async function recover() {
		busy = true;
		message = '';
		const result = await registerPasskey({ optionsUrl: `/recover/${data.token}/options`, verifyUrl: `/recover/${data.token}/verify`, label: '復旧で登録' });
		busy = false;
		if (!result.ok) {
			message = result.message;
			return;
		}
		handOffRecoveryCode(result.data.recoveryCode);
		await invalidateAll();
		await goto('/me/security?recovered=1');
	}
</script>

<Meta title="パスキーの復旧" description="新しいパスキーを登録します。" />

<div class="page">
	<h1>パスキーの復旧</h1>
	<div class="panel">
		{#if !data.valid}
			<p class="banner error">このリンクは、使えません（期限切れか、使用済みです）。<a href="/recover">もう一度、メールを送る</a></p>
		{:else}
			{#if message}<p class="banner error" role="alert">{message}</p>{/if}
			<p class="banner warning">新しいパスキーを登録すると、これまでのパスキーと、ログイン中の端末は、すべて使えなくなります。</p>
			<div class="row"><Button class="btn" disabled={busy || !ready} onclick={recover}>新しいパスキーを登録する</Button></div>
		{/if}
	</div>
</div>
