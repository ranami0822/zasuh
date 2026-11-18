<script lang="ts">
	import { Button } from '@ui-sdk/svelte/button';
	import { Field, FieldLabel } from '@ui-sdk/svelte/field';
	import { Input } from '@ui-sdk/svelte/input';
	import Footer from '#components/Footer.svelte';
	import Header from '#components/Header.svelte';
	import Meta from '#components/Meta.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<Meta title="パスキーの復旧" description="登録したメールアドレスに、復旧のリンクを送ります。" />

<div class="page">
	<Header />
	<h1>パスキーの復旧</h1>
	<div class="panel">
		{#if !data.emailEnabled}
			<p class="banner warning">メールでの復旧は、まだ使えません。</p>
		{:else if form && 'sent' in form && form.sent}
			<p class="banner success" role="status">登録されたメールアドレスなら、復旧のリンクを送りました（15分有効）。届かないときは、迷惑メールを確認してください。</p>
		{:else}
			{#if form && 'error' in form && form.error}<p class="banner error" role="alert">{form.error}</p>{/if}
			<form method="post" action="?/send" class="stack">
				<Field name="email">
					<FieldLabel>登録したメールアドレス</FieldLabel>
					<Input class="input" type="email" required autocomplete="email" maxlength={254} />
				</Field>
				<div class="row"><Button type="submit" class="btn">リンクを送る</Button></div>
			</form>
		{/if}
	</div>
	<Footer />
</div>
