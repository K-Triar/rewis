import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('./fixtures/v1-latest.json', import.meta.url));

test('v1 fixture has stations', () => {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  assert.ok(Array.isArray(fixture.data.stations));
  assert.ok(fixture.data.stations.length > 0);
});
