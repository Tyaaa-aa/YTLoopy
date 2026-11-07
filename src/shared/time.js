// Time helpers shared by the practice bar and the library.

/** 83.456 -> "1:23.4" (decimals = 1) or "1:23" (decimals = 0). Hours shown when needed. */
export function formatTime(sec, decimals = 1) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const factor = 10 ** decimals;
  // Round once up front so 59.96 becomes 1:00.0, not 0:60.0.
  const total = Math.round(sec * factor) / factor;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total - h * 3600 - m * 60;
  const sStr = decimals > 0
    ? s.toFixed(decimals).padStart(decimals + 3, '0')
    : String(Math.round(s)).padStart(2, '0');
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${sStr}`
    : `${m}:${sStr}`;
}

/**
 * Parses what a person might type into a time field:
 * "83", "83.5", "1:23", "1:23.4", "1:02:03", "1m23s", "1m 23.5s", "90s".
 * Returns seconds, or null when the text isn't a time.
 */
export function parseTime(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim().toLowerCase().replace(',', '.');
  if (!t) return null;

  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);

  const colon = t.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$|^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (colon) {
    if (colon[1] !== undefined) {
      const s = parseFloat(colon[2]);
      return s < 60 ? parseInt(colon[1], 10) * 60 + s : null;
    }
    const m = parseInt(colon[4], 10);
    const s = parseFloat(colon[5]);
    return m < 60 && s < 60 ? parseInt(colon[3], 10) * 3600 + m * 60 + s : null;
  }

  const units = t.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s)?$/);
  if (units && (units[1] || units[2] || units[3])) {
    return (parseInt(units[1] || '0', 10) * 3600)
      + (parseInt(units[2] || '0', 10) * 60)
      + parseFloat(units[3] || '0');
  }
  return null;
}

/** "0.75" -> "0.75×", "1" -> "1×", "1.5" -> "1.5×" */
export function formatSpeed(rate) {
  return `${Number(rate.toFixed(2))}×`;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
