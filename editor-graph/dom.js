import { ICONS } from './icons.js';

const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected']);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);

  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === 'class') {
      el.className = value;
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'for') {
      el.htmlFor = value;
    } else if (PROP_KEYS.has(key)) {
      el[key] = value;
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  });

  children.flat(Infinity).forEach((child) => {
    if (child == null || child === false) return;
    el.appendChild(
      typeof child === 'string' || typeof child === 'number'
        ? document.createTextNode(String(child))
        : child
    );
  });

  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);

  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === 'class') {
      el.setAttribute('class', value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  });

  children.flat(Infinity).forEach((child) => {
    if (child == null || child === false) return;
    el.appendChild(
      typeof child === 'string' || typeof child === 'number'
        ? document.createTextNode(String(child))
        : child
    );
  });

  return el;
}

export function icon(name, { size = 16, label = null } = {}) {
  const paths = ICONS[name];
  if (!paths) throw new Error(`未知のアイコン: ${name}`);
  const attrs = {
    viewBox: '0 0 16 16',
    width: size,
    height: size,
    fill: 'currentColor'
  };
  if (label) {
    attrs.role = 'img';
    attrs['aria-label'] = label;
  } else {
    attrs['aria-hidden'] = 'true';
  }
  return s('svg', attrs, paths.map((d) => s('path', { d })));
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}
