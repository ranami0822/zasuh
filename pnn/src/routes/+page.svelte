<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { EditorView } from '@codemirror/view';
	import { redo, undo } from '@codemirror/commands';
	import Editor from '../lib/Editor.svelte';
	import { press } from '../lib/press';
	import { createIdbStore } from '../lib/store';
	import { createSaver, type SaveState } from '../lib/saver';
	import { isEmpty, labelOf, newDoc, openInitial, statusLabel, statusOrder } from '../lib/docs';
	import { insertRule, insertText, today, toggleLinePrefix, toggleWrap } from '../lib/editor/commands';
	import type { Doc, Status } from '../lib/types';

	const store = createIdbStore();
	let saveState = $state<SaveState>('ok');
	const saver = createSaver(store, { onState: (s) => (saveState = s) });

	let doc = $state.raw<Doc | null>(null);
	let all = $state.raw<Doc[]>([]);
	let view: EditorView | undefined;
	let titleEl: HTMLInputElement | undefined = $state();
	let statusDlg: HTMLDialogElement | undefined = $state();
	let docsDlg: HTMLDialogElement | undefined = $state();
	let confirmPublic = $state(false);
	let armedDelete = $state<string | null>(null);
	let theme = $state<'light' | 'dark'>('light');

	onMount(() => {
		theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
		(async () => {
			doc = await openInitial(store);
			await tick();
			if (doc.title === '') titleEl?.focus();
			else view?.focus();
		})();

		// 閉じる前、隠れる前に、待っているものを書き出す
		const flush = () => void saver.flush();
		const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
		document.addEventListener('visibilitychange', onHide);
		addEventListener('pagehide', flush);

		// キーボードが出ても、下の装飾バーが見える高さに合わせる（iOS）
		const vv = window.visualViewport;
		const fit = () => document.documentElement.style.setProperty('--vh', (vv?.height ?? innerHeight) + 'px');
		fit();
		vv?.addEventListener('resize', fit);
		return () => {
			document.removeEventListener('visibilitychange', onHide);
			removeEventListener('pagehide', flush);
			vv?.removeEventListener('resize', fit);
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

	async function open(next: Doc) {
		await leave();
		doc = next;
		await store.setMeta('last', next.id);
		docsDlg?.close();
		await tick();
		if (next.title === '') titleEl?.focus();
		else view?.focus();
	}

	async function create() {
		if (doc && isEmpty(doc)) { titleEl?.focus(); return; }
		const d = newDoc();
		await leave();
		await store.put(d);
		doc = d;
		await store.setMeta('last', d.id);
		await tick();
		titleEl?.focus();
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

	const bar: { label: string; title: string; run: (v: EditorView) => void; gap?: boolean }[] = [
		{ label: '↶', title: '戻す', run: (v) => void undo(v) },
		{ label: '↷', title: '進む', run: (v) => void redo(v) },
		{ label: '見出し', title: '見出し', run: (v) => toggleLinePrefix(v, '# ') },
		{ label: '太字', title: '太字', run: (v) => toggleWrap(v, '**') },
		{ label: '傾き', title: '傾き', run: (v) => toggleWrap(v, '*') },
		{ label: '取消', title: '取り消し線', run: (v) => toggleWrap(v, '~~') },
		{ label: '引用', title: '引用', run: (v) => toggleLinePrefix(v, '> ') },
		{ label: '箇条', title: '箇条書き', run: (v) => toggleLinePrefix(v, '- ') },
		{ label: '区切り', title: '区切り線', run: (v) => insertRule(v) },
		{ label: '「」', title: '「」', run: (v) => insertText(v, '「」', 1), gap: true },
		{ label: '『』', title: '『』', run: (v) => insertText(v, '『』', 1) },
		{ label: '……', title: '……', run: (v) => insertText(v, '……') },
		{ label: '※', title: '※', run: (v) => insertText(v, '※') },
		{ label: '♡', title: '♡', run: (v) => insertText(v, '♡') },
		{ label: '❤', title: '❤', run: (v) => insertText(v, '❤') },
		{ label: '日付', title: '今日の日付', run: (v) => insertText(v, today()) }
	];

	function fmtDate(t: number) {
		const d = new Date(t);
		return `${d.getMonth() + 1}/${d.getDate()}`;
	}
</script>

<svelte:head><title>{doc && labelOf(doc) ? labelOf(doc) + ' / pnn' : 'pnn'}</title></svelte:head>

<div class="app">
	<header class="top">
		<button class="p chip" use:press={{ k: 1 }} onclick={openStatus} aria-label="状態">
			<span class="f">{doc ? statusLabel[doc.status] : ''}</span>
		</button>
		<span class="dot" class:saving={saveState === 'saving'} class:error={saveState === 'error'} aria-hidden="true"></span>
		<span class="sp"></span>
		<button class="p chip soft" use:press={{ k: 1 }} onclick={showDocs} aria-label="いままで"><span class="f">いままで</span></button>
		<button class="p chip soft" use:press={{ k: 1.1 }} onclick={create} aria-label="新しく書く"><span class="f">＋</span></button>
		<button class="p chip soft" use:press={{ k: 1.1 }} onclick={toggleTheme} aria-label="明るさ"><span class="f">{theme === 'dark' ? '☀' : '☾'}</span></button>
	</header>

	{#if doc}
		{#key doc.id}
			<input
				class="title"
				bind:this={titleEl}
				value={doc.title}
				oninput={(e) => edit({ title: e.currentTarget.value })}
				onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); view?.focus(); } }}
				aria-label="題"
				autocomplete="off"
				enterkeyhint="next"
			/>
			<div class="editor">
				<Editor value={doc.body} onchange={(v) => edit({ body: v })} onready={(v) => (view = v)} />
			</div>
		{/key}
	{/if}

	<footer class="bar" aria-label="装飾">
		{#each bar as b (b.label)}
			<button
				class="p chip soft"
				class:gap={b.gap}
				use:press={{ k: 1.1 }}
				aria-label={b.title}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => { if (view) { b.run(view); view.focus(); } }}
			><span class="f">{b.label}</span></button>
		{/each}
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
				<button class="p chip soft" use:press onclick={() => removeDoc(d)} aria-label="消す"><span class="f">{armedDelete === d.id ? 'ほんとに' : '消'}</span></button>
			</li>
		{/each}
	</ul>
</dialog>

<style>
	.app {
		position: relative; z-index: 2;
		height: var(--vh, 100dvh);
		display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto;
		max-width: 720px; margin: 0 auto;
		padding: env(safe-area-inset-top) 18px env(safe-area-inset-bottom);
	}
	.top { display: flex; align-items: center; gap: 10px; padding: 14px 0 8px; }
	.sp { flex: 1; }
	.chip { padding: 8px 18px; }
	.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--mint); transition: background-color .2s; }
	.dot.saving { background: var(--card); }
	.dot.error { background: var(--card-red); box-shadow: 0 0 8px rgb(var(--glow)); }

	.title {
		width: 100%; border: 0; outline: 0; background: transparent; color: var(--ink);
		font-size: 32px; line-height: 1.4; padding: 10px 2px 6px; caret-color: var(--card-red);
	}
	.editor { min-height: 0; }

	.bar {
		display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none;
		padding: 10px 6px 12px; margin: 0 -18px; padding-inline: 18px;
		background: var(--face); border-radius: var(--r-pill) var(--r-pill) 0 0;
		box-shadow: 0 -6px 24px rgb(var(--shade) / .14);
		-webkit-overflow-scrolling: touch;
	}
	.bar::-webkit-scrollbar { display: none; }
	.bar .chip { flex: none; }
	.bar .gap { margin-left: 12px; }

	/* ダイアログは直角。線は使わず、面の色と影で区切る */
	.dlg {
		border: 0; border-radius: 0; background: var(--face); color: var(--ink);
		padding: 24px; width: min(420px, calc(100vw - 36px));
		box-shadow: 0 0 60px rgb(var(--shade) / .35);
		margin: auto;
	}
	.dlg::backdrop { background: rgb(var(--shade) / .35); }
	.dlg.wide { width: min(560px, calc(100vw - 36px)); max-height: 80vh; }
	.dlg h2 { font-size: 32px; font-weight: 400; margin-bottom: 18px; }
	.row { display: flex; flex-wrap: wrap; gap: 12px; }
	.row.end { justify-content: flex-end; }
	.btn { padding: 14px 30px; }

	.list { list-style: none; padding: 0; display: grid; gap: 10px; }
	.item { display: flex; gap: 10px; align-items: center; }
	.open {
		flex: 1; min-width: 0; text-align: left; border: 0; cursor: pointer;
		background: var(--ring); padding: 12px 18px; border-radius: 28px;
		display: grid; gap: 2px;
	}
	.item.current .open { background: var(--bit); }
	.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.meta { color: var(--soft); }
</style>
