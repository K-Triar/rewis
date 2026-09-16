import { createStationCanvasTab } from '../canvas/canvas-tab-base.js';

export function renderStationsView(container, ctx) {
  return createStationCanvasTab(container, ctx, { viewportKey: 'stations', leftTitle: '駅' });
}
