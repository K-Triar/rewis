// 操作マニュアル（HTML 版）へのリンク。両エディタとも <エディタ>/guide/ にあるので相対パスで指せる。
// 読み込んだデータはタブの中にしかなく、同じタブで移動すると未保存の変更が消えるため、必ず新しいタブで開く。

import { h, icon } from '../dom.js';

const MANUAL_URL = 'guide/';

export function manualLink({ className = '', label = '操作マニュアル' } = {}) {
  return h('a', {
    class: className,
    href: MANUAL_URL,
    target: '_blank',
    rel: 'noopener',
    title: '操作マニュアルを新しいタブで開きます'
  }, icon('book'), label);
}
