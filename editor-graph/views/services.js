import { createStationCanvasTab } from '../canvas/canvas-tab-base.js';

export function renderServicesView(container, ctx) {
  return createStationCanvasTab(container, ctx, { viewportKey: 'services', ribbon: true, leftTitle: '運行系統' });
}
