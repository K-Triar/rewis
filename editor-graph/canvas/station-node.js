import { s } from '../../editor-shared/dom.js';
import { NODE, nodeRect, portPoint } from '../../editor-core/graph-geometry.js';

function isHighlighted(highlightPorts, platformId) {
  if (!highlightPorts) return false;
  if (typeof highlightPorts.has === 'function') return highlightPorts.has(platformId);
  if (Array.isArray(highlightPorts)) return highlightPorts.includes(platformId);
  return false;
}

export function renderStationNode(parent, station, pos, {
  selected = false,
  dimmed = false,
  highlightPorts = null,
  onBodyPointerDown = null,
  onPortPointerDown = null
} = {}) {
  const rect = nodeRect(station, pos);
  const platforms = station.platforms || [];

  let nodeClass = 'g-node';
  if (selected) nodeClass += ' is-selected';
  if (dimmed) nodeClass += ' is-dimmed';

  const group = s('g', { class: nodeClass, 'data-station-id': station.id });

  const body = s('rect', {
    class: 'g-node__body',
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
    rx: 6,
    ry: 6
  });
  if (onBodyPointerDown) {
    body.addEventListener('pointerdown', (event) => onBodyPointerDown(event, station));
  }
  group.appendChild(body);

  const nameText = s('text', {
    class: 'g-node__name',
    x: rect.x + rect.w / 2,
    y: rect.y + NODE.nameY,
    'text-anchor': 'middle'
  }, station.name);
  group.appendChild(nameText);

  if (platforms.length === 0) {
    group.appendChild(s('text', {
      class: 'g-node__no-platform',
      x: rect.x + rect.w / 2,
      y: rect.y + NODE.portY,
      'text-anchor': 'middle'
    }, 'のりば未登録'));
  } else {
    platforms.forEach((platform) => {
      const point = portPoint(station, pos, platform.id);
      const highlight = isHighlighted(highlightPorts, platform.id);

      const port = s('circle', {
        class: 'g-port' + (highlight ? ' is-highlight' : ''),
        cx: point.x,
        cy: point.y,
        r: NODE.portR
      });
      group.appendChild(port);

      const label = s('text', {
        class: 'g-port__label',
        x: point.x,
        y: point.y,
        'text-anchor': 'middle',
        'dominant-baseline': 'central'
      }, String(platform.label ?? '').slice(0, 3));
      group.appendChild(label);

      const hit = s('circle', {
        class: 'g-port__hit',
        cx: point.x,
        cy: point.y,
        r: NODE.hitR,
        'data-platform-id': platform.id
      });
      if (onPortPointerDown) {
        hit.addEventListener('pointerdown', (event) => onPortPointerDown(event, station, platform.id));
      }
      group.appendChild(hit);
    });
  }

  parent.appendChild(group);
  return group;
}
