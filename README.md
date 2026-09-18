# REWIS（Kトライア全世界鉄道情報システム）

REWISは、Minecraft サーバー内の鉄道網（Kトライア全世界鉄道情報システム）を対象にした、乗換案内・運行状況の配信システムです。GitHub Pages 上の静的サイトと、Cloudflare Workers 上の保存用APIで構成されています。

- **公開サイト**：<https://k-triar.github.io/rewis/>
- **利用者向け**：乗換案内・運行状況・路線情報の閲覧
- **事業者（参加者）向け**：路線・駅・運行系統などのデータ編集（[表形式エディタの使い方](editor-v1/readme.md) と互換の [図形式エディタの使い方](editor-graph-guide.md) を参照）

## 目次

- [概要](#概要)
- [ページ構成](#ページ構成)
- [データ編集エディタ](#データ編集エディタ)
- [ディレクトリ構成](#ディレクトリ構成)
- [データの流れ](#データの流れ)
- [開発](#開発)
- [ライセンス](#ライセンス)

## 概要

利用者がアプリなどで見かける「乗換案内」「運行状況」のもとになるデータ（鉄道会社・駅・路線・運行系統・のりば乗換・運行情報）は、事業者（参加者）がエディタ画面から入力し、Cloudflare Workers を経由して Cloudflare KV に保存されます。保存されたデータは公開用に整形（コンパイル）され、各公開ページから参照されます。

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

- **表形式エディタ**（`editor/`、`editor2/` が実装）：一覧・フォーム中心の編集画面。
- **図形式エディタ**（`editor-graph/` が実装、共通ロジックは `editor-core/`）：路線図の上でクリック・ドラッグしながら編集する画面。表形式エディタのヘッダーにある「図で編集する（新しいエディタ）」リンクから行き来できます。
- **旧エディタ v1**（`editor-v1/`）：過去のエディタです。現在は閲覧専用（保存不可）として残しています。

使い方は次のマニュアルを参照してください。

- 図形式エディタ：[`editor-graph-guide.md`](editor-graph-guide.md)
- 旧エディタ（v1・閲覧専用）：[`editor-v1/readme.md`](editor-v1/readme.md)

## ディレクトリ構成

```
.
├── index.html, transfer.html, operation.html, about.html, information.html, editor.html
│                         # 公開ページ・エディタへの転送スタブ（実体は同名ディレクトリ）
├── transfer/, operation/, about/, information/, editor/, editor-v1/
│                         # 各公開ページ・エディタの実体（HTML/CSS/JS）
├── editor2/              # 表形式エディタの実装（dom・api・store・views ほか）
├── editor-graph/          # 図形式エディタの実装（canvas・components・views ほか）
├── editor-core/            # 図形式・表形式が共有する編集ロジック（DOMに依存しない純粋関数。node --test で検証）
├── shared/                # スキーマ検証・データ変換・経路探索など、公開ページとエディタが共有するロジック
├── worker/                 # Cloudflare Workers 製の保存用API（認証・保存・履歴・ロールバック）
├── assets/                 # 画像・アイコンなど静的アセット
├── tests/                  # node --test によるユニットテスト
├── tools/                  # 開発補助スクリプト（Octiconsの生成など）
├── manifest.json, service-worker.js
│                         # PWA用マニフェストとオフラインキャッシュ
├── package.json            # ルートのテストスクリプト（`npm test`）
└── LICENSE
```

## データの流れ

```
[ 事業者 ] → editor / editor-graph （事業者向けページ・GitHub Pages）
                 │ 保存時のみ認証つきでAPIを呼び出す
                 ▼
        Cloudflare Workers（worker/）
                 │
                 ▼
        Cloudflare KV（正本データ・履歴）
                 │ 公開用に整形（shared/compile-public.js）
                 ▼
  [ 利用者 ] transfer / operation ほか公開ページ（GitHub Pages）
```

Workers API の詳しいセットアップ手順は [`worker/README.md`](worker/README.md) を参照してください。

## 開発

依存パッケージはありません。テストは Node.js 標準の `node:test` で実行します。

```sh
npm test
```

## ライセンス

本プロジェクトは [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE) のもとで公開されています。

このソフトウェアはフリーソフトウェアです。自由に利用・改変・再配布できますが、改変版をネットワーク経由でサービスとして提供する場合も、そのソースコードを利用者に開示する義務があります。詳細はLICENSEファイルをご確認ください。

Copyright (C) 2025- K-Triar Luli Transport
