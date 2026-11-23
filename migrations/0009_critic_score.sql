-- 専門家のレビューの、媒体の点数（0〜100にそろえたもの）。**画面には出さない。**
-- AI が読んだ星と、大きくずれた抜粋を、集計から外す目安にだけ使う（docs/mvp-design.md の 22.12。ユーザーの決定、2026-11-23）。
-- NULL は、点数がない（点数をつけない媒体）、または、読めなかったもの。足すだけ（既存の行は、NULL のまま）。
ALTER TABLE critic_reviews ADD COLUMN oc_score INTEGER;
