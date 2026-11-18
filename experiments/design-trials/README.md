# デザインの試しの案

アプリには、組み込まない。実画面に、スタイルを上書きして、スクリーンショットで比べるための置き場。

- `mono.css`: 灰色の濃淡と白黒に、差し色を1色（orange / red / pink / cyan）だけ載せる案。評価の棒は、赤と緑のまま。角は、レイアウトの面だけ直角。
- 使い方（Playwright）: 画面を開き、`page.addStyleTag({ content: <mono.css の中身> })` と、`document.documentElement.dataset.accent = 'orange'` を実行する。ダークは、`colorScheme: 'dark'`。
- 経緯と判断は、`docs/mvp-design.md` の18章。
