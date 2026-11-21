-- 専門家（批評家）の評価欄（docs/critics-plan.md の 1.1）。足すだけ。
-- 作品に、OpenCritic の作品 ID と、最後に取得した日時。
ALTER TABLE works ADD COLUMN opencritic_id INTEGER;
ALTER TABLE works ADD COLUMN critic_synced_at TEXT;
CREATE UNIQUE INDEX works_opencritic ON works (opencritic_id) WHERE opencritic_id IS NOT NULL;

-- 専門家のレビューの、読み取りの結果。抜粋・題名・著者・点数は、持たない。
CREATE TABLE critic_reviews (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works (id),
  oc_review_id TEXT NOT NULL,
  outlet TEXT NOT NULL,
  url TEXT NOT NULL,
  published_on TEXT,
  question_set_id INTEGER NOT NULL REFERENCES question_sets (id),
  read_at TEXT NOT NULL,
  UNIQUE (work_id, oc_review_id)
);
CREATE INDEX critic_reviews_work ON critic_reviews (work_id, published_on);

-- 質問ごとの答え（reading_answers と同じ形。タグの列は、ない）。
CREATE TABLE critic_answers (
  critic_review_id TEXT NOT NULL REFERENCES critic_reviews (id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  aspect TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('direction', 'mention', 'star')),
  value TEXT NOT NULL,
  prob REAL NOT NULL,
  probs_json TEXT,
  PRIMARY KEY (critic_review_id, question_key)
);

-- 自動の候補（作品名で検索した、いちばん上の 1 件）。運営者が承認すると、works.opencritic_id に入る。
CREATE TABLE critic_candidates (
  work_id TEXT PRIMARY KEY REFERENCES works (id),
  oc_id INTEGER NOT NULL,
  oc_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected')),
  created_at TEXT NOT NULL
);
