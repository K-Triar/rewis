export const graphUi = {
  viewports: {},
  stations: { selectedId: null, search: '' },
  lines: { selectedId: null, selectedIndex: null, mode: 'idle', insertIndex: null },
  services: { selectedId: null, sel: null, mode: 'idle', insertIndex: null, draft: null, filterLineId: '', filterCategoryId: '' },
  transfers: { selectedId: null, selectedStationId: null, search: '', pane: 'graph' }
};

export function dropStaleSelection(existingIds) {
  if (graphUi.stations.selectedId && !existingIds.stations.has(graphUi.stations.selectedId)) {
    graphUi.stations.selectedId = null;
  }
  if (graphUi.lines.selectedId && !existingIds.lines.has(graphUi.lines.selectedId)) {
    graphUi.lines.selectedId = null;
    graphUi.lines.selectedIndex = null;
  }
  if (graphUi.services.selectedId && !existingIds.services.has(graphUi.services.selectedId)) {
    graphUi.services.selectedId = null;
    graphUi.services.sel = null;
  }
  if (graphUi.transfers.selectedId && !existingIds.transfers.has(graphUi.transfers.selectedId)) {
    graphUi.transfers.selectedId = null;
  }
  if (graphUi.transfers.selectedStationId && !existingIds.stations.has(graphUi.transfers.selectedStationId)) {
    graphUi.transfers.selectedStationId = null;
  }
}
