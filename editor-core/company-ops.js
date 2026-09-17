// 鉄道会社の編集ロジック。DOM を使わない。02-editor-ui-spec.md 15.1、17章。

import { isValidId } from '../shared/ids.js';

export function validateCompanyDraft(network, company, isNew) {
  if (isNew) {
    if (!isValidId(company.id)) return '会社IDの書式が不正です（英数字・_・- のみ、1〜64文字）。';
    if ((network.companies || []).some((c) => c.id === company.id)) return '同じIDの会社が既にあります。';
  }
  if (!company.name || !company.name.trim()) return '会社名を入力してください。';
  return null;
}

// 自社（meta.ownCompanyId）は削除できない。表形式にはない、図形式で追加するチェック（仕様17章）。
export function canDeleteCompany(network, id) {
  if (network.meta && network.meta.ownCompanyId === id) {
    return '自社は削除できません。';
  }
  return null;
}
