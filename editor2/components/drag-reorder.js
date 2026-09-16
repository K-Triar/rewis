// tr要素などの行にドラッグ&ドロップでの並べ替えを付ける。
// array自体を書き換え、並べ替え後にonReordered(fromIndex, toIndex)を呼ぶ（再描画や、
// 並行する別の配列を同じ順序で動かすのは呼び出し側の責任）。
export function attachDragReorder(row, index, array, onReordered) {
  row.draggable = true;
  row.classList.add('ed2-drag-row');
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(index));
  });
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    row.classList.add('ed2-drag-over');
  });
  row.addEventListener('dragleave', () => {
    row.classList.remove('ed2-drag-over');
  });
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('ed2-drag-over');
    const fromIndex = Number(e.dataTransfer.getData('text/plain'));
    if (Number.isNaN(fromIndex) || fromIndex === index) return;
    const [moved] = array.splice(fromIndex, 1);
    array.splice(index, 0, moved);
    onReordered(fromIndex, index);
  });
}
