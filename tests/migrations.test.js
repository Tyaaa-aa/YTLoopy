import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, mapVideos, isDataKey, SCHEMA_VERSION } from '../src/shared/migrations.js';
import { parseExport, buildExport } from '../src/shared/model.js';

const v1 = {
  settings: { gap: 1 },
  'video:abcdefghijk': { id: 'abcdefghijk', title: 'T', sections: [{ id: 's', name: 'n', a: 1, b: 2, speed: 1 }], markers: [] },
};

// Pretend future versions to prove the runner chains steps correctly.
const steps = [
  { to: 3, run: (d) => mapVideos(d, (v) => ({ ...v, sections: v.sections.map((s) => ({ ...s, color: s.tags[0] || 'none' })) })) },
  { to: 2, run: (d) => mapVideos(d, (v) => ({ ...v, sections: v.sections.map((s) => ({ tags: [], ...s })) })) },
];

test('migrate applies steps in order and only the ones needed', () => {
  const { data, version } = migrate(v1, { from: 1, to: 3, steps });
  assert.equal(version, 3);
  assert.deepEqual(data['video:abcdefghijk'].sections[0].tags, []);
  assert.equal(data['video:abcdefghijk'].sections[0].color, 'none');
  assert.deepEqual(data.settings, { gap: 1 });
  const partial = migrate(v1, { from: 1, to: 2, steps });
  assert.equal(partial.data['video:abcdefghijk'].sections[0].color, undefined);
});

test('migrate never touches its input', () => {
  const before = structuredClone(v1);
  migrate(v1, { from: 1, to: 3, steps });
  assert.deepEqual(v1, before);
});

test('data from a newer schema is left alone', () => {
  const { data, version } = migrate(v1, { from: 5, to: 3, steps });
  assert.equal(version, 5);
  assert.equal(data, v1);
});

test('current schema is a no-op', () => {
  const { data, version } = migrate(v1, { from: SCHEMA_VERSION });
  assert.equal(version, SCHEMA_VERSION);
  assert.equal(data, v1);
});

test('isDataKey separates library data from bookkeeping', () => {
  assert.ok(isDataKey('settings'));
  assert.ok(isDataKey('video:abc'));
  for (const k of ['schemaVersion', 'pending', 'backupInfo', 'backup:schema1']) assert.ok(!isDataKey(k), k);
});

test('1.0.x export files (no version field) still import', () => {
  const file = { app: 'YTLoopy', videos: [v1['video:abcdefghijk']] };
  const { videos, version } = parseExport(JSON.stringify(file));
  assert.equal(version, 1);
  assert.equal(videos.length, 1);
});

test('exports carry the schema version and app version', () => {
  const e = buildExport([], '1.1.0');
  assert.equal(e.version, SCHEMA_VERSION);
  assert.equal(e.appVersion, '1.1.0');
});
