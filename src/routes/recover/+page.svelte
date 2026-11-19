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

<Meta title="パスキーの復旧" description="復旧コードか、登録したメールアドレスで、アカウントを取り戻します。" />

<div class="page">
	<Header />
	<h1>パスキーの復旧</h1>

	<form method="post" action="?/code" class="panel">
		<h2>復旧コード</h2>
		{#if form && 'error' in form && form.form === 'code'}<p class="banner error" role="alert">{form.error}</p>{/if}
		<Field name="code">
			<FieldLabel>登録のときに保存した復旧コード</FieldLabel>
			<Input class="input" required autocomplete="off" autocapitalize="characters" spellcheck={false} maxlength={40} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" />
		</Field>
		<div class="row"><Button type="submit" class="btn">復旧する</Button></div>
	</form>

	{#if data.emailEnabled}
		<div class="panel">
			<h2>メール</h2>
			{#if form && 'sent' in form && form.sent}
				<p class="banner success" role="status">登録されているアドレスなら、復旧のリンクを送りました。15分以内に開いてください。届かないときは、迷惑メールのフォルダも見てください。</p>
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
