// Storage schema history. Pure (no chrome.*) so it can be unit tested.
//
// When a new feature changes the shape of stored data:
//   1. bump SCHEMA_VERSION,
//   2. append a step { to: <new version>, describe, run } to MIGRATIONS.
// A step receives the whole storage object ({ settings, 'video:<id>': {...}, ... }) at the previous
// version and returns it at `to`. Steps must only add or transform data: never drop fields or keys
// they don't know about. Fields that are simply new and optional don't need a step at all:
// withDefaults() and the readers already fill those in.
//
// The same steps upgrade old export files on import, so a backup made with any older version
// always imports into a newer one.

export const SCHEMA_VERSION = 1;

export const MIGRATIONS = [
  // Example for the future:
  // { to: 2, describe: 'sections get tags', run: (data) => mapVideos(data, (v) => ({
  //   ...v, sections: v.sections.map((s) => ({ tags: [], ...s })) })) },
];

/** Helper for steps: apply `fn` to every stored video record. */
export function mapVideos(data, fn) {
  const out = {};
  for (const [k, v] of Object.entries(data)) out[k] = k.startsWith('video:') ? fn(v) : v;
  return out;
}

/**
 * Brings `data` from schema `from` up to `to`. Returns { data, version }.
 * Data from a newer schema (a downgrade) is returned untouched so nothing gets lost.
 */
export function migrate(data, { from, to = SCHEMA_VERSION, steps = MIGRATIONS } = {}) {
  if (from >= to) return { data, version: from };
  let out = structuredClone(data);
  let version = from;
  for (const step of [...steps].sort((x, y) => x.to - y.to)) {
    if (step.to <= from || step.to > to) continue;
    out = step.run(out);
    version = step.to;
  }
  return { data: out, version: to };
}

/** Keys the extension uses for bookkeeping rather than library data. */
export const isDataKey = (k) => k === 'settings' || k.startsWith('video:');
