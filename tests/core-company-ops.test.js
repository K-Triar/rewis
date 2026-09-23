import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateCompanyDraft, canDeleteCompany } from '../editor-core/company-ops.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}
const network = loadFixture('v2-minimal-network.json');

test('validateCompanyDraft: 表形式と同じ文言', () => {
  assert.equal(
    validateCompanyDraft(network, { id: '不正 ID', name: 'x' }, true),
    '会社IDの書式が不正です（英数字・_・- のみ、1〜64文字）。'
  );
  assert.equal(validateCompanyDraft(network, { id: 'C1', name: 'x' }, true), '同じIDの会社が既にあります。');
  assert.equal(validateCompanyDraft(network, { id: 'C9', name: '' }, true), '会社名を入力してください。');
  assert.equal(validateCompanyDraft(network, { id: 'C9', name: '新会社' }, true), null);
  assert.equal(validateCompanyDraft(network, { id: 'C1', name: 'C鉄道改' }, false), null);
});

test('canDeleteCompany: 自社は削除できない', () => {
  assert.notEqual(canDeleteCompany(network, 'C1'), null); // meta.ownCompanyIdはC1
});

test('canDeleteCompany: 自社でなければ削除できる（null）', () => {
  const withSecondCompany = { ...network, companies: [...network.companies, { id: 'C2', name: 'D鉄道' }] };
  assert.equal(canDeleteCompany(withSecondCompany, 'C2'), null);
});

test('canDeleteCompany: 自社が配列で複数指定されていても、含まれていれば削除できない', () => {
  const net = { ...network, meta: { ...network.meta, ownCompanyId: ['C1', 'C2'] }, companies: [...network.companies, { id: 'C2', name: 'D鉄道' }] };
  assert.notEqual(canDeleteCompany(net, 'C1'), null);
  assert.notEqual(canDeleteCompany(net, 'C2'), null);
});

