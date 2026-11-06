'use strict';
// שרת "לוח הכפל": מגיש את האפליקציה ואת ה-API, ומזהה את המשתמש לפי כותרות ה-Ingress של Home Assistant.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');
const U = require('./util');
const M = require('./math');
const S = require('./sessions');
const RW = require('./rewards');
const ha = require('./ha');
const scheduler = require('./scheduler');
const { HttpError } = U;

const PORT = parseInt(process.env.PORT || '8099', 10);
const DATA_DIR = process.env.DATA_DIR || '/data';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEV = process.env.KEFEL_DEV === '1';
const INGRESS_IPS = ['172.30.32.2', '::ffff:172.30.32.2'];
const MAX_BODY = 256 * 1024;

function readOptions() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'options.json'), 'utf8')); } catch (e) { return {}; }
}
const options = readOptions();
const store = new Store(DATA_DIR);
const adminNames = (options.admin_users || []).map(s => String(s).toLowerCase());

// ---------- זיהוי משתמש ----------
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0]).map(([k, v]) => [k, decodeURIComponent(v || '')]));
}
function decodeHeader(v) {
  // HA שולח לפעמים שם עם תווים לא-ASCII כ-latin1; ננסה לשחזר UTF-8
  try { const b = Buffer.from(String(v), 'latin1').toString('utf8'); return b.includes('�') ? String(v) : b; } catch (e) { return String(v); }
}
function identify(req, url) {
  if (DEV) {
    // פיתוח מקומי: ?as=admin או ?as=<מזהה משתמש> שומר עוגייה
    const as = url.searchParams.get('as') || parseCookies(req).dev_user || 'admin';
    return { id: as === 'admin' ? 'dev-admin' : as, name: as, displayName: as === 'admin' ? 'מנהל (פיתוח)' : as, devAdmin: as === 'admin' };
  }
  if (!INGRESS_IPS.includes(req.socket.remoteAddress)) return null;
  const id = req.headers['x-remote-user-id'];
  if (!id) return null;
  return {
    id: String(id),
    name: String(req.headers['x-remote-user-name'] || ''),
    displayName: decodeHeader(req.headers['x-remote-user-display-name'] || req.headers['x-remote-user-name'] || '')
  };
}
async function isAdmin(user) {
  if (user.devAdmin) return true;
  if (store.data.settings.adminUserIds.includes(user.id)) return true;
  if (adminNames.includes(user.name.toLowerCase())) return true;
  if (!ha.connected()) return false;
  try {
    const u = (await ha.listUsers()).find(x => x.id === user.id);
    return !!(u && u.isAdmin);
  } catch (e) {
    console.warn('could not read HA users:', e.message);
    return false;
  }
}
async function resolve(req, url) {
  const user = identify(req, url);
  if (!user) return { role: 'none' };
  const seen = store.data.users[user.id];
  if (!seen || seen.displayName !== user.displayName || U.today() !== (seen.lastSeen || '').slice(0, 10)) {
    store.data.users[user.id] = { id: user.id, name: user.name, displayName: user.displayName, lastSeen: U.now().toISOString() };
    store.save();
  }
  if (await isAdmin(user)) return { role: 'admin', user };
  const child = store.data.children.find(c => c.haUserId === user.id);
  if (child) return { role: child.active ? 'child' : 'paused', user, child };
  return { role: 'unknown', user };
}

// ---------- פרופיל ילד ----------
function int(v, min, max, def) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def; }
function sanitizeChild(input, base = {}) {
  const c = { ...base };
  const has = k => k in input;
  if (has('name')) c.name = String(input.name || '').trim().slice(0, 40);
  if (has('gender')) c.gender = ['m', 'f'].includes(input.gender) ? input.gender : '';
  if (has('notifyTime')) c.notifyTime = U.toMinutes(input.notifyTime) != null ? input.notifyTime : '16:00';
  if (has('days')) c.days = (Array.isArray(input.days) ? input.days : []).map(Number).filter(d => d >= 0 && d <= 6);
  if (has('haUserId')) c.haUserId = String(input.haUserId || '');
  if (has('notifyService')) c.notifyService = /^mobile_app_[a-z0-9_]+$/.test(input.notifyService || '') ? input.notifyService : '';
  if (has('active')) c.active = !!input.active;
  if (has('reminderEnabled')) c.reminderEnabled = !!input.reminderEnabled;
  if (has('reminderAfterMin')) c.reminderAfterMin = int(input.reminderAfterMin, 15, 720, 120);
  if (!c.name) throw new HttpError(400, 'חסר שם');
  if (c.haUserId && store.data.children.some(x => x.haUserId === c.haUserId && x.id !== c.id)) {
    throw new HttpError(409, 'משתמש ה-Home Assistant הזה כבר משויך לילד אחר');
  }
  return c;
}
function childOr404(id) {
  const c = store.child(id);
  if (!c) throw new HttpError(404, 'הילד לא נמצא');
  return c;
}
function tableNum(v) {
  const n = Number(v);
  if (!M.TABLES.includes(n)) throw new HttpError(400, 'כפולה לא תקינה');
  return n;
}

// מה ההורה רואה על כל ילד
function childRow(c) {
  const facts = store.childFacts(c.id);
  const date = U.today();
  const today = store.data.sessions.filter(s => s.childId === c.id && s.date === date && s.kind === 'daily')
    .sort((a, b) => b.id - a.id)[0];
  const week = store.data.sessions.filter(s => s.childId === c.id && s.status === 'completed' && s.date >= U.addDays(date, -6));
  const tot = week.reduce((x, s) => x + s.summary.total, 0);
  const cor = week.reduce((x, s) => x + s.summary.correct, 0);
  return {
    ...c,
    tables: (c.tables || []).map(t => ({ ...t, ...M.tableState(facts, t.n) })),
    today: !c.current ? 'none' : today ? today.status : S.isStudyDay(c, date) ? 'waiting' : 'off',
    todayPct: today && today.summary ? today.summary.pct : null,
    weekAccuracy: tot ? Math.round((cor / tot) * 100) : null,
    weekSessions: week.length,
    lastNotification: store.data.notifications.find(n => n.childId === c.id) || null,
    suggestNext: M.SUGGESTED_ORDER.find(n => !(c.tables || []).some(t => t.n === n)) || null
  };
}

// ---------- נתיבים ----------
const routes = [];
function route(method, pattern, role, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, role, handler });
}

route('GET', '/api/me', 'any', async (ctx) => {
  const base = {
    role: ctx.role, user: ctx.user ? { id: ctx.user.id, name: ctx.user.displayName || ctx.user.name } : null,
    meta: { themes: M.THEMES, statusHe: M.STATUS_HE, today: U.today(), dev: DEV }
  };
  if (ctx.child) base.child = { id: ctx.child.id, name: ctx.child.name, gender: ctx.child.gender, stars: ctx.child.stars || 0 };
  if (ctx.role === 'unknown' && !ha.connected() && !adminNames.length && !store.data.settings.adminUserIds.length) base.setupNeeded = true;
  return base;
});

// ---- ילד ----
route('GET', '/api/child/home', 'child', async ({ child }) => ({
  child: { name: child.name, gender: child.gender, stars: child.stars || 0 },
  intro: !child.introSeen, goal: RW.goalOf(store, child), ...S.homeState(store, child)
}));
route('POST', '/api/child/intro/seen', 'child', async ({ child }) => { child.introSeen = true; store.save(); return { ok: true }; });
route('POST', '/api/child/session/start', 'child', async ({ child, body }) => S.startSession(store, child, body));
route('POST', '/api/child/session/:id/learned', 'child', async ({ child, params, body }) => S.markLearned(store, child, params.id, Number(body.step)));
route('POST', '/api/child/session/:id/answer', 'child', async ({ child, params, body }) => S.answer(store, child, params.id, Number(body.step), body.answer));
route('POST', '/api/child/session/:id/complete', 'child', async ({ child, params }) => {
  const sum = S.complete(store, child, params.id);
  // הדיווח להורה לא חוסם את הילד: כשל בשליחה לא ייכשל את סיום התרגול
  scheduler.notifySessionDone(store, child, sum).catch(e => console.error('done notify', e.message));
  if (sum.ready) scheduler.notifyReady(store, child, sum.table).catch(e => console.error('ready notify', e.message));
  return sum;
});
route('GET', '/api/child/progress', 'child', async ({ child }) => {
  const facts = store.childFacts(child.id);
  const done = store.data.sessions.filter(s => s.childId === child.id && s.status === 'completed');
  return {
    name: child.name, stars: child.stars || 0, earned: child.starsEarned || 0,
    tables: (child.tables || []).map(t => ({ n: t.n, learned: !!t.learnedAt, ...M.tableState(facts, t.n) })),
    sessions: done.length, days: new Set(done.map(s => s.date)).size,
    perfect: done.filter(s => s.summary && s.summary.pct === 100).length
  };
});

// ---- פרסים: צד הילד ----
route('GET', '/api/child/rewards', 'child', async ({ child }) => ({
  stars: child.stars || 0, earned: child.starsEarned || 0,
  goal: RW.goalOf(store, child), catalog: RW.catalogFor(store, child),
  pending: RW.pending(store, child.id)[0] || null,
  history: store.data.redemptions.filter(r => r.childId === child.id && r.status !== 'pending').slice(0, 10)
}));
route('POST', '/api/child/rewards/:id/goal', 'child', async ({ child, params }) => {
  const r = RW.setGoal(store, child, params.id);
  return { joke: r.joke, name: r.reward.name, goal: RW.goalOf(store, child) };
});
route('POST', '/api/child/rewards/:id/request', 'child', async ({ child, params }) => {
  const rec = RW.request(store, child, params.id);
  // ההורה הוא שמביא את הפרס בפועל, ולכן הוא צריך לדעת מיד
  const s = store.data.settings;
  if (s.adminNotifyService) {
    scheduler.send(store, { childId: child.id, kind: 'reward', service: s.adminNotifyService, title: 'לוח הכפל — בקשת פרס',
      message: `${child.name} ביקש/ה: ${rec.emoji} ${rec.name} (${rec.cost} כוכבים). ממתין לאישור שלך.` }).catch(e => console.error('reward notify', e.message));
  }
  return rec;
});

// ---- מנהל: לוח בקרה ----
route('GET', '/api/dashboard', 'admin', async () => ({
  children: store.data.children.map(childRow),
  notices: store.data.notices.filter(n => !n.dismissed).slice(0, 20),
  pending: RW.pending(store).map(r => ({ ...r, childName: store.child(r.childId)?.name || '' })),
  status: systemStatus()
}));
route('POST', '/api/notices/:id/dismiss', 'admin', async ({ params }) => {
  const n = store.data.notices.find(x => String(x.id) === params.id);
  if (n) n.dismissed = true;
  store.save();
  return { ok: true };
});

// ---- מנהל: ילדים ----
route('GET', '/api/children', 'admin', async () => store.data.children.map(childRow));
route('GET', '/api/children/:id', 'admin', async ({ params }) => {
  const c = childOr404(params.id);
  const facts = store.childFacts(c.id);
  return {
    child: childRow(c),
    // טבלת 10×10 של מצב כל עובדה, לתצוגת "לוח הכפל" של ההורה
    grid: M.TABLES.map(a => M.TABLES.map(b => { const r = facts[M.factKey(a, b)]; return { s: M.status(r), w: r ? r.wrong : 0 }; })),
    sessions: store.data.sessions.filter(s => s.childId === c.id && s.status === 'completed').sort((a, b) => b.id - a.id).slice(0, 30)
      .map(s => ({ id: s.id, date: s.date, kind: s.kind, table: s.table, ...s.summary })),
    hard: Object.values(facts).filter(r => r.wrong > 0 && M.status(r) !== 'mastered')
      .sort((a, b) => b.wrong - a.wrong).slice(0, 12).map(r => ({ a: r.a, b: r.b, wrong: r.wrong, status: M.status(r) }))
  };
});
route('POST', '/api/children', 'admin', async ({ body }) => {
  const c = sanitizeChild(body, {
    id: store.nextId('child'), name: '', gender: '', notifyTime: '16:00', days: [0, 1, 2, 3, 4], haUserId: '', notifyService: '',
    active: true, reminderEnabled: false, reminderAfterMin: 120, tables: [], current: null, stars: 0, starsEarned: 0,
    createdAt: U.now().toISOString()
  });
  store.data.children.push(c);
  store.save();
  return c;
});
route('PUT', '/api/children/:id', 'admin', async ({ params, body }) => {
  const c = childOr404(params.id);
  Object.assign(c, sanitizeChild(body, c));
  store.save();
  return childRow(c);
});
route('DELETE', '/api/children/:id', 'admin', async ({ params }) => {
  const c = childOr404(params.id);
  const d = store.data;
  d.children = d.children.filter(x => x.id !== c.id);
  d.sessions = d.sessions.filter(s => s.childId !== c.id);
  d.notifications = d.notifications.filter(n => n.childId !== c.id);
  d.redemptions = d.redemptions.filter(r => r.childId !== c.id);
  delete d.facts[c.id];
  store.save();
  return { ok: true };
});

// פתיחת כפולה חדשה: היא הופכת לכפולה היומית, והתרגול הבא מתחיל בשלב לימוד
route('POST', '/api/children/:id/unlock', 'admin', async ({ params, body }) => {
  const c = childOr404(params.id);
  const n = tableNum(body.n);
  c.tables = c.tables || [];
  if (!c.tables.some(t => t.n === n)) c.tables.push({ n, openedAt: U.now().toISOString(), learnedAt: null, readyAt: null });
  c.current = n;
  store.save();
  let notified = null;
  if (store.data.settings.notifyChildOnUnlock && c.notifyService && c.active && body.notify !== false) {
    notified = await scheduler.send(store, { childId: c.id, kind: 'unlock', service: c.notifyService, title: scheduler.TITLE,
      message: `${c.name}, נפתחה לך כפולה חדשה: כפולות של ${n}! 🎉 בואו ללמוד אותה ולאסוף כוכבים ⭐` });
  }
  return { child: childRow(c), notified };
});
// לחזור לכפולה שכבר נפתחה (בלי לפתוח חדשה)
route('POST', '/api/children/:id/current', 'admin', async ({ params, body }) => {
  const c = childOr404(params.id);
  const n = tableNum(body.n);
  if (!(c.tables || []).some(t => t.n === n)) throw new HttpError(400, 'הכפולה הזו עוד לא נפתחה');
  c.current = n;
  store.save();
  return childRow(c);
});
// ללמוד שוב: בתרגול הבא יופיע שוב שלב הלימוד
route('POST', '/api/children/:id/relearn', 'admin', async ({ params, body }) => {
  const c = childOr404(params.id);
  const rec = S.tableRec(c, tableNum(body.n));
  if (!rec) throw new HttpError(400, 'הכפולה הזו עוד לא נפתחה');
  rec.learnedAt = null;
  store.save();
  return childRow(c);
});
route('DELETE', '/api/children/:id/tables/:n', 'admin', async ({ params }) => {
  const c = childOr404(params.id);
  const n = tableNum(params.n);
  c.tables = (c.tables || []).filter(t => t.n !== n);
  if (c.current === n) c.current = c.tables.length ? c.tables[c.tables.length - 1].n : null;
  store.save();
  return childRow(c);
});
route('POST', '/api/children/:id/test-notify', 'admin', async ({ params, body }) => {
  const c = childOr404(params.id);
  return scheduler.send(store, { childId: c.id, kind: 'test', service: body.service || c.notifyService, title: scheduler.TITLE,
    message: `התראת בדיקה: היי ${c.name}! ככה ייראו התזכורות לתרגול לוח הכפל.` });
});
route('POST', '/api/preview', 'admin', async ({ body }) => S.previewPlan(store, tableNum(body.n), { learn: body.learn !== false }));

// ---- מנהל: Home Assistant ----
route('GET', '/api/ha/users', 'admin', async () => {
  let haUsers = [];
  let error = '';
  if (ha.connected()) { try { haUsers = await ha.listUsers(); } catch (e) { error = e.message; } }
  const byId = new Map();
  for (const u of haUsers) byId.set(u.id, { id: u.id, name: u.name, isAdmin: u.isAdmin });
  for (const u of Object.values(store.data.users)) if (!byId.has(u.id)) byId.set(u.id, { id: u.id, name: u.displayName || u.name, isAdmin: false });
  return { users: [...byId.values()], error };
});
route('GET', '/api/ha/services', 'admin', async () => {
  if (!ha.connected()) return { services: [], error: 'אין חיבור ל-Home Assistant' };
  try { return { services: await ha.notifyServices() }; } catch (e) { return { services: [], error: e.message }; }
});
route('GET', '/api/notifications', 'admin', async ({ query }) => {
  const cid = query.get('childId');
  return store.data.notifications.filter(n => !cid || String(n.childId) === cid).slice(0, 100);
});

// ---- מנהל: כוכבים ופרסים ----
route('GET', '/api/stars', 'admin', async () => {
  const list = RW.rewards(store);
  return { conf: RW.starsConf(store), rewards: list.map(r => ({ ...r, lessons: r.joke ? null : RW.lessonsFor(store, r.cost) })) };
});
route('PUT', '/api/stars', 'admin', async ({ body }) => {
  const s = store.data.settings;
  s.stars = { ...RW.starsConf(store),
    base: int(body.base, 0, 50, 2), max: int(body.max, 1, 200, 10),
    streakBonus: int(body.streakBonus, 0, 20, 0), streakCap: 5, missPenalty: int(body.missPenalty, 0, 100, 0) };
  if (Array.isArray(body.rewards)) {
    s.rewards = body.rewards.filter(r => r && String(r.name || '').trim()).slice(0, 40).map(r => ({
      id: Number(r.id) || Date.now(), emoji: String(r.emoji || '🎁').slice(0, 4),
      name: String(r.name).trim().slice(0, 60), cost: int(r.cost, 1, 999999, 50), active: r.active !== false, joke: !!r.joke
    }));
  }
  store.save();
  return { ok: true, conf: RW.starsConf(store) };
});
route('GET', '/api/redemptions', 'admin', async () => ({
  pending: RW.pending(store).map(r => ({ ...r, childName: store.child(r.childId)?.name || '' })),
  recent: store.data.redemptions.filter(r => r.status !== 'pending').slice(0, 30).map(r => ({ ...r, childName: store.child(r.childId)?.name || '' }))
}));
route('POST', '/api/redemptions/:id/decide', 'admin', async ({ params, body }) => {
  const rec = RW.decide(store, params.id, !!body.approve);
  const child = store.child(rec.childId);
  // הילד צריך לדעת גם כשאישרו וגם כשלא, אחרת הבקשה נעלמת בלי הסבר
  if (child && child.notifyService) {
    scheduler.send(store, { childId: child.id, kind: 'reward-result', service: child.notifyService, title: 'לוח הכפל 🎁',
      message: rec.status === 'given' ? `הפרס אושר! ${rec.emoji} ${rec.name} מחכה לך 🎉` : `הבקשה ל${rec.name} לא אושרה הפעם, והכוכבים חזרו אליך.`
    }).catch(e => console.error('reward result notify', e.message));
  }
  return rec;
});

// ---- מנהל: הגדרות ----
function systemStatus() {
  return { ha: { mode: ha.mode, connected: ha.connected() }, panelUrl: scheduler.getPanelUrl(), timeZone: U.timeZone(), now: U.localParts(), dev: DEV };
}
route('GET', '/api/settings', 'admin', async () => ({ settings: store.data.settings, status: systemStatus() }));
route('PUT', '/api/settings', 'admin', async ({ body }) => {
  const s = store.data.settings;
  if ('adminNotifyService' in body) s.adminNotifyService = /^mobile_app_[a-z0-9_]+$/.test(body.adminNotifyService || '') ? body.adminNotifyService : '';
  if ('questions' in body) s.questions = int(body.questions, 4, 30, 10);
  if ('reviewShare' in body) s.reviewShare = int(body.reviewShare, 0, 60, 30);
  if ('readyThreshold' in body) s.readyThreshold = int(body.readyThreshold, 30, 100, 80);
  for (const k of ['notifyAdminSessionDone', 'notifyAdminReady', 'notifyChildOnUnlock', 'notifyAdminDaySummary']) if (k in body) s[k] = !!body[k];
  if ('summaryTime' in body && U.toMinutes(body.summaryTime) != null) s.summaryTime = body.summaryTime;
  if ('adminUserIds' in body && Array.isArray(body.adminUserIds)) s.adminUserIds = body.adminUserIds.map(String);
  store.save();
  return s;
});
route('POST', '/api/settings/test-admin-notify', 'admin', async ({ body }) => scheduler.send(store, {
  kind: 'test', service: body.service || store.data.settings.adminNotifyService,
  title: 'לוח הכפל — בדיקה', message: 'התראת בדיקה להורה. כאן יגיעו דיווחי התרגול ובקשות הפרסים.'
}));

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(buf);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'הבקשה גדולה מדי')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      if (!s) return resolve({});
      try { resolve(JSON.parse(s)); } catch (e) { reject(new HttpError(400, 'JSON לא תקין')); }
    });
    req.on('error', reject);
  });
}
function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    send(res, 200, buf, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (DEV && url.searchParams.get('as')) {
    res.setHeader('Set-Cookie', `dev_user=${encodeURIComponent(url.searchParams.get('as'))}; Path=/; SameSite=Lax`);
  }
  if (!p.startsWith('/api/')) {
    if (!identify(req, url)) return send(res, 403, 'גישה רק דרך Home Assistant', { 'Content-Type': 'text/plain; charset=utf-8' });
    const rel = p === '/' ? 'index.html' : p.slice(1);
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    return serveFile(res, file);
  }
  const r = routes.find(x => x.method === req.method && x.re.test(p));
  if (!r) return send(res, 404, { error: 'נתיב לא קיים' });
  const ctx = await resolve(req, url);
  if (ctx.role === 'none') return send(res, 403, { error: 'גישה רק דרך Home Assistant' });
  if (r.role === 'admin' && ctx.role !== 'admin') return send(res, 403, { error: 'אין הרשאת מנהל' });
  if (r.role === 'child' && ctx.role !== 'child') return send(res, 403, { error: 'אין פרופיל ילד פעיל למשתמש הזה' });
  const m = r.re.exec(p);
  ctx.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  ctx.query = url.searchParams;
  ctx.body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
  const out = await r.handler(ctx);
  send(res, 200, out === undefined ? { ok: true } : out);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    const code = e instanceof HttpError ? e.code : (Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : 500);
    if (code === 500) console.error(e);
    if (!res.headersSent) send(res, code, { error: e.message || 'שגיאה' });
  });
});

async function init() {
  if (ha.connected()) {
    try { const c = await ha.config(); if (!process.env.KF_TZ && c?.time_zone) U.setTimeZone(c.time_zone); } catch (e) { console.warn('HA config:', e.message); }
    // הקישור בהתראה = הפאנל בתפריט הצד של HA (פתוח גם למשתמשים שאינם מנהלים).
    // לא /hassio/ingress/<slug> — זה אזור התוספים של המנהל, וילד מגיע ממנו למסך הבית של HA.
    const info = await ha.selfInfo();
    if (info?.slug) {
      let p = info.slug;
      try {
        const panels = await ha.wsCommand({ type: 'get_panels' });
        const panel = Object.values(panels || {}).find(x => x.config && x.config.addon === info.slug);
        if (panel?.url_path) p = panel.url_path;
      } catch (e) { console.warn('HA panels:', e.message); }
      scheduler.setPanelUrl('/' + p);
    }
  }
  if (options.panel_url) scheduler.setPanelUrl(options.panel_url);
  if (process.env.KEFEL_NO_SCHEDULER !== '1') scheduler.start(store);
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Kefel listening on ${PORT} (HA: ${ha.mode}, dev: ${DEV})`);
    init().catch(e => console.error('init', e));
  });
  const shutdown = () => { try { store.flush(); } catch (e) { console.error(e); } process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { server, store, init };
