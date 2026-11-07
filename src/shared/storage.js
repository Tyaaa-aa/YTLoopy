// chrome.storage.local wrapper. One key per video ("video:<id>") so the bar and the library
// rarely write the same key at the same moment.
import { emptyVideo, withDefaults, mergeVideo, hasContent } from './model.js';

const area = chrome.storage.local;
const videoKey = (id) => `video:${id}`;

export async function getVideo(id) {
  const key = videoKey(id);
  const got = await area.get(key);
  return got[key] || null;
}

/** Read-modify-write one video. `fn` gets a copy (created if missing) and returns the new record. */
export async function updateVideo(id, meta, fn) {
  const current = (await getVideo(id)) || emptyVideo(id, meta);
  const next = fn(structuredClone(current)) || current;
  next.updatedAt = Date.now();
  if (meta) {
    if (meta.title) next.title = meta.title;
    if (meta.channel) next.channel = meta.channel;
    if (meta.duration) next.duration = meta.duration;
  }
  if (hasContent(next)) await area.set({ [videoKey(id)]: next });
  else await area.remove(videoKey(id));
  return next;
}

export async function putVideo(video) {
  await area.set({ [videoKey(video.id)]: video });
}

export async function deleteVideo(id) {
  await area.remove(videoKey(id));
}

export async function getAllVideos() {
  const all = await area.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith('video:'))
    .map(([, v]) => v);
}

export async function importVideos(videos) {
  let sections = 0;
  let markers = 0;
  for (const incoming of videos) {
    const { video, sectionsAdded, markersAdded } = mergeVideo(await getVideo(incoming.id), incoming);
    sections += sectionsAdded;
    markers += markersAdded;
    await putVideo(video);
  }
  return { videos: videos.length, sections, markers };
}

export async function getSettings() {
  const { settings } = await area.get('settings');
  return withDefaults(settings);
}

export async function patchSettings(patch) {
  const current = await getSettings();
  const next = withDefaults({
    ...current,
    ...patch,
    keys: { ...current.keys, ...(patch.keys || {}) },
    trainer: { ...current.trainer, ...(patch.trainer || {}) },
  });
  await area.set({ settings: next });
  return next;
}

/** Hand-off from the library to a tab that is about to load a video. */
export async function setPending(videoId, sectionId) {
  await area.set({ pending: { videoId, sectionId, ts: Date.now() } });
}

export async function takePending(videoId) {
  const { pending } = await area.get('pending');
  if (!pending || pending.videoId !== videoId || Date.now() - pending.ts > 60_000) return null;
  await area.remove('pending');
  return pending.sectionId;
}

export function onStorageChange(fn) {
  chrome.storage.onChanged.addListener((changes, name) => {
    if (name === 'local') fn(changes);
  });
}
