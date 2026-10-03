# REWIS（Kトライア全世界鉄道情報システム）

REWISは、Minecraft サーバー内の鉄道網（Kトライア全世界鉄道情報システム）を対象にした、乗換案内・運行状況の配信システムです。GitHub Pages 上の静的サイトと、Cloudflare Workers 上の保存用APIで構成されています。

- **公開 URL**：<https://k-triar.github.io/rewis/>
- **対象環境**：Node.js 22 以上（開発時） / モダンブラウザ
- **主な特徴**：乗換案内・運行状況配信、静的サイト＋Workers API 構成、事業者向けWebエディタ機能

## 目次

- [概要](#概要)
- [主な機能](#主な機能)
- [システム構成とデータの流れ](#システム構成とデータの流れ)
- [ページ構成](#ページ構成)
- [データ編集エディタ](#データ編集エディタ)
- [ディレクトリ構成](#ディレクトリ構成)
- [開発](#開発)
  - [前提環境](#前提環境)
  - [ローカル実行](#ローカル実行)
  - [コマンド](#コマンド)
  - [Workers API の開発](#workers-api-の開発)
- [ドキュメント](#ドキュメント)
- [ライセンス](#ライセンス)
- [免責事項](#免責事項)

## 概要

利用者がアプリなどで見かける「乗換案内」「運行状況」のもとになるデータ（鉄道会社・駅・路線・運行系統・のりば乗換・運行情報）は、事業者（参加者）がエディタ画面から入力し、Cloudflare Workers を経由して Cloudflare KV に保存されます。保存されたデータは公開用に整形（コンパイル）され、各公開ページから参照されます。

## 主な機能

| 機能 | 対象 | 概要 |
|---|---|---|
| 乗換案内 | 一般利用者 | 出発駅・到着駅を指定した経路探索（所要時間・乗換回数・経由駅の案内） |
| 運行状況 | 一般利用者 | 事業者が登録した各社・各路線の運行情報（平常運転・遅延・運休など）の配信 |
| 路線・駅情報 | 一般利用者 | 乗換案内・運行状況ページ内での路線図、停車駅一覧、各駅の乗り入れ路線やのりば情報の閲覧 |
| 表形式エディタ | 鉄道事業者 | 一覧・フォーム形式による駅・路線・系統・運行情報データの編集・保存 |
| 図形式エディタ | 鉄道事業者 | 路線図（ノード・エッジ）を視覚的にドラッグ＆ドロップしながら編集 |
| 履歴・復元管理 | 鉄道事業者 | 編集履歴の自動追跡、過去リビジョンへのワンクリック・ロールバック |
| PWA オフライン対応 | 全体 | Service Worker によるオフラインキャッシュとホーム画面追加 |

## システム構成とデータの流れ

```
[ 事業者 ] → editor / editor-graph （事業者向けページ・GitHub Pages）
                 │ 保存時のみ認証つきでAPIを呼び出す
                 ▼
        Cloudflare Workers（worker/）
                 │
                 ▼
        Cloudflare KV（正本データ・履歴）
                 │ 公開用に整形（src/shared/compile-public.js）
                 ▼
  [ 利用者 ] transfer / operation ほか公開ページ（GitHub Pages）
```

Workers API の詳しい仕様やセットアップ手順は [`worker/README.md`](worker/README.md) を参照してください。

## ページ構成

公開サイト側のトップレベルページです（`*.html` はディレクトリ形式のURLへ転送するスタブで、実体は同名のディレクトリ配下にあります）。

| ページ | 実体 | 内容 |
|---|---|---|
| `index.html` | — | ホーム |
| `transfer.html` | `transfer/` | 乗換案内 |
| `operation.html` | `operation/` | 運行状況 |
| `about.html` | `about/` | REWISについて |
| `information.html` | `information/` | お知らせ |
| `editor.html` | `editor/` | 事業者向けデータ編集ページ（表形式エディタ） |

## データ編集エディタ

事業者向けのデータ編集ページは、同じデータを異なる操作方法で編集できる2種類のエディタで構成されています。

- **表形式エディタ**（入口 `editor/`、実装 `src/editor/table/`）：一覧・フォーム中心の編集画面。
- **図形式エディタ**（入口 `editor-graph/`、実装 `src/editor/graph/`）：路線図の上でクリック・ドラッグしながら編集する画面。表形式エディタのヘッダーにある「図で編集する（新しいエディタ）」リンクから行き来できます。
- **旧エディタ v1**（`editor-v1/`）：過去のエディタです。現在は閲覧専用（保存不可）として残しています。

2つのエディタが共有するコードは `src/editor/core/`（DOMに依存しない編集ロジック）と `src/editor/common/`（UI部品・CSS・API呼び出し）にあります。

## ディレクトリ構成

```
.
├── index.html, transfer.html, operation.html, about.html, information.html, editor.html
│                         # 公開ページ・エディタへの転送スタブ（実体は同名ディレクトリ）
├── transfer/, operation/, about/, information/, editor/, editor-graph/
│                         # 各ページの入口HTML（URLになる。JSは src/ 配下）
├── editor-v1/              # 旧エディタ（閲覧専用。HTML/CSS/JS一式）
├── editor-guide.md         # 表形式エディタの詳細操作マニュアル
├── editor-graph-guide.md   # 図形式エディタの詳細操作マニュアル
├── src/
│   ├── editor/
│   │   ├── table/          # 表形式エディタの実装（editor/ から読み込む）
│   │   ├── graph/          # 図形式エディタの実装（editor-graph/ から読み込む）
│   │   ├── core/           # 両エディタ共通の編集ロジック（DOM非依存の純粋関数）
│   │   └── common/         # 両エディタ共通のUI部品・CSS・Primerトークン・API呼び出し
│   ├── pages/              # 公開ページ（index / transfer / operation）のJS
│   └── shared/             # スキーマ検証・データ変換・経路探索など共通ロジック
├── worker/                 # Cloudflare Workers 製の保存用API（認証・保存・履歴・ロールバック）
├── assets/                 # CSS・デザインシステム・画像・アイコンなど静的アセット
├── tests/                  # ユニットテスト（editor / shared / worker 別。fixtures・helpers を含む）
├── tools/                  # 開発補助スクリプト（Octiconsの生成など）
├── manifest.json, service-worker.js
│                         # PWA用マニフェストとオフラインキャッシュ
├── package.json            # テストスクリプト定義
└── LICENSE
```

## 開発

### 前提環境

- Node.js 22 以上（Workers API の開発に使う Wrangler 4 の要件。`npm test` のみであれば Node.js 20 でも実行できます）

フロントエンド（公開静的サイト）側に外部の実行時依存パッケージはありません。

### ローカル実行

静的ファイル配信用のローカルサーバーを起動して確認します。

```bash
# Python を使用する場合
python -m http.server 8000

# Node.js (npx) を使用する場合
npx serve -l 8000 .
```

起動後、ブラウザで `http://localhost:8000` を開きます。

### コマンド

テストは Node.js 標準の `node:test` で実行します。

```bash
npm test
```

### Workers API の開発

保存用 API（`worker/`）のローカルエミュレーションや KV のバインド、本番デプロイについては、[`worker/README.md`](worker/README.md) を参照してください。

## ドキュメント

| 文書 | 内容 |
|---|---|
| [`editor-guide.md`](editor-guide.md) | 表形式エディタの操作ガイド |
| [`editor-graph-guide.md`](editor-graph-guide.md) | 図形式エディタの操作ガイド |
| [`editor-v1/readme.md`](editor-v1/readme.md) | 旧エディタ（v1・閲覧専用）の操作ガイド |
| [`worker/README.md`](worker/README.md) | Workers 保存用APIの仕様とセットアップ手順 |

## ライセンス

本プロジェクトは **[GNU Affero General Public License v3.0 or later（AGPL-3.0-or-later）](LICENSE)** のもとで公開されています。

```
Copyright (C) 2025-2026 K-Triar Luli Transport
```

### 利用条件と特記事項

- **ネットワーク経由での利用（AGPL §13）**：本ソフトウェアを改変してネットワーク経由でサービス・機能として提供する場合、バイナリを直接配布していなくても、その利用者に対して改変後のソースコードを開示する義務があります。フォークを公開リポジトリ等に配置し、利用者へ案内してください。
- **生成・登録データの自由利用**：事業者が本システムおよびエディタを通じて作成・登録した鉄道データ（路線・駅・系統・ダイヤ・運行情報等）は、AGPL の制約を受けず、作成者および利用者が自由に利用・改変・再配布できます。
- **ロゴマークの除外**：「REWIS」のロゴ（`assets/icons/rewis_logo*.svg`）および「Kトライア瑠璃」のブランドロゴマーク（`assets/icons/kt_*.svg`、`assets/img/kt_luli_logo_*.png`、`favicon.ico` 等）は AGPL の対象外です。Kトライア瑠璃の許諾なく無断で使用することはできません。
- **サードパーティライセンス**：UI デザイン等で使用している GitHub Primer のトークンやアイコンは、各提供元のライセンス（MIT License）に準拠します。

## 免責事項

本プロジェクトは Minecraft 公式の製品・サービスではありません。Mojang または Microsoft から承認を受けておらず、それらとの関連性もありません。

「Minecraft」は Mojang Synergies AB の商標です。
