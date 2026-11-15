<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { EditorView } from '@codemirror/view';
	import Editor from '../lib/Editor.svelte';
	import { press } from '../lib/press';
	import { createIdbStore } from '../lib/store';
	import { createSaver, type SaveState } from '../lib/saver';
	import { isEmpty, labelOf, newDoc, openInitial, statusLabel, statusOrder } from '../lib/docs';
	import { bar } from '../lib/editor/bar';
	import Icon from '../lib/Icon.svelte';
	import type { Doc, Status } from '../lib/types';

	const store = createIdbStore();
	let saveState = $state<SaveState>('ok');
	const saver = createSaver(store, { onState: (s) => (saveState = s) });

	// 文書は $state.raw で持つ（Svelte のプロキシを IndexedDB に渡すと、保存が黙って失敗する）
	let doc = $state.raw<Doc | null>(null);
	let all = $state.raw<Doc[]>([]);
	let view: EditorView | undefined;
	let titleEl: HTMLTextAreaElement | undefined = $state();
	let statusDlg: HTMLDialogElement | undefined = $state();
	let docsDlg: HTMLDialogElement | undefined = $state();
	let confirmPublic = $state(false);
	let armedDelete = $state<string | null>(null);
	let theme = $state<'light' | 'dark'>('light');

	/** 題は、長ければ折り返す（切らない） */
	function fit(el: HTMLTextAreaElement | undefined) {
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = el.scrollHeight + 'px';
	}

	onMount(() => {
		theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
		(async () => {
			doc = await openInitial(store);
			await tick();
			fit(titleEl);
			if (doc.title === '') titleEl?.focus();
			else view?.focus();
		})();

		// 閉じる前、隠れる前に、待っているものを書き出す
		const flush = () => void saver.flush();
		const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
		document.addEventListener('visibilitychange', onHide);
		addEventListener('pagehide', flush);

		// キーボードが出ても、下の帯が見える高さに合わせる（iOS）
		const vv = window.visualViewport;
		const setVh = () => document.documentElement.style.setProperty('--vh', (vv?.height ?? innerHeight) + 'px');
		setVh();
		vv?.addEventListener('resize', setVh);
		const onResize = () => fit(titleEl);
		addEventListener('resize', onResize);
		return () => {
			document.removeEventListener('visibilitychange', onHide);
			removeEventListener('pagehide', flush);
			vv?.removeEventListener('resize', setVh);
			removeEventListener('resize', onResize);
		};
	});

	function edit(patch: Partial<Doc>) {
		if (!doc) return;
		doc = { ...doc, ...patch, updatedAt: Date.now() };
		saver.schedule(doc);
	}

	async function leave() {
		// 離れるとき、空の文書は残さない
		if (doc && isEmpty(doc)) {
			saver.cancel(doc.id);
			await store.remove(doc.id);
		} else {
			await saver.flush();
		}
	}

	async function focusStart() {
		await tick();
		fit(titleEl);
		if (doc?.title === '') titleEl?.focus();
		else view?.focus();
	}

	async function open(next: Doc) {
		await leave();
		doc = next;
		await store.setMeta('last', next.id);
		docsDlg?.close();
		await focusStart();
	}

	async function create() {
		if (doc && isEmpty(doc)) { titleEl?.focus(); return; }
		const d = newDoc();
		await leave();
		await store.put(d);
		doc = d;
		await store.setMeta('last', d.id);
		await focusStart();
	}

	async function showDocs() {
		await saver.flush();
		all = (await store.list()).filter((d) => d.id !== doc?.id || !isEmpty(d));
		armedDelete = null;
		docsDlg?.showModal();
	}

	async function removeDoc(d: Doc) {
		if (armedDelete !== d.id) { armedDelete = d.id; return; }
		armedDelete = null;
		saver.cancel(d.id);
		await store.remove(d.id);
		all = all.filter((x) => x.id !== d.id);
		if (doc?.id === d.id) {
			docsDlg?.close();
			const [next] = await store.list();
			doc = next ?? newDoc();
			if (!next) await store.put(doc);
			await store.setMeta('last', doc.id);
			await focusStart();
		}
	}

	function setStatus(s: Status) {
		if (s === 'public' && doc?.status !== 'public') { confirmPublic = true; return; }
		applyStatus(s);
	}
	function applyStatus(s: Status) {
		confirmPublic = false;
		edit({ status: s, publish: s === 'public' ? { requestedAt: Date.now(), status: 'queued' } : undefined });
		statusDlg?.close();
		view?.focus();
	}
	function openStatus() { confirmPublic = false; statusDlg?.showModal(); }

	function toggleTheme() {
		theme = theme === 'light' ? 'dark' : 'light';
		document.documentElement.dataset.theme = theme;
		try { localStorage.setItem('pnn-theme', theme); } catch {}
		document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1F1512' : '#FCF6F2');
	}

	function backdrop(e: MouseEvent, dlg: HTMLDialogElement | undefined) {
		if (e.target === dlg) dlg.close();
	}

	function fmtDate(t: number) {
		const d = new Date(t);
		return `${d.getMonth() + 1}/${d.getDate()}`;
	}
</script>

<svelte:head><title>{doc && labelOf(doc) ? labelOf(doc) + ' / pnn' : 'pnn'}</title></svelte:head>

<div class="app">
	<div class="col">
		<header class="top">
			<button class="p chip tight" use:press={{ k: 1 }} onclick={openStatus} aria-label="状態">
				<span class="f">{doc ? statusLabel[doc.status] : ''}</span>
			</button>
			<span class="dot" class:saving={saveState === 'saving'} class:error={saveState === 'error'} aria-hidden="true"></span>
			<span class="sp"></span>
			<button class="p chip soft tight" use:press={{ k: 1 }} onclick={showDocs} aria-label="いままで"><span class="f">いままで</span></button>
			<button class="p chip soft icon-only" use:press={{ k: 1.1 }} onclick={create} aria-label="新しく書く"><span class="f"><Icon name="plus" /></span></button>
			<button class="p chip soft icon-only" use:press={{ k: 1.1 }} onclick={toggleTheme} aria-label="明るさ"><span class="f"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></span></button>
		</header>

		{#if doc}
			{#key doc.id}
				<textarea
					class="field title"
					rows="1"
					bind:this={titleEl}
					value={doc.title}
					oninput={(e) => {
						const el = e.currentTarget;
						if (el.value.includes('\n')) el.value = el.value.replace(/\n/g, ' ');
						fit(el);
						edit({ title: el.value });
					}}
					onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); view?.focus(); } }}
					aria-label="題"
					autocomplete="off"
					enterkeyhint="next"
				></textarea>
				<div class="editor">
					<Editor value={doc.body} onchange={(v) => edit({ body: v })} onready={(v) => (view = v)} />
				</div>
			{/key}
		{/if}
	</div>

	<footer class="band" aria-label="装飾">
		<div class="bar">
			{#each bar as b (b.id)}
				<button
					class="p chip soft"
					class:gap={b.gap}
					class:icon-only={!!b.icon}
					use:press={{ k: 1.1 }}
					aria-label={b.title}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => { if (view) { b.run(view); view.focus(); } }}
				><span class="f">{#if b.icon}<Icon name={b.icon} />{:else}{b.label}{/if}</span></button>
			{/each}
		</div>
	</footer>
</div>

<dialog class="dlg" bind:this={statusDlg} onclick={(e) => backdrop(e, statusDlg)}>
	{#if !confirmPublic}
		<div class="row">
			{#each statusOrder as s (s)}
				<button class="p btn" class:soft={doc?.status !== s} use:press onclick={() => setStatus(s)}><span class="f">{statusLabel[s]}</span></button>
			{/each}
		</div>
	{:else}
		<h2>公開？</h2>
		<div class="row end">
			<button class="p btn soft" use:press onclick={() => (confirmPublic = false)}><span class="f">まだ</span></button>
			<button class="p btn" use:press onclick={() => applyStatus('public')}><span class="f">公開する</span></button>
		</div>
	{/if}
</dialog>

<dialog class="dlg wide" bind:this={docsDlg} onclick={(e) => backdrop(e, docsDlg)}>
	<ul class="list">
		{#each all as d (d.id)}
			<li class="item" class:current={d.id === doc?.id}>
				<button class="open" onclick={() => open(d)}>
					<span class="name">{labelOf(d) || '　'}</span>
					<span class="meta">{statusLabel[d.status]} ・ {fmtDate(d.updatedAt)}</span>
				</button>
				<button class="p chip soft tight" use:press onclick={() => removeDoc(d)} aria-label="消す"><span class="f">{armedDelete === d.id ? 'ほんとに' : '消'}</span></button>
			</li>
		{/each}
	</ul>
</dialog>

<style>
	/* 画面: 上から 列（上の列・題・本文）と、下の帯。幅は --measure までで、中央に置く */
	.app {
		position: relative; z-index: var(--z-app);
		height: var(--vh, 100dvh);
		display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto;
		padding-top: env(safe-area-inset-top);
	}
	.col {
		min-height: 0; width: min(var(--measure), 100%); margin-inline: auto;
		padding-inline: var(--gutter);
		display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr);
	}

	/* 上の列: 折り返さない。幅が足りないときは、余白を詰める（--gutter と .tight） */
	.top { display: flex; flex-wrap: nowrap; align-items: center; gap: var(--gap); padding-block: var(--s3); }
	.sp { flex: 1; min-width: 0; }
	.dot { flex: none; width: var(--s2); height: var(--s2); border-radius: 50%; background: var(--mint); transition: background-color .2s; margin-left: var(--s1); }
	.dot.saving { background: var(--card); }
	.dot.error { background: var(--card-red); box-shadow: 0 0 var(--s2) rgb(var(--glow)); }

	.title { padding-block: var(--s3) var(--s2); }
	.editor { min-height: 0; }

	/* 下の帯: 全幅の直角の面。中の列は --measure に揃え、横にスクロールする。右端は、続きがあることを、ぼかして示す */
	.band { padding-bottom: env(safe-area-inset-bottom); }
	.bar {
		width: min(var(--measure), 100%); margin-inline: auto;
		display: flex; flex-wrap: nowrap; gap: var(--gap);
		overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch;
		padding: var(--s2) var(--gutter);
		scroll-padding-inline: var(--gutter);
		-webkit-mask-image: linear-gradient(to right, #000 calc(100% - var(--s6)), transparent);
		mask-image: linear-gradient(to right, #000 calc(100% - var(--s6)), transparent);
	}
	.bar::-webkit-scrollbar { display: none; }
	.bar .gap { margin-left: var(--s3); }
	.bar::after { content: ''; flex: none; width: var(--s5); }

	.row { display: flex; flex-wrap: wrap; gap: var(--s3); }
	.row.end { justify-content: flex-end; }

	.list { list-style: none; padding: 0; display: grid; gap: var(--s2); }
	.item { display: flex; gap: var(--s2); align-items: center; }
	.open {
		flex: 1; min-width: 0; text-align: left; border: 0; cursor: pointer;
		background: var(--ring); padding: var(--s3) var(--s4); border-radius: var(--r-card);
		display: grid; gap: var(--s1); min-height: var(--tap);
	}
	.item.current .open { background: var(--bit); }
	.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.meta { color: var(--soft); }
</style>
