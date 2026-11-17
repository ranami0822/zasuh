-- 受信箱: 作品の追加依頼、お問い合わせ、異議申し立て（docs/mvp-design.md の15章）。
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('work_request', 'contact', 'dispute')),
  body TEXT NOT NULL,
  -- 追加依頼のときの、作品名・分野・リンク。ほかの種類では空。
  work_name TEXT,
  category TEXT CHECK (category IS NULL OR category IN ('software', 'game')),
  url TEXT,
  -- 任意の連絡先。書いた人が、書きたいときだけ書く（メールでも何でもよい）。
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  sender_id TEXT REFERENCES reviewers (id),
  ip_day_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX messages_status ON messages (status, created_at);
CREATE INDEX messages_sender ON messages (sender_id, created_at);
CREATE INDEX messages_ip_day ON messages (ip_day_hash);
