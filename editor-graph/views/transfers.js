import { createStationCanvasTab } from '../canvas/canvas-tab-base.js';

export function renderTransfersView(container, ctx) {
  return createStationCanvasTab(container, ctx, { viewportKey: 'transfers', requireShiftDrag: true, leftTitle: '乗換・駅グループ' });
}
