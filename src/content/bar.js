// The practice bar under the player. Lives in a shadow root so YouTube's CSS and ours never mix.
import { formatTime, parseTime, formatSpeed, clamp } from '../shared/time.js';
import { SPEED_MIN, SPEED_MAX, KEY_LABELS } from '../shared/model.js';
import { icon, logo } from '../shared/icons.js';

const PRESETS = [0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 1, 1.25, 1.5, 2];
const GAPS = [0, 1, 2, 3, 5];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const keyName = (k) => (k === ' ' ? 'Space' : k);

function timeField(k) {
  const label = k.toUpperCase();
  return `
    <div class="tf" data-k="${k}">
      <button class="ic sm" data-act="nudge" data-k="${k}" data-d="-1" title="Earlier by 0.1 s (Shift: 1 s)">${icon('chevL', 14)}</button>
      <label class="tf-box"><span class="tag tag-${k}">${label}</span><input class="time" data-k="${k}" placeholder="–:––" spellcheck="false" autocomplete="off" aria-label="Loop ${k === 'a' ? 'start' : 'end'}"></label>
      <button class="ic sm" data-act="nudge" data-k="${k}" data-d="1" title="Later by 0.1 s (Shift: 1 s)">${icon('chevR', 14)}</button>
      <button class="ic sm now" data-act="setnow" data-k="${k}">${icon('target', 15)}</button>
    </div>`;
}

const TEMPLATE = `
  <div class="bar">
    <div class="row top">
      <span class="brand" title="YTLoopy">${logo(22)}<span class="name">YTLoopy</span></span>
      <button class="pill loop" data-act="loop" aria-pressed="false">${icon('repeat', 16)}<span>Loop</span></button>
      <span class="summary"></span>
      <div class="cluster ab full">${timeField('a')}${timeField('b')}</div>
      <div class="cluster speed full">
        <button class="ic" data-act="slower">${icon('minus', 16)}</button>
        <button class="speedval" data-act="speedmenu" title="Playback speed"></button>
        <button class="ic" data-act="faster">${icon('plus', 16)}</button>
        <button class="ic toggle pitch" data-act="pitch" aria-pressed="true">${icon('note', 16)}</button>
      </div>
      <div class="spacer"></div>
      <div class="cluster actions full">
        <button class="btn" data-act="marker">${icon('flag', 16)}<span>Marker</span></button>
        <button class="btn primary" data-act="save">${icon('bookmark', 16)}<span>Save</span></button>
        <button class="ic" data-act="practice" title="Practice options">${icon('sliders', 17)}</button>
        <button class="ic" data-act="library" title="Open library">${icon('panel', 17)}</button>
      </div>
      <button class="ic collapse" data-act="collapse"></button>
    </div>
    <div class="row tlrow full">
      <div class="tl" aria-label="Loop timeline">
        <div class="tl-track"></div>
        <div class="tl-region"></div>
        <div class="tl-markers"></div>
        <div class="tl-head"></div>
        <div class="tl-handle" data-h="a"><span>A</span></div>
        <div class="tl-handle" data-h="b"><span>B</span></div>
        <div class="tl-hover"></div>
        <span class="tl-edge l"></span><span class="tl-edge r"></span>
      </div>
      <span class="count" title="Repeats"></span>
      <button class="ic sm" data-act="zoom"></button>
      <button class="ic sm" data-act="clear" title="Clear loop">${icon('x', 15)}</button>
    </div>
    <div class="row chips full"></div>
    <div class="pop" hidden></div>
    <div class="toast" hidden><span class="msg"></span><button class="toast-act"></button></div>
  </div>`;

export function createBar(S, A) {
  const host = document.createElement('div');
  host.id = 'ytloopy-bar';
  host.style.visibility = 'hidden';
  const root = host.attachShadow({ mode: 'open' });
  // Inline the stylesheet: a <link> to the extension inside YouTube's page is blocked as cross-origin.
  const css = document.createElement('style');
  fetch(chrome.runtime.getURL('src/content/bar.css'))
    .then((r) => r.text())
    .then((text) => { css.textContent = text; host.style.visibility = ''; });
  root.append(css);
  const tpl = document.createElement('template');
  tpl.innerHTML = TEMPLATE;
  root.append(tpl.content);

  const $ = (sel) => root.querySelector(sel);
  const el = {
    bar: $('.bar'),
    loop: $('.loop'),
    summary: $('.summary'),
    inA: $('input[data-k="a"]'),
    inB: $('input[data-k="b"]'),
    speed: $('.speedval'),
    pitch: $('.pitch'),
    collapse: $('.collapse'),
    tl: $('.tl'),
    region: $('.tl-region'),
    markers: $('.tl-markers'),
    head: $('.tl-head'),
    hA: $('.tl-handle[data-h="a"]'),
    hB: $('.tl-handle[data-h="b"]'),
    hover: $('.tl-hover'),
    edgeL: $('.tl-edge.l'),
    edgeR: $('.tl-edge.r'),
    count: $('.count'),
    zoom: $('[data-act="zoom"]'),
    chips: $('.chips'),
    pop: $('.pop'),
    toast: $('.toast'),
  };

  // Follow YouTube's light/dark theme.
  const syncTheme = () => host.toggleAttribute('data-dark', document.documentElement.hasAttribute('dark'));
  syncTheme();
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });

  const isModified = () => {
    const s = S.record?.sections.find((x) => x.id === S.activeId);
    return !!s && (Math.abs(s.a - S.a) > 0.001 || Math.abs(s.b - S.b) > 0.001 || Math.abs(s.speed - S.speed) > 0.001);
  };

  // ---------- rendering ----------

  function renderControls() {
    const k = S.settings.keys;
    const hasLoop = S.a != null && S.b != null;
    el.bar.classList.toggle('collapsed', !!S.settings.collapsed);
    el.loop.setAttribute('aria-pressed', String(S.loopOn));
    el.loop.classList.toggle('ready', hasLoop);
    el.loop.title = hasLoop ? `Loop on / off (${keyName(k.toggleLoop)})` : `Set A (${k.setA}) and B (${k.setB}) to loop`;
    for (const [input, v] of [[el.inA, S.a], [el.inB, S.b]]) {
      if (root.activeElement !== input) input.value = v == null ? '' : formatTime(v);
    }
    root.querySelector('[data-act="setnow"][data-k="a"]').title = `Set A to current time (${keyName(k.setA)})`;
    root.querySelector('[data-act="setnow"][data-k="b"]').title = `Set B to current time (${keyName(k.setB)})`;
    root.querySelector('[data-act="slower"]').title = `Slower (${keyName(k.slower)})`;
    root.querySelector('[data-act="faster"]').title = `Faster (${keyName(k.faster)})`;
    root.querySelector('[data-act="marker"]').title = `Add a marker at the current time (${keyName(k.marker)})`;
    el.speed.textContent = formatSpeed(S.speed);
    el.speed.classList.toggle('changed', Math.abs(S.speed - 1) > 0.001);
    el.pitch.setAttribute('aria-pressed', String(S.settings.preservePitch));
    el.pitch.title = S.settings.preservePitch
      ? 'Keep pitch: on (slowed audio stays in tune)'
      : 'Keep pitch: off (pitch follows speed, like tape)';
    el.collapse.innerHTML = icon(S.settings.collapsed ? 'chevD' : 'chevU', 18);
    el.collapse.title = S.settings.collapsed ? 'Show YTLoopy controls' : 'Hide YTLoopy controls';
    const parts = [];
    if (hasLoop) parts.push(`${formatTime(S.a)} – ${formatTime(S.b)}`);
    if (Math.abs(S.speed - 1) > 0.001) parts.push(formatSpeed(S.speed));
    el.summary.textContent = parts.join(' · ');
  }

  function view() {
    if (S.drag?.view) return S.drag.view;
    const d = A.duration();
    if (S.zoom && S.a != null && S.b != null) {
      const pad = Math.max(1.5, (S.b - S.a) * 0.35);
      return [Math.max(0, S.a - pad), Math.min(d, S.b + pad)];
    }
    return [0, d];
  }
  const pct = (t, [v0, v1]) => ((t - v0) / (v1 - v0 || 1)) * 100;

  function renderTimeline() {
    const d = A.duration();
    el.tl.classList.toggle('empty', !d);
    if (!d) return;
    const v = view();
    const hasA = S.a != null;
    const hasB = S.b != null;
    el.hA.hidden = !hasA;
    el.hB.hidden = !hasB;
    if (hasA) el.hA.style.left = `${pct(S.a, v)}%`;
    if (hasB) el.hB.style.left = `${pct(S.b, v)}%`;
    el.region.hidden = !(hasA && hasB);
    el.region.classList.toggle('on', S.loopOn);
    if (hasA && hasB) {
      el.region.style.left = `${pct(S.a, v)}%`;
      el.region.style.width = `${pct(S.b, v) - pct(S.a, v)}%`;
    }
    el.markers.replaceChildren();
    for (const m of S.record?.markers || []) {
      if (m.t < v[0] || m.t > v[1]) continue;
      const mk = document.createElement('button');
      mk.className = 'tl-marker';
      mk.dataset.id = m.id;
      mk.style.left = `${pct(m.t, v)}%`;
      mk.title = `${m.label} · ${formatTime(m.t)}`;
      el.markers.appendChild(mk);
    }
    const zoomed = S.zoom && hasA && hasB;
    el.tl.classList.toggle('zoomed', zoomed);
    el.edgeL.textContent = zoomed ? formatTime(v[0]) : '';
    el.edgeR.textContent = zoomed ? formatTime(v[1]) : '';
    el.zoom.innerHTML = icon(zoomed ? 'zoomOut' : 'zoomIn', 15);
    el.zoom.title = zoomed ? 'Show whole video' : 'Zoom in on the loop for fine adjustment';
    el.zoom.disabled = !(hasA && hasB);
    root.querySelector('[data-act="clear"]').disabled = !hasA;
    renderPlayhead();
  }

  function renderPlayhead() {
    if (!A.duration()) return;
    const v = view();
    const p = pct(A.now(), v);
    el.head.hidden = p < 0 || p > 100;
    el.head.style.left = `${p}%`;
  }

  function renderLoopCount() {
    el.count.textContent = S.loopOn && S.loops > 0 ? `×${S.loops}` : '';
  }

  function renderChips() {
    const sections = S.record?.sections || [];
    el.chips.replaceChildren();
    if (!sections.length) {
      const k = S.settings.keys;
      el.chips.innerHTML = `<span class="hint">Press <kbd>${esc(keyName(k.setA))}</kbd> at the start of a passage and <kbd>${esc(keyName(k.setB))}</kbd> at the end to loop it. Save it to come back later.</span>`;
      return;
    }
    const modified = isModified();
    for (const s of sections) {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.classList.toggle('active', s.id === S.activeId);
      chip.classList.toggle('modified', s.id === S.activeId && modified);
      chip.dataset.id = s.id;
      chip.innerHTML = `
        <button class="chip-main" data-act="chip" title="Loop “${esc(s.name)}”">
          <span class="chip-name"></span>
          <span class="chip-meta">${formatTime(s.a, 0)}–${formatTime(s.b, 0)}${Math.abs(s.speed - 1) > 0.001 ? ` · ${formatSpeed(s.speed)}` : ''}</span>
        </button>
        <button class="chip-del" data-act="chipdel" title="Delete section">${icon('x', 12)}</button>`;
      chip.querySelector('.chip-name').textContent = s.name;
      el.chips.appendChild(chip);
    }
  }

  function render() {
    renderControls();
    renderTimeline();
    renderChips();
    renderLoopCount();
  }

  // ---------- toast ----------

  let toastTimer = null;
  function toast(text, action = null) {
    el.toast.hidden = false;
    el.toast.querySelector('.msg').textContent = text;
    const btn = el.toast.querySelector('.toast-act');
    btn.hidden = !action;
    btn.textContent = action?.label || '';
    btn.onclick = action ? () => { el.toast.hidden = true; action.run(); } : null;
    el.toast.classList.remove('show');
    void el.toast.offsetWidth;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, action ? 6000 : 3000);
  }

  // ---------- popovers ----------

  let popAnchor = null;
  function openPop(anchor, html, onReady, cls = '') {
    if (!el.pop.hidden && popAnchor === anchor) { closePop(); return; }
    popAnchor = anchor;
    el.pop.className = `pop ${cls}`;
    el.pop.innerHTML = html;
    el.pop.hidden = false;
    const br = el.bar.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const pw = el.pop.offsetWidth;
    el.pop.style.left = `${clamp(ar.left - br.left + ar.width / 2 - pw / 2, 8, br.width - pw - 8)}px`;
    el.pop.style.top = `${ar.bottom - br.top + 8}px`;
    onReady?.(el.pop);
  }
  function closePop() {
    el.pop.hidden = true;
    popAnchor = null;
  }
  document.addEventListener('pointerdown', (e) => {
    if (el.pop.hidden) return;
    const path = e.composedPath();
    if (!path.includes(el.pop) && !path.includes(popAnchor)) closePop();
  }, true);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.pop.hidden) { e.stopPropagation(); closePop(); }
  });

  const sw = (on, act, label) => `<button class="switch" role="switch" data-act="${act}" aria-checked="${on}" aria-label="${esc(label)}"><span></span></button>`;

  function speedPop(anchor) {
    const render = () => `
      <div class="pop-title">Playback speed</div>
      <div class="presets">${PRESETS.map((p) => `<button class="preset${Math.abs(p - S.speed) < 0.001 ? ' sel' : ''}" data-act="preset" data-v="${p}">${formatSpeed(p)}</button>`).join('')}</div>
      <div class="slider-row"><input type="range" min="${SPEED_MIN}" max="${SPEED_MAX}" step="0.05" value="${S.speed}" aria-label="Speed"><span class="slider-val">${formatSpeed(S.speed)}</span></div>
      <div class="opt-row"><div><div class="opt-name">Keep pitch</div><div class="opt-sub">Slowed audio stays in tune</div></div>${sw(S.settings.preservePitch, 'pitch', 'Keep pitch')}</div>`;
    openPop(anchor, render(), (pop) => {
      pop.querySelector('input[type=range]').addEventListener('input', (e) => {
        A.setSpeed(parseFloat(e.target.value));
        pop.querySelector('.slider-val').textContent = formatSpeed(S.speed);
        pop.querySelectorAll('.preset').forEach((b) => b.classList.toggle('sel', Math.abs(parseFloat(b.dataset.v) - S.speed) < 0.001));
      });
    }, 'w-speed');
  }

  function practicePop(anchor) {
    const t = S.settings.trainer;
    const k = S.settings.keys;
    openPop(anchor, `
      <div class="pop-title">Practice options</div>
      <div class="opt-name">Pause before each repeat</div>
      <div class="seg">${GAPS.map((g) => `<button data-act="gap" data-v="${g}" class="${S.settings.gap === g ? 'sel' : ''}">${g ? `${g}s` : 'Off'}</button>`).join('')}</div>
      <div class="opt-row top-gap"><div><div class="opt-name">Speed trainer</div><div class="opt-sub">Start slow and speed up as you repeat</div></div>${sw(t.enabled, 'trainer', 'Speed trainer')}</div>
      <div class="trainer${t.enabled ? '' : ' off'}">
        <div class="fields">
          <label><span>Raise by (×)</span><input type="number" data-t="step" min="0.01" max="0.5" step="0.01" value="${t.step}"></label>
          <label><span>Every (repeats)</span><input type="number" data-t="every" min="1" max="50" step="1" value="${t.every}"></label>
          <label><span>Up to (×)</span><input type="number" data-t="target" min="${SPEED_MIN}" max="${SPEED_MAX}" step="0.05" value="${t.target}"></label>
        </div>
        <div class="opt-sub trainer-sum"></div>
      </div>
      <div class="pop-title top-gap">Keyboard</div>
      <div class="keys">${Object.entries(KEY_LABELS).map(([id, label]) => `<div><kbd>${esc(keyName(k[id]))}</kbd><span>${label}</span></div>`).join('')}</div>
      <div class="opt-sub">Change shortcuts in the library's settings.</div>`, (pop) => {
      const sum = () => {
        const [step, every, target] = ['step', 'every', 'target'].map((n) => parseFloat(pop.querySelector(`[data-t="${n}"]`).value));
        pop.querySelector('.trainer-sum').textContent = `${every > 1 ? `Every ${every} repeats` : 'After every repeat'}, speed goes up ${formatSpeed(step)} until it reaches ${formatSpeed(target)}.`;
      };
      sum();
      pop.querySelectorAll('input[data-t]').forEach((input) => input.addEventListener('change', () => {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v)) return;
        A.setSettings({ trainer: { [input.dataset.t]: input.dataset.t === 'every' ? Math.max(1, Math.round(v)) : v } });
        sum();
      }));
    }, 'w-practice');
  }

  function savePop(anchor) {
    if (S.a == null || S.b == null) {
      openPop(anchor, `<div class="pop-title">Save section</div><div class="opt-sub">Set a loop first: press <kbd>${esc(keyName(S.settings.keys.setA))}</kbd> for the start and <kbd>${esc(keyName(S.settings.keys.setB))}</kbd> for the end.</div>`);
      return;
    }
    const active = S.record?.sections.find((x) => x.id === S.activeId);
    const modified = isModified();
    openPop(anchor, `
      <div class="pop-title">${active && modified ? 'Save changes' : 'Save section'}</div>
      <input class="text" maxlength="80" value="" placeholder="Name, e.g. Chorus riff">
      <div class="opt-sub">${formatTime(S.a)} – ${formatTime(S.b)} · ${formatSpeed(S.speed)}</div>
      <div class="pop-actions">
        ${active && modified
          ? `<button class="btn" data-act="saveNew">Save as new</button><button class="btn primary" data-act="saveUpdate">Update</button>`
          : `<button class="btn primary" data-act="saveNew">Save</button>`}
      </div>`, (pop) => {
      const input = pop.querySelector('input');
      input.value = active && modified ? active.name : A.suggestName();
      input.focus();
      input.select();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') pop.querySelector('.btn.primary').click();
      });
    }, 'w-save');
  }

  function markerPop(anchor, m) {
    openPop(anchor, `
      <input class="text" maxlength="60" aria-label="Marker name">
      <div class="opt-sub">${formatTime(m.t)}</div>
      <div class="pop-actions spread">
        <button class="btn" data-act="mJump">${icon('play', 14)}Jump</button>
        <button class="btn" data-act="mA">Set A</button>
        <button class="btn" data-act="mB">Set B</button>
        <button class="ic danger" data-act="mDel" title="Delete marker">${icon('trash', 16)}</button>
      </div>`, (pop) => {
      pop.dataset.id = m.id;
      const input = pop.querySelector('input');
      input.value = m.label;
      const commit = () => {
        const label = input.value.trim();
        if (label && label !== m.label) A.updateMarker(m.id, { label });
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); closePop(); } });
    }, 'w-marker');
  }

  // ---------- events ----------

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const k = btn.dataset.k;
    const marker = () => S.record?.markers.find((x) => x.id === el.pop.dataset.id);
    switch (act) {
      case 'loop': A.toggleLoop(); break;
      case 'setnow': (k === 'a' ? A.setA : A.setB)(A.now()); break;
      case 'nudge': nudge(k, parseInt(btn.dataset.d, 10) * (e.shiftKey ? 1 : 0.1)); break;
      case 'slower': A.setSpeed(S.speed - S.settings.speedStep); break;
      case 'faster': A.setSpeed(S.speed + S.settings.speedStep); break;
      case 'speedmenu': speedPop(btn); break;
      case 'preset': A.setSpeed(parseFloat(btn.dataset.v)); closePop(); break;
      case 'pitch':
        A.setSettings({ preservePitch: !S.settings.preservePitch });
        if (btn.classList.contains('switch')) btn.setAttribute('aria-checked', String(!S.settings.preservePitch));
        break;
      case 'marker': A.addMarker(A.now()); break;
      case 'save': savePop(btn); break;
      case 'saveNew': {
        const name = el.pop.querySelector('input').value.trim() || A.suggestName();
        closePop();
        A.saveSection(name);
        break;
      }
      case 'saveUpdate': {
        const name = el.pop.querySelector('input').value.trim();
        closePop();
        A.updateSection(S.activeId, { a: S.a, b: S.b, speed: S.speed, ...(name ? { name } : {}) });
        break;
      }
      case 'practice': practicePop(btn); break;
      case 'gap':
        A.setSettings({ gap: parseFloat(btn.dataset.v) });
        btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b === btn));
        break;
      case 'trainer': {
        const on = !S.settings.trainer.enabled;
        A.setSettings({ trainer: { enabled: on } });
        btn.setAttribute('aria-checked', String(on));
        el.pop.querySelector('.trainer').classList.toggle('off', !on);
        break;
      }
      case 'library': A.openLibrary(); break;
      case 'collapse': closePop(); A.setSettings({ collapsed: !S.settings.collapsed }); break;
      case 'zoom': A.setZoom(!S.zoom); break;
      case 'clear': A.clearLoop(); break;
      case 'chip': {
        const s = S.record?.sections.find((x) => x.id === btn.closest('.chip').dataset.id);
        if (s) A.loadSection(s);
        break;
      }
      case 'chipdel': A.deleteSection(btn.closest('.chip').dataset.id); break;
      case 'mJump': { const m = marker(); if (m) { A.seek(m.t); A.play(); } closePop(); break; }
      case 'mA': { const m = marker(); if (m) A.setA(m.t); closePop(); break; }
      case 'mB': { const m = marker(); if (m) A.setB(m.t); closePop(); break; }
      case 'mDel': { const id = el.pop.dataset.id; closePop(); A.deleteMarker(id); break; }
      default: break;
    }
  });

  function nudge(k, delta) {
    if (S[k] == null) { (k === 'a' ? A.setA : A.setB)(A.now()); return; }
    const t = Math.max(0, S[k] + delta);
    if (S.a != null && S.b != null) {
      if (k === 'a' && t < S.b - 0.05) A.setRange(t, S.b);
      if (k === 'b' && t > S.a + 0.05) A.setRange(S.a, Math.min(t, A.duration() || t));
    } else {
      (k === 'a' ? A.setA : A.setB)(t);
    }
  }

  for (const input of [el.inA, el.inB]) {
    const k = input.dataset.k;
    const revert = () => { input.value = S[k] == null ? '' : formatTime(S[k]); };
    const commit = () => {
      const t = parseTime(input.value);
      if (t == null) { revert(); return; }
      if (Math.abs(t - (S[k] ?? -1)) < 0.001) return;
      if (k === 'a') A.setA(t); else A.setB(t);
    };
    input.addEventListener('focus', () => input.select());
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { revert(); input.blur(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        nudge(k, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 0.1));
        input.value = S[k] == null ? '' : formatTime(S[k]);
      }
    });
    input.closest('.tf').addEventListener('wheel', (e) => {
      if (S[k] == null) return;
      e.preventDefault();
      nudge(k, (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 1 : 0.1));
    }, { passive: false });
  }

  // ---------- timeline dragging ----------

  const tToX = (clientX, v) => {
    const r = el.tl.getBoundingClientRect();
    return v[0] + clamp((clientX - r.left) / r.width, 0, 1) * (v[1] - v[0]);
  };
  const snap = (t, v) => {
    const r = el.tl.getBoundingClientRect();
    const tol = (8 / r.width) * (v[1] - v[0]);
    let best = t;
    let bestD = tol;
    for (const m of S.record?.markers || []) {
      const d = Math.abs(m.t - t);
      if (d < bestD) { best = m.t; bestD = d; }
    }
    return best;
  };

  el.tl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !A.duration()) return;
    const v = view();
    const markerEl = e.target.closest('.tl-marker');
    if (markerEl) {
      const m = S.record?.markers.find((x) => x.id === markerEl.dataset.id);
      if (m) markerPop(markerEl, m);
      return;
    }
    closePop();
    const handle = e.target.closest('.tl-handle');
    el.tl.setPointerCapture(e.pointerId);
    S.drag = {
      kind: handle ? handle.dataset.h : 'new', view: v, startX: e.clientX, startT: tToX(e.clientX, v),
    };
    el.tl.classList.add('dragging');
  });

  el.tl.addEventListener('pointermove', (e) => {
    const v = S.drag?.view || view();
    const t = tToX(e.clientX, v);
    el.hover.textContent = formatTime(t);
    el.hover.style.left = `${pct(t, v)}%`;
    if (!S.drag) return;
    const st = snap(t, v);
    const d = S.drag;
    if (d.kind === 'new' && Math.abs(e.clientX - d.startX) > 4) d.kind = 'range';
    if (d.kind === 'a' && st < S.b - 0.05) S.a = Math.max(0, st);
    else if (d.kind === 'b' && st > S.a + 0.05) S.b = st;
    else if (d.kind === 'range') {
      const s0 = snap(d.startT, v);
      S.a = Math.min(s0, st);
      S.b = Math.max(s0, st);
    }
    if (d.kind !== 'new') { renderControls(); renderTimeline(); }
  });

  const endDrag = () => {
    const d = S.drag;
    if (!d) return;
    S.drag = null;
    el.tl.classList.remove('dragging');
    if (d.kind === 'new') { A.seek(d.startT); return; }
    if (d.kind === 'range' && S.b - S.a < 0.1) { A.clearLoop(); return; }
    A.endDrag(d.kind);
  };
  el.tl.addEventListener('pointerup', endDrag);
  el.tl.addEventListener('pointercancel', endDrag);

  // Keep keystrokes typed into our inputs from reaching YouTube's shortcuts.
  root.addEventListener('keydown', (e) => {
    const t = e.composedPath()[0];
    if (t instanceof HTMLInputElement) e.stopPropagation();
  });

  render();
  return { host, render, renderControls, renderTimeline, renderPlayhead, renderChips, renderLoopCount, toast };
}
