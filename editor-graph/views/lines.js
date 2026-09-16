import { createStationCanvasTab } from '../canvas/canvas-tab-base.js';

export function renderLinesView(container, ctx) {
  return createStationCanvasTab(container, ctx, { viewportKey: 'lines', ribbon: true, leftTitle: '路線' });
}
