# REWIS Cloudflare Workers 手順書

このフォルダは、GitHub Pages のまま editor だけ保存認証を有効にするための API です。

- GitHub Pages: 画面表示と通常の静的配信
- Cloudflare Worker: 認証と外部正本への保存
- editor: 保存時のみ ID/パスワードを送信して保存

## 0. 概要と保存場所

このセットアップは以下の 3 層で構成されます：

```
[ editor (GitHub Pages) ]
        ↓ (保存時のみ認証)
[ Cloudflare Worker API ]
        ↓
[ Cloudflare KV ストレージ ]
```

### 情報の保存場所

| 情報 | 保存場所 | 設定方法 | 用途 |
|------|---------|---------|------|
| ユーザーID / ハッシュ | Cloudflare Secret | `wrangler secret put AUTH_USERS_JSON` | 認証 |
| salt | Cloudflare Secret | `wrangler secret put PASSWORD_SALT` | ハッシュ化 |
| データ | Cloudflare KV | 自動保存 | 正本 |
| トークン | Cloudflare KV (TTL付) | 自動生成 | セッション |
| ALLOWED_ORIGIN | wrangler.toml | 手動編集 | CORS制御 |
| KV ID | wrangler.toml | 手動編集 | バインディング |

## 1. 事前準備

1. Cloudflare アカウントを作成
2. Node.js をインストール
3. Cloudflare CLI をインストール

PowerShell 例:

```powershell
npm.cmd install -g wrangler
wrangler login
```

## 2. KV を作成

1. データ保存用 KV を作成
2. トークン保存用 KV を作成

PowerShell 例:

```powershell
wrangler kv namespace create DATA_KV
```

出力例:

```
✓ Created KV namespace DATA_KV
id = "2fac11df14294dbabe14eeef77abb063"
```

2 つ目を作成:

```powershell
wrangler kv namespace create TOKEN_KV
```

出力された 2 つの id を **wrangler.toml** に設定します。

wrangler.toml を開き、[[kv_namespaces]] セクションを編集：

```toml
[[kv_namespaces]]
binding = "DATA_KV"
id = "output-from-data-kv-create"

[[kv_namespaces]]
binding = "TOKEN_KV"
id = "output-from-token-kv-create"
```

## 3. パスワードハッシュを作成

この Worker は平文パスワードを保存しません。

ハッシュは次の計算です。

SHA-256( password + PASSWORD_SALT )

### パスワードハッシュ作成方法

**方法①：PowerShell（推奨）**

重要：「コマンドプロンプト」ではなく「PowerShell」を使用してください。

1. Windows メニュー → 「PowerShell」検索 → 「Windows PowerShell」を開く
2. 以下をコピーして貼り付け（salt と password は好きな値に変更）

```powershell
$Salt = "my-secret-salt-12345-change-this"
$Password = "my-strong-password"
$Text = $Password + $Salt
$Bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
$Sha = [System.Security.Cryptography.SHA256]::Create()
$Hash = $Sha.ComputeHash($Bytes)
($Hash | ForEach-Object { $_.ToString("x2") }) -join ""
```

3. Enter を押す
4. 出力された 64 文字の文字列（16進数）をメモ帳へコピー

出力例：
```
d41d8cd98f00b204e9800998ecf8427e5e0f2b8f4f7e6f5d4c3b2a1f0e9d8c7b
```

**方法②：Node.js（npm.cmd がある場合）**

PowerShell で実行：

```powershell
node -e "const crypto = require('crypto'); const salt = 'my-secret-salt-12345-change-this'; const pwd = 'my-strong-password'; console.log(crypto.createHash('sha256').update(pwd + salt).digest('hex'));"
```

**方法③：このリポジトリのスクリプトを使用（最も簡単）**

事前に npm.cmd でパッケージをインストール：

```powershell
npm.cmd install
```

その後、PowerShell で実行：

```powershell
node generate-hash.js
```

または、パスワードと salt を指定：

```powershell
node generate-hash.js "my-strong-password" "my-secret-salt-12345"
```

複数ユーザーの例も表示されます。

**方法④：スクリプトファイルを保存して再利用**

1. メモ帳を開き、以下を貼り付け：

```powershell
param(
    [string]$Password = "my-strong-password",
    [string]$Salt = "my-secret-salt-12345-change-this"
)

$Text = $Password + $Salt
$Bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
$Sha = [System.Security.Cryptography.SHA256]::Create()
$Hash = $Sha.ComputeHash($Bytes)
$Result = ($Hash | ForEach-Object { $_.ToString("x2") }) -join ""
Write-Host "Hash: $Result"
```

2. `hash-generator.ps1` として保存
3. PowerShell で実行：

```powershell
.\hash-generator.ps1
```

### 複数ユーザーの設定例

AUTH_USERS_JSON にはユーザー一覧を配列で設定します。各ユーザーのハッシュを方法①で計算してください。

```json
[
  {"userId":"admin","passwordHash":"d41d8cd98f00b204e9800998ecf8427e5e0f2b8f4f7e6f5d4c3b2a1f0e9d8c7b"},
  {"userId":"editor1","passwordHash":"a1b2c3d4e5f6789012345678901234567890abcdef1234567890123456789"},
  {"userId":"editor2","passwordHash":"f1e2d3c4b5a6978069584738271605940373829156029384756038291058342"}
]
```

## 4. シークレットを設定（Cloudflare に登録）

ユーザー情報と salt は Cloudflare の KV ではなく、**シークレット（Secret）** として登録します。

### 4-1. PASSWORD_SALT を設定

salt は好きな長くてランダムな文字列を作ります。例：`my-secret-salt-abc123-xyz789`

PowerShell で実行：

```powershell
wrangler secret put PASSWORD_SALT
```

実行すると対話的プロンプトが出ます。salt の値を入力して Enter：

```
? Enter a secret value: › my-secret-salt-abc123-xyz789
```

### 4-2. AUTH_USERS_JSON を設定

步骤3で生成したハッシュを使って、JSON 配列を作ります。

例（1ユーザーの場合）：

```powershell
wrangler secret put AUTH_USERS_JSON
```

プロンプトに以下を貼り付け：

```json
[{"userId":"admin","passwordHash":"d41d8cd98f00b204e9800998ecf8427e5e0f2b8f4f7e6f5d4c3b2a1f0e9d8c7b"}]
```

例（複数ユーザーの場合）：

```json
[
  {"userId":"admin","passwordHash":"d41d8cd98f00b204e9800998ecf8427e5e0f2b8f4f7e6f5d4c3b2a1f0e9d8c7b"},
  {"userId":"editor1","passwordHash":"a1b2c3d4e5f6789012345678901234567890abcdef1234567890123456789"},
  {"userId":"editor2","passwordHash":"f1e2d3c4b5a6978069584738271605940373829156029384756038291058342"}
]
```

### 4-3. vars を wrangler.toml で設定

ALLOWED_ORIGIN と TOKEN_TTL_SECONDS は環境変数として wrangler.toml に設定します。

wrangler.toml を開き、[vars] セクションを以下のように確認・編集：

```toml
[vars]
ALLOWED_ORIGIN = "https://yourname.github.io"
TOKEN_TTL_SECONDS = "1800"
```

- ALLOWED_ORIGIN: あなたの GitHub Pages の URL に変更してください（カンマ区切りで複数指定可）
  - これとは別に、ローカル開発用の `http://localhost` / `http://127.0.0.1`、自宅LAN `10.0.1.0/24`、Tailscale `100.64.0.0/10` の http オリジンは任意のポートで常に許可されます（`worker/src/index.js` の `isLocalDevOrigin()`）
- TOKEN_TTL_SECONDS: トークンの有効秒数（デフォルト 1800秒 = 30分）

### 4-4.（オプション）ローカル開発用に .dev.vars を設定

`wrangler dev` でローカルテストする場合、.dev.vars ファイルを使用できます。

`.dev.vars.example` を参考に、`.dev.vars` ファイルを作成：

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` の内容を編集し、あなたの salt と AUTH_USERS_JSON を設定：

```
PASSWORD_SALT='your-secret-salt-here'
AUTH_USERS_JSON='[{"userId":"admin","passwordHash":"your-hash-here"}]'
ALLOWED_ORIGIN='https://yourname.github.io'
TOKEN_TTL_SECONDS='1800'
```

注意: `.dev.vars` は `.gitignore` に登録されているため、リポジトリには上がりません。

### 4-5. デプロイ前のチェックリスト

デプロイする前に以下を確認してください：

```powershell
# シークレットが登録されたか確認
wrangler secret list
```

出力例:

```
┌────────────────────┐
│ name               │
├────────────────────┤
│ PASSWORD_SALT      │
├────────────────────┤
│ AUTH_USERS_JSON    │
└────────────────────┘
```

チェックリスト：

- [ ] PASSWORD_SALT が登録されている
- [ ] AUTH_USERS_JSON が登録されている
- [ ] wrangler.toml の ALLOWED_ORIGIN が正しい（あなたの GitHub Pages URL）
- [ ] wrangler.toml の KV namespace id が 2 つ設定されている
- [ ] generate-hash.js で passwordHash を生成済み
- [ ] AUTH_USERS_JSON に複数ユーザーを設定（必要に応じて）

## 5. デプロイ

PowerShell 例:

wrangler deploy

デプロイ後に Worker の URL が表示されます。

## 6. editor 側設定

保存/読込タブの 外部正本 (Cloudflare Workers) で以下を設定します。

1. Workers API URL に Worker URL を入力
2. ユーザーIDを入力
3. パスワードを入力
4. 認証テストを押す
5. 保存を押す

保存時の挙動:

- Worker URL が設定済み: Worker へ保存
- Worker 未設定: 従来の /api/data 保存を試行
- それも失敗: data.json をダウンロード

## 7. API 仕様

- POST /auth/login
  - 入力: { userId, password }
  - 出力: { token, expiresAt }

- POST /data/save
  - ヘッダー: Authorization: Bearer <token>
  - 入力: { data, client, savedAt }
  - 出力: { ok, updatedAt }

- GET /data/latest
  - 認証不要
  - 出力: { data, meta }

- GET /health
  - 動作確認用

## 8. セキュリティ注意

- これは簡易認証です。高セキュリティ用途には不向きです。
- 1ユーザー1パスワードでも運用できますが、定期的に変更してください。
- 必ず HTTPS の Worker URL を使ってください。
- ALLOWED_ORIGIN は必ずあなたの公開ドメインに限定してください。
- GitHub Pages 側に平文パスワードを保存しないでください。

## 9. 運用メモ

- 保存履歴は data:history:<timestamp> として KV に蓄積します。
- 最新データは data:latest に保存されます。
- 必要なら別途エクスポート用の管理画面を追加できます。

## 10. ローカル確認（localtest 環境）

本番の `.dev.vars` は使いません。架空の値だけを入れた `.dev.vars.localtest` と、`wrangler.toml` の `[env.localtest]` を使います。

1. `cd worker && npx wrangler dev --env localtest` で起動します。`http://127.0.0.1:8787` で動きます。
   - **`--env localtest` を付けずに `wrangler dev` を実行しないでください**（本番の値の `.dev.vars` が読み込まれます）。
   - **`wrangler deploy --env localtest` は絶対に実行しないでください。**
2. エディタ（v1: `editor.html`）の Workers API URL に `http://127.0.0.1:8787` を入れ、ユーザー `dev`・パスワード `dev-password` でログインします。
3. エディタは VS Code の Live Server（ポート 5502）で開きます。
