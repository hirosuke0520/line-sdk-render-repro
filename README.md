# line-sdk-render-repro

Render上で `@line/bot-sdk` middleware と raw body の差分を検証するための再現サーバーです。

## Endpoints

- `GET /healthz`: ヘルスチェック
- `GET /last`: 直近リクエストのメモリ内ログ
- `POST /webhook`: `express.json()` 後に `@line/bot-sdk` middleware を通す再現用ルート
- `POST /webhook-sdk-first`: `@line/bot-sdk` middleware を先に通す比較用ルート
- `POST /webhook-raw`: `express.raw()` で生bodyを検証する比較用ルート

`/webhook` はエラー時も意図的にHTTP 200を返します。先方Renderが「200だがアプリ処理ログ/返信なし」に見えるケースの再現確認用です。

## Environment

- `LINE_CHANNEL_SECRET`: LINE channel secret
- `LINE_CHANNEL_ACCESS_TOKEN`: LINE reply APIを実際に叩く場合のみ設定
- `REPLY_TO_LINE`: `1` の場合だけLINEへ返信します。デフォルトは `0` です。
