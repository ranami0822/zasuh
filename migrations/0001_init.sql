-- Zasuh の最初のスキーマ（docs/mvp-design.md の3章）。
-- id は、アプリ側で作る UUID（TEXT）。日時は、ISO 8601 の UTC（TEXT）。

CREATE TABLE works (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('software', 'game')),
  url TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden')),
  created_at TEXT NOT NULL
);

-- タグ（版つき）。定義はコード（src/lib/server/tags.ts）が正で、ここにはその写しとハッシュを残す。
-- 同じ版なのに定義が変わっていたら、読み取りを止める（過去の結果と意味がずれるため）。
CREATE TABLE tags (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  definition_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, version)
);

-- 作品が選んだタグ。分野のタグ（ゲームなら4つ）は、ここに入れなくても自動で付く。
CREATE TABLE work_tags (
  work_id TEXT NOT NULL REFERENCES works (id),
  tag_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (work_id, tag_id)
);

-- 質問セット。1回の問い合わせに入れた、タグ（と版）の組と、質問の並び。
-- 同じ問い合わせに入る質問は互いに影響するので、組と順序ごとに1行にして、読み取りに記録する。
CREATE TABLE question_sets (
  id INTEGER PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 投稿者。MVP では匿名の端末トークン（ハッシュ）だけを持つ。
CREATE TABLE reviewers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('anon', 'passkey')),
  token_hash TEXT UNIQUE,
  created_at TEXT NOT NULL
);

-- レビュー。本文は review_revisions にあり、current_revision_id が最新の版を指す。
-- （相互参照になるので、current_revision_id に外部キーは付けていない。）
CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works (id),
  reviewer_id TEXT NOT NULL REFERENCES reviewers (id),
  current_revision_id TEXT NOT NULL,
  written_on TEXT NOT NULL,
  disclosure TEXT NOT NULL DEFAULT 'none'
    CHECK (disclosure IN ('none', 'developer', 'affiliated', 'other')),
  disclosure_note TEXT,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX reviews_work ON reviews (work_id);

-- レビュー本文の版。編集のたびに1行増える。
CREATE TABLE review_revisions (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews (id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX review_revisions_review ON review_revisions (review_id);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews (id),
  reporter_id TEXT REFERENCES reviewers (id),
  reason TEXT NOT NULL CHECK (reason IN ('abuse', 'spam', 'conflict', 'other')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL
);
CREATE INDEX reports_status ON reports (status);

-- レビューの1つの版を、1つの質問セットで読んだ結果。
-- running: 読み取り中（next_attempt_at までは、ほかの処理が手を出さない）
-- error:   失敗（attempts が上限未満なら、next_attempt_at 以降にやり直す）
CREATE TABLE readings (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES review_revisions (id),
  question_set_id INTEGER NOT NULL REFERENCES question_sets (id),
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  latency_ms INTEGER,
  input_tokens INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (revision_id, question_set_id)
);

-- 質問ごとの答え。観点の列ではなく「質問のキーと値」で持つ（質問を後から足せるように）。
-- kind = 'direction': value は positive / negative / mixed / none、prob はその確率
-- kind = 'mention':   value は true / false、prob は「具体的な記述がある」確率
CREATE TABLE reading_answers (
  reading_id TEXT NOT NULL REFERENCES readings (id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  tag_version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  prob REAL NOT NULL,
  probs_json TEXT,
  needs_check INTEGER NOT NULL DEFAULT 0 CHECK (needs_check IN (0, 1)),
  PRIMARY KEY (reading_id, question_key)
);

-- 集計（作品 × タグ）。tag_id = '_overall' は、全タグの言及をまとめたもの。
-- 利害関係のあるレビューと、非表示のレビューは含めない。
-- タグの版や、一緒に聞いた質問の組が違う読み取りも、同じタグなら合算する（読み直しをしない方針のため）。
CREATE TABLE aspect_stats (
  work_id TEXT NOT NULL REFERENCES works (id),
  tag_id TEXT NOT NULL,
  n_mention INTEGER NOT NULL,
  n_pos INTEGER NOT NULL,
  n_neg INTEGER NOT NULL,
  n_mix INTEGER NOT NULL,
  score_lower REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (work_id, tag_id)
);
