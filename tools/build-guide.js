// 操作マニュアル（editor-guide.md など）から、画面イメージ付きの HTML 版を生成する。
//   node tools/build-guide.js            … すべて生成
//   node tools/build-guide.js editor     … 表形式エディタのガイドだけ生成
//   node tools/build-guide.js graph      … 図形式エディタのガイドだけ生成
//
// 本文は md をそのまま変換する（文言は md が正本。HTML 側で本文を直接書き換えない）。
// 図は <ガイドの出力先>/figures/<名前>.html に書き、md の入れたい位置に
// <!-- figure: 名前 --> と書く（GitHub 上では表示されない）。
// 図の中の <i data-icon="アイコン名"></i> は、エディタと同じ Octicons の SVG に置き換える。
// 複数の図で使う部品は、図の中に {{> 部品名}} と書いて読み込む。部品は
// そのガイドの figures/_parts/ → 両ガイド共通の src/guide/parts/ の順に探す。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICONS } from '../src/editor/common/icons.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_BLOB = 'https://github.com/K-Triar/rewis/blob/main/';

const SHARED_PARTS = join(ROOT, 'src/guide/parts');

// 画面イメージを描くためのエディタの CSS（両エディタ共通の分）
const EDITOR_CSS = [
  'src/editor/common/primer/tokens/colors-base.css',
  'src/editor/common/primer/tokens/colors-semantic.css',
  'src/editor/common/primer/tokens/typography.css',
  'src/editor/common/primer/tokens/spacing.css',
  'src/editor/common/primer/tokens/borders.css',
  'src/editor/common/primer/tokens/motion.css',
  'src/editor/common/css/theme.css',
  'src/editor/common/css/components.css',
  'src/editor/common/css/app.css'
];

// css: エディタ本体の index.html と同じものを読み込む
// appId: 本文の <main> に付ける id。エディタの CSS が #ed2-app（表形式）/ #g-app（図形式）の中だけに効かせている指定を、図にも効かせるため
const GUIDES = {
  editor: {
    md: 'editor-guide.md',
    outDir: 'editor/guide',
    css: [...EDITOR_CSS, 'src/editor/table/table.css'],
    appId: 'ed2-app',
    appNote: 'id="ed2-app" は、表形式エディタの画面イメージに table.css の詰めた表示を効かせるため'
  },
  graph: {
    md: 'editor-graph-guide.md',
    outDir: 'editor-graph/guide',
    css: EDITOR_CSS,
    appId: 'g-app',
    appNote: 'id="g-app" は、図形式エディタ（app.css の #g-app）と同じ入れ物にするため'
  }
};

// ---- 文字列の変換 ----

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// GitHub と同じ規則で見出しのアンカーを作る（md の目次のリンクと一致させるため）
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function plainText(inline) {
  return inline.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function renderInline(text) {
  const codes = [];
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`);
  out = out.replace(/(^|[^"=>])(https?:\/\/[^\s<）」]+)/g, '$1<a href="$2">$2</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

function iconSvg(name, size = 16) {
  const paths = ICONS[name];
  if (!paths) throw new Error(`未知のアイコン: ${name}`);
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">` +
    paths.map((d) => `<path d="${d}"></path>`).join('') + '</svg>';
}

// ---- ブロックの解析 ----

const LIST_RE = /^( *)([-*]|\d+\.) (.*)$/;
const CALLOUTS = {
  NOTE: { label: 'Note', icon: 'info' },
  TIP: { label: 'Tip', icon: 'info' },
  IMPORTANT: { label: 'Important', icon: 'info' },
  WARNING: { label: 'Warning', icon: 'alert' },
  CAUTION: { label: 'Caution', icon: 'alert' }
};

function indentOf(line) {
  return line.match(/^ */)[0].length;
}

// lines を解析して HTML の配列にする。ctx は図の差し込みと見出しの記録に使う
function renderBlocks(lines, ctx) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    // AI に md を渡して質問する人向けの前置き（<!-- ai-note:start --> 〜 <!-- ai-note:end -->）は HTML 版に出さない
    if (/^<!--\s*ai-note:start/.test(trimmed)) {
      while (i < lines.length && !/^<!--\s*ai-note:end/.test(lines[i].trim())) i++;
      if (i >= lines.length) throw new Error('<!-- ai-note:end --> がありません');
      i++;
      continue;
    }

    const fig = trimmed.match(/^<!--\s*figure:\s*([\w-]+)\s*-->$/);
    if (fig) {
      out.push(ctx.figure(fig[1]));
      i++;
      continue;
    }
    if (trimmed.startsWith('<!--')) {
      while (i < lines.length && !lines[i].includes('-->')) i++;
      i++;
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      out.push('<hr>');
      i++;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6}) (.*)$/);
    if (heading) {
      const level = heading[1].length;
      const id = slugify(plainText(heading[2]));
      ctx.ids.add(id);
      out.push(`<h${level} id="${id}">${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const inner = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        inner.push(lines[i].trim().replace(/^> ?/, ''));
        i++;
      }
      const kind = inner[0] && inner[0].match(/^\[!([A-Z]+)\]$/);
      if (kind && CALLOUTS[kind[1]]) {
        const c = CALLOUTS[kind[1]];
        out.push(`<div class="gd-callout gd-callout--${kind[1].toLowerCase()}">` +
          `<p class="gd-callout__title">${iconSvg(c.icon)}${c.label}</p>` +
          renderBlocks(inner.slice(1), ctx).join('\n') + '</div>');
      } else {
        out.push(`<blockquote>${renderBlocks(inner, ctx).join('\n')}</blockquote>`);
      }
      continue;
    }

    const item = line.match(LIST_RE);
    if (item) {
      const consumed = renderList(lines, i, ctx);
      out.push(consumed.html);
      i = consumed.next;
      continue;
    }

    // 段落：md の改行はそのまま改行として表示する
    const para = [];
    while (i < lines.length && lines[i].trim() && !LIST_RE.test(lines[i]) &&
      !/^(#{1,6} |>|-{3,}$|<!--)/.test(lines[i].trim())) {
      para.push(renderInline(lines[i].trim()));
      i++;
    }
    out.push(`<p>${para.join('<br>\n')}</p>`);
  }
  return out;
}

// 同じ字下げ・同じ種類の項目が続く範囲を 1 つのリストとして描く
function renderList(lines, start, ctx) {
  const first = lines[start].match(LIST_RE);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = lines[i].match(LIST_RE);
    if (!m || m[1].length !== baseIndent || /\d/.test(m[2]) !== ordered) break;
    const contentIndent = baseIndent + m[2].length + 1;
    const body = [m[3]];
    i++;
    // 項目の続き：空行をはさんでも、字下げが項目より深い行は同じ項目に含める
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) {
        const after = lines.slice(i + 1).find((l) => l.trim());
        if (after !== undefined && indentOf(after) > baseIndent) { body.push(''); i++; continue; }
        break;
      }
      if (indentOf(next) <= baseIndent) break;
      body.push(next.slice(Math.min(indentOf(next), contentIndent)));
      i++;
    }
    items.push(body);
  }

  const lis = items.map((body) => {
    const blocks = renderBlocks(body, ctx);
    // 先頭が段落だけなら <p> を外して詰めて表示する（GitHub の詰めたリストと同じ）
    if (blocks[0] && blocks[0].startsWith('<p>')) blocks[0] = blocks[0].slice(3, -4);
    return `<li>${blocks.join('\n')}</li>`;
  });
  const tag = ordered ? 'ol' : 'ul';
  return { html: `<${tag}>\n${lis.join('\n')}\n</${tag}>`, next: i };
}

// ---- ページの組み立て ----

// 図の中の data-g（手順から @名前 で指す目印）が重複していないか、手順が指す目印がすべてあるかを確かめる
function checkFigure(name, html) {
  const names = [...html.matchAll(/data-g="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  names.forEach((n) => {
    if (seen.has(n)) throw new Error(`図 ${name}: data-g="${n}" が重複しています`);
    seen.add(n);
  });
  const steps = (html.match(/<script type="text\/x-gd-steps">([\s\S]*?)<\/script>/) || [])[1] || '';
  [...steps.matchAll(/(^|\s)@([\w-]+)/g)].forEach((m) => {
    if (!seen.has(m[2])) throw new Error(`図 ${name}: 手順の @${m[2]} が見つかりません`);
  });
}

// 図の中の {{> 名前}} を部品に置き換える（ヘッダーなど複数の図で同じ部品）。
// partsDirs の前のものほど優先する（ガイド固有の _parts/ → 共通の src/guide/parts/）
function includeParts(html, partsDirs, depth = 0) {
  if (depth > 5) throw new Error('部品の読み込みが深すぎます');
  return html.replace(/\{\{> ([\w-]+)\}\}/g, (_, name) => {
    const path = partsDirs.map((dir) => join(dir, `${name}.html`)).find((p) => existsSync(p));
    if (!path) throw new Error(`部品がありません: ${name}（${partsDirs.map((d) => relative(ROOT, d)).join(' / ')}）`);
    return includeParts(readFileSync(path, 'utf8').trim(), partsDirs, depth + 1);
  });
}

// 「LLMに質問する：」の部品。押したときの動きは src/guide/ask.js
function askBox(mdName) {
  return `<div class="gd-ask">
<span class="gd-ask__label" id="gd-ask-label">LLMに質問する：</span>
<div class="gd-split" role="group" aria-labelledby="gd-ask-label">
<button type="button" class="g-btn g-btn--small gd-split__main" data-gd-md="copy">${iconSvg('copy')}<span data-gd-md-text>Markdownをコピー</span></button>
<button type="button" class="g-btn g-btn--small gd-split__toggle" aria-haspopup="menu" aria-expanded="false" aria-controls="gd-ask-menu" aria-label="ほかの方法を選ぶ">${iconSvg('chevron-down')}</button>
<div class="gd-menu" id="gd-ask-menu" role="menu" hidden>
<button type="button" class="gd-menu__item" role="menuitem" data-gd-md="copy">${iconSvg('copy')}<span><span class="gd-menu__title">Markdownをコピー</span><span class="gd-menu__desc">AI のチャット欄に貼り付けて質問します</span></span></button>
<button type="button" class="gd-menu__item" role="menuitem" data-gd-md="download">${iconSvg('download')}<span><span class="gd-menu__title">Markdownをダウンロード</span><span class="gd-menu__desc">${escapeHtml(mdName)} として保存します</span></span></button>
</div>
</div>
</div>`;
}

function cutChapters(lines, untilChapter) {
  if (!untilChapter) return lines;
  const stop = lines.findIndex((l) => {
    const m = l.match(/^## (\d+)\./);
    return m && Number(m[1]) > untilChapter;
  });
  if (stop < 0) return lines;
  // 章の区切りの --- も落とす
  let end = stop;
  while (end > 0 && (!lines[end - 1].trim() || /^-{3,}$/.test(lines[end - 1].trim()))) end--;
  return lines.slice(0, end);
}

function build(key) {
  const conf = GUIDES[key];
  const outDir = join(ROOT, conf.outDir);
  const md = readFileSync(join(ROOT, conf.md), 'utf8').replace(/\r\n/g, '\n');
  const allLines = md.split('\n');
  const lines = cutChapters(allLines, conf.untilChapter);
  const toRoot = relative(outDir, ROOT).replace(/\\/g, '/');

  const usedFigures = [];
  const ctx = {
    ids: new Set(),
    figure(name) {
      const path = join(outDir, 'figures', `${name}.html`);
      if (!existsSync(path)) throw new Error(`図がありません: ${relative(ROOT, path)}`);
      usedFigures.push(name);
      const html = includeParts(readFileSync(path, 'utf8').trim(), [join(outDir, 'figures', '_parts'), SHARED_PARTS]);
      checkFigure(name, html);
      return html
        .replace(/<i data-icon="([\w-]+)"(?: data-size="(\d+)")?><\/i>/g, (_, n, s) => iconSvg(n, s ? Number(s) : 16))
        .replace(/\{\{ROOT\}\}/g, toRoot)
        // ラジオボタンの name などを図ごとに分ける（同じ部品を別の図で使っても互いに影響しない）
        .replace(/\{\{FIG\}\}/g, name);
    }
  };

  const titleLine = lines.find((l) => l.startsWith('# '));
  const title = titleLine ? plainText(titleLine.slice(2)) : key;
  let body = renderBlocks(lines, ctx).join('\n');

  // まだ HTML にしていない章へのリンクは、GitHub 上の md の同じ見出しへ飛ばす
  const pending = [];
  body = body.replace(/href="#([^"]+)"/g, (all, id) => {
    if (ctx.ids.has(decodeURIComponent(id))) return all;
    pending.push(id);
    return `href="${REPO_BLOB}${conf.md}#${id}" class="gd-pending-link"`;
  });
  // 他の md へのリンクも GitHub 上のものにする
  body = body.replace(/href="(?!https?:|#)([^"]+\.md)(#[^"]*)?"/g, (_, file, hash) => `href="${REPO_BLOB}${file}${hash || ''}"`);

  // タイトルの下に「LLMに質問する：」（md の全文をコピー・ダウンロードする）を置く
  if (!body.includes('</h1>')) throw new Error(`${conf.md} にタイトル（# 見出し）がありません`);
  body = body.replace('</h1>', `</h1>\n${askBox(conf.md)}`);

  const html = `<!DOCTYPE html>
<!-- 自動生成: node tools/build-guide.js ${key}（${conf.md} と ${conf.outDir}/figures/ から）。このファイルを直接編集しないこと -->
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <meta name="robots" content="noindex">
    <link rel="icon" href="${toRoot}/favicon.ico" type="image/x-icon">

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900&display=swap" rel="stylesheet">

    <!-- 画面イメージは実際のエディタと同じ CSS で描く -->
${conf.css.map((href) => `    <link rel="stylesheet" href="${toRoot}/${href}">`).join('\n')}
    <!-- 公開ページの画面イメージ用（layout.css はページ全体の骨組みなので読み込まない） -->
    <link rel="stylesheet" href="${toRoot}/assets/design-system/tokens.css">
    <link rel="stylesheet" href="${toRoot}/assets/design-system/components.css">

    <link rel="stylesheet" href="${toRoot}/src/guide/guide.css">
</head>
<body>
    <header class="g-header">
        <div class="g-header__left">
            <img class="g-header__logo" src="${toRoot}/assets/icons/rewis_logo_w.svg" alt="">
            <div class="g-header__title">| 操作マニュアル</div>
        </div>
    </header>
    <!-- ${conf.appNote} -->
    <main id="${conf.appId}" class="gd-doc">
${body}
    </main>
    <!-- 「LLMに質問する：」でコピー・ダウンロードする md の全文（AI 向けの前置きも含めて、md のまま） -->
    <script type="application/json" id="gd-md-source" data-filename="${escapeHtml(conf.md)}">${JSON.stringify(md).replace(/</g, '\\u003c')}</script>
    <script type="module" src="${toRoot}/src/guide/player.js"></script>
    <script type="module" src="${toRoot}/src/guide/ask.js"></script>
</body>
</html>
`;

  writeFileSync(join(outDir, 'index.html'), html);
  console.log(`${conf.outDir}/index.html を生成しました（図 ${usedFigures.length} 件: ${usedFigures.join(', ') || 'なし'}）`);
  if (pending.length) console.log(`  まだ HTML にない章へのリンク ${pending.length} 件は GitHub の md に飛ばします`);
}

const keys = process.argv.slice(2);
(keys.length ? keys : Object.keys(GUIDES)).forEach((key) => {
  if (!GUIDES[key]) throw new Error(`不明なガイド: ${key}（${Object.keys(GUIDES).join(', ')}）`);
  build(key);
});
