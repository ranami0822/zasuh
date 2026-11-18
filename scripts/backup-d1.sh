#!/usr/bin/env bash
# 本番の D1 を、SQL ファイルに書き出す（バックアップ）。D1 の Time Travel（30日）とは別に、手元に残すための手順。
# 使い方: CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID を設定して、npm run db:backup
# 出力: backups/zasuh-<日時>.sql（.gitignore 済み。レビュー本文を含むので、リポジトリには入れない）
set -euo pipefail
mkdir -p backups
out="backups/zasuh-$(date -u +%Y%m%dT%H%M%SZ).sql"
npx wrangler d1 export zasuh --remote --output "$out"
echo "書き出しました: $out"
