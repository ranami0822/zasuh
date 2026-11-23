<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from '@ui-sdk/svelte/toast';
	import { untrack } from 'svelte';
	import { Button } from '@ui-sdk/svelte/button';
	import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@ui-sdk/svelte/dialog';
	import { Checkbox, CheckboxIndicator, type CheckedState } from '@ui-sdk/svelte/checkbox';
	import { Field, FieldLabel } from '@ui-sdk/svelte/field';
	import { Input } from '@ui-sdk/svelte/input';
	import { Radio, RadioGroup } from '@ui-sdk/svelte/radio';
	import { Textarea } from '@ui-sdk/svelte/textarea';
	import StarDist from '#components/StarDist.svelte';
	import StarTag from '#components/StarTag.svelte';
	import CriticPane from '#components/CriticPane.svelte';
	import Glacier from '#components/Glacier.svelte';
	import Meta from '#components/Meta.svelte';
	import { CATEGORY_LABEL, DISCLOSURE_LABEL, REASON_LABEL } from '#messages';
	import type { ActionData, PageProps } from './$types';

	/** これより長い説明は、スマホで、たたむ（文字数）。 */
	const SUMMARY_FOLD_LENGTH = 80;

	let { data, form }: PageProps & { form?: ActionData } = $props();

	const postFailed = $derived(form && 'form' in form && form.form === 'post' ? form : null);
	// svelte-ignore state_referenced_locally
	let interest = $state<CheckedState>((form && 'values' in form && form.values?.disclosure && form.values.disclosure !== 'none') || false);
	let reportOpen = $state<string | null>(null);
	let reported = $state<Record<string, boolean>>({});
	let reportError = $state('');

	/** 投稿・編集の直後に、AIの読み取りの結果を、toast で知らせる。読み取りは、応答のあとに始まるので、数秒おきに確かめる。 */
	/** 投稿のあとに、パスキーの登録を、小さく案内する（強制しない）。 */
	function suggestPasskey(kind: 'posted' | 'edited') {
		if (kind !== 'posted' || page.data.account) return;
		toast('パスキーを登録すると、端末を変えても、編集できます', {
			id: 'passkey-suggest',
			duration: 14000,
			action: { label: '登録する', onAction: () => void goto('/me/security') }
		});
	}

	async function follow(kind: 'posted' | 'edited') {
		const id = toast.loading(kind === 'posted' ? '投稿しました。読み取っています' : '直しました。読み取っています', { id: 'reading' });
		for (let i = 0; i < 24; i++) {
			await new Promise((r) => setTimeout(r, 1500));
			let status: { status: string; reads: { label: string; star: number }[]; duplicate: boolean; disclosed: boolean } | null = null;
			try {
				const res = await fetch(`/works/${data.work.slug}/reading`);
				if (res.ok) status = await res.json();
			} catch {
				/* 通信の失敗は、次の回で、もう一度確かめる */
			}
			if (!status) continue;
			if (status.status === 'failed') {
				toast.update(id, { type: 'info', title: 'いまは読み取れませんでした', description: 'あとで自動で読み直します。', duration: 8000 });
				suggestPasskey(kind);
				return;
			}
			if (status.status === 'ok') {
				const lines = status.reads.map((r) => `${r.label}　星 ${r.star.toFixed(1)}`);
				const notes = [
					status.duplicate ? 'ほかのレビューと文面がほぼ同じなので、集計には数えません。' : '',
					status.disclosed ? '関係者のレビューとして、別枠に表示します。集計には数えません。' : ''
				].filter(Boolean);
				toast.update(id, {
					type: 'success',
					title: lines.length > 0 ? '読み取りました' : '数えられる内容は、見つかりませんでした',
					description: [...lines, ...notes].join('\n') || '具体的な事実・特徴・体験が書かれていると、観点として数えられます。',
					duration: 9000
				});
				await invalidateAll();
				suggestPasskey(kind);
				return;
			}
		}
		toast.update(id, { type: 'info', title: '読み取りに時間がかかっています', description: '終わると、結果が反映されます。', duration: 8000 });
		suggestPasskey(kind);
	}

	// 同じページへの移動（フォーム送信のあとの redirect）では、コンポーネントが作り直されないので、onMount ではなく $effect で見る。
	// 読み取りが終わって、データを読み直す（invalidateAll）と、load の url には ?done が残っているので、一度だけ始める印を持つ。
	let started = false;
	$effect(() => {
		const done = data.done;
		if (done === 'deleted') {
			untrack(() => {
				replaceState(`/works/${data.work.slug}`, {});
				toast('レビューを消しました');
			});
			return;
		}
		if (done !== 'posted' && done !== 'edited') {
			started = false;
			return;
		}
		if (started) return;
		started = true;
		untrack(() => {
			replaceState(`/works/${data.work.slug}`, {});
			void follow(done);
		});
	});

	const link = (t: string | null, p = 1) => `/works/${data.work.slug}${t || p > 1 ? '?' : ''}${[t ? `t=${encodeURIComponent(t)}` : '', p > 1 ? `p=${p}` : ''].filter(Boolean).join('&')}`;
	// 説明が長いとき、スマホでは、たたんで見せる（広い画面では、いつも全部見せる）。
	// 紹介文がなければ、OpenCritic の英語の説明を出す（翻訳しない。出典を添える）。
	const summaryText = $derived(data.work.summary ?? data.work.ocInfo?.description ?? null);
	const summaryFromOc = $derived(!data.work.summary && !!data.work.ocInfo?.description);
	const summaryLong = $derived((summaryText ?? '').length > SUMMARY_FOLD_LENGTH);
	// 発売日、機種、ジャンル、開発元、販売元（OpenCritic。値は英語のまま）。
	const facts = $derived.by(() => {
		const i = data.work.ocInfo;
		if (!i) return [];
		return [
			i.releaseDate ? `発売: ${i.releaseDate}` : '',
			i.platforms.length ? `機種: ${i.platforms.join(', ')}` : '',
			i.genres.length ? `ジャンル: ${i.genres.join(', ')}` : '',
			i.developers.length ? `開発: ${i.developers.join(', ')}` : '',
			i.publishers.length ? `販売: ${i.publishers.join(', ')}` : ''
		].filter(Boolean);
	});
	let summaryOpen = $state(false);
	// 投稿の欄: スマホでは、書き始める（フォーカスする）まで、小さく見せる。失敗して戻ったときは、広げたまま。
	let composeOpen = $state(false);
	const composeExpanded = $derived(composeOpen || postFailed !== null);
	const maxMonth = $derived(Math.max(1, ...data.months.map((m: { n: number }) => m.n)));
</script>

<Meta title={data.work.name} type="article" url={data.share.url} description={data.work.summary ?? data.share.description} />

<div class="workpage">
	<header
		class="hero band"
		style:--band-from={data.band?.from}
		style:--band-to={data.band?.to}
		style:--band-fg={data.band?.fg}
		style:--band-muted={data.band?.muted}
	>
		<nav class="crumbs" aria-label="パンくず">
			<a href="/">一覧</a><span aria-hidden="true">/</span><a href={`/?c=${data.work.category}`}>{CATEGORY_LABEL[data.work.category]}</a>
		</nav>
		<h1>{data.work.name}</h1>
		{#if summaryText}
			<p class="muted work-summary" class:clamped={summaryLong && !summaryOpen} id="work-summary" lang={summaryFromOc ? 'en' : undefined}>{summaryText}</p>
			{#if summaryLong}
				<!-- 開閉は、文字ではなく、アイコンで示す（文字の「続きを読む」は、言語ごとの決まりに頼るため）。読み上げは、aria-label。 -->
				<button
					type="button"
					class="iconbtn only-narrow"
					aria-label={summaryOpen ? '説明を閉じる' : '説明の続きを開く'}
					title={summaryOpen ? '説明を閉じる' : '説明の続きを開く'}
					aria-expanded={summaryOpen}
					aria-controls="work-summary"
					onclick={() => (summaryOpen = !summaryOpen)}
				>
					<svg class="chevron" class:open={summaryOpen} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6l6 -6" /></svg>
				</button>
			{/if}
			{#if data.work.summarySourceUrl}
				<p class="caption muted">
					出典: <a href={data.work.summarySourceUrl} rel="noopener noreferrer nofollow">Wikipedia「{data.work.summarySourceTitle}」</a>（<a href="https://creativecommons.org/licenses/by-sa/4.0/deed.ja" rel="noopener noreferrer nofollow">CC BY-SA 4.0</a>）
				</p>
			{:else if summaryFromOc}
				<p class="caption muted">説明（英語）。出典: OpenCritic</p>
			{/if}
		{/if}
		{#if facts.length > 0 || data.work.ocInfo?.steamId}
			<p class="caption muted">
				{facts.join(' · ')}{#if data.work.ocInfo?.steamId}{facts.length > 0 ? ' · ' : ''}<a href={`https://store.steampowered.com/app/${data.work.ocInfo.steamId}`} rel="noopener noreferrer nofollow">Steam</a>{/if}
			</p>
		{/if}
		{#if data.work.url}<p class="caption"><a href={data.work.url} rel="noopener noreferrer nofollow">{data.work.url}</a></p>{/if}
	</header>

	<!-- 題名の帯の下: 左に、評価の aside（灰色。画面の左の端から、フッターの上まで）、右に、投稿とレビュー。 -->
	<div class="workbody">
	<aside class="rating" aria-label="観点ごとの星">
		<div class="rating__inner">
			<StarDist size="hero" {...data.overall} />
			<!-- 広い画面: そのまま見せる。スマホ: 総合だけ見せて、観点ごとは、たたむ（同じ中身を、画面の幅で出し分ける） -->
			<div class="rating__detail only-wide">
				{@render details()}
			</div>
			<details class="rating__detail rating__fold only-narrow">
				<summary aria-label="観点ごとに見る" title="観点ごとに見る">
					<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6l6 -6" /></svg>
				</summary>
				{@render details()}
			</details>
			<!-- 専門家の欄（22.10）: 広い画面は、灰色の欄の中、読者の評価の下。スマホは、読者の評価の要約（と、その開閉）の直下で、投稿欄より上。 -->
			{#if data.criticPane}
				<CriticPane pane={data.criticPane} />
			{/if}
		</div>
	</aside>

	<div class="main">
			<section class="compose" aria-label="レビューを書く">
				{#if data.own}
					<div class="spread">
						<p class="muted">この作品には、すでに投稿しています。</p>
						<a class="btn quiet" href={`/works/${data.work.slug}/edit`}>編集する</a>
					</div>
				{:else}
					<form
						method="post"
						action="?/post"
						class="compose"
						class:compose--compact={!composeExpanded}
						onfocusin={() => (composeOpen = true)}
						onfocusout={(e) => {
							const f = e.currentTarget as HTMLFormElement;
							if (!f.contains(e.relatedTarget as Node | null) && !f.querySelector('textarea')?.value) composeOpen = false;
						}}
						use:enhance={() => async ({ update }) => { await update({ reset: false }); }}>
						{#if postFailed}<p class="banner error" role="alert">{postFailed.error}</p>{/if}
						<Field name="body">
							<Textarea
								class="input"
								aria-label="レビュー"
								required
								minlength={5}
								maxlength={4000}
								placeholder="何が、どうだったか。"
								defaultValue={postFailed?.values.body ?? ''}
							/>
						</Field>
						{#if interest}
							<div class="stack">
								<RadioGroup name="disclosure" aria-label="利害関係の種類" defaultValue={postFailed?.values.disclosure && postFailed.values.disclosure !== 'none' ? postFailed.values.disclosure : 'developer'} class="row">
									{#each Object.entries(DISCLOSURE_LABEL).filter(([id]) => id !== 'none') as [id, text] (id)}
										<label class="choice"><Radio value={id} />{text}</label>
									{/each}
								</RadioGroup>
								<Field name="disclosureNote">
									<Input class="input" aria-label="利害関係のメモ" placeholder="関係を、一言で" maxlength={200} defaultValue={postFailed?.values.disclosureNote ?? ''} />
								</Field>
							</div>
						{:else}
							<input type="hidden" name="disclosure" value="none" />
						{/if}
						<div class="compose__foot">
							<label class="check">
								<Checkbox bind:checked={interest}>
									<CheckboxIndicator>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5l9 -10" /></svg>
									</CheckboxIndicator>
								</Checkbox>作り手・関係者として書く
							</label>
							<Button type="submit" class="btn">投稿する</Button>
						</div>
					</form>
				{/if}
			</section>

			{#if data.tag}
				<div class="row"><a class="tag" href={link(null)} aria-current="true">{data.tags.find((t) => t.tagId === data.tag)?.label} ×</a></div>
			{/if}

			{#if data.reviews.length > 0}
				<section class="panel flush reviews" id="reviews" aria-label="レビュー">
					{#each data.reviews as r (r.id)}
						{@render review(r)}
					{/each}
				</section>
			{/if}

			{#if data.pageCount > 1}
				<div class="row">
					{#each Array.from({ length: data.pageCount }, (_, i) => i + 1) as p (p)}
						<a class="tag" href={link(data.tag, p)} aria-current={p === data.page}>{p}</a>
					{/each}
				</div>
			{/if}

			{#if data.disclosed.length > 0}
				<Glacier seed={data.work.slug} label="関係者のレビュー">
					<p class="glacier__label">関係者 · <span class="num">{data.disclosed.length}</span>件</p>
					{#each data.disclosed as r (r.id)}
						{@render review(r)}
					{/each}
				</Glacier>
			{/if}
	</div>
	</div>
</div>

{#snippet details()}
	<div class="tagrows">
	{#each data.tags as t (t.tagId)}
		<a class="tagrow" class:empty={t.stat.n === 0} href={link(data.tag === t.tagId ? null : t.tagId)} aria-current={data.tag === t.tagId}>
			<span>{t.label}</span>
			<StarDist {...t.stat} />
		</a>
	{/each}
</div>
{#if data.months.length > 0}
	<div aria-label="月ごとの変化">
		<div class="months" style="height: 56px">
			{#each data.months as m (m.month)}
				<div
					class="months__col"
					style:height="{Math.max(12, (m.n / maxMonth) * 100)}%"
					title={m.month}
					role="img"
					aria-label="{m.month}: {m.n}件。星の平均 {(m.soft.reduce((t: number, v: number, i: number) => t + v * (i + 1), 0) / m.n).toFixed(1)}"
				>
					{#each [4, 3, 2, 1, 0] as i (i)}
						<i class="s{i + 1}" style:flex={m.soft[i]}></i>
					{/each}
				</div>
			{/each}
		</div>
		<div class="spread caption muted" style="margin-top: var(--space-1)">
			<span class="num">{data.months[0].month}</span>
			<span class="num">{data.months[data.months.length - 1].month}</span>
		</div>
	</div>
{/if}
{/snippet}

{#snippet review(r: (typeof data.reviews)[number])}
	<article class:faded={r.duplicate}>
		{#if r.reads.length > 0}
			<div class="row">
				{#each r.reads as x (x.tagId)}
					<StarTag label={x.label} star={x.star} />
				{/each}
			</div>
		{/if}
		<p class="reading">{r.body}</p>
		<div class="review__meta">
			<span>
				<span class="num">{r.writtenOn}</span>
				{#if r.edited} · 編集済み{/if}
				{#if r.disclosure !== 'none'} · {DISCLOSURE_LABEL[r.disclosure]}{r.disclosureNote ? `（${r.disclosureNote}）` : ''}{/if}
			</span>
			{#if reported[r.id]}
				<span>通報しました</span>
			{:else}
				<Dialog open={reportOpen === r.id} onOpenChange={(open) => { reportOpen = open ? r.id : null; reportError = ''; }}>
					<DialogTrigger class="review__report">通報</DialogTrigger>
					<DialogBackdrop />
					<DialogContent>
						<form
							method="post"
							action="?/report"
							class="stack"
							use:enhance={() => async ({ result, update }) => {
								if (result.type === 'success') {
									reported[r.id] = true;
									reportOpen = null;
								} else if (result.type === 'failure') {
									reportError = String(result.data?.error ?? '通報できませんでした。');
								} else {
									await update();
								}
							}}
						>
							<DialogTitle>通報</DialogTitle>
							{#if reportError}<p class="banner error" role="alert">{reportError}</p>{/if}
							<input type="hidden" name="reviewId" value={r.id} />
							<Field>
								<FieldLabel>理由</FieldLabel>
								<RadioGroup name="reason" defaultValue="abuse" required class="stack">
									{#each Object.entries(REASON_LABEL) as [id, text] (id)}
										<label class="choice"><Radio value={id} />{text}</label>
									{/each}
								</RadioGroup>
							</Field>
							<Field name="note">
								<FieldLabel>メモ</FieldLabel>
								<Input class="input" maxlength={200} />
							</Field>
							<div class="row" style="justify-content: flex-end">
								<DialogClose class="btn quiet">閉じる</DialogClose>
								<Button type="submit" class="btn">通報する</Button>
							</div>
						</form>
					</DialogContent>
				</Dialog>
			{/if}
		</div>
	</article>
{/snippet}
