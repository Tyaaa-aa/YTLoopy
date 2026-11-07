# YTLoopy — design spec

A Chromium (Manifest V3) extension for practising music with YouTube: loop an A–B section,
slow it down, drop markers, and keep a library of saved sections.

## Goals
- Looping a passage takes two keystrokes or two clicks.
- Never gets in the way of normal viewing: one slim bar under the player, collapsible to a single line.
- Everything is local (chrome.storage.local). No accounts, no network calls, no tracking.

## Surfaces
1. **Practice bar** (content script, under the player, in a shadow root so YouTube CSS can't leak in)
   - Row 1: loop toggle, A and B time fields (click to type, ‹ › to nudge 0.1 s, wheel to nudge),
     speed control (− / value / +, presets popover, 0.25×–2×, 0.05 steps), preserve-pitch toggle,
     add marker, save section, practice options (gap between repeats, speed trainer), library, collapse.
   - Row 2: mini timeline with draggable A/B handles, loop region, markers and playhead. "Zoom to loop"
     toggle magnifies the area around the loop for precise handle placement.
   - Row 3: chips for this video's saved sections (click = load and loop).
   - Loop region and markers are also drawn on YouTube's own progress bar (non-interactive overlay).
2. **Library** (Chrome side panel)
   - "Now playing" card for the active tab's video, then all videos (search, sort by recent / title).
   - Each video: thumbnail, title, channel, sections (name, range, speed) and markers.
     Click a section to play it (same tab if already on YouTube, otherwise a new tab).
     Rename inline, delete with undo.
   - Export all (JSON) / export one video / import (merge, newest wins per item).
   - Settings: preserve pitch (default on), gap between repeats, keyboard shortcuts (rebindable).

## Loop engine
- requestAnimationFrame check (plus `timeupdate` fallback for background tabs): when time ≥ B, seek to A.
- Paused while an ad plays (`#movie_player.ad-showing`).
- Optional gap (0–5 s) before each repeat. Optional speed trainer: +step every N repeats up to a target.
- Speed applied via `video.playbackRate`; `preservesPitch` follows the setting.
- A loop's speed belongs to the loop. YTLoopy remembers the person's normal speed (whatever YouTube
  plays at outside YTLoopy) and returns to it when the loop is switched off, cleared or its section is
  deleted, and whenever a new video opens. Switching the loop back on restores the loop's speed.
  Changing speed without a loop affects the current video only. A change made in YouTube's own speed
  menu while no loop is on becomes the new normal speed.

## Keyboard (defaults avoid YouTube's own keys; ignored while typing)
`[` set A · `]` set B · `\` toggle loop · `'` jump to A · `-` / `=` speed down / up · `;` add marker

## Data model
```
video:<id> = { id, title, channel, duration, updatedAt,
               sections: [{ id, name, a, b, speed, createdAt, updatedAt }],
               markers:  [{ id, t, label, createdAt }] }
settings   = { preservePitch, gap, collapsed, keys{...}, trainer{...} }
pending    = { videoId, sectionId, ts }   // hand-off from library to a freshly opened tab
```
Export file: `{ app: "YTLoopy", version: 1, exportedAt, videos: [...] }`.

## Out of scope (v1)
Shorts, embedded players, cloud sync.

## Testing
- Unit tests (node --test) for time parsing/formatting, import validation/merge, model helpers.
- End-to-end check in Chromium with the unpacked extension on a real YouTube watch page.
