'use strict';
// מתזמן: התראה יומית לילד (ותזכורת אם לא תרגל), סיכום יומי להורה וקנס על יום שהוחמץ.
// רץ כל 30 שניות. כל שליחה נרשמת ביומן ההתראות, כולל כשלונות.
const { localParts, toMinutes, now } = require('./util');
const ha = require('./ha');
const S = require('./sessions');
const RW = require('./rewards');

const NOTIFY_WINDOW_MIN = 240;   // לא שולחים התראה יומית יותר מ-4 שעות אחרי השעה שנקבעה
const RETRY_MIN = 10;
const MAX_ATTEMPTS = 3;
const TITLE = 'לוח הכפל ✖️';

let panelUrl = '';
function setPanelUrl(u) { panelUrl = u || ''; }
function getPanelUrl() { return panelUrl; }

const word = (g, m, f, n) => (g === 'f' ? f : g === 'm' ? m : n);

async function send(store, { childId = null, kind, service, title, message }) {
  const rec = { id: store.nextId('notif'), at: now().toISOString(), childId, kind, service, title, message, ok: false, error: '' };
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

function notice(store, text) {
  store.data.notices.unshift({ id: store.nextId('notice'), at: now().toISOString(), text, dismissed: false });
  if (store.data.notices.length > 100) store.data.notices.length = 100;
  store.save();
}

function dailyMessage(store, child) {
  const rec = S.tableRec(child, child.current);
  const ready = word(child.gender, 'מוכן', 'מוכנה', 'מוכנים');
  if (rec && !rec.learnedAt) return `היי ${child.name}! היום לומדים את כפולות של ${child.current} 🎉 ${ready}?`;
  return `היי ${child.name}! מחכות לך שאלות בכפולות של ${child.current}. ${ready} לאסוף כוכבים? ⭐`;
}

async function childTick(store, child, p) {
  if (!child.active || !child.notifyService || !child.current || !S.isStudyDay(child, p.date)) return;
  const at = toMinutes(child.notifyTime);
  if (at == null || p.minutes < at) return;
  const st = child.notifyState && child.notifyState.date === p.date ? child.notifyState
    : (child.notifyState = { date: p.date, daily: null, dailyAttempts: 0, lastAttempt: 0, reminder: null });
  const done = S.dailyDone(store, child, p.date);
  const nowMs = now().getTime();
  if (!st.daily) {
    if (done || p.minutes >= at + NOTIFY_WINDOW_MIN) return;
    if (st.dailyAttempts >= MAX_ATTEMPTS || nowMs - st.lastAttempt < RETRY_MIN * 60000) return;
    st.dailyAttempts += 1; st.lastAttempt = nowMs;
    const r = await send(store, { childId: child.id, kind: 'daily', service: child.notifyService, title: TITLE, message: dailyMessage(store, child) });
    if (r.ok) st.daily = r.at;
    store.save();
    return;
  }
  if (child.reminderEnabled && !st.reminder && !done) {
    const after = Number(child.reminderAfterMin) || 120;
    if (nowMs - Date.parse(st.daily) >= after * 60000) {
      const r = await send(store, { childId: child.id, kind: 'reminder', service: child.notifyService, title: TITLE,
        message: `${child.name}, התרגול של היום עוד מחכה לך — רק כמה דקות ו${word(child.gender, 'סיימת', 'סיימת', 'סיימתם')} 🙂` });
      st.reminder = r.at;   // תזכורת אחת בלבד, גם אם נכשלה (נרשמה ביומן)
      store.save();
    }
  }
}

// ---------- דיווח להורה ----------
function doneMessage(child, sum) {
  let m = `${child.name} ${word(child.gender, 'סיים', 'סיימה', 'סיימו')} תרגול בכפולות של ${sum.table}`
    + `${sum.learned ? ' (כולל שלב הלימוד)' : ''}: ${sum.correct} מתוך ${sum.total} נכון (${sum.pct}%)`;
  if (sum.stars) m += ` · +${sum.stars} ⭐`;
  if (sum.weak.length) m += `\nטעויות: ${sum.weak.slice(0, 5).map(w => `${w.a}×${w.b}`).join(', ')}`;
  return m;
}
async function notifySessionDone(store, child, sum) {
  const s = store.data.settings;
  if (sum.kind !== 'daily' || !s.notifyAdminSessionDone || !s.adminNotifyService) return null;
  return send(store, { childId: child.id, kind: 'session-done', service: s.adminNotifyService,
    title: 'לוח הכפל — תרגול הושלם', message: doneMessage(child, sum) });
}

async function notifyReady(store, child, n) {
  const verb = word(child.gender, 'שולט', 'שולטת', 'שולטים');
  const text = `${child.name} כבר ${verb} בכפולות של ${n} — אפשר לפתוח כפולה חדשה.`;
  notice(store, text);
  const s = store.data.settings;
  if (!s.notifyAdminReady || !s.adminNotifyService) return null;
  return send(store, { childId: child.id, kind: 'ready', service: s.adminNotifyService, title: 'לוח הכפל — מוכנים להמשיך', message: text });
}

function daySummary(store, date) {
  const lines = [];
  for (const c of store.data.children) {
    if (!c.active || !c.current) continue;
    if (!S.isStudyDay(c, date)) { lines.push(`${c.name}: לא יום תרגול`); continue; }
    const s = store.data.sessions.find(x => x.childId === c.id && x.date === date && x.kind === 'daily' && x.status === 'completed');
    lines.push(s ? `${c.name}: ✅ כפולות של ${s.table} · ${s.summary.pct}%` : `${c.name}: ❌ לא תרגל היום`);
  }
  return lines.length ? lines.join('\n') : '';
}

async function eveningTick(store, p) {
  const s = store.data.settings;
  const at = toMinutes(s.summaryTime || '20:30');
  if (at == null || p.minutes < at || s.lastEveningDate === p.date) return;
  s.lastEveningDate = p.date;
  store.save();
  // קנס: רק אם ההורה הגדיר, רק ביום תרגול ורק לילד שיש לו כפולה פתוחה
  const pen = Number(RW.starsConf(store).missPenalty) || 0;
  if (pen > 0) {
    for (const c of store.data.children) {
      if (!c.active || !c.current || !S.isStudyDay(c, p.date) || S.dailyDone(store, c, p.date)) continue;
      const lost = RW.applyMissPenalty(store, c);
      if (lost && c.notifyService) {
        await send(store, { childId: c.id, kind: 'penalty', service: c.notifyService, title: TITLE,
          message: `היום לא היה תרגול, ולכן ירדו ${lost} כוכבים. מחר אפשר להרוויח אותם בחזרה 🙂` });
      }
    }
    store.save();
  }
  if (s.notifyAdminDaySummary && s.adminNotifyService) {
    const message = daySummary(store, p.date);
    if (message) await send(store, { kind: 'day-summary', service: s.adminNotifyService, title: 'לוח הכפל — סיכום היום', message });
  }
}

let running = false;
async function tick(store) {
  if (running) return;
  running = true;
  try {
    const p = localParts();
    S.closeStale(store, p.date);
    try { await eveningTick(store, p); } catch (e) { console.error('evening', e.message); }
    for (const child of store.data.children) {
      try { await childTick(store, child, p); } catch (e) { console.error('notify tick', child.id, e.message); }
    }
  } finally { running = false; }
}

function start(store) {
  setTimeout(() => tick(store).catch(e => console.error(e)), 5000);
  return setInterval(() => tick(store).catch(e => console.error(e)), 30000);
}

module.exports = { start, tick, send, notice, setPanelUrl, getPanelUrl, dailyMessage, notifySessionDone, notifyReady,
  daySummary, doneMessage, TITLE };
