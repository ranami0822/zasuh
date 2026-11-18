<script lang="ts">
	import Footer from '#components/Footer.svelte';
	import Header from '#components/Header.svelte';
	import Meta from '#components/Meta.svelte';
</script>

<Meta title="プライバシー" description="Zasuh が保存する情報と、その使い道。" />

<div class="page">
	<Header />
	<h1>プライバシー</h1>
	<p class="muted">最終更新: 2026年11月17日</p>

	<div class="panel prose">
		<section>
			<h2>保存する情報</h2>
			<ul>
				<li><strong>レビュー</strong>: 本文、投稿した日、利害関係の申告とメモ。編集の履歴（以前の本文）も、サービスの内部に残します。表示するのは、最新の本文だけです。</li>
				<li><strong>端末の印</strong>: 投稿や通報をしたときに、ブラウザに、ランダムな文字列（Cookie「zs_device」、1年）を保存します。サービス側には、その文字列のハッシュだけを保存します。自分のレビューを、編集できるようにするためと、投稿の回数の上限のためです。Cookie を消すと、自分のレビューを、編集できなくなります。</li>
				<li><strong>送信元の印</strong>: IP アドレスそのものは、保存しません。1日ごとに変わる鍵で作ったハッシュだけを、投稿・通報・お問い合わせに付けて保存します。1日の回数の上限のためで、翌日には、同じ IP でも、別の値になります。</li>
				<li><strong>パスキー</strong>（ログインしたとき）: パスキーの公開鍵、種類、登録した日と最後に使った日。秘密鍵は、あなたの端末（または、パスワード管理の同期）にあり、Zasuh には、送られません。ログイン中の端末の印（Cookie）は、30日で切れます。</li>
				<li><strong>メールアドレス</strong>（任意）: パスキーを使えなくなったときの復旧の連絡のためだけに、登録したアドレスを保存します。確認のリンクを開くまでは、復旧に使いません。アカウントのページで、いつでも消せます。ほかの目的には、使いません。</li>
				<li><strong>お問い合わせ</strong>: 内容と、書いた場合だけ、連絡先。</li>
				<li><strong>AI の読み取りの結果</strong>: レビューごとの、観点ごとの向きと確率。</li>
			</ul>
			<p>名前は、集めていません。メールアドレスは、復旧用に登録した場合だけ、保存します。</p>
		</section>
		<section>
			<h2>使い道</h2>
			<p>レビューの表示、AI による読み取りと集計、荒らしの防止、お問い合わせへの対応のためだけに使います。広告には、使いません。</p>
		</section>
		<section>
			<h2>AI による読み取り</h2>
			<p>レビューの本文は、AI で読み取るために、Cloudflare の Workers AI（Clef）に送られます。Cloudflare は、このモデルについて、データを保持しない（zero data retention）としています。</p>
		</section>
		<section>
			<h2>外部のサービス</h2>
			<ul>
				<li><strong>Cloudflare</strong>: このサービスを動かし、データを保存し、復旧のメールを送ります。アクセスの記録が、Cloudflare に残ります。</li>
				<li><strong>Google Fonts</strong>: 文字の表示のために、ページを開くと、閲覧者の IP アドレスとブラウザの情報が、Google に送られます。</li>
			</ul>
			<p>ほかに、保存した情報を、第三者に渡すことは、法令に基づく場合を除いて、ありません。</p>
		</section>
		<section>
			<h2>削除</h2>
			<p>自分のレビューの削除、お問い合わせの内容の削除は、<a href="/contact?kind=dispute">お問い合わせ</a>から、依頼してください。</p>
		</section>
	</div>
	<Footer />
</div>
