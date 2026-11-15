// Date and time helpers. All of them work in the server's time zone (TZ, IST by default).

export function pad(n) {
  return String(n).padStart(2, '0');
}

// "2026-11-15"
export function localDate(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "13:30"
export function localTime(ms = Date.now()) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Turns a local date + time into a timestamp in milliseconds.
export function toMs(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n).getTime());
}

export function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

// "13:30" -> "1:30 PM"
export function niceTime(timeStr) {
  const [hh, mm] = timeStr.split(':').map(Number);
  const suffix = hh >= 12 ? 'PM' : 'AM';
  let h = hh % 12;
  if (h === 0) h = 12;
  return `${h}:${pad(mm)} ${suffix}`;
}

// timestamp -> "Tue, 18 Nov"
export function niceDate(ms) {
  return new Date(ms).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

// timestamp -> "Tue, 18 Nov, 11:00 AM"
export function niceDateTime(ms) {
  return `${niceDate(ms)}, ${niceTime(localTime(ms))}`;
}

export function minutesOf(timeStr) {
  const [hh, mm] = timeStr.split(':').map(Number);
  return hh * 60 + mm;
}

// Which part of the day a time belongs to, like the compartments of a pill box.
export function partOfDay(timeStr) {
  const mins = minutesOf(timeStr);
  if (mins >= 4 * 60 && mins < 12 * 60) return 'morning';
  if (mins >= 12 * 60 && mins < 17 * 60) return 'afternoon';
  if (mins >= 17 * 60 && mins < 21 * 60 + 30) return 'evening';
  return 'night';
}

export const DEFAULT_ROUTINE = {
  wake: '06:30', breakfast: '08:00', lunch: '13:00', tea: '17:00', dinner: '20:00', bed: '22:00',
};

// Elderly people think in routines ("after lunch"), not clock times ("13:30").
// This finds the daily event closest to a dose time and says before/after it.
export function routineLabel(timeStr, routine) {
  const r = routine || DEFAULT_ROUTINE;
  const mins = minutesOf(timeStr);
  let best = null;
  for (const anchor of Object.keys(r)) {
    if (!r[anchor]) continue;
    const gap = mins - minutesOf(r[anchor]);
    if (Math.abs(gap) > 75) continue;
    if (best === null || Math.abs(gap) < Math.abs(best.gap)) best = { anchor, gap };
  }
  if (!best) return { anchor: null, rel: null };
  if (best.anchor === 'wake') return { anchor: 'wake', rel: 'at' };
  if (best.anchor === 'bed') return { anchor: 'bed', rel: 'at' };
  if (best.anchor === 'tea') return { anchor: 'tea', rel: 'with' };
  if (best.gap < -10) return { anchor: best.anchor, rel: 'before' };
  if (best.gap > 10) return { anchor: best.anchor, rel: 'after' };
  return { anchor: best.anchor, rel: 'with' };
}

export function routineText(timeStr, routine) {
  const { anchor, rel } = routineLabel(timeStr, routine);
  if (!anchor) return `in the ${partOfDay(timeStr)}`;
  const names = { wake: 'when you wake up', bed: 'at bedtime', tea: 'with evening tea', breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner' };
  if (anchor === 'wake' || anchor === 'bed' || anchor === 'tea') return names[anchor];
  return `${rel} ${names[anchor]}`;
}
