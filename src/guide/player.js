// 操作マニュアルの画面イメージ（.gd-figure）を、GIF のように自動で動かす。
// 図が画面に入ったら再生し、外れたら止まり、最後まで行くと最初の状態に戻して繰り返す。
//
// 手順は図の中の <script type="text/x-gd-steps"> に 1 行 1 命令で書く（# から行末はコメント）。
// 対象は @名前（data-g="名前" の要素）か CSS セレクタで指定する。
//   move  @x              カーソルを x へ動かす
//   click @x              x を押す（カーソル移動・押し込み・波紋）
//   type  @x 文字列        x を押して 1 文字ずつ入力する
//   wait  ミリ秒           待つ
//   show  @x / hide @x    hidden を外す / 付ける
//   add   @x クラス名      クラスを付ける / remove @x クラス名 で外す
//   text  @x 文字列        中の文字を置き換える
//   enable @x / disable @x  disabled を外す / 付ける
//   place @x @y           x（ポップオーバーなど）を y のすぐ下に置く（x は先に show しておく）
//   clear @x              入力欄を空にする
//   value @x 文字列        入力欄の値を一度に書き換える（ボタンで値が入る様子など）
//   select @x 値          選択欄を押して、その値（option の value）を選ぶ
//   check @x / uncheck @x チェック欄・ラジオボタンを押してオン / オフにする
//   scroll @x             x が見えるところまで、x を囲むスクロール領域を動かす
//   spot  @x [見出し]      x を枠で囲む（spot off で消す）

const MOVE_MS = 650;
const STEP_GAP_MS = 380;
const TYPE_MS = 70;
const END_WAIT_MS = 1800;
const ABORT = Symbol('abort');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function parseSteps(source) {
  return source.split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const [, cmd, target = '', rest = ''] = line.match(/^(\S+)(?:\s+(\S+))?(?:\s+(.*))?$/);
      return { cmd, target, rest };
    });
}

const ICON_PAUSE = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11a.5.5 0 0 0 .77.42l8.5-5.5a.5.5 0 0 0 0-.84l-8.5-5.5A.5.5 0 0 0 4 2.5Z"/></svg>';
const ICON_RESTART = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 2.5a5.5 5.5 0 1 1-5.4 6.6.75.75 0 1 1 1.47-.3A4 4 0 1 0 5.2 5.2H7a.75.75 0 0 1 0 1.5H3.25a.75.75 0 0 1-.75-.75V2.2a.75.75 0 0 1 1.5 0v1.86A5.48 5.48 0 0 1 8 2.5Z"/></svg>';
const CURSOR_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 2.5v17.2l4.3-4.1 2.9 6.6 2.9-1.3-2.9-6.5h6.1Z" fill="#fff" stroke="#1f2328" stroke-width="1.4" stroke-linejoin="round"/></svg>';

class FigurePlayer {
  constructor(figure) {
    this.figure = figure;
    this.width = Number(figure.dataset.w) || 720;
    this.height = Number(figure.dataset.h) || 320;
    const script = figure.querySelector('script[type="text/x-gd-steps"]');
    this.steps = script ? parseSteps(script.textContent) : [];

    this.stage = figure.querySelector('.gd-stage');
    this.initialHtml = this.stage.innerHTML;

    // 拡大縮小する箱の中に、画面・カーソル・囲み枠を重ねる
    this.frame = document.createElement('div');
    this.frame.className = 'gd-frame';
    this.frame.style.maxWidth = `${this.width + 2}px`;
    this.scaler = document.createElement('div');
    this.scaler.className = 'gd-scaler';
    this.scaler.style.width = `${this.width}px`;
    this.scaler.style.height = `${this.height}px`;
    this.stage.replaceWith(this.frame);
    this.frame.appendChild(this.scaler);
    this.scaler.appendChild(this.stage);
    this.stage.inert = true; // 画面イメージは押せない（見るだけ）

    this.spot = document.createElement('div');
    this.spot.className = 'gd-spot';
    this.spot.hidden = true;
    this.scaler.appendChild(this.spot);

    this.cursor = document.createElement('div');
    this.cursor.className = 'gd-cursor';
    this.cursor.innerHTML = CURSOR_SVG;
    this.scaler.appendChild(this.cursor);

    this.runId = 0;
    this.visible = false;
    this.userPaused = reducedMotion;
    this.started = false;

    if (this.steps.length) this.buildControls();
    else this.cursor.hidden = true;

    this.fit();
    new ResizeObserver(() => this.fit()).observe(this.figure);
    this.resetCursor();
  }

  buildControls() {
    const bar = document.createElement('div');
    bar.className = 'gd-controls';
    this.playBtn = document.createElement('button');
    this.playBtn.type = 'button';
    this.playBtn.className = 'gd-control';
    this.playBtn.addEventListener('click', () => {
      this.userPaused = !this.userPaused;
      this.updateControls();
      this.maybeStart();
    });
    const restartBtn = document.createElement('button');
    restartBtn.type = 'button';
    restartBtn.className = 'gd-control';
    restartBtn.innerHTML = ICON_RESTART;
    restartBtn.setAttribute('aria-label', '最初から');
    restartBtn.title = '最初から';
    restartBtn.addEventListener('click', () => {
      this.userPaused = false;
      this.updateControls();
      this.restart();
    });
    bar.append(this.playBtn, restartBtn);
    this.frame.appendChild(bar);
    this.updateControls();
  }

  updateControls() {
    if (!this.playBtn) return;
    const label = this.userPaused ? '再生' : '一時停止';
    this.playBtn.innerHTML = this.userPaused ? ICON_PLAY : ICON_PAUSE;
    this.playBtn.setAttribute('aria-label', label);
    this.playBtn.title = label;
    this.figure.classList.toggle('is-paused', this.userPaused);
  }

  get playing() {
    return this.visible && !this.userPaused;
  }

  fit() {
    const available = this.frame.clientWidth;
    this.scale = Math.min(1, available / this.width);
    this.scaler.style.transform = `scale(${this.scale})`;
    this.frame.style.height = `${this.height * this.scale}px`;
  }

  setVisible(visible) {
    this.visible = visible;
    this.maybeStart();
  }

  maybeStart() {
    if (this.playing && !this.started && this.steps.length) {
      this.started = true;
      this.loop(this.runId);
    }
  }

  restart() {
    this.runId++;
    this.reset();
    this.started = false;
    this.maybeStart();
  }

  reset() {
    this.stage.innerHTML = this.initialHtml;
    this.spot.hidden = true;
    this.resetCursor();
  }

  resetCursor() {
    this.cursor.style.transition = 'none';
    this.placeCursor(this.width * 0.62, this.height * 0.82);
    void this.cursor.offsetWidth;
    this.cursor.style.transition = '';
  }

  placeCursor(x, y) {
    this.cursorPos = { x, y };
    this.cursor.style.transform = `translate(${x}px, ${y}px)`;
  }

  // 再生中の時間だけ数えて待つ（止めている間は進まない）
  sleep(ms, runId) {
    return new Promise((resolve, reject) => {
      let left = ms;
      let last = performance.now();
      const tick = (now) => {
        if (runId !== this.runId) { reject(ABORT); return; }
        if (this.playing) left -= now - last;
        last = now;
        if (left <= 0) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  find(target) {
    const selector = target.startsWith('@') ? `[data-g="${target.slice(1)}"]` : target;
    const el = this.stage.querySelector(selector);
    if (!el) throw new Error(`画面イメージに ${target} が見つかりません`);
    return el;
  }

  // 要素の位置（拡大縮小する前の座標）
  rectOf(el) {
    const base = this.scaler.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      x: (r.left - base.left) / this.scale,
      y: (r.top - base.top) / this.scale,
      w: r.width / this.scale,
      h: r.height / this.scale
    };
  }

  scrollParentOf(el) {
    for (let node = el.parentElement; node && node !== this.stage; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    }
    return null;
  }

  async moveTo(el, runId) {
    const r = this.rectOf(el);
    // 文字の上を指すよう、要素の中央よりやや左上を狙う
    const x = r.x + Math.min(r.w * 0.5, r.w - 6);
    const y = r.y + r.h * 0.55;
    const distance = Math.hypot(x - this.cursorPos.x, y - this.cursorPos.y);
    if (distance < 2) return;
    this.placeCursor(x, y);
    await this.sleep(MOVE_MS, runId);
  }

  async press(el, runId) {
    this.cursor.classList.add('is-pressing');
    el.classList.add('gd-pressed');
    const ripple = document.createElement('div');
    ripple.className = 'gd-ripple';
    ripple.style.left = `${this.cursorPos.x}px`;
    ripple.style.top = `${this.cursorPos.y}px`;
    this.scaler.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
    await this.sleep(180, runId);
    this.cursor.classList.remove('is-pressing');
    el.classList.remove('gd-pressed');
  }

  async run(step, runId) {
    const { cmd, target, rest } = step;
    switch (cmd) {
      case 'wait':
        await this.sleep(Number(target) || 0, runId);
        return;
      case 'move':
        await this.moveTo(this.find(target), runId);
        return;
      case 'click': {
        const el = this.find(target);
        await this.moveTo(el, runId);
        await this.press(el, runId);
        break;
      }
      case 'type': {
        const el = this.find(target);
        await this.moveTo(el, runId);
        await this.press(el, runId);
        el.classList.add('gd-focus');
        for (const ch of rest) {
          el.value += ch;
          await this.sleep(TYPE_MS, runId);
        }
        await this.sleep(150, runId);
        el.classList.remove('gd-focus');
        break;
      }
      case 'select': {
        // 選択欄を押して、値を選んだ状態にする（ブラウザのドロップダウンは出さない）
        const el = this.find(target);
        await this.moveTo(el, runId);
        await this.press(el, runId);
        await this.sleep(250, runId);
        el.value = rest;
        break;
      }
      case 'check':
      case 'uncheck': {
        const el = this.find(target);
        await this.moveTo(el, runId);
        await this.press(el, runId);
        el.checked = cmd === 'check';
        break;
      }
      case 'scroll': {
        // x が見えるところまで、x を囲むスクロール領域を動かす
        const el = this.find(target);
        const box = this.scrollParentOf(el);
        if (!box) return;
        const from = box.scrollTop;
        const to = Math.max(0, Math.min(box.scrollHeight - box.clientHeight,
          from + this.rectOf(el).y - this.rectOf(box).y - 12));
        const steps = 20;
        for (let i = 1; i <= steps; i++) {
          await this.sleep(500 / steps, runId);
          const t = i / steps;
          box.scrollTop = from + (to - from) * (1 - (1 - t) * (1 - t));
        }
        break;
      }
      // 画面の変化は待たずに続けて反映する（押した結果が一度に変わるように）
      case 'clear': this.find(target).value = ''; return;
      case 'value': this.find(target).value = rest; return;
      case 'show': this.find(target).hidden = false; return;
      case 'hide': this.find(target).hidden = true; return;
      case 'add': this.find(target).classList.add(...rest.split(/\s+/)); return;
      case 'remove': this.find(target).classList.remove(...rest.split(/\s+/)); return;
      case 'text': this.find(target).textContent = rest; return;
      case 'place': {
        // ポップオーバーなどを、別の要素のすぐ下に置く
        const el = this.find(target);
        const r = this.rectOf(this.find(rest.trim()));
        el.style.left = `${Math.min(r.x, this.width - el.offsetWidth - 8)}px`;
        el.style.top = `${r.y + r.h + 4}px`;
        return;
      }
      case 'enable': this.find(target).disabled = false; return;
      case 'disable': this.find(target).disabled = true; return;
      case 'spot':
        if (target === 'off') {
          this.spot.hidden = true;
        } else {
          const r = this.rectOf(this.find(target));
          const pad = 4;
          Object.assign(this.spot.style, {
            left: `${r.x - pad}px`, top: `${r.y - pad}px`,
            width: `${r.w + pad * 2}px`, height: `${r.h + pad * 2}px`
          });
          this.spot.dataset.label = rest;
          this.spot.classList.toggle('has-label', !!rest);
          // 見出しが図の上端からはみ出すときは枠の下に出す
          this.spot.classList.toggle('is-label-below', r.y < 30);
          this.spot.hidden = false;
          return void await this.sleep(1300, runId);
        }
        break;
      default:
        throw new Error(`不明な命令: ${cmd}`);
    }
    await this.sleep(STEP_GAP_MS, runId);
  }

  async loop(runId) {
    try {
      for (;;) {
        await this.sleep(500, runId);
        for (const step of this.steps) await this.run(step, runId);
        await this.sleep(END_WAIT_MS, runId);
        this.stage.classList.add('is-fading');
        await this.sleep(300, runId);
        this.reset();
        this.stage.classList.remove('is-fading');
      }
    } catch (e) {
      if (e !== ABORT) console.error('[guide]', e);
    }
  }
}

const players = new Map();
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    const player = players.get(entry.target);
    if (player) player.setVisible(entry.isIntersecting);
  });
}, { threshold: 0.4 });

document.querySelectorAll('.gd-figure').forEach((figure) => {
  const player = new FigurePlayer(figure);
  players.set(figure, player);
  observer.observe(figure);
});
