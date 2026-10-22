'use strict';
// עזרי תאריך/שעה לפי אזור הזמן של הבית, ועזרים כלליים.

let TZ = process.env.WS_TZ || process.env.TZ || 'Asia/Jerusalem';
function setTimeZone(tz) { if (tz) TZ = tz; }
function timeZone() { return TZ; }

// נקודת זמן "עכשיו" ניתנת להחלפה בבדיקות.
let nowFn = () => new Date();
function setNow(fn) { nowFn = fn || (() => new Date()); }
function now() { return nowFn(); }

const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function localParts(d = now()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  });
  const p = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  const time = `${p.hour}:${p.minute}`;
  return { date: `${p.year}-${p.month}-${p.day}`, time, dow: DOW[p.weekday], minutes: toMinutes(time) };
}
function today() { return localParts().date; }

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
function dowOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// השוואת תשובה כתובה: בלי רישיות, רווחים מיותרים וסימני פיסוק.
function normalizeAnswer(s) {
  return String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z' -]/g, '').replace(/\s+/g, ' ').trim();
}
function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

class HttpError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

module.exports = {
  setTimeZone, timeZone, setNow, now, localParts, today, toMinutes, addDays, daysBetween, dowOf,
  shuffle, normalizeAnswer, levenshtein, HttpError
};
