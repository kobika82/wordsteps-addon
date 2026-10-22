'use strict';
// מתזמן: הודעה יומית למנהל (רק כשיש מילים לאישור), התראה יומית לכל ילד ותזכורת אם לא השלים.
// רץ כל 30 שניות. כל שליחה נרשמת ביומן ההתראות, כולל כשלונות.
const { localParts, toMinutes, now } = require('./util');
const ha = require('./ha');
const L = require('./lessons');

const NOTIFY_WINDOW_MIN = 240;   // לא שולחים התראה יומית יותר מ-4 שעות אחרי השעה שנקבעה
const RETRY_MIN = 10;
const MAX_ATTEMPTS = 3;

let panelUrl = '';
function setPanelUrl(u) { panelUrl = u || ''; }
function getPanelUrl() { return panelUrl; }

function word(g, m, f, n) { return g === 'f' ? f : g === 'm' ? m : n; }

async function send(store, { childId = null, kind, service, title, message, lessonDate = null }) {
  const rec = { id: store.nextId('notif'), at: now().toISOString(), childId, kind, service, title, message, lessonDate, ok: false, error: '' };
  try {
    if (!service) throw new Error('לא שויך מכשיר');
    await ha.notify(service, { title, message, url: panelUrl || undefined });
    rec.ok = true;
  } catch (e) {
    rec.error = e.message;
  }
  store.data.notifications.unshift(rec);
  if (store.data.notifications.length > 500) store.data.notifications.length = 500;
  store.save();
  return rec;
}

function dailyMessage(child, info) {
  const g = child.gender;
  if (info.mode === 'review') {
    return `היי ${child.name}! היום יש תרגול חזרה קצר על מילים שלמדת. ${word(g, 'מוכן', 'מוכנה', 'מוכנים')}? ⭐`;
  }
  return `היי ${child.name}! ${info.newCount} מילים חדשות באנגלית מחכות לך היום. ${word(g, 'מוכן', 'מוכנה', 'מוכנים')} להתחיל?`;
}
function reminderMessage(child) {
  return `${child.name}, השיעור של היום עוד מחכה לך — רק כמה דקות ו${word(child.gender, 'סיימת', 'סיימת', 'סיימתם')} 🙂`;
}

// האם יש היום לילד שיעור זמין (מאושר) — או חזרה על תוכן מאושר
function availability(store, child, date) {
  const home = L.homeState(store, child);
  const doneToday = store.data.lessons.some(l => l.childId === child.id && l.status === 'completed' && l.date === date && l.kind !== 'practice');
  if (doneToday) return { available: false, done: true };
  if (home.mode === 'start' || (home.mode === 'resume' && home.kind === 'daily')) {
    const lesson = store.lesson(home.lessonId);
    return { available: true, mode: 'lesson', newCount: lesson.items.filter(i => i.role === 'new').length };
  }
  if ((home.mode === 'review' || home.mode === 'resume') && store.data.settings.notifyReviewDays) return { available: true, mode: 'review' };
  return { available: false };
}

async function childTick(store, child, p) {
  if (!child.active || !child.notifyService || !L.isStudyDay(child, p.date)) return;
  const at = toMinutes(child.notifyTime);
  if (at == null || p.minutes < at) return;
  const st = child.notifyState && child.notifyState.date === p.date ? child.notifyState : (child.notifyState = { date: p.date, daily: null, dailyAttempts: 0, lastAttempt: 0, reminder: null });
  const info = availability(store, child, p.date);
  const nowMs = now().getTime();

  if (!st.daily) {
    if (!info.available || p.minutes >= at + NOTIFY_WINDOW_MIN) return;
    if (st.dailyAttempts >= MAX_ATTEMPTS || nowMs - st.lastAttempt < RETRY_MIN * 60000) return;
    st.dailyAttempts += 1; st.lastAttempt = nowMs;
    const r = await send(store, { childId: child.id, kind: 'daily', service: child.notifyService, title: 'WordSteps 📚', message: dailyMessage(child, info), lessonDate: p.date });
    if (r.ok) st.daily = r.at;
    store.save();
    return;
  }
  if (child.reminderEnabled && !st.reminder && info.available && !info.done) {
    const after = Number(child.reminderAfterMin) || 120;
    if (nowMs - Date.parse(st.daily) >= after * 60000) {
      const r = await send(store, { childId: child.id, kind: 'reminder', service: child.notifyService, title: 'WordSteps 📚', message: reminderMessage(child), lessonDate: p.date });
      st.reminder = r.at;   // תזכורת אחת בלבד, גם אם נכשלה (נרשמה ביומן)
      store.save();
    }
  }
}

// הודעה יומית למנהל — רק כשצריך לעשות משהו: מילים שממתינות לאישור, או ילד שנגמרות לו המילים המאושרות
const LOW_DAYS = 3;
function adminDigest(store) {
  const drafts = store.data.words.filter(w => w.status === 'draft').length;
  const low = store.data.children.filter(c => c.active && c.newPerDay > 0).map(c => ({ c, p: L.poolInfo(store, c) }))
    .filter(x => x.p.lessons < LOW_DAYS);
  const parts = [];
  if (low.length) parts.push(low.map(x => x.p.available ? `ל${x.c.name} נשארו מילים מאושרות ${x.p.lessons === 1 ? 'לשיעור אחד' : `ל-${x.p.lessons} שיעורים`}` : `ל${x.c.name} אין מילים מאושרות חדשות`).join(' · '));
  if (drafts) parts.push(`${drafts} מילים ממתינות לאישור`);
  return parts.length ? parts.join('. ') + '.' : '';
}

async function prepTick(store, p) {
  const s = store.data.settings;
  const at = toMinutes(s.prepTime);
  if (at == null || p.minutes < at || s.lastPrepDate === p.date) return;
  s.lastPrepDate = p.date;
  store.save();
  const message = adminDigest(store);
  if (message && s.adminNotifyService) {
    await send(store, { kind: 'admin', service: s.adminNotifyService, title: 'WordSteps — מילים לאישור', message });
  }
}

let running = false;
async function tick(store) {
  if (running) return;
  running = true;
  try {
    const p = localParts();
    await prepTick(store, p);
    for (const child of store.data.children) {
      try { await childTick(store, child, p); } catch (e) { console.error('notify tick', child.id, e.message); }
    }
  } finally { running = false; }
}

function start(store) {
  setTimeout(() => tick(store).catch(e => console.error(e)), 5000);
  return setInterval(() => tick(store).catch(e => console.error(e)), 30000);
}

module.exports = { start, tick, send, setPanelUrl, getPanelUrl, dailyMessage, adminDigest };
