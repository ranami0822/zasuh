<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorState } from '@codemirror/state';
	import { EditorView, keymap } from '@codemirror/view';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
	import { live, liveTheme } from './editor/live';

	let { value, onchange, onready }: { value: string; onchange: (v: string) => void; onready: (v: EditorView) => void } = $props();
	let host: HTMLDivElement;

	onMount(() => {
		const view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: value,
				extensions: [
					history(),
					keymap.of([...defaultKeymap, ...historyKeymap]),
					markdown({ base: markdownLanguage }),
					EditorView.lineWrapping,
					live,
					liveTheme,
					EditorView.contentAttributes.of({ 'aria-label': '本文', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'enter' }),
					EditorView.updateListener.of((u) => {
						if (u.docChanged) onchange(u.state.doc.toString());
					})
				]
			})
		});
		onready(view);
		return () => view.destroy();
	});
</script>

<div class="host" bind:this={host}></div>

<style>
	.host { height: 100%; min-height: 0; }
</style>
