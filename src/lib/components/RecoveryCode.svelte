<script lang="ts">
	import { Button } from '@ui-sdk/svelte/button';
	import { toast } from '@ui-sdk/svelte/toast';

	let { code, onsaved }: { code: string; onsaved: () => void } = $props();

	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			toast.success('コピーしました', { duration: 3000 });
		} catch {
			toast.error('コピーできませんでした。手で書き写してください。', { duration: 5000 });
		}
	}
</script>

<section class="panel" aria-label="復旧コード">
	<h2>復旧コード</h2>
	<p class="banner warning">このコードは、いまだけ表示します。パスキーが使えなくなったときに、これでアカウントを取り戻せます。パスワード管理アプリか紙に控えてください。</p>
	<p class="code num" data-testid="recovery-code">{code}</p>
	<div class="row">
		<Button class="btn quiet" onclick={copy}>コピーする</Button>
		<Button class="btn" onclick={onsaved}>控えました</Button>
	</div>
</section>
