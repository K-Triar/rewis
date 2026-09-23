import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeSize, nodeRect, portPoint, edgeMidpoint, boundsOf, NODE } from '../../../src/editor/core/graph-geometry.js';

function station(platforms) {
  return { id: 'S1', name: 'S1駅', kana: '', platforms, location: null };
}

test('nodeSize: のりば0件は幅120（padX*2）', () => {
  assert.deepEqual(nodeSize(station([])), { w: 120, h: 60 });
});

test('nodeSize: のりば1件も幅120', () => {
  assert.deepEqual(nodeSize(station([{ id: 'P1', label: '1' }])), { w: 120, h: 60 });
});

test('nodeSize: のりば3件は幅 24*2+36*2=120', () => {
  const st = station([{ id: 'P1', label: '1' }, { id: 'P2', label: '2' }, { id: 'P3', label: '3' }]);
  assert.deepEqual(nodeSize(st), { w: 24 * 2 + 36 * 2, h: 60 });
});

test('nodeSize: のりば5件で幅が広がること', () => {
  const platforms = ['P1', 'P2', 'P3', 'P4', 'P5'].map((id) => ({ id, label: id }));
  assert.deepEqual(nodeSize(station(platforms)), { w: 24 * 2 + 36 * 4, h: 60 });
});

test('portPoint: のりばが1件なら x は pos.x', () => {
  const st = station([{ id: 'P1', label: '1' }]);
  const pos = { x: 100, y: 200 };
  const rect = nodeRect(st, pos);
  assert.deepEqual(portPoint(st, pos, 'P1'), { x: 100, y: rect.y + NODE.portY });
});

test('portPoint: のりばが0件なら中心を返す', () => {
  const st = station([]);
  const pos = { x: 100, y: 200 };
  assert.deepEqual(portPoint(st, pos, null), pos);
});

test('portPoint: のりばが3件のとき i 番目の座標', () => {
  const st = station([{ id: 'P1', label: '1' }, { id: 'P2', label: '2' }, { id: 'P3', label: '3' }]);
  const pos = { x: 100, y: 200 };
  const rect = nodeRect(st, pos);
  assert.deepEqual(portPoint(st, pos, 'P2'), { x: rect.x + NODE.padX + NODE.portGap * 1, y: rect.y + NODE.portY });
});

test('portPoint: null ののりばは中心を返す', () => {
  const st = station([{ id: 'P1', label: '1' }, { id: 'P2', label: '2' }]);
  const pos = { x: 100, y: 200 };
  assert.deepEqual(portPoint(st, pos, null), pos);
});

test('portPoint: 見つからないのりばIDも中心を返す', () => {
  const st = station([{ id: 'P1', label: '1' }]);
  const pos = { x: 100, y: 200 };
  assert.deepEqual(portPoint(st, pos, 'P9'), pos);
});

test('edgeMidpoint', () => {
  assert.deepEqual(edgeMidpoint({ x: 0, y: 0 }, { x: 10, y: 20 }), { x: 5, y: 10 });
});

test('boundsOf: 空なら全部0', () => {
  assert.deepEqual(boundsOf([]), { minX: 0, minY: 0, maxX: 0, maxY: 0 });
});

test('boundsOf: 複数点の範囲', () => {
  assert.deepEqual(boundsOf([{ x: 5, y: -3 }, { x: -2, y: 10 }, { x: 8, y: 4 }]), { minX: -2, minY: -3, maxX: 8, maxY: 10 });
});
