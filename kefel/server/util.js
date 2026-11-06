'use strict';
// עזרי תאריך/שעה לפי אזור הזמן של הבית, ועזרים כלליים.

let TZ = process.env.KF_TZ || process.env.TZ || 'Asia/Jerusalem';
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
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
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

class HttpError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

module.exports = { setTimeZone, timeZone, setNow, now, localParts, today, toMinutes, addDays, dowOf, shuffle, HttpError };
