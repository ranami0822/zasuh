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

	<form method="post" action="?/code" class="panel">
		<h2>復旧コード</h2>
		{#if form && 'error' in form && form.form === 'code'}<p class="banner error" role="alert">{form.error}</p>{/if}
		<Field name="code">
			<FieldLabel>登録のときに保存した、復旧コード</FieldLabel>
			<Input class="input" required autocomplete="off" autocapitalize="characters" spellcheck={false} maxlength={40} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" />
		</Field>
		<div class="row"><Button type="submit" class="btn">復旧する</Button></div>
	</form>

	{#if data.emailEnabled}
		<div class="panel">
			<h2>メール</h2>
			{#if form && 'sent' in form && form.sent}
				<p class="banner success" role="status">登録されたメールアドレスなら、復旧のリンクを送りました（15分有効）。届かないときは、迷惑メールを確認してください。</p>
			{:else}
				{#if form && 'error' in form && form.form === 'email'}<p class="banner error" role="alert">{form.error}</p>{/if}
				<form method="post" action="?/send" class="stack">
					<Field name="email">
						<FieldLabel>登録したメールアドレス</FieldLabel>
						<Input class="input" type="email" required autocomplete="email" maxlength={254} />
					</Field>
					<div class="row"><Button type="submit" class="btn quiet">リンクを送る</Button></div>
				</form>
			{/if}
		</div>
	{/if}
	<Footer />
</div>
