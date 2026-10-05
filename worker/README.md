# REWIS Cloudflare Workers 手順書

このフォルダは、GitHub Pages のまま editor だけ保存認証を有効にするための API です。

- GitHub Pages: 画面表示と通常の静的配信
- Cloudflare Worker: 認証と外部正本への保存
- editor: 保存時のみ ID/パスワードを送信して保存

> [!IMPORTANT]
> 編集者アカウントは **招待リンク方式**（[§12](#12-編集者アカウント招待リンク方式)）に移行中です。新しいユーザーの追加やパスワードの再設定は、editor の「アカウント」タブから行います。salt やターミナルは不要です。
> §3〜§4 の `AUTH_USERS_JSON` / `PASSWORD_SALT` は **旧方式** で、全員が新方式に移るまでの間だけ使います（[§12-4](#12-4-旧方式からの移行)）。

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
| ユーザーID / ハッシュ（新方式） | Cloudflare KV（DATA_KV の `auth:user:*`） | editor の「アカウント」タブ | 認証 |
| 招待リンク（ハッシュのみ） | Cloudflare KV（DATA_KV の `auth:invite:*`、24時間で消える） | editor の「アカウント」タブ | アカウント登録・再設定 |
| 管理者の指定 | Cloudflare Secret | `wrangler secret put ADMIN_USERS` | ユーザー管理・v2 移行 |
| ユーザーID / ハッシュ（旧方式） | Cloudflare Secret | `wrangler secret put AUTH_USERS_JSON` | 認証（移行が済むまで） |
| salt（旧方式） | Cloudflare Secret | `wrangler secret put PASSWORD_SALT` | ハッシュ化（移行が済むまで） |
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

## 3. パスワードハッシュを作成（旧方式）

> [!NOTE]
> この節と §4-1・§4-2 は旧方式の手順です。新しく編集者を追加するときは、editor の「アカウント」タブで招待リンクを発行してください（§12）。

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
  - 出力: { token, expiresAt, userId, isAdmin }
  - 新方式（KV）のユーザーを先に確認し、いなければ旧方式（AUTH_USERS_JSON）で確認する。旧方式で成功したら新方式に移す
  - 401 invalid_credentials / 403 account_disabled / 429 too_many_attempts

- アカウント関連（§12）
  - GET /auth/me … { userId, isAdmin, expiresAt }
  - POST /auth/password … { currentPassword, newPassword } → 新しい { token, ... }（ほかのログインは切れる）
  - POST /auth/invite/check … { token } → { userId, purpose, expiresAt }
  - POST /auth/invite/accept … { token, password } → { token, ... }（そのままログイン）
  - GET /auth/admin/users（管理者）… { users: [{ userId, status, disabled, legacy, isAdmin, invite }] }
  - POST /auth/admin/invite（管理者）… { userId, purpose: 'new' | 'reset' } → { token, expiresAt }
  - POST /auth/admin/invite/revoke（管理者）… { userId }
  - POST /auth/admin/disable（管理者）… { userId, disabled }

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

- パスワードのみの認証です（2段階認証はありません）。フィッシングにはパスキーや Cloudflare Access ほど強くありません。
- 新方式のハッシュは PBKDF2-SHA256（ユーザーごとのランダムな salt、既定 10,000 回）です。無料プランの CPU 時間（1リクエスト 10ms）に収めるため、Workers の上限（100,000 回）より少なくしています（§12-3）。
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
2. エディタの Workers API URL（［詳細設定］）に `http://127.0.0.1:8787` を入れ、ユーザー `dev`・パスワード `dev-password` でログインします。
   - ユーザー管理を試すときは、`.dev.vars.localtest` に `ADMIN_USERS='dev'` を足します。
   - ローカルの KV は `worker/.wrangler/` に残ります。消すと最初の状態に戻ります。
3. エディタは VS Code の Live Server（ポート 5502）で開きます。

## 11. 公開APIの外部利用

運行情報・路線データの公開 JSON は、他サイト（GitHub Pages などの静的サイト）のブラウザ JS から直接読めます。認証は不要です。

### エンドポイント

本番の Worker URL は `https://rewis-editor-api.56drich.workers.dev` です。

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/v2/public` | v2 の公開データ `{ network, notices, masters, ... }`。**外部利用はこちらを推奨します** |
| GET | `/data/public` | 旧形式（v1）の公開データ `{ data, meta }` |

- データがまだ無い場合は `404 { "error": "not_initialized" }` を返します。
- 上記以外（`/auth/*`、`/data/save`、`/data/latest`、`/data/history*`、`/data/rollback`、`/v2/doc/*`、`/v2/history/*`、`/v2/rollback/*`、`/v2/admin/*`）は外部サイトからは使えません。

### CORS とキャッシュの方針

- 上の 2 つ（とそのプリフライト `OPTIONS`）だけ `Access-Control-Allow-Origin: *` を返します。どのオリジンからでも読めます。
- Cookie や `Authorization` は使いません。`Access-Control-Allow-Credentials` は付けないので、`fetch` に `credentials: 'include'` を指定しないでください。
- 保存系・認証系は従来どおり `ALLOWED_ORIGIN` に書かれたオリジンだけに限定しています。
- `Cache-Control: public, max-age=30, s-maxage=30` です。運行情報の鮮度を優先し、30 秒と短めにしています。
- `ETag` は内容のハッシュです。`If-None-Match` が一致すれば `304 Not Modified` を返します（ブラウザが自動で使います）。
- 短時間に何度も取得する必要はありません。ポーリングする場合は 30 秒以上の間隔を空けてください。

### fetch の例

```js
const API = 'https://rewis-editor-api.56drich.workers.dev';

const res = await fetch(API + '/v2/public');
if (!res.ok) throw new Error('REWIS のデータを取得できませんでした: ' + res.status);
const pub = await res.json();
console.log(pub.network.stations.length, '駅', pub.notices.length, '件の運行情報');
```

### 乗換探索の最小例

探索（`src/shared/route-search.js`）とモデル構築（`src/shared/model.js`）は DOM に依存しない ES モジュールです。GitHub Pages から直接 import できます（GitHub Pages は静的ファイルに `Access-Control-Allow-Origin: *` を付けて配信します）。

```html
<script type="module">
  import { buildModel } from 'https://k-triar.github.io/rewis/src/shared/model.js';
  import { buildSearchGraph, searchRoutes } from 'https://k-triar.github.io/rewis/src/shared/route-search.js';

  const API = 'https://rewis-editor-api.56drich.workers.dev';
  const pub = await (await fetch(API + '/v2/public')).json();

  const model = buildModel(pub.network, pub.notices, pub.masters);
  const graph = buildSearchGraph(model);   // 例: buildSearchGraph(model, { ownCompanyOnly: true })

  const [from, to] = pub.network.stations;  // 実際は駅名などから駅 ID を選んでください
  const routes = searchRoutes(model, graph, {
    fromStationId: from.id,
    toStationId: to.id,
    maxRoutes: 3
  });

  for (const route of routes) {
    console.log(`所要 ${route.totalDuration} 秒・乗換 ${route.transferCount} 回`);
    for (const leg of route.legs) {
      if (leg.type === 'ride') {
        const first = leg.stops[0];
        const last = leg.stops[leg.stops.length - 1];
        console.log(`  ${leg.headsign}: ${model.stationName(first.stationId)} → ${model.stationName(last.stationId)}`);
      } else {
        console.log(`  ${leg.kind === 'walk' ? '徒歩連絡' : '乗換'} ${leg.duration} 秒`);
      }
    }
  }
</script>
```

- 上の URL は `main` ブランチの最新を指します。内部関数の引数や戻り値は予告なく変わることがあります。安定させたい場合は、jsDelivr でコミットを固定して読み込むか（`https://cdn.jsdelivr.net/gh/K-Triar/rewis@<コミットハッシュ>/src/shared/route-search.js`）、ファイルをコピーして使ってください。
- import が依存先（`./ids.js`、`./schema-v2.js` など）を相対パスで読み込むので、コピーする場合は依存先もまとめてコピーしてください。

### ライセンスと出典表記のお願い

- **データ**：API が返す鉄道データ（路線・駅・系統・ダイヤ・運行情報等）は AGPL の対象外で、自由に利用・改変・再配布できます。
- **コード**：`src/shared/*.js` は **AGPL-3.0-or-later** です（詳しくはルートの [README のライセンス節](../README.md#ライセンス)）。
  - `fetch` で JSON を読んで自分のコードで処理するだけなら、コードのライセンスは関係しません。
  - ファイルをコピーして自サイトから配信する場合は、AGPL に従った配布になります（ライセンス表示を残し、改変した場合は改変後のソースも公開してください）。
  - import して自分のコードと組み合わせる場合、組み合わせた全体が AGPL の義務を負うと解釈される可能性があります。自分のコードも AGPL 互換のライセンスで公開しておくのが安全です。
- **出典表記**：利用する場合は、ページ内に「データ出典: REWIS（Kトライア全世界鉄道情報システム） <https://k-triar.github.io/rewis/>」のように表記してください。
- **免責**：データの正確性・完全性・可用性は保証しません。API は予告なく変更・停止することがあります。本 API を使ったことによる損害について、責任を負いません。
- REWIS および Kトライア瑠璃のロゴは AGPL の対象外です。許諾なく使用しないでください。

## 12. 編集者アカウント（招待リンク方式）

### 12-1. しくみ

- ユーザーは DATA_KV の `auth:user:<userId>` に保存します。パスワードは PBKDF2-SHA256 のハッシュだけを持ち、メールアドレスは使いません。
- 新しいユーザーは、管理者が editor の「アカウント」タブで **招待リンク** を発行し、本人がリンクを開いて自分でパスワードを決めます。管理者はパスワードを知りません。
- パスワードを忘れた人には **再設定リンク** を発行します。本人が新しいパスワードを設定するまでは、今のパスワードも使えます。設定すると、それまでのログインはすべて切れます。
- リンクは `<editor の URL>#invite=<トークン>` の形で、発行から 24 時間・一度だけ使えます。KV にはトークンのハッシュだけを保存し、再発行すると古いリンクは使えなくなります。トークンは URL の `#` 以降にあるので、サーバーのログや Referer には残りません。
- 無効にしたユーザーはログインできず、ログイン中のトークンも使えなくなります（KV の反映に最大 1 分ほどかかります）。管理者と自分自身は無効にできません。
- 管理者は `ADMIN_USERS`（カンマ区切りのユーザーID）で指定します。画面から管理者を増やすことはできません（管理者アカウントが乗っ取られても、ほかの管理者を作れないようにするため）。

### 12-2. 初回のデプロイ

1. `ADMIN_USERS` が **Secret** として登録されていることを確認します。

   ```powershell
   wrangler secret list
   ```

   一覧に `ADMIN_USERS` がなければ、`wrangler secret put ADMIN_USERS` で自分のユーザーID（例: `ktriar`）を登録します。
   ダッシュボードの「変数」（平文）として登録した値は、`wrangler deploy` のたびに `wrangler.toml` の `[vars]` で上書きされて消えることがあるため、Secret にしてください。
2. `wrangler deploy` します。`wrangler.toml` の `[[ratelimits]]`（試行回数の上限）もこのときに作られます。
3. editor に管理者のユーザーIDでログインし、「アカウント」タブに「ユーザー管理（管理者のみ）」が出ることを確認します。

### 12-3. 設定値

| 名前 | 場所 | 既定 | 内容 |
|------|------|------|------|
| `ADMIN_USERS` | Secret | なし | 管理者のユーザーID（カンマ区切り） |
| `PBKDF2_ITERATIONS` | `[vars]` か Secret | `10000` | パスワードハッシュの反復回数（1000〜100000）。上げると、各ユーザーが次にログインしたときに計算し直します。有料プラン（CPU 時間の上限が長い）なら `100000` を推奨 |
| `AUTH_RATE_LIMITER` | `[[ratelimits]]` | 60 秒に 10 回 | ログイン・パスワード変更・招待リンクの試行回数の上限。ユーザーID（大文字小文字を区別しない）と IP ごとに数えます。失敗回数を KV に書くと無料プランの KV 書き込み上限を使い切られるおそれがあるため、KV は使いません |

### 12-4. 旧方式からの移行

1. デプロイ後、旧方式のユーザーは今までどおりのユーザーID・パスワードでログインできます。ログインに成功した時点で、自動的に新方式（KV）に移ります。
2. 「アカウント」タブのユーザー一覧で、「旧方式」と表示されているユーザーが残っていないか確認します。しばらくログインしていない人には、再設定リンクを送って移ってもらいます。
3. 「旧方式」が一人もいなくなったら、旧方式の Secret を消します。

   ```powershell
   wrangler secret delete AUTH_USERS_JSON
   wrangler secret delete PASSWORD_SALT
   ```

   消したあとも、新方式に移ったユーザーはそのままログインできます。`generate-hash.js` も不要になります。

### 12-5. 困ったとき

- **管理者が自分のパスワードを忘れた**：ほかに管理者がいれば、その人に再設定リンクを発行してもらいます（管理者は 2 人以上にしておくと安心です）。管理者が一人だけの場合は、wrangler が使える PC で次のように復旧します（以前の salt は不要です）。
  1. 新しく決めた salt とパスワードで `node generate-hash.js "<パスワード>" "<salt>"` を実行し、`PASSWORD_SALT` と `AUTH_USERS_JSON`（自分のユーザーIDだけ）を一時的に登録し直します（§4-1・§4-2）。
  2. 自分の新方式の記録を消します：`wrangler kv key delete --binding DATA_KV --remote "auth:user:<自分のID>"`
  3. editor にそのパスワードでログインします（その時点で新方式に移ります）。「アカウント」タブでパスワードを変更しておきます。
  4. 一時的に登録した `AUTH_USERS_JSON` と `PASSWORD_SALT` を消します（§12-4 の 3）。
- **招待リンクを開くと「このリンクは使えません」**：期限切れ（24時間）、使用済み、または再発行済みです。管理者が「招待リンクを再発行」を押して送り直します。
- **「試行回数が多すぎます」**：1 分ほど待つと解除されます。
