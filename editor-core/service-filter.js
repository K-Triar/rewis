// 運行系統タブの路線・種別による絞り込み。DOM を使わない。02-editor-ui-spec.md 12.1。

export function matchesServiceFilter(service, { lineId, categoryId } = {}) {
  if (!lineId) return true;
  const sections = service.sections || [];
  if (!sections.some((s) => s.lineId === lineId)) return false;
  if (!categoryId) return true;
  return sections.some((s) => s.lineId === lineId && s.categoryId === categoryId);
}
