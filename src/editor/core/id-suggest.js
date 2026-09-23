// ID の候補。DOM を使わない。02-editor-ui-spec.md 9.5。

import { isValidId } from '../../shared/ids.js';

export function suggestPlatformId(label, existingIds) {
  const set = new Set(existingIds || []);
  if (isValidId(label) && !set.has(label)) return label;
  let i = 1;
  while (set.has(`P${i}`)) i++;
  return `P${i}`;
}

export function suggestCategoryId(name, network, existingIds) {
  const set = new Set(existingIds || []);
  let foundId = null;
  outer: for (const line of (network.lines || [])) {
    for (const category of (line.categories || [])) {
      if (category.name === name) {
        foundId = category.id;
        break outer;
      }
    }
  }
  if (foundId && !set.has(foundId)) return foundId;
  let i = 1;
  while (set.has(`cat${i}`)) i++;
  return `cat${i}`;
}
