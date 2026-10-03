// 操作マニュアルの「LLMに質問する：」。ページに埋め込んだ md の全文（#gd-md-source）を
// クリップボードにコピーする。メニューの「Markdownとして表示」「Markdownをダウンロード」は公開中の md へのただのリンク（ここでは閉じるだけ）。
// ヘルプマーク（.gd-help）は3つの方法の違いを説明するパネルを開閉する。
// 既定はコピー（チャット欄に貼れば全文が確実に読まれる。ファイルの添付は拾い読みされることがある）。

const source = document.getElementById('gd-md-source');
const box = document.querySelector('.gd-ask');

const DONE_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';
const RESET_MS = 2000;

if (source && box) {
  const markdown = JSON.parse(source.textContent);
  const main = box.querySelector('.gd-split__main');
  const mainText = main.querySelector('[data-gd-md-text]');
  const mainIcon = main.querySelector('svg');
  const toggle = box.querySelector('.gd-split__toggle');
  const menu = box.querySelector('.gd-menu');
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const defaultText = mainText.textContent;
  const defaultIcon = mainIcon.outerHTML;
  let resetTimer = 0;

  // 押した結果をボタンの文字で知らせる（読み上げにも伝わるよう aria-live で囲む）
  mainText.setAttribute('aria-live', 'polite');
  function flash(text, ok) {
    clearTimeout(resetTimer);
    mainText.textContent = text;
    if (ok) main.querySelector('svg').outerHTML = DONE_ICON;
    resetTimer = setTimeout(() => {
      mainText.textContent = defaultText;
      main.querySelector('svg').outerHTML = defaultIcon;
    }, RESET_MS);
  }

  // navigator.clipboard が使えない環境（http や file:// で開いたときなど）は古い方法で写す
  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      const area = document.createElement('textarea');
      area.value = markdown;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      if (!ok) { flash('コピーできませんでした', false); return; }
    }
    flash('コピーしました', true);
  }

  const actions = { copy };

  function openMenu(focusFirst) {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (focusFirst) items[0].focus();
  }
  function closeMenu(returnFocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (returnFocus) toggle.focus();
  }

  box.addEventListener('click', (event) => {
    // 「Markdownとして表示」「Markdownをダウンロード」はリンクのまま動かし、メニューだけ閉じる
    if (event.target.closest('a.gd-menu__item')) {
      closeMenu(false);
      return;
    }
    const button = event.target.closest('[data-gd-md]');
    if (!button) return;
    closeMenu(button.closest('.gd-menu') !== null);
    actions[button.dataset.gdMd]();
  });

  toggle.addEventListener('click', () => {
    if (menu.hidden) openMenu(false);
    else closeMenu(false);
  });
  toggle.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu(true);
    }
  });

  menu.addEventListener('keydown', (event) => {
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length].focus();
    } else if (event.key === 'Escape') {
      closeMenu(true);
    } else if (event.key === 'Tab') {
      closeMenu(false);
    }
  });

  document.addEventListener('click', (event) => {
    if (!box.contains(event.target)) closeMenu(false);
  });

  // ヘルプマーク：3つの方法の違いを説明するパネルを開閉する
  const helpBtn = box.querySelector('.gd-help__btn');
  const helpPanel = box.querySelector('.gd-help__panel');
  if (helpBtn && helpPanel) {
    function setHelp(open) {
      helpPanel.hidden = !open;
      helpBtn.setAttribute('aria-expanded', String(open));
    }
    helpBtn.addEventListener('click', () => {
      closeMenu(false);
      setHelp(helpPanel.hidden);
    });
    toggle.addEventListener('click', () => setHelp(false));
    document.addEventListener('click', (event) => {
      if (!helpBtn.parentElement.contains(event.target)) setHelp(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !helpPanel.hidden) {
        setHelp(false);
        helpBtn.focus();
      }
    });
  }
}
