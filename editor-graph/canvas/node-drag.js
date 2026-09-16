import { trackPointer } from './canvas.js';

export function createNodeDragHandler(canvas, positions, { requireShift = false, onChange, onCommit, onClick } = {}) {
  return function onBodyPointerDown(event, station) {
    if (requireShift && !event.shiftKey) return;

    const startWorld = canvas.screenToWorld(event.clientX, event.clientY);
    const startPos = positions.get(station.id) || { x: 0, y: 0 };

    trackPointer(event, {
      onClick: (ev) => { if (onClick) onClick(station, ev); },
      onDragMove: (ev) => {
        const nowWorld = canvas.screenToWorld(ev.clientX, ev.clientY);
        const next = {
          x: startPos.x + (nowWorld.x - startWorld.x),
          y: startPos.y + (nowWorld.y - startWorld.y)
        };
        positions.set(station.id, next);
        if (onChange) onChange(station.id, next);
      },
      onDragEnd: () => {
        const finalPos = positions.get(station.id);
        if (onCommit) onCommit(station.id, finalPos);
      }
    });
  };
}
