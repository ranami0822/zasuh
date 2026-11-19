<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { Button } from '@ui-sdk/svelte/button';
	import { onMount } from 'svelte';
	import Footer from '#components/Footer.svelte';
	import Header from '#components/Header.svelte';
	import Meta from '#components/Meta.svelte';
	import { loginWithPasskey, supportsPasskeys } from '#passkey';

	let ready = $state(false);
	let supported = $state(true);
	let busy = $state(false);
	let message = $state('');
	onMount(() => {
		supported = supportsPasskeys();
		ready = true;
	});

	async function login() {
		busy = true;
		message = '';
		const result = await loginWithPasskey();
		busy = false;
		if (!result.ok) {
			message = result.message;
			return;
		}
		await invalidateAll();
		await goto('/me');
	}
</script>

<Meta title="ログイン" description="パスキーでログインすると、端末を変えても、自分のレビューを編集できます。" />

<div class="page">
	<Header />
	<h1>ログイン</h1>
	<div class="panel">
		{#if ready && !supported}<p class="banner warning">このブラウザは、パスキーに対応していません。</p>{/if}
		{#if message}<p class="banner error" role="alert">{message}</p>{/if}
		<div class="row">
			<Button class="btn" disabled={busy || !ready || !supported} onclick={login}>パスキーでログイン</Button>
			<a class="btn quiet" href="/recover">パスキーを使えない</a>
		</div>
		<p class="caption muted">はじめての人は、<a href="/me/security">パスキーを登録</a>してください。</p>
	</div>
	<Footer />
</div>
