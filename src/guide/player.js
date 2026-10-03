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
//   dblclick @x           x をダブルクリックする
//   drag  @x @y [@a ...]  x を押したまま y まで動かして離す。@a… も同じだけ一緒に動かす
//                         （@a:1 / @a:2 は線（line）の始点 / 終点だけを動かす）
//   wheel @x 倍率          カーソルの位置でホイールを回し、x（図の g-world）を拡大・縮小する
//   attr  @x 名前 値       属性を書き換える（SVG の座標などを一度に変える）
//   key   文字列           押したキーを画面下に一瞬表示する（例: key Esc / key Ctrl+Z）
//   hold  文字列           押したままのキーを表示し続ける（hold off で消す。例: hold Shift）

const MOVE_MS = 650;
const STEP_GAP_MS = 380;
const TYPE_MS = 70;
const END_WAIT_MS = 1800;
const ABORT = Symbol('abort');

const DRAG_MS = 900;
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

    this.keycap = document.createElement('div');
    this.keycap.className = 'gd-keycap';
    this.keycap.hidden = true;
    this.scaler.appendChild(this.keycap);

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
    this.keycap.hidden = true;
    this.held = null;
    this.cursor.classList.remove('is-wheel');
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

  // 要素の中心（ドラッグの始点・終点に使う）
  centerOf(el) {
    const r = this.rectOf(el);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  // 図の座標での移動量 (dx, dy) を、el の座標系での移動量に直す（SVG の中は拡大縮小されている）
  localDelta(el, dx, dy) {
    if (!(el instanceof SVGElement) || el instanceof SVGSVGElement) return { dx, dy };
    const ctm = el.parentNode.getScreenCTM();
    if (!ctm) return { dx, dy };
    const k = this.scale / Math.hypot(ctm.a, ctm.b);
    return { dx: dx * k, dy: dy * k };
  }

  // 一緒に動かす要素の、動かし始めの状態を覚える
  moverOf(target) {
    const [name, end] = target.split(':');
    const el = this.find(name);
    if (end) {
      const x = `x${end}`;
      const y = `y${end}`;
      const x0 = Number(el.getAttribute(x));
      const y0 = Number(el.getAttribute(y));
      return (dx, dy) => {
        const d = this.localDelta(el, dx, dy);
        el.setAttribute(x, x0 + d.dx);
        el.setAttribute(y, y0 + d.dy);
      };
    }
    if (el instanceof SVGElement) {
      const base = el.getAttribute('transform') || '';
      return (dx, dy) => {
        const d = this.localDelta(el, dx, dy);
        el.setAttribute('transform', `translate(${d.dx},${d.dy}) ${base}`.trim());
      };
    }
    const base = el.style.transform;
    return (dx, dy) => { el.style.transform = `translate(${dx}px, ${dy}px) ${base}`.trim(); };
  }

  // 一定時間かけて、t = 0〜1 で fn を呼ぶ
  async animate(ms, runId, fn) {
    const frames = Math.max(1, Math.round(ms / 30));
    for (let i = 1; i <= frames; i++) {
      await this.sleep(ms / frames, runId);
      const t = i / frames;
      fn(t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    }
  }

  showKey(label) {
    this.keycap.textContent = label;
    this.keycap.hidden = !label;
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
        // 数値の欄は「-」だけのような途中の値を受け付けないので、入れた文字は別に持っておく
        const before = el.value;
        let typed = '';
        for (const ch of rest) {
          typed += ch;
          el.value = before + typed;
          await this.sleep(TYPE_MS, runId);
        }
        await this.sleep(150, runId);
        el.classList.remove('gd-focus');
        break;
      }
      case 'dblclick': {
        const el = this.find(target);
        await this.moveTo(el, runId);
        await this.press(el, runId);
        await this.sleep(60, runId);
        await this.press(el, runId);
        break;
      }
      case 'drag': {
        // 押したまま動かす。カーソルの移動は CSS の transition ではなく、一緒に動く要素と同じ刻みで動かす
        const from = this.find(target);
        const names = rest.split(/\s+/).filter(Boolean);
        const to = this.find(names.shift());
        await this.moveTo(from, runId);
        const start = { ...this.cursorPos };
        const goal = this.centerOf(to);
        const movers = names.map((n) => this.moverOf(n));
        this.cursor.classList.add('is-pressing');
        await this.sleep(200, runId);
        this.cursor.style.transition = 'none';
        await this.animate(DRAG_MS, runId, (t) => {
          const dx = (goal.x - start.x) * t;
          const dy = (goal.y - start.y) * t;
          this.placeCursor(start.x + dx, start.y + dy);
          movers.forEach((move) => move(dx, dy));
        });
        this.cursor.style.transition = '';
        await this.sleep(120, runId);
        this.cursor.classList.remove('is-pressing');
        break;
      }
      case 'wheel': {
        // world の transform（translate(x,y) scale(k)）を、カーソルの位置を中心に拡大・縮小する
        const el = this.find(target);
        const factor = Number(rest) || 1.2;
        const m = (el.getAttribute('transform') || '').match(/translate\(([-\d.]+)[ ,]+([-\d.]+)\)\s*scale\(([-\d.]+)\)/);
        const [tx, ty, k] = m ? m.slice(1).map(Number) : [0, 0, 1];
        const svgRect = this.rectOf(el.ownerSVGElement);
        const svgScale = el.ownerSVGElement.getBoundingClientRect().width / this.scale / svgRect.w || 1;
        const cx = (this.cursorPos.x - svgRect.x) / svgScale;
        const cy = (this.cursorPos.y - svgRect.y) / svgScale;
        this.cursor.classList.add('is-wheel');
        await this.animate(700, runId, (t) => {
          const f = 1 + (factor - 1) * t;
          el.setAttribute('transform', `translate(${cx - (cx - tx) * f},${cy - (cy - ty) * f}) scale(${k * f})`);
        });
        this.cursor.classList.remove('is-wheel');
        break;
      }
      case 'key':
        this.showKey(rest ? `${target} ${rest}` : target);
        this.keycap.classList.add('is-pressed');
        await this.sleep(700, runId);
        this.keycap.classList.remove('is-pressed');
        this.showKey(this.held);
        break;
      case 'hold':
        this.held = target === 'off' ? null : target;
        this.showKey(this.held);
        return;
      case 'attr': {
        const [name, ...value] = rest.split(/\s+/);
        this.find(target).setAttribute(name, value.join(' '));
        return;
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
      // SVG の要素には hidden プロパティがないので、属性で切り替える
      case 'show': this.find(target).removeAttribute('hidden'); return;
      case 'hide': this.find(target).setAttribute('hidden', ''); return;
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
