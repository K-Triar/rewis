// 運行状況の記号（○ △ ×）を SVG で描く。形は Kトライア瑠璃のトップページ（k-triar.github.io）と共通。
// 線の色は currentColor なので、呼び出し側の CSS の color で状態色を付ける。
const SVG_NS = 'http://www.w3.org/2000/svg';

const SHAPES = {
    normal: ['circle', { cx: 20, cy: 20, r: 13.5 }],
    warning: ['path', { d: 'M20 6.5 34 31.5H6z' }],
    suspend: ['path', { d: 'M9 9l22 22M31 9 9 31' }],
};

export function createStatusIcon(state, className = 'status-icon') {
    const [tag, attrs] = SHAPES[state];
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => shape.setAttribute(k, v));
    svg.appendChild(shape);
    return svg;
}
