-- passkey ログインと、メールでの復旧（docs/mvp-design.md の16章）。

-- アカウントごとの、ランダムな識別子（WebAuthn の userHandle）。名前やメールは入れない。
ALTER TABLE reviewers ADD COLUMN user_handle TEXT;

-- パスキー。クレデンシャル ID は、全体で一意（すでにあるものを、上書きしない）。
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  reviewer_id TEXT NOT NULL REFERENCES reviewers (id),
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX credentials_reviewer ON credentials (reviewer_id);

-- WebAuthn のチャレンジ。一度使ったら消す。ref は、復旧の登録のときの、メールのリンクのハッシュ。
CREATE TABLE challenges (
  challenge TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'stepup', 'recover')),
  reviewer_id TEXT,
  ref TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ログイン中の端末（パスキーのアカウントの端末）。期限つきで、サーバー側で取り消せる。
CREATE TABLE device_tokens (
  token_hash TEXT PRIMARY KEY,
  reviewer_id TEXT NOT NULL REFERENCES reviewers (id),
  expires_at TEXT NOT NULL,
  stepup_until TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX device_tokens_reviewer ON device_tokens (reviewer_id);

-- 復旧用のメールアドレス（任意）。確認するまでは、使わない。確認済みのアドレスは、1つのアカウントにだけ結びつく。
CREATE TABLE account_emails (
  reviewer_id TEXT PRIMARY KEY REFERENCES reviewers (id),
  email TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX account_emails_verified ON account_emails (email) WHERE verified_at IS NOT NULL;

-- メールで送るリンク（確認、復旧）。ハッシュだけを保存し、一度使うと無効。
CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'recover')),
  reviewer_id TEXT NOT NULL REFERENCES reviewers (id),
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  ip_day_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX email_tokens_email ON email_tokens (email, created_at);
CREATE INDEX email_tokens_ip ON email_tokens (ip_day_hash);
