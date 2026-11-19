<script lang="ts">
	import { Button } from '@ui-sdk/svelte/button';
	import Footer from '#components/Footer.svelte';
	import Header from '#components/Header.svelte';
	import Meta from '#components/Meta.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<Meta title="メールアドレスの確認" description="復旧用のメールアドレスを確認します。" />

<div class="page">
	<Header />
	<h1>メールアドレスの確認</h1>
	<div class="panel">
		{#if form && 'confirmed' in form && form.confirmed}
			<p class="banner success" role="status">確認しました。パスキーが使えなくなったら、このアドレスに復旧のリンクを送れます。</p>
			<div class="row"><a class="btn" href="/me/security">アカウントへ</a></div>
		{:else if !data.valid}
			<p class="banner error">このリンクは期限切れか、使用済みです。<a href="/me/security">アカウントの画面から送り直す</a></p>
		{:else}
			{#if form && 'error' in form && form.error}<p class="banner error" role="alert">{form.error}</p>{/if}
			<form method="post" action="?/confirm" class="stack">
				<input type="hidden" name="token" value={data.token} />
				<div class="row"><Button type="submit" class="btn">このメールアドレスを確認する</Button></div>
			</form>
		{/if}
	</div>
	<Footer />
</div>
