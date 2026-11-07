// Practice bar entry point: tracks the current watch page, runs the loop engine and owns the state.
import { formatTime, formatSpeed, clamp } from '../shared/time.js';
import { SPEED_MIN, SPEED_MAX, uid, nextName, withDefaults } from '../shared/model.js';
import * as store from '../shared/storage.js';
import { createBar } from './bar.js';

const S = {
  videoId: null,
  video: null,
  player: null,
  a: null,
  b: null,
  loopOn: false,
  speed: 1,
  record: null,       // stored data for this video ({ sections, markers }) or null
  settings: null,
  activeId: null,     // id of the saved section currently loaded
  loops: 0,
  zoom: false,
  drag: null,         // set by the bar while a handle is being dragged
  gapTimer: null,
  ourRateAt: 0,
  adoptBlockUntil: 0,
  wasAd: false,
};

let bar = null;
let overlay = null;
let osd = null;
let osdTimer = null;
const boundVideos = new WeakSet();

export async function main() {
  S.settings = await store.getSettings();
  store.onStorageChange(onStorage);
  chrome.runtime.onMessage.addListener(onMessage);
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('yt-navigate-finish', check);
  setInterval(check, 1000);
  check();
  requestAnimationFrame(frame);
}

// ---------- page tracking ----------

function currentVideoId() {
  if (location.pathname !== '/watch') return null;
  return new URLSearchParams(location.search).get('v');
}

let checking = false;
async function check() {
  if (checking) return;
  checking = true;
  try {
    const id = currentVideoId();
    if (!id) {
      if (S.videoId) leaveVideo();
      return;
    }
    const player = document.querySelector('#movie_player');
    const video = player?.querySelector('video.html5-main-video') || player?.querySelector('video');
    const below = document.querySelector('ytd-watch-flexy #below');
    if (!player || !video || !below) return;
    if (id !== S.videoId) await enterVideo(id, player, video);
    else if (video !== S.video) bindVideo(video);
    mount(below, player);
    watchAds();
  } finally {
    checking = false;
  }
}

async function enterVideo(id, player, video) {
  clearGap();
  Object.assign(S, {
    videoId: id, player, a: null, b: null, loopOn: false, activeId: null, loops: 0, zoom: false,
  });
  bindVideo(video);
  S.speed = round2(video.playbackRate || 1);
  S.record = await store.getVideo(id);
  render();
  const sid = await store.takePending(id);
  if (sid) {
    const s = S.record?.sections.find((x) => x.id === sid);
    if (s) loadSection(s);
  }
}

function leaveVideo() {
  clearGap();
  S.videoId = null;
  S.loopOn = false;
  S.record = null;
  bar?.host.remove();
  overlay?.remove();
}

function bindVideo(video) {
  S.video = video;
  if (boundVideos.has(video)) return;
  boundVideos.add(video);
  video.addEventListener('timeupdate', checkLoop);
  video.addEventListener('ratechange', onRate);
  video.addEventListener('loadedmetadata', () => {
    if (S.video !== video) return;
    S.adoptBlockUntil = performance.now() + 1500;
    applyRate();
    render();
  });
  video.addEventListener('play', () => {
    if (S.gapTimer) clearGap();
  });
  video.addEventListener('durationchange', () => S.video === video && render());
}

function mount(below, player) {
  if (!bar) bar = createBar(S, actions);
  if (bar.host.parentElement !== below || below.firstElementChild !== bar.host) below.prepend(bar.host);

  const progress = player.querySelector('.ytp-progress-bar');
  if (progress && (!overlay || overlay.parentElement !== progress)) {
    overlay = overlay || Object.assign(document.createElement('div'), { className: 'ytl-overlay' });
    progress.appendChild(overlay);
    renderOverlay();
  }
  if (!osd || osd.parentElement !== player) {
    osd = osd || Object.assign(document.createElement('div'), { className: 'ytl-osd' });
    player.appendChild(osd);
  }
}

// ---------- ads ----------

const isAd = () => !!S.player?.classList.contains('ad-showing');

let adObserver = null;
function watchAds() {
  if (adObserver?.target === S.player) return;
  adObserver?.disconnect();
  const obs = new MutationObserver(() => {
    const ad = isAd();
    if (S.wasAd && !ad) {
      // Ad finished: YouTube resets the rate, so put ours back.
      S.adoptBlockUntil = performance.now() + 1500;
      applyRate();
    }
    S.wasAd = ad;
  });
  obs.observe(S.player, { attributes: true, attributeFilter: ['class'] });
  adObserver = { target: S.player, disconnect: () => obs.disconnect() };
}

// ---------- speed ----------

const round2 = (v) => Math.round(v * 100) / 100;

function applyRate() {
  const v = S.video;
  if (!v || isAd()) return;
  v.preservesPitch = S.settings.preservePitch;
  if (Math.abs(v.playbackRate - S.speed) > 0.001) {
    S.ourRateAt = performance.now();
    v.playbackRate = S.speed;
  }
}

function onRate() {
  const v = S.video;
  if (!v || isAd() || Math.abs(v.playbackRate - S.speed) < 0.001) return;
  const now = performance.now();
  if (now - S.ourRateAt < 300) return;
  if (now < S.adoptBlockUntil) { applyRate(); return; }
  // Changed through YouTube's own speed menu: follow it.
  S.speed = round2(v.playbackRate);
  bar?.renderControls();
}

function setSpeed(rate, { flash: show = false } = {}) {
  S.speed = clamp(round2(rate), SPEED_MIN, SPEED_MAX);
  applyRate();
  bar?.renderControls();
  bar?.renderChips();
  if (show) flash(formatSpeed(S.speed));
}

// ---------- loop engine ----------

function frame() {
  checkLoop();
  if (bar && !S.settings.collapsed && document.visibilityState === 'visible') bar.renderPlayhead();
  requestAnimationFrame(frame);
}

function checkLoop() {
  const v = S.video;
  if (!v || !S.loopOn || S.a == null || S.b == null || S.gapTimer || S.drag || isAd()) return;
  if (v.currentTime >= S.b) wrap();
}

function wrap() {
  const v = S.video;
  S.loops++;
  const t = S.settings.trainer;
  if (t.enabled && S.loops % Math.max(1, t.every) === 0 && S.speed < t.target - 0.001) {
    setSpeed(Math.min(t.target, S.speed + t.step));
    flash(`Speed up · ${formatSpeed(S.speed)}`);
  }
  if (S.settings.gap > 0 && !v.paused) {
    v.pause();
    v.currentTime = S.a;
    S.gapTimer = setTimeout(() => {
      S.gapTimer = null;
      v.play();
    }, S.settings.gap * 1000);
  } else {
    v.currentTime = S.a;
  }
  bar?.renderLoopCount();
}

function clearGap() {
  clearTimeout(S.gapTimer);
  S.gapTimer = null;
}

// ---------- actions (used by the bar and the keyboard) ----------

const now = () => S.video?.currentTime || 0;
const duration = () => (Number.isFinite(S.video?.duration) ? S.video.duration : 0);
const clampT = (t) => clamp(t, 0, duration() || t);

function seek(t) {
  if (!S.video) return;
  clearGap();
  S.video.currentTime = clampT(t);
}

function readMeta() {
  const title = document.querySelector('ytd-watch-metadata h1')?.textContent?.trim()
    || document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '');
  const channel = document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a')
    ?.textContent?.trim() || '';
  return { title, channel, duration: Math.round(duration()) };
}

function changed() {
  S.loops = 0;
  render();
}

function setA(t = now(), { flash: show } = {}) {
  t = clampT(t);
  S.a = t;
  if (S.b != null && S.b <= t + 0.05) S.b = null;
  changed();
  if (show) flash(`A  ${formatTime(t)}`);
}

function setB(t = now(), { flash: show } = {}) {
  t = clampT(t);
  if (S.a == null) S.a = 0;
  if (t <= S.a + 0.05) {
    flash('B has to be after A');
    bar?.toast('B has to be after A');
    return;
  }
  S.b = t;
  S.loopOn = true;   // setting the end point is the moment people expect the loop to start
  changed();
  if (show) flash(`B  ${formatTime(t)} · Loop on`);
}

function setRange(a, b) {
  S.a = clampT(a);
  S.b = clampT(b);
  changed();
}

function toggleLoop({ flash: show } = {}) {
  if (S.a == null || S.b == null) {
    const hint = `Set A and B first (${S.settings.keys.setA} and ${S.settings.keys.setB})`;
    bar?.toast(hint);
    if (show) flash(hint);
    return;
  }
  S.loopOn = !S.loopOn;
  if (S.loopOn && (now() < S.a || now() >= S.b)) seek(S.a);
  if (!S.loopOn) clearGap();
  S.loops = 0;
  render();
  if (show) flash(S.loopOn ? 'Loop on' : 'Loop off');
}

function clearLoop() {
  Object.assign(S, { a: null, b: null, loopOn: false, activeId: null, zoom: false });
  clearGap();
  changed();
}

function jumpA({ flash: show } = {}) {
  if (S.a == null) return;
  seek(S.a);
  if (show) flash('Back to A');
}

function loadSection(s) {
  Object.assign(S, { a: s.a, b: s.b, loopOn: true, activeId: s.id, loops: 0 });
  setSpeed(s.speed);
  seek(s.a);
  S.video?.play();
  render();
}

async function saveSection(name) {
  const section = {
    id: uid(), name, a: S.a, b: S.b, speed: S.speed, createdAt: Date.now(), updatedAt: Date.now(),
  };
  S.record = await store.updateVideo(S.videoId, readMeta(), (rec) => {
    rec.sections.push(section);
    rec.sections.sort((x, y) => x.a - y.a);
    return rec;
  });
  S.activeId = section.id;
  render();
  bar?.toast(`Saved “${name}”`);
}

async function updateSection(id, patch) {
  S.record = await store.updateVideo(S.videoId, readMeta(), (rec) => {
    const s = rec.sections.find((x) => x.id === id);
    if (s) Object.assign(s, patch, { updatedAt: Date.now() });
    rec.sections.sort((x, y) => x.a - y.a);
    return rec;
  });
  render();
  bar?.toast('Section updated');
}

async function deleteSection(id) {
  const removed = S.record?.sections.find((x) => x.id === id);
  if (!removed) return;
  S.record = await store.updateVideo(S.videoId, null, (rec) => {
    rec.sections = rec.sections.filter((x) => x.id !== id);
    return rec;
  });
  if (S.activeId === id) S.activeId = null;
  render();
  bar?.toast(`Deleted “${removed.name}”`, {
    label: 'Undo',
    run: async () => {
      S.record = await store.updateVideo(S.videoId, readMeta(), (rec) => {
        rec.sections.push(removed);
        rec.sections.sort((x, y) => x.a - y.a);
        return rec;
      });
      render();
    },
  });
}

async function addMarker(t = now(), { flash: show } = {}) {
  t = clampT(t);
  let label = '';
  S.record = await store.updateVideo(S.videoId, readMeta(), (rec) => {
    label = nextName(rec.markers, 'Marker', 'label');
    rec.markers.push({ id: uid(), t, label, createdAt: Date.now() });
    rec.markers.sort((x, y) => x.t - y.t);
    return rec;
  });
  render();
  if (show) flash(`${label}  ${formatTime(t)}`);
  else bar?.toast(`${label} added at ${formatTime(t)}`);
}

async function updateMarker(id, patch) {
  S.record = await store.updateVideo(S.videoId, null, (rec) => {
    const m = rec.markers.find((x) => x.id === id);
    if (m) Object.assign(m, patch);
    rec.markers.sort((x, y) => x.t - y.t);
    return rec;
  });
  render();
}

async function deleteMarker(id) {
  const removed = S.record?.markers.find((x) => x.id === id);
  if (!removed) return;
  S.record = await store.updateVideo(S.videoId, null, (rec) => {
    rec.markers = rec.markers.filter((x) => x.id !== id);
    return rec;
  });
  render();
  bar?.toast(`Deleted “${removed.label}”`, {
    label: 'Undo',
    run: async () => {
      S.record = await store.updateVideo(S.videoId, readMeta(), (rec) => {
        rec.markers.push(removed);
        rec.markers.sort((x, y) => x.t - y.t);
        return rec;
      });
      render();
    },
  });
}

const actions = {
  seek, setA, setB, setRange, toggleLoop, clearLoop, jumpA, setSpeed,
  loadSection, saveSection, updateSection, deleteSection,
  addMarker, updateMarker, deleteMarker,
  now, duration,
  play: () => S.video?.play(),
  setZoom: (on) => { S.zoom = on; bar?.renderTimeline(); },
  setSettings: (patch) => store.patchSettings(patch),
  openLibrary: () => chrome.runtime.sendMessage({ type: 'openLibrary' }),
  endDrag: (kind) => {
    S.loops = 0;
    if (kind === 'range') { S.loopOn = true; seek(S.a); }
    else if (kind === 'a' && S.loopOn) seek(S.a);
    render();
  },
  suggestName: () => nextName(S.record?.sections || [], 'Section'),
};

// ---------- rendering ----------

function render() {
  bar?.render();
  renderOverlay();
}

function renderOverlay() {
  if (!overlay) return;
  const d = duration();
  overlay.replaceChildren();
  if (!d) return;
  if (S.a != null && S.b != null) {
    const r = document.createElement('div');
    r.className = `ytl-ov-region${S.loopOn ? ' on' : ''}`;
    r.style.left = `${(S.a / d) * 100}%`;
    r.style.width = `${((S.b - S.a) / d) * 100}%`;
    overlay.appendChild(r);
  } else if (S.a != null) {
    const r = document.createElement('div');
    r.className = 'ytl-ov-a';
    r.style.left = `${(S.a / d) * 100}%`;
    overlay.appendChild(r);
  }
  for (const m of S.record?.markers || []) {
    const el = document.createElement('div');
    el.className = 'ytl-ov-marker';
    el.style.left = `${(m.t / d) * 100}%`;
    overlay.appendChild(el);
  }
}

function flash(text) {
  if (!osd) return;
  osd.textContent = text;
  osd.classList.add('show');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => osd.classList.remove('show'), 1100);
}

// ---------- storage / messages / keyboard ----------

function onStorage(changes) {
  if (changes.settings) {
    const before = S.settings;
    S.settings = withDefaults(changes.settings.newValue);
    if (before.preservePitch !== S.settings.preservePitch) applyRate();
    bar?.render();
  }
  const key = `video:${S.videoId}`;
  if (S.videoId && changes[key]) {
    S.record = changes[key].newValue || null;
    if (S.activeId && !S.record?.sections.some((x) => x.id === S.activeId)) S.activeId = null;
    render();
  }
}

function onMessage(msg) {
  if (msg?.type === 'loadSection' && msg.videoId === S.videoId) {
    store.getVideo(S.videoId).then((rec) => {
      S.record = rec;
      const s = rec?.sections.find((x) => x.id === msg.sectionId);
      if (s) loadSection(s);
    });
  } else if (msg?.type === 'seek' && msg.videoId === S.videoId) {
    seek(msg.t);
    S.video?.play();
  }
}

function isTyping(e) {
  const el = e.composedPath()[0];
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

function onKey(e) {
  if (!S.videoId || !S.video || e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
  const k = S.settings.keys;
  const map = {
    [k.setA]: () => setA(now(), { flash: true }),
    [k.setB]: () => setB(now(), { flash: true }),
    [k.toggleLoop]: () => toggleLoop({ flash: true }),
    [k.jumpA]: () => jumpA({ flash: true }),
    [k.slower]: () => setSpeed(S.speed - S.settings.speedStep, { flash: true }),
    [k.faster]: () => setSpeed(S.speed + S.settings.speedStep, { flash: true }),
    [k.marker]: () => addMarker(now(), { flash: true }),
  };
  const fn = map[e.key];
  if (!fn) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  fn();
}
