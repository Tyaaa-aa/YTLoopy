// Library side panel: browse, play, rename and delete saved sections; import/export; settings.
import { formatTime, formatSpeed } from '../shared/time.js';
import { KEY_LABELS, DEFAULT_KEYS, buildExport, parseExport } from '../shared/model.js';
import * as store from '../shared/storage.js';
import { icon, logo } from '../shared/icons.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const keyName = (k) => (k === ' ' ? 'Space' : k);

let videos = [];
let settings = null;
let nowId = null;          // video id in the active tab, if it's a watch page
let nowTabId = null;
const expanded = new Set();
let editing = null;        // { videoId, sectionId } being renamed

// ---------- boot ----------

$('.logo').innerHTML = logo(24);
document.querySelectorAll('[data-act="import"]').forEach((b) => { b.innerHTML = b.classList.contains('btn') ? `${icon('download', 16)}Import` : icon('download', 18); });
document.querySelectorAll('[data-act="export"]').forEach((b) => { b.innerHTML = b.classList.contains('btn') ? `${icon('upload', 16)}Export library` : icon('upload', 18); });
$('[data-act="settings"]').innerHTML = icon('gear', 18);
$('[data-act="back"]').innerHTML = icon('chevL', 20);
$('.search-ic').innerHTML = icon('search', 16);
$('#version').textContent = `YTLoopy ${chrome.runtime.getManifest().version}`;

async function load() {
  [videos, settings] = await Promise.all([store.getAllVideos(), store.getSettings()]);
  render();
  renderSettings();
}

store.onStorageChange(async (changes) => {
  if (Object.keys(changes).some((k) => k.startsWith('video:'))) videos = await store.getAllVideos();
  if (changes.settings) { settings = await store.getSettings(); renderSettings(); }
  render();
});

async function refreshNow() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const id = videoIdFrom(tab?.url);
  nowTabId = tab?.id ?? null;
  if (id !== nowId) {
    nowId = id;
    if (id) expanded.add(id);
    render();
  }
}
chrome.tabs.onActivated.addListener(refreshNow);
chrome.tabs.onUpdated.addListener((_, info) => { if (info.url) refreshNow(); });
chrome.windows?.onFocusChanged.addListener(refreshNow);

function videoIdFrom(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'www.youtube.com' && u.pathname === '/watch') return u.searchParams.get('v');
  } catch { /* not a URL */ }
  return null;
}

// ---------- library rendering ----------

function matches(v, q) {
  if (!q) return true;
  const hay = [v.title, v.channel, ...v.sections.map((s) => s.name), ...v.markers.map((m) => m.label)].join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function render() {
  if (!settings) return;
  const q = $('#q').value.trim().toLowerCase();
  const sort = $('#sort').value;
  const list = videos.filter((v) => matches(v, q));
  list.sort(sort === 'title' ? (x, y) => x.title.localeCompare(y.title) : (x, y) => y.updatedAt - x.updatedAt);

  const nowVideo = nowId && videos.find((v) => v.id === nowId);
  const now = $('#now');
  now.replaceChildren();
  if (nowId && !q) {
    now.insertAdjacentHTML('beforeend', '<h2 class="sec-title">Now playing</h2>');
    if (nowVideo) now.appendChild(card(nowVideo, true));
    else now.insertAdjacentHTML('beforeend', `<div class="now-empty">Nothing saved for this video yet. Use the YTLoopy bar under the player, or press <kbd>${esc(keyName(settings.keys.setA))}</kbd> and <kbd>${esc(keyName(settings.keys.setB))}</kbd>.</div>`);
  }

  const el = $('#list');
  el.replaceChildren();
  const rest = q ? list : list.filter((v) => v.id !== nowId);
  if (!videos.length) {
    el.innerHTML = `
      <div class="empty">
        <div class="empty-logo">${logo(56)}</div>
        <h2>Your practice library is empty</h2>
        <ol>
          <li>Open any YouTube video.</li>
          <li>Press <kbd>${esc(keyName(settings.keys.setA))}</kbd> where a passage starts and <kbd>${esc(keyName(settings.keys.setB))}</kbd> where it ends. It loops right away.</li>
          <li>Slow it down with <kbd>${esc(keyName(settings.keys.slower))}</kbd>, then hit <b>Save</b> in the bar under the video.</li>
        </ol>
        <p>Saved sections and markers show up here.</p>
      </div>`;
    return;
  }
  if (!rest.length) {
    el.innerHTML = q ? `<div class="none">No matches for “${esc(q)}”.</div>` : '';
    return;
  }
  el.insertAdjacentHTML('beforeend', `<h2 class="sec-title">${q ? 'Results' : 'All videos'} <span class="count">${rest.length}</span></h2>`);
  for (const v of rest) el.appendChild(card(v, false, q));
}

function card(v, isNow, q = '') {
  const open = expanded.has(v.id) || !!q;
  const node = document.createElement('article');
  node.className = `card${open ? ' open' : ''}${isNow ? ' now' : ''}`;
  node.dataset.id = v.id;
  const counts = [
    v.sections.length && `${v.sections.length} section${v.sections.length > 1 ? 's' : ''}`,
    v.markers.length && `${v.markers.length} marker${v.markers.length > 1 ? 's' : ''}`,
  ].filter(Boolean).join(' · ');
  node.innerHTML = `
    <div class="card-head" data-act="toggle" role="button" tabindex="0" aria-expanded="${open}">
      <img class="thumb" alt="" loading="lazy" src="https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/mqdefault.jpg">
      <div class="meta">
        <div class="title"></div>
        <div class="sub"><span class="channel"></span></div>
        <div class="sub">${counts}</div>
      </div>
      <button class="ic sm more" data-act="menu" title="More">${icon('more', 18)}</button>
    </div>
    <div class="card-body"></div>`;
  node.querySelector('.title').textContent = v.title;
  node.querySelector('.title').title = v.title;
  node.querySelector('.channel').textContent = v.channel;
  if (open) fillBody(node.querySelector('.card-body'), v, isNow || v.id === nowId);
  return node;
}

function fillBody(body, v, playingHere) {
  for (const s of v.sections) {
    const row = document.createElement('div');
    row.className = 'item section';
    row.dataset.sid = s.id;
    const isEditing = editing?.sectionId === s.id;
    row.innerHTML = `
      <button class="play" data-act="play" title="${playingHere ? 'Loop this section' : 'Open and loop this section'}">${icon('play', 14)}</button>
      <div class="item-main">
        ${isEditing ? '<input class="rename" maxlength="80">' : '<div class="item-name" data-act="rename" title="Double-click to rename"></div>'}
        <div class="item-sub">${formatTime(s.a)} – ${formatTime(s.b)} <span class="dur">${formatTime(s.b - s.a)}</span>${Math.abs(s.speed - 1) > 0.001 ? ` <span class="spd">${formatSpeed(s.speed)}</span>` : ''}</div>
      </div>
      <button class="ic sm" data-act="edit" title="Rename">${icon('edit', 15)}</button>
      <button class="ic sm danger" data-act="delSection" title="Delete">${icon('trash', 15)}</button>`;
    if (isEditing) {
      const input = row.querySelector('.rename');
      input.value = s.name;
      queueMicrotask(() => { input.focus(); input.select(); });
      const done = async (save) => {
        if (editing?.sectionId !== s.id) return;
        editing = null;
        const name = input.value.trim();
        if (save && name && name !== s.name) {
          await store.updateVideo(v.id, null, (rec) => {
            const x = rec.sections.find((y) => y.id === s.id);
            if (x) { x.name = name; x.updatedAt = Date.now(); }
            return rec;
          });
        } else render();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      });
      input.addEventListener('blur', () => done(true));
    } else {
      row.querySelector('.item-name').textContent = s.name;
    }
    body.appendChild(row);
  }
  if (v.markers.length) {
    const wrap = document.createElement('div');
    wrap.className = 'markers';
    for (const m of v.markers) {
      const chip = document.createElement('button');
      chip.className = 'marker';
      chip.dataset.act = 'marker';
      chip.dataset.mid = m.id;
      chip.title = `Jump to ${formatTime(m.t)}`;
      chip.innerHTML = `${icon('flag', 12)}<span class="m-label"></span><span class="m-time">${formatTime(m.t, 0)}</span>`;
      chip.querySelector('.m-label').textContent = m.label;
      wrap.appendChild(chip);
    }
    body.appendChild(wrap);
  }
}

// ---------- actions ----------

async function openAt(videoId, t, sectionId = null) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (videoIdFrom(tab?.url) === videoId) {
    const msg = sectionId ? { type: 'loadSection', videoId, sectionId } : { type: 'seek', videoId, t };
    chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    return;
  }
  if (sectionId) await store.setPending(videoId, sectionId);
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.floor(t)}s`;
  if (tab?.url?.startsWith('https://www.youtube.com/')) chrome.tabs.update(tab.id, { url });
  else chrome.tabs.create({ url });
}

async function deleteSection(v, sid) {
  const removed = v.sections.find((s) => s.id === sid);
  await store.updateVideo(v.id, null, (rec) => {
    rec.sections = rec.sections.filter((s) => s.id !== sid);
    return rec;
  });
  toast(`Deleted “${removed.name}”`, {
    label: 'Undo',
    run: () => store.updateVideo(v.id, null, (rec) => {
      rec.sections.push(removed);
      rec.sections.sort((x, y) => x.a - y.a);
      return rec;
    }),
  });
}

async function deleteVideo(v) {
  const copy = structuredClone(v);
  await store.deleteVideo(v.id);
  toast(`Removed “${v.title.slice(0, 40)}”`, { label: 'Undo', run: () => store.putVideo(copy) });
}

function download(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const today = () => new Date().toISOString().slice(0, 10);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';

function exportAll() {
  if (!videos.length) { toast('Nothing to export yet'); return; }
  download(buildExport(videos), `ytloopy-library-${today()}.json`);
  const n = videos.reduce((sum, v) => sum + v.sections.length, 0);
  toast(`Exported ${videos.length} video${videos.length > 1 ? 's' : ''}, ${n} section${n === 1 ? '' : 's'}`);
}

$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { videos: incoming } = parseExport(await file.text());
    if (!incoming.length) { toast('That file has no videos in it'); return; }
    const r = await store.importVideos(incoming);
    toast(`Imported ${r.videos} video${r.videos > 1 ? 's' : ''}: ${r.sections} new section${r.sections === 1 ? '' : 's'}, ${r.markers} new marker${r.markers === 1 ? '' : 's'}`);
  } catch (err) {
    toast(err.message || 'Import failed');
  }
});

// Card menu: a tiny floating menu built on demand.
let menu = null;
function openMenu(anchor, v) {
  closeMenu();
  menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = `
    <button data-m="open">${icon('external', 16)}Open video</button>
    <button data-m="export">${icon('upload', 16)}Export this video</button>
    <button data-m="delete" class="danger">${icon('trash', 16)}Remove from library</button>`;
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    closeMenu();
    if (b.dataset.m === 'open') openAt(v.id, 0);
    if (b.dataset.m === 'export') download(buildExport([v]), `ytloopy-${slug(v.title)}.json`);
    if (b.dataset.m === 'delete') deleteVideo(v);
  });
}
function closeMenu() { menu?.remove(); menu = null; }
document.addEventListener('pointerdown', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const cardEl = btn.closest('.card');
  const v = cardEl && videos.find((x) => x.id === cardEl.dataset.id);
  const sid = btn.closest('.item')?.dataset.sid;
  const s = v && sid && v.sections.find((x) => x.id === sid);
  switch (act) {
    case 'toggle':
      if (e.target.closest('[data-act="menu"]')) return;
      if (expanded.has(v.id)) expanded.delete(v.id); else expanded.add(v.id);
      render();
      break;
    case 'menu': e.stopPropagation(); openMenu(btn, v); break;
    case 'play': if (s) openAt(v.id, s.a, s.id); break;
    case 'edit': if (s) { editing = { videoId: v.id, sectionId: s.id }; render(); } break;
    case 'delSection': if (s) deleteSection(v, s.id); break;
    case 'marker': {
      const m = v?.markers.find((x) => x.id === btn.dataset.mid);
      if (m) openAt(v.id, m.t);
      break;
    }
    case 'import': $('#file').click(); break;
    case 'export': exportAll(); break;
    case 'settings': showSettings(true); break;
    case 'back': showSettings(false); break;
    case 'resetKeys': store.patchSettings({ keys: { ...DEFAULT_KEYS } }); toast('Shortcuts reset'); break;
    default: break;
  }
});

document.addEventListener('dblclick', (e) => {
  const name = e.target.closest('.item-name');
  if (!name) return;
  editing = { videoId: name.closest('.card').dataset.id, sectionId: name.closest('.item').dataset.sid };
  render();
});

document.addEventListener('keydown', (e) => {
  const head = e.target.closest?.('.card-head');
  if (head && (e.key === 'Enter' || e.key === ' ') && e.target === head) { e.preventDefault(); head.click(); }
});

$('#q').addEventListener('input', render);
$('#sort').addEventListener('change', render);

// ---------- settings ----------

function showSettings(on) {
  $('#library').hidden = on;
  $('#settings').hidden = !on;
}

const seg = (el, values, current, fmt, onPick) => {
  el.innerHTML = values.map((v) => `<button data-v="${v}" class="${v === current ? 'sel' : ''}">${fmt(v)}</button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('button'); if (b) onPick(parseFloat(b.dataset.v)); };
};

let capturing = null; // shortcut id waiting for a key press

function renderSettings() {
  if (!settings) return;
  $('#pitch').setAttribute('aria-checked', String(settings.preservePitch));
  seg($('#gap'), [0, 1, 2, 3, 5], settings.gap, (v) => (v ? `${v}s` : 'Off'), (v) => store.patchSettings({ gap: v }));
  seg($('#step'), [0.05, 0.1, 0.25], settings.speedStep, (v) => `${v}×`, (v) => store.patchSettings({ speedStep: v }));
  $('#keys').innerHTML = Object.entries(KEY_LABELS).map(([id, label]) => `
    <div class="row key">
      <div class="label">${label}</div>
      <button class="keycap${capturing === id ? ' capturing' : ''}" data-key="${id}">${capturing === id ? 'Press a key…' : esc(keyName(settings.keys[id]))}</button>
    </div>`).join('');
}

$('#pitch').addEventListener('click', () => store.patchSettings({ preservePitch: !settings.preservePitch }));

$('#keys').addEventListener('click', (e) => {
  const b = e.target.closest('[data-key]');
  if (!b) return;
  capturing = capturing === b.dataset.key ? null : b.dataset.key;
  renderSettings();
});

// YouTube's own single-key shortcuts; binding these would fight the player.
const YT_KEYS = new Set(['k', 'j', 'l', 'f', 't', 'i', 'm', 'c', 'n', 'p', ',', '.', '<', '>', '/', ' ', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

window.addEventListener('keydown', async (e) => {
  if (!capturing) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') { capturing = null; renderSettings(); return; }
  if (['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Enter', 'Backspace'].includes(e.key)) return;
  if (YT_KEYS.has(e.key.length === 1 ? e.key.toLowerCase() : e.key)) {
    toast(`“${keyName(e.key)}” is one of YouTube's own shortcuts. Pick another key.`);
    return;
  }
  const clash = Object.entries(settings.keys).find(([id, k]) => k === e.key && id !== capturing);
  const id = capturing;
  capturing = null;
  const keys = { [id]: e.key };
  if (clash) keys[clash[0]] = settings.keys[id]; // swap so nothing ends up unbound
  await store.patchSettings({ keys });
  if (clash) toast(`Swapped with “${KEY_LABELS[clash[0]]}”`);
}, true);

// ---------- toast ----------

let toastTimer = null;
function toast(text, action = null) {
  const t = $('.toast');
  t.hidden = false;
  t.querySelector('.msg').textContent = text;
  const btn = t.querySelector('.toast-act');
  btn.hidden = !action;
  btn.textContent = action?.label || '';
  btn.onclick = action ? () => { t.hidden = true; action.run(); } : null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3500);
}

load();
refreshNow();
