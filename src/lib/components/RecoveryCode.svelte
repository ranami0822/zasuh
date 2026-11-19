<script lang="ts">
	import { Button } from '@ui-sdk/svelte/button';
	import { toast } from '@ui-sdk/svelte/toast';

	let { code, onsaved }: { code: string; onsaved: () => void } = $props();

	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			toast('コピーしました', { duration: 3000 });
		} catch {
			toast.error('コピーできませんでした。手で書き写してください。', { duration: 5000 });
		}
	}
</script>

<section class="panel" aria-label="復旧コード">
	<h2>復旧コード</h2>
	<p class="banner warning">このコードは、今回だけ表示します。パスキーを使えなくなったときに、これで復旧します。パスワード管理か、紙に、保存してください。</p>
	<p class="code num" data-testid="recovery-code">{code}</p>
	<div class="row">
		<Button class="btn quiet" onclick={copy}>コピーする</Button>
		<Button class="btn" onclick={onsaved}>保存しました</Button>
	</div>
</section>
