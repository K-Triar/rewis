// 操作マニュアル（HTML 版）の読み進めるための仕組み。
//   ・左の目次：今読んでいる章・節を強調し、その章の節だけを開く。幅が狭いときは引き出しにする
//   ・見出しの「#」：その見出しの URL をコピーする
//   ・検索：本文（画面イメージの中は除く）を段落・項目ごとに探し、押すとその場所へ移って強調する

const header = document.querySelector('.gd-header');
const doc = document.querySelector('.gd-doc');
const toast = document.querySelector('.gd-toast');

function headerOffset() {
  return (header ? header.getBoundingClientRect().height : 0) + 16;
}

// ---- 知らせ（画面下に少しだけ出す） ----

let toastTimer = 0;
function showToast(text) {
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = text;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
}

// ---- 場所へ移って強調する ----

function flash(el) {
  el.classList.remove('gd-flash');
  // 同じ場所を続けて選んでも、もう一度光らせる
  void el.offsetWidth;
  el.classList.add('gd-flash');
  setTimeout(() => el.classList.remove('gd-flash'), 1800);
}

function goTo(el, { center = false } = {}) {
  if (center) el.scrollIntoView({ block: 'center' });
  else window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - headerOffset() + 4 });
  flash(el);
}

// ---- 左の目次 ----

const sidebar = document.getElementById('gd-sidebar');
const sidebarInner = sidebar && sidebar.querySelector('.gd-sidebar__inner');
const backdrop = document.querySelector('.gd-backdrop');
const tocButton = document.querySelector('.gd-header__toc');
const tocLinks = sidebar ? [...sidebar.querySelectorAll('[data-toc]')] : [];
const tocTargets = tocLinks
  .map((link) => ({ link, heading: document.getElementById(link.dataset.toc) }))
  .filter((t) => t.heading);
const drawerQuery = window.matchMedia('(max-width: 1099px)');

let activeLink = null;
function updateActive() {
  const limit = headerOffset() + 8;
  let current = null;
  for (const t of tocTargets) {
    if (t.heading.getBoundingClientRect().top <= limit) current = t;
    else break;
  }
  const link = current ? current.link : null;
  if (link === activeLink) return;
  if (activeLink) {
    activeLink.classList.remove('is-active');
    activeLink.removeAttribute('aria-current');
  }
  sidebar.querySelectorAll('.gd-toc__chapter.is-open').forEach((li) => li.classList.remove('is-open'));
  activeLink = link;
  if (!link) return;
  link.classList.add('is-active');
  link.setAttribute('aria-current', 'location');
  link.closest('.gd-toc__chapter').classList.add('is-open');
  keepVisible(link);
}

// 強調した項目が目次の見える範囲から外れていたら、目次だけをスクロールする（ページは動かさない）
function keepVisible(link) {
  const box = sidebarInner.getBoundingClientRect();
  const r = link.getBoundingClientRect();
  if (r.top < box.top + 40) sidebarInner.scrollTop -= box.top + 40 - r.top;
  else if (r.bottom > box.bottom - 40) sidebarInner.scrollTop += r.bottom - (box.bottom - 40);
}

function setDrawer(open) {
  document.body.classList.toggle('gd-toc-open', open);
  tocButton.setAttribute('aria-expanded', String(open));
  tocButton.setAttribute('aria-label', open ? '目次を閉じる' : '目次を開く');
  backdrop.hidden = !open;
  if (open) {
    if (activeLink) keepVisible(activeLink);
    (activeLink || tocLinks[0]).focus({ preventScroll: true });
  }
}

if (sidebar) {
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; updateActive(); });
  }, { passive: true });
  window.addEventListener('resize', updateActive);
  updateActive();

  tocButton.addEventListener('click', () => setDrawer(!document.body.classList.contains('gd-toc-open')));
  backdrop.addEventListener('click', () => setDrawer(false));
  sidebar.addEventListener('click', (event) => {
    if (event.target.closest('a') && drawerQuery.matches) setDrawer(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('gd-toc-open')) {
      setDrawer(false);
      tocButton.focus();
    }
  });
  drawerQuery.addEventListener('change', () => { if (!drawerQuery.matches) setDrawer(false); });
}

// ---- 見出しの「#」：URL をコピー ----

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

doc.addEventListener('click', async (event) => {
  const anchor = event.target.closest('.gd-anchor');
  if (!anchor) return;
  event.preventDefault();
  const heading = anchor.parentElement;
  history.replaceState(null, '', `#${heading.id}`);
  goTo(heading);
  const ok = await copyText(location.href);
  showToast(ok ? 'この見出しへのリンクをコピーしました' : 'リンクをコピーできませんでした');
});

// ---- 検索 ----

const search = document.querySelector('.gd-search');
const input = search.querySelector('.gd-search__input');
const results = search.querySelector('.gd-search__results');
const MAX_RESULTS = 40;
const SNIPPET_BEFORE = 24;
const SNIPPET_LENGTH = 90;

// 全角・半角、大文字・小文字、カタカナ・ひらがなの違いを無視して比べる。
// 元の文字の位置に戻せるよう、1 文字ずつ変換して位置の対応表を作る
function normalizeChar(c) {
  return c.normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, (k) => String.fromCharCode(k.charCodeAt(0) - 0x60));
}
function normalizeWithMap(text) {
  let norm = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const n = normalizeChar(text[i]);
    for (let j = 0; j < n.length; j++) map.push(i);
    norm += n;
  }
  return { norm, map };
}
function normalize(text) {
  return normalizeWithMap(text).norm;
}

function cleanText(el, removeSelector) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll(removeSelector).forEach((x) => x.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim();
}

// 本文を段落・項目ごとの検索対象にする（画面イメージ・入口・章末のリンクは除く）
let entries = null;
function buildIndex() {
  entries = [];
  const path = { 2: '', 3: '', 4: '' };
  doc.querySelectorAll('h2, h3, h4, p, li').forEach((el) => {
    if (el.closest('.gd-figure, .gd-entry, .gd-next')) return;
    const tag = el.tagName;
    if (tag === 'H2' || tag === 'H3' || tag === 'H4') {
      const level = Number(tag[1]);
      const text = cleanText(el, '.gd-anchor');
      path[level] = text;
      for (let l = level + 1; l <= 4; l++) path[l] = '';
      entries.push({ el, text, heading: true, where: [path[2], path[3], path[4]].filter(Boolean).slice(0, -1) });
      return;
    }
    // 項目は、中の段落や入れ子のリストを別の検索対象にするので、項目そのものの文だけを取る
    const text = tag === 'LI' ? cleanText(el, 'ul, ol, p, figure, .gd-figure') : cleanText(el, '.gd-figure');
    if (!text) return;
    entries.push({ el, text, heading: false, where: [path[2], path[3], path[4]].filter(Boolean) });
  });
  entries.forEach((e) => Object.assign(e, normalizeWithMap(e.text)));
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 一致した語に <mark> を付け、最初の一致の前後だけを切り出す
function snippet(entry, terms) {
  const ranges = [];
  terms.forEach((t) => {
    let from = 0;
    let at;
    while ((at = entry.norm.indexOf(t, from)) >= 0) {
      ranges.push([entry.map[at], entry.map[at + t.length - 1] + 1]);
      from = at + t.length;
    }
  });
  ranges.sort((a, b) => a[0] - b[0]);
  const first = ranges.length ? ranges[0][0] : 0;
  const start = entry.heading ? 0 : Math.max(0, first - SNIPPET_BEFORE);
  const end = Math.min(entry.text.length, start + SNIPPET_LENGTH);
  let out = start > 0 ? '…' : '';
  let pos = start;
  ranges.filter(([a, b]) => b > start && a < end).forEach(([a, b]) => {
    a = Math.max(a, pos);
    if (a >= b) return;
    out += escapeHtml(entry.text.slice(pos, a)) + '<mark>' + escapeHtml(entry.text.slice(a, Math.min(b, end))) + '</mark>';
    pos = Math.min(b, end);
  });
  out += escapeHtml(entry.text.slice(pos, end)) + (end < entry.text.length ? '…' : '');
  return out;
}

let found = [];
let activeIndex = -1;

function runSearch() {
  if (!entries) buildIndex();
  const terms = normalize(input.value).split(/\s+/).filter(Boolean);
  if (!terms.length) {
    closeResults();
    return;
  }
  found = entries
    .map((e, order) => {
      if (!terms.every((t) => e.norm.includes(t))) return null;
      return { e, order, score: (e.heading ? 100 : 0) + e.norm.split(terms[0]).length - 1 };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_RESULTS)
    .map((x) => x.e);
  activeIndex = found.length ? 0 : -1;
  renderResults(terms);
}

function renderResults(terms) {
  results.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  if (!found.length) {
    results.innerHTML = '<p class="gd-search__empty">見つかりませんでした。言葉を短くするか、別の言い方で探してください。</p>';
    input.removeAttribute('aria-activedescendant');
    return;
  }
  results.innerHTML = `<p class="gd-search__count">${found.length >= MAX_RESULTS ? `${MAX_RESULTS} 件以上` : `${found.length} 件`}</p>` +
    found.map((e, i) => `<div class="gd-search__item${e.heading ? ' is-heading' : ''}" role="option" id="gd-hit-${i}" data-i="${i}" aria-selected="${i === activeIndex}">` +
      (e.where.length ? `<span class="gd-search__where">${escapeHtml(e.where.join(' › '))}</span>` : '') +
      `<span class="gd-search__text">${snippet(e, terms)}</span></div>`).join('');
  markActive();
}

function markActive() {
  results.querySelectorAll('.gd-search__item').forEach((item) => {
    const on = Number(item.dataset.i) === activeIndex;
    item.setAttribute('aria-selected', String(on));
    if (on) item.scrollIntoView({ block: 'nearest' });
  });
  if (activeIndex >= 0) input.setAttribute('aria-activedescendant', `gd-hit-${activeIndex}`);
  else input.removeAttribute('aria-activedescendant');
}

function closeResults() {
  results.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
}

function choose(i) {
  const entry = found[i];
  if (!entry) return;
  closeResults();
  closeMobileSearch();
  input.blur();
  goTo(entry.el, { center: !entry.heading });
}

let searchTimer = 0;
input.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 80);
});
input.addEventListener('focus', () => { if (input.value.trim()) runSearch(); });
input.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!found.length || results.hidden) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    activeIndex = (activeIndex + step + found.length) % found.length;
    markActive();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (activeIndex >= 0) choose(activeIndex);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    if (!results.hidden) closeResults();
    else if (input.value) input.value = '';
    else { closeMobileSearch(); input.blur(); }
  }
});
// 押した瞬間に入力欄のフォーカスが外れて結果が閉じないよう、mousedown で選ぶ
results.addEventListener('mousedown', (event) => {
  const item = event.target.closest('.gd-search__item');
  if (!item) return;
  event.preventDefault();
  choose(Number(item.dataset.i));
});
document.addEventListener('click', (event) => {
  if (!search.contains(event.target)) closeResults();
});

// 幅が狭いときは虫眼鏡だけを出し、押すとヘッダーいっぱいに検索欄を広げる
function openMobileSearch() {
  document.body.classList.add('gd-searching');
  input.focus();
}
function closeMobileSearch() {
  document.body.classList.remove('gd-searching');
}
search.querySelector('.gd-search__open').addEventListener('click', openMobileSearch);
search.querySelector('.gd-search__close').addEventListener('click', () => {
  closeResults();
  closeMobileSearch();
});

// 「/」または Ctrl+K（Mac は ⌘K）で検索欄へ
document.addEventListener('keydown', (event) => {
  const typing = event.target.closest && event.target.closest('input, textarea, select, [contenteditable="true"]');
  const isSlash = event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey;
  const isCmdK = event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey);
  if (!isSlash && !isCmdK) return;
  event.preventDefault();
  if (getComputedStyle(search.querySelector('.gd-search__box')).display === 'none') openMobileSearch();
  else { input.focus(); input.select(); }
});
