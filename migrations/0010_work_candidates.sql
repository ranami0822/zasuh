-- 作品の候補（OpenCritic の一覧から自動で見つけたもの）。運営者が承認すると、作品になる（docs/mvp-design.md の 25 章）。
-- 作品の自動生成はしない（22.1）。承認が、作品を作る唯一の入口。
-- wiki_* は、日本語版 Wikipedia の要約（承認すると、作品の紹介文になる）。見つからなければ NULL。
CREATE TABLE work_candidates (
  oc_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  wiki_title TEXT,
  wiki_extract TEXT,
  wiki_url TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected')),
  created_at TEXT NOT NULL
);

-- 紹介文の出典（Wikipedia の記事名と URL）。NULL は、運営者が自分で書いた紹介文。足すだけ。
ALTER TABLE works ADD COLUMN summary_source_title TEXT;
ALTER TABLE works ADD COLUMN summary_source_url TEXT;
