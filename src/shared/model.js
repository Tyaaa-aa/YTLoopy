// Pure data helpers: defaults, validation, import/export merging. No chrome.* here so it can be unit tested.
import { SCHEMA_VERSION, migrate } from './migrations.js';

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 2;

export const DEFAULT_KEYS = {
  setA: '[',
  setB: ']',
  toggleLoop: '\\',
  jumpA: "'",
  slower: '-',
  faster: '=',
  marker: ';',
};

export const KEY_LABELS = {
  setA: 'Set loop start (A)',
  setB: 'Set loop end (B)',
  toggleLoop: 'Loop on / off',
  jumpA: 'Jump to loop start',
  slower: 'Slower',
  faster: 'Faster',
  marker: 'Add marker',
};

export const DEFAULT_SETTINGS = {
  preservePitch: true,
  gap: 0,               // seconds of silence before each repeat
  speedStep: 0.05,
  collapsed: false,
  keys: { ...DEFAULT_KEYS },
  trainer: { enabled: false, step: 0.05, every: 2, target: 1 },
};

export function withDefaults(settings) {
  const s = settings || {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    keys: { ...DEFAULT_KEYS, ...(s.keys || {}) },
    trainer: { ...DEFAULT_SETTINGS.trainer, ...(s.trainer || {}) },
  };
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function emptyVideo(id, meta = {}) {
  return {
    id,
    title: meta.title || 'Untitled video',
    channel: meta.channel || '',
    duration: meta.duration || 0,
    updatedAt: Date.now(),
    sections: [],
    markers: [],
  };
}

export const isVideoId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(id);

const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const str = (v, fallback = '') => (typeof v === 'string' ? v.slice(0, 300) : fallback);

/** Cleans one video record from an untrusted source (an import file). Returns null if unusable. */
export function sanitizeVideo(raw) {
  if (!raw || typeof raw !== 'object' || !isVideoId(raw.id)) return null;
  const now = Date.now();
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .filter((s) => s && Number.isFinite(s.a) && Number.isFinite(s.b) && s.b > s.a && s.a >= 0)
    .map((s) => ({
      id: str(s.id) || uid(),
      name: str(s.name, 'Section') || 'Section',
      a: s.a,
      b: s.b,
      speed: Math.min(SPEED_MAX, Math.max(SPEED_MIN, num(s.speed, 1))),
      createdAt: num(s.createdAt, now),
      updatedAt: num(s.updatedAt, num(s.createdAt, now)),
    }));
  const markers = (Array.isArray(raw.markers) ? raw.markers : [])
    .filter((m) => m && Number.isFinite(m.t) && m.t >= 0)
    .map((m) => ({
      id: str(m.id) || uid(),
      t: m.t,
      label: str(m.label, 'Marker') || 'Marker',
      createdAt: num(m.createdAt, now),
    }));
  return {
    id: raw.id,
    title: str(raw.title, 'Untitled video') || 'Untitled video',
    channel: str(raw.channel),
    duration: num(raw.duration),
    updatedAt: num(raw.updatedAt, now),
    sections,
    markers,
  };
}

/** Checks an import file. Returns { videos } or throws an Error with a message fit to show the user. */
export function parseExport(json) {
  let data;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!data || data.app !== 'YTLoopy' || !Array.isArray(data.videos)) {
    throw new Error("That file isn't a YTLoopy export.");
  }
  const version = Number.isInteger(data.version) && data.version > 0 ? data.version : 1;
  if (version > SCHEMA_VERSION) {
    throw new Error('That file comes from a newer YTLoopy. Update the extension first.');
  }
  // Older files are upgraded with the same steps that upgrade stored data.
  const asStorage = Object.fromEntries(
    data.videos.filter((v) => v && isVideoId(v.id)).map((v) => [`video:${v.id}`, v]),
  );
  const { data: upgraded } = migrate(asStorage, { from: version });
  const videos = Object.values(upgraded).map(sanitizeVideo).filter(Boolean);
  return { videos, version };
}

export function buildExport(videos, appVersion = '') {
  return {
    app: 'YTLoopy',
    version: SCHEMA_VERSION,   // data format; what import checks
    appVersion,                // informational only
    exportedAt: new Date().toISOString(),
    videos,
  };
}

function mergeById(current, incoming, stamp) {
  const out = new Map(current.map((x) => [x.id, x]));
  let added = 0;
  for (const item of incoming) {
    const have = out.get(item.id);
    if (!have) { out.set(item.id, item); added++; }
    else if (stamp(item) > stamp(have)) out.set(item.id, item);
  }
  return { list: [...out.values()], added };
}

/** Merges an imported video into what's stored. Newest item wins; nothing local is deleted. */
export function mergeVideo(existing, incoming) {
  if (!existing) {
    return { video: incoming, sectionsAdded: incoming.sections.length, markersAdded: incoming.markers.length };
  }
  const s = mergeById(existing.sections, incoming.sections, (x) => x.updatedAt || x.createdAt || 0);
  const m = mergeById(existing.markers, incoming.markers, (x) => x.createdAt || 0);
  return {
    video: {
      ...existing,
      title: existing.title === 'Untitled video' ? incoming.title : existing.title,
      channel: existing.channel || incoming.channel,
      duration: existing.duration || incoming.duration,
      updatedAt: Math.max(existing.updatedAt || 0, incoming.updatedAt || 0),
      sections: s.list.sort((x, y) => x.a - y.a),
      markers: m.list.sort((x, y) => x.t - y.t),
    },
    sectionsAdded: s.added,
    markersAdded: m.added,
  };
}

export const hasContent = (v) => !!v && (v.sections.length > 0 || v.markers.length > 0);

/** Next default name like "Section 3" that isn't taken yet. */
export function nextName(list, prefix, key = 'name') {
  const taken = new Set(list.map((x) => x[key]));
  let n = list.length + 1;
  while (taken.has(`${prefix} ${n}`)) n++;
  return `${prefix} ${n}`;
}
