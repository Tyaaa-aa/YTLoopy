import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, parseTime, formatSpeed } from '../src/shared/time.js';
import {
  parseExport, buildExport, mergeVideo, sanitizeVideo, withDefaults, nextName, DEFAULT_KEYS,
} from '../src/shared/model.js';

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00.0');
  assert.equal(formatTime(83.456), '1:23.5');
  assert.equal(formatTime(59.96), '1:00.0');
  assert.equal(formatTime(3723.2), '1:02:03.2');
  assert.equal(formatTime(83.4, 0), '1:23');
  assert.equal(formatTime(NaN), '0:00.0');
});

test('parseTime accepts common forms', () => {
  assert.equal(parseTime('83'), 83);
  assert.equal(parseTime('83.5'), 83.5);
  assert.equal(parseTime('1:23'), 83);
  assert.equal(parseTime('1:23.4'), 83.4);
  assert.equal(parseTime('1:02:03'), 3723);
  assert.equal(parseTime('1m23s'), 83);
  assert.equal(parseTime('1m 23.5s'), 83.5);
  assert.equal(parseTime('90s'), 90);
  assert.equal(parseTime('1,5'), 1.5);
});

test('parseTime rejects junk', () => {
  for (const bad of ['', 'abc', '1:75', '1::2', null, '1:2:3:4']) {
    assert.equal(parseTime(bad), null, String(bad));
  }
});

test('formatSpeed', () => {
  assert.equal(formatSpeed(0.75), '0.75×');
  assert.equal(formatSpeed(1), '1×');
  assert.equal(formatSpeed(0.8500000001), '0.85×');
});

test('sanitizeVideo drops bad items and clamps speed', () => {
  const v = sanitizeVideo({
    id: 'dQw4w9WgXcQ',
    title: 'T',
    sections: [{ id: 's1', name: 'ok', a: 1, b: 2, speed: 9 }, { a: 5, b: 3 }, null],
    markers: [{ t: 3 }, { t: -1 }],
  });
  assert.equal(v.sections.length, 1);
  assert.equal(v.sections[0].speed, 2);
  assert.equal(v.markers.length, 1);
  assert.equal(v.markers[0].label, 'Marker');
  assert.equal(sanitizeVideo({ id: 'bad id!' }), null);
});

test('parseExport validates', () => {
  assert.throws(() => parseExport('{nope'), /valid JSON/);
  assert.throws(() => parseExport({ app: 'Other', videos: [] }), /isn't a YTLoopy export/);
  assert.throws(() => parseExport({ app: 'YTLoopy', version: 99, videos: [] }), /newer/);
  const round = parseExport(JSON.stringify(buildExport([{ id: 'abcdefghijk', sections: [], markers: [] }])));
  assert.equal(round.videos.length, 1);
});

test('mergeVideo keeps local, adds new, newest wins', () => {
  const local = {
    id: 'abcdefghijk', title: 'Local', channel: '', duration: 100, updatedAt: 1,
    sections: [{ id: 'a', name: 'old', a: 1, b: 2, speed: 1, createdAt: 1, updatedAt: 5 }],
    markers: [{ id: 'm1', t: 3, label: 'x', createdAt: 1 }],
  };
  const incoming = {
    ...local,
    title: 'Remote',
    sections: [
      { id: 'a', name: 'newer', a: 1, b: 2, speed: 1, createdAt: 1, updatedAt: 9 },
      { id: 'b', name: 'fresh', a: 0, b: 1, speed: 1, createdAt: 2, updatedAt: 2 },
    ],
    markers: [],
  };
  const { video, sectionsAdded, markersAdded } = mergeVideo(local, incoming);
  assert.equal(video.title, 'Local');
  assert.deepEqual(video.sections.map((s) => s.name), ['fresh', 'newer']);
  assert.equal(video.markers.length, 1);
  assert.equal(sectionsAdded, 1);
  assert.equal(markersAdded, 0);
});

test('withDefaults fills nested keys', () => {
  const s = withDefaults({ keys: { setA: 'q' }, trainer: { enabled: true } });
  assert.equal(s.keys.setA, 'q');
  assert.equal(s.keys.setB, DEFAULT_KEYS.setB);
  assert.equal(s.trainer.enabled, true);
  assert.equal(s.trainer.every, 2);
  assert.equal(s.preservePitch, true);
});

test('nextName skips taken names', () => {
  assert.equal(nextName([], 'Section'), 'Section 1');
  assert.equal(nextName([{ name: 'Section 2' }], 'Section'), 'Section 3');
  assert.equal(nextName([{ name: 'Section 2' }, { name: 'x' }], 'Section'), 'Section 3');
});
