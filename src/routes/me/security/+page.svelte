<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '$app/forms';
	import { Button } from '@ui-sdk/svelte/button';
	import { Field, FieldLabel } from '@ui-sdk/svelte/field';
	import { Input } from '@ui-sdk/svelte/input';
	import { toast } from '@ui-sdk/svelte/toast';
	import { onMount } from 'svelte';
	import Footer from '#components/Footer.svelte';
	import Header from '#components/Header.svelte';
	import Meta from '#components/Meta.svelte';
	import { handOffRecoveryCode, registerPasskey, stepupWithPasskey, supportsPasskeys, takeRecoveryCode } from '#passkey';
	import RecoveryCode from '#components/RecoveryCode.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let ready = $state(false);
	let supported = $state(true);
	let busy = $state(false);
	let message = $state('');
	let shownCode = $state<string | null>(null);
	onMount(() => {
		shownCode = takeRecoveryCode();
		supported = supportsPasskeys();
		ready = true;
		if (data.recovered) toast('復旧しました', { description: '新しいパスキーだけが、有効です。', duration: 8000 });
	});

	async function add() {
		busy = true;
		message = '';
		// すでにパスキーがあるアカウントは、追加の前に、本人確認をする。
		if (data.account && !data.stepup) {
			const check = await stepupWithPasskey();
			if (!check.ok) {
				busy = false;
				message = check.message;
				return;
			}
		}
		const result = await registerPasskey();
		busy = false;
		if (!result.ok) {
			message = result.message;
			return;
		}
		toast('登録しました', { duration: 6000 });
		handOffRecoveryCode(result.data.recoveryCode);
		shownCode = takeRecoveryCode();
		await invalidateAll();
	}

	/** 追加・削除などの前に、直前の本人確認を求める。済んでいれば、そのまま送る。 */
	const guarded: SubmitFunction = ({ formElement, cancel }) => {
		if (data.stepup) return async ({ update }) => update({ reset: false });
		cancel();
		void (async () => {
			message = '';
			const check = await stepupWithPasskey();
			if (!check.ok) {
				message = check.message;
				return;
			}
			await invalidateAll();
			formElement.requestSubmit();
		})();
	};

	const plain: SubmitFunction = () => async ({ result, update }) => {
		if (result.type === 'success' && result.data?.loggedOut) {
			await invalidateAll();
			await goto('/');
			return;
		}
		await update({ reset: false });
	};

	const date = (iso: string) => iso.slice(0, 10);
</script>

<Meta title="アカウント" description="パスキーとメールアドレスの管理。" />

<div class="page">
	<Header />
	<h1>アカウント</h1>

	{#if ready && !supported}<p class="banner warning">このブラウザは、パスキーに対応していません。</p>{/if}
	{#if message}<p class="banner error" role="alert">{message}</p>{/if}
	{#if form && 'error' in form && form.error}<p class="banner error" role="alert">{form.error}</p>{/if}

	{#if form && 'recoveryCode' in form && typeof form.recoveryCode === 'string' && !shownCode}
		<RecoveryCode code={form.recoveryCode} onsaved={() => (shownCode = null)} />
	{/if}
	{#if shownCode}
		<RecoveryCode code={shownCode} onsaved={() => (shownCode = null)} />
	{/if}

	{#if !data.account}
		<section class="panel">
			<p>パスキーを登録すると、端末を変えても、自分のレビューを編集できます。</p>
			<div class="row"><Button class="btn" disabled={busy || !ready || !supported} onclick={add}>パスキーを登録する</Button></div>
		</section>
	{:else}
		<section class="panel" aria-label="パスキー">
			<h2>パスキー</h2>
			<div class="stack">
				{#each data.credentials as c (c.id)}
					<div class="spread">
						<div>
							<p>{c.label ?? 'パスキー'}{c.backedUp ? '（同期されます）' : ''}</p>
							<p class="caption muted"><span class="num">{date(c.createdAt)}</span> 登録{c.lastUsedAt ? ` · 最後に使った日 ${date(c.lastUsedAt)}` : ''}</p>
						</div>
						{#if data.credentials.length > 1}
							<form method="post" action="?/deleteCredential" use:enhance={guarded}>
								<input type="hidden" name="id" value={c.id} />
								<Button type="submit" class="btn quiet small">削除</Button>
							</form>
						{/if}
					</div>
				{/each}
			</div>
			<div class="row"><Button class="btn quiet" disabled={busy || !ready || !supported} onclick={add}>パスキーを追加する</Button></div>
		</section>

		<section class="panel" aria-label="復旧コード">
			<h2>復旧コード</h2>
			<p>{data.recoveryCode ? `設定済み（${date(data.recoveryCode.createdAt)}）。コードは、保存していません。なくしたときは、作り直してください。` : '設定されていません。'}</p>
			<form method="post" action="?/regenerateCode" use:enhance={guarded}><Button type="submit" class="btn quiet">コードを作り直す</Button></form>
		</section>

		{#if data.emailEnabled}
		<section class="panel" aria-label="復旧用のメール">
			<h2>復旧用のメールアドレス</h2>
			{#if true}
				{#if form && 'emailSent' in form && form.emailSent}<p class="banner success" role="status">確認のメールを送りました。リンクを開いて、確認してください（1時間有効）。</p>{/if}
				{#if data.email}
					<p>{data.email.email} <span class="tag">{data.email.verified ? '確認済み' : '確認待ち'}</span></p>
				{/if}
				<form method="post" action="?/setEmail" class="stack" use:enhance={guarded}>
					<Field name="email">
						<FieldLabel>{data.email ? 'アドレスを変える' : 'メールアドレス'}</FieldLabel>
						<Input class="input" type="email" required autocomplete="email" maxlength={254} />
					</Field>
					<div class="row">
						<Button type="submit" class="btn">確認のメールを送る</Button>
					</div>
				</form>
				{#if data.email}
					<form method="post" action="?/removeEmail" use:enhance={guarded}><Button type="submit" class="btn quiet small">アドレスを消す</Button></form>
				{/if}
			{/if}
		</section>
		{/if}

		<section class="panel" aria-label="ログアウト">
			<div class="row">
				<form method="post" action="?/logout" use:enhance={plain}><Button type="submit" class="btn quiet">ログアウト</Button></form>
				<form method="post" action="?/logoutAll" use:enhance={guarded}><Button type="submit" class="btn quiet">すべての端末でログアウト</Button></form>
			</div>
		</section>
	{/if}
	<Footer />
</div>
