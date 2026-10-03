// 全ページ共通の OGP（Discord などのリンクプレビュー）用 meta を作る。
// 書式（サイト名・テーマ色・画像・カード種別）をここに集約する。
// 手書きページ向けの一括挿入は node tools/ogp.js、ガイドは tools/build-guide.js から使う。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SITE_URL = 'https://k-triar.github.io/rewis/';
export const SITE_NAME = 'REWIS';
export const THEME_COLOR = '#003366';
export const OGP_IMAGE = `${SITE_URL}assets/img/kt_luli_logo_512.png`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// path: サイトルートからのパス（例 'transfer/'）。タイトルは「ページ名 - REWIS」の形に揃える
export function ogpBlock({ title, description, path }) {
  return [
    `    <meta property="og:title" content="${esc(title)}">`,
    `    <meta property="og:description" content="${esc(description)}">`,
    `    <meta property="og:type" content="website">`,
    `    <meta property="og:url" content="${SITE_URL}${path}">`,
    `    <meta property="og:site_name" content="${SITE_NAME}">`,
    `    <meta property="og:image" content="${OGP_IMAGE}">`,
    `    <meta name="twitter:card" content="summary">`,
    `    <meta name="theme-color" content="${THEME_COLOR}">`
  ].join('\n');
}

// 手書きページ（ガイド以外）
const PAGES = [
  ['index.html', 'ホーム - REWIS', '情報で、世界がつながる。Kトライア瑠璃の鉄道情報システム REWIS', ''],
  ['about/index.html', 'REWISについて - REWIS', 'Kトライア全世界鉄道情報システム REWIS の概要をご紹介します。', 'about/'],
  ['information/index.html', 'お知らせ - REWIS', 'REWISの最新情報とお知らせです。サービスの更新情報やメンテナンス情報をお届けします。', 'information/'],
  ['operation/index.html', '路線・運行情報 - REWIS', '各路線の詳細情報と運行状況を確認できます。鉄道会社や方面から探して、最新の運行情報をチェック。', 'operation/'],
  ['transfer/index.html', '乗換案内 - REWIS', '出発駅と到着駅から最適な経路を検索できます。所要時間優先やバランス、乗換回数優先など、複数の検索モードが利用可能。', 'transfer/'],
  ['editor/index.html', '路線データ編集システム - REWIS', 'REWISの路線データを表形式で編集するための、鉄道事業者向けエディタです。', 'editor/'],
  ['editor-graph/index.html', '路線データ編集（図形式） - REWIS', 'REWISの路線データを図形式で編集するための、鉄道事業者向けエディタです。', 'editor-graph/'],
  ['assets/design-system/style-guide.html', 'デザインシステム スタイルガイド - REWIS', 'REWISのデザインシステム（色・文字・コンポーネント）の一覧です。', 'assets/design-system/style-guide.html'],
  // 旧URL（.html）。リダイレクト前にプレビューが取られても同じ見た目になるよう、移動先と同じ内容にする
  ['about.html', null, null, 'about/'],
  ['information.html', null, null, 'information/'],
  ['operation.html', null, null, 'operation/'],
  ['transfer.html', null, null, 'transfer/'],
  ['editor.html', null, null, 'editor/']
];

const OGP_LINE = /^[ \t]*<meta (?:property="og:[^"]*"|name="twitter:[^"]*"|name="theme-color")[^>]*>\r?\n/gm;

function apply() {
  const byPath = Object.fromEntries(PAGES.filter((p) => p[1]).map((p) => [p[3], p]));
  for (const [file, title, desc, path] of PAGES) {
    const [, t, d] = title ? [0, title, desc] : byPath[path];
    let html = readFileSync(file, 'utf8');
    const eol = html.includes('\r\n') ? '\r\n' : '\n';
    html = html.replace(OGP_LINE, '');
    const block = ogpBlock({ title: t, description: d, path }).replace(/\n/g, eol);
    html = html.replace(/([ \t]*<title>[^\n]*<\/title>\r?\n)/, `$1${block}${eol}`);
    writeFileSync(file, html);
    console.log('ogp:', file);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) apply();
