import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeImport } from '../src/import-history.mjs';

test('import fills gaps but never overwrites scraped values', () => {
  const existing = { '2026-11-05': { k24: 14602, k22: 13385, ag: 210100 } };
  const days = {
    '2026-11-05': { k24: 14000, k22: 13385, k18: 10952, ag: 210000 },
    '2016-10-01': { k24: 3157, k22: 2952, k18: 2415.3, ag: 45963 },
    '2016-10-02': { k22: 0, ag: -1 },
    'bad-date': { k22: 1 },
  };
  const { h, added, conflicts } = mergeImport(existing, days);
  assert.deepEqual(h['2026-11-05'], { k24: 14602, k22: 13385, ag: 210100, k18: 10952 });
  assert.deepEqual(h['2016-10-01'], { k24: 3157, k22: 2952, k18: 2415.3, ag: 45963 });
  assert.equal(h['2016-10-02'], undefined);
  assert.equal(h['bad-date'], undefined);
  assert.equal(added, 5);
  assert.equal(conflicts.length, 1); // 24K 14000 vs 14602
  assert.equal(mergeImport(h, days).added, 0);
});
