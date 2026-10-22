'use strict';
// שרת WordSteps: מגיש את האפליקציה ואת ה-API, ומזהה את המשתמש לפי כותרות ה-Ingress של Home Assistant.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');
const U = require('./util');
const C = require('./content');
const srs = require('./srs');
const ha = require('./ha');
const gemini = require('./gemini');
const images = require('./images');
const L = require('./lessons');
const sources = require('./sources');
const aireview = require('./aireview');
const R = require('./reports');
const scheduler = require('./scheduler');
const { HttpError } = U;

const PORT = parseInt(process.env.PORT || '8099', 10);
const DATA_DIR = process.env.DATA_DIR || '/data';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEV = process.env.WORDSTEPS_DEV === '1';
const INGRESS_IPS = ['172.30.32.2', '::ffff:172.30.32.2'];
const MAX_BODY = 12 * 1024 * 1024;

// ---------- הגדרות התוסף ----------
function readOptions() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'options.json'), 'utf8')); } catch (e) { return {}; }
}
const options = readOptions();
gemini.configure({
  apiKey: options.gemini_api_key || process.env.GEMINI_API_KEY || '',
  model: options.gemini_model || process.env.GEMINI_MODEL || '',
  imageModel: options.gemini_image_model || ''
});
images.configure(path.join(DATA_DIR, 'images'));
const store = new Store(DATA_DIR);
const adminNames = (options.admin_users || []).map(s => String(s).toLowerCase());

// ---------- זיהוי משתמש ----------
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0]).map(([k, v]) => [k, decodeURIComponent(v || '')]));
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
function decodeHeader(v) {
  // HA שולח לפעמים שם עם תווים לא-ASCII כ-latin1; ננסה לשחזר UTF-8
  try { const b = Buffer.from(String(v), 'latin1').toString('utf8'); return b.includes('�') ? String(v) : b; } catch (e) { return String(v); }
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

// ---------- ולידציה של פרופיל ילד ----------
function int(v, min, max, def) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def; }
function sanitizeChild(input, base = {}) {
  const c = { ...base };
  const has = k => k in input;
  if (has('name')) c.name = String(input.name || '').trim().slice(0, 40);
  if (has('age')) c.age = int(input.age, 3, 18, 9);
  if (has('gender')) c.gender = ['m', 'f'].includes(input.gender) ? input.gender : '';
  if (has('level')) c.level = C.LEVELS.includes(input.level) ? input.level : 'beginner';
  if (has('newPerDay')) c.newPerDay = int(input.newPerDay, 0, 20, 5);
  if (has('reviewPerDay')) c.reviewPerDay = int(input.reviewPerDay, 0, 40, 7);
  if (has('notifyTime')) c.notifyTime = U.toMinutes(input.notifyTime) != null ? input.notifyTime : '16:00';
  if (has('days')) c.days = (Array.isArray(input.days) ? input.days : []).map(Number).filter(d => d >= 0 && d <= 6);
  if (has('haUserId')) c.haUserId = String(input.haUserId || '');
  if (has('notifyService')) c.notifyService = /^mobile_app_[a-z0-9_]+$/.test(input.notifyService || '') ? input.notifyService : '';
  if (has('active')) c.active = !!input.active;
  if (has('topics')) c.topics = (Array.isArray(input.topics) ? input.topics : []).filter(t => C.TOPICS[t]);
  if (has('exerciseTypes')) c.exerciseTypes = (Array.isArray(input.exerciseTypes) ? input.exerciseTypes : []).filter(t => C.EXERCISE_TYPES.includes(t));
  if (has('reminderEnabled')) c.reminderEnabled = !!input.reminderEnabled;
  if (has('reminderAfterMin')) c.reminderAfterMin = int(input.reminderAfterMin, 15, 720, 120);
  if (!c.name) throw new HttpError(400, 'חסר שם תצוגה');
  if (c.haUserId && store.data.children.some(x => x.haUserId === c.haUserId && x.id !== c.id)) {
    throw new HttpError(409, 'משתמש ה-Home Assistant הזה כבר משויך לילד אחר');
  }
  return c;
}
function newChild(input) {
  const level = C.LEVELS.includes(input.level) ? input.level : 'beginner';
  const base = {
    id: store.nextId('child'), name: '', age: 9, gender: '', level, newPerDay: 5, reviewPerDay: 7,
    notifyTime: '16:00', days: [0, 1, 2, 3, 4], haUserId: '', notifyService: '', active: true, topics: [],
    exerciseTypes: C.DEFAULT_EXERCISES[level].slice(), reminderEnabled: false, reminderAfterMin: 120,
    stars: 0, createdAt: U.now().toISOString()
  };
  return sanitizeChild(input, base);
}

function childOr404(id) {
  const c = store.child(id);
  if (!c) throw new HttpError(404, 'הילד לא נמצא');
  return c;
}
function lessonOr404(id) {
  const l = store.lesson(id);
  if (!l) throw new HttpError(404, 'השיעור לא נמצא');
  return l;
}

function lessonSummaryRow(l) {
  return {
    id: l.id, date: l.date, kind: l.kind, childId: l.childId, childName: store.child(l.childId)?.name || '',
    status: L.displayStatus(l), items: l.items.filter(i => i.role === 'new').length,
    reviewItems: l.items.filter(i => i.role === 'review').length,
    pct: l.summary?.pct ?? null, warnings: l.warnings || []
  };
}

function lessonDetail(l) {
  const child = store.child(l.childId);
  const prog = store.childProgress(l.childId);
  const reviewIds = l.items.filter(i => i.role === 'review').map(i => i.wordId);
  return {
    ...lessonSummaryRow(l), approvedAt: l.approvedAt, completedAt: l.completedAt, summary: l.summary,
    exerciseTypes: child?.exerciseTypes || [],
    items: l.items.filter(i => i.role === 'new'),
    review: reviewIds.map(id => {
      const w = store.word(id);
      return { w: id, en: w?.en || '?', he: w?.he || '', status: prog[id]?.status || 'new', approved: w?.status === 'approved' };
    })
  };
}

function wordRow(w) {
  const usedBy = Object.entries(store.data.progress).filter(([, m]) => m[w.id]).length;
  return { ...w, usedBy };
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
    meta: { levels: C.LEVEL_HE, topics: C.TOPICS, statusHe: srs.STATUS_HE, exerciseTypes: C.EXERCISE_TYPES, today: U.today(), dev: DEV }
  };
  if (ctx.child) base.child = { id: ctx.child.id, name: ctx.child.name, gender: ctx.child.gender, stars: ctx.child.stars || 0 };
  if (ctx.role === 'unknown' && !ha.connected() && !adminNames.length && !store.data.settings.adminUserIds.length) base.setupNeeded = true;
  return base;
});

// ---- ילד ----
route('GET', '/api/child/home', 'child', async ({ child }) => {
  const prog = store.childProgress(child.id);
  const learned = Object.values(prog).filter(r => r.sessions > 0).length;
  return { child: { name: child.name, gender: child.gender, stars: child.stars || 0 }, learned, ...L.homeState(store, child) };
});
route('POST', '/api/child/lesson/start', 'child', async ({ child, body }) => L.startLesson(store, child, body));
route('POST', '/api/child/lesson/:id/answer', 'child', async ({ child, params, body }) => L.answer(store, child, params.id, body.step, body));
route('POST', '/api/child/lesson/:id/advance', 'child', async ({ child, params, body }) => L.advance(store, child, params.id, body.step));
route('POST', '/api/child/lesson/:id/complete', 'child', async ({ child, params }) => L.complete(store, child, params.id));
route('GET', '/api/child/progress', 'child', async ({ child }) => {
  const prog = store.childProgress(child.id);
  const recs = Object.values(prog).filter(r => r.sessions > 0);
  const words = recs.map(r => {
    const w = store.word(r.wordId);
    return { w: r.wordId, en: w?.en || '?', he: w?.he || '', emoji: w?.emoji || '', status: r.status };
  }).sort((a, b) => a.en.localeCompare(b.en));
  const lessons = store.data.lessons.filter(l => l.childId === child.id && l.status === 'completed')
    .sort((a, b) => b.id - a.id).slice(0, 10).map(l => ({ date: l.date, kind: l.kind, pct: l.summary?.pct, stars: l.summary?.stars }));
  const studyDays = new Set(store.data.answers.filter(a => a.childId === child.id).map(a => a.date)).size;
  return {
    name: child.name, stars: child.stars || 0, learned: recs.length, status: R.statusCounts(prog),
    milestones: [10, 25, 50, 75, 100, 150, 200, 300, 400, 500].map(m => ({ m, reached: recs.length >= m })),
    words, lessons, studyDays
  };
});

// ---- מנהל: לוח בקרה ----
route('GET', '/api/dashboard', 'admin', async () => ({ ...R.dashboard(store), status: await systemStatus() }));
route('POST', '/api/notices/dismiss-all', 'admin', async () => {
  for (const n of store.data.adminNotices) n.dismissed = true;
  store.save();
  return { ok: true };
});
route('POST', '/api/notices/:id/dismiss', 'admin', async ({ params }) => {
  const n = store.data.adminNotices.find(x => String(x.id) === params.id);
  if (n) n.dismissed = true;
  store.save();
  return { ok: true };
});

// ---- מנהל: ילדים ----
route('GET', '/api/children', 'admin', async () => store.data.children);
route('POST', '/api/children', 'admin', async ({ body }) => {
  const c = newChild(body);
  store.data.children.push(c);
  store.save();
  return c;
});
route('PUT', '/api/children/:id', 'admin', async ({ params, body }) => {
  const c = childOr404(params.id);
  const next = sanitizeChild(body, c);
  Object.assign(c, next);
  store.save();
  return c;
});
route('DELETE', '/api/children/:id', 'admin', async ({ params }) => {
  const c = childOr404(params.id);
  const d = store.data;
  d.children = d.children.filter(x => x.id !== c.id);
  d.lessons = d.lessons.filter(l => l.childId !== c.id);
  d.answers = d.answers.filter(a => a.childId !== c.id);
  d.notifications = d.notifications.filter(n => n.childId !== c.id);
  delete d.progress[c.id];
  store.save();
  return { ok: true };
});
route('GET', '/api/children/:id/words', 'admin', async ({ params }) => {
  const c = childOr404(params.id);
  return Object.values(store.childProgress(c.id)).map(r => {
    const w = store.word(r.wordId);
    return { ...r, en: w?.en || '?', he: w?.he || '' };
  }).sort((a, b) => (a.status === 'needs_reinforcement' ? -1 : 0) - (b.status === 'needs_reinforcement' ? -1 : 0) || a.en.localeCompare(b.en));
});
route('POST', '/api/children/:id/test-notify', 'admin', async ({ params, body }) => {
  const c = childOr404(params.id);
  const service = body.service || c.notifyService;
  return scheduler.send(store, {
    childId: c.id, kind: 'test', service, title: 'WordSteps 📚',
    message: `התראת בדיקה: היי ${c.name}! ככה ייראו התזכורות לשיעור האנגלית.`
  });
});

// ---- מנהל: Home Assistant ----
route('GET', '/api/ha/users', 'admin', async () => {
  let haUsers = [];
  let error = '';
  if (ha.connected()) { try { haUsers = await ha.listUsers(); } catch (e) { error = e.message; } }
  const seen = Object.values(store.data.users);
  const byId = new Map();
  for (const u of haUsers) byId.set(u.id, { id: u.id, name: u.name, isAdmin: u.isAdmin, source: 'ha' });
  for (const u of seen) if (!byId.has(u.id)) byId.set(u.id, { id: u.id, name: u.displayName || u.name, isAdmin: false, source: 'seen' });
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

// ---- מנהל: מאגר מילים ----
route('GET', '/api/words', 'admin', async ({ query }) => {
  const q = (query.get('q') || '').trim().toLowerCase();
  const level = query.get('level'), topic = query.get('topic'), status = query.get('status'), ai = query.get('ai');
  return store.data.words.filter(w =>
    (!q || w.en.toLowerCase().includes(q) || w.he.includes(q)) &&
    (!level || w.level === level) && (!topic || w.topic === topic) && (!status || w.status === status) &&
    (!ai || (ai === 'none' ? !w.ai : w.ai && w.ai.verdict === ai))
  ).sort((a, b) => b.id - a.id).map(wordRow);
});
route('POST', '/api/words', 'admin', async ({ body }) => {
  let data = body;
  if (store.data.words.some(w => w.en.toLowerCase() === String(body.en || '').trim().toLowerCase())) {
    throw new HttpError(409, `המילה "${body.en}" כבר קיימת במאגר`);
  }
  // autofill: 'gemini' (AI) או 'sources' (ARASAAC + Tatoeba, בלי AI). true נשמר לתאימות = gemini
  const mode = body.autofill === true ? 'gemini' : body.autofill;
  if (mode === 'gemini') {
    const g = await gemini.completeWord({ en: body.en, level: body.level });
    data = { ...g, en: body.en || g.en, level: body.level, topic: body.topic || g.topic };
  } else if (mode === 'sources') {
    const { word } = await sources.buildWord(String(body.en).trim(), body.pos);
    data = { ...word, level: body.level, topic: body.topic || word.topic };
  }
  const before = store.data.words.length;
  const w = L.addWordToBank(store, data, { status: body.approve ? 'approved' : 'draft', source: mode === 'sources' ? 'arasaac+tatoeba' : mode ? 'gemini' : 'manual' });
  if (store.data.words.length === before) throw new HttpError(409, `המילה "${w.en}" כבר קיימת במאגר`);
  if (mode === 'sources') sources.fillDistractors(store, w);
  if (mode) await L.proposeImage(store, w);
  store.save();
  return w;
});

// ---- בדיקת מילים אוטומטית ב-Gemini ----
route('GET', '/api/ai-review', 'admin', async () => aireview.status(store));
route('POST', '/api/ai-review/run', 'admin', async () => (await aireview.tick(store, { force: true })) || { error: 'אין מילים שממתינות לבדיקה, או ש-Gemini לא מוגדר' });

// ---- ייבוא מרשימות מילים רשמיות (בלי AI) ----
route('GET', '/api/wordlists', 'admin', async () => {
  const inBank = new Set(store.data.words.map(w => w.en.toLowerCase()));
  return sources.wordLists().map(l => ({
    id: l.id, name: l.name, level: l.level, source: l.source, count: l.words.length,
    words: l.words.map(w => ({ ...w, inBank: inBank.has(w.en.toLowerCase()) }))
  }));
});
const importJobs = new Map();
route('POST', '/api/import', 'admin', async ({ body }) => {
  const list = sources.wordLists().find(l => l.id === body.listId);
  if (!list) throw new HttpError(404, 'הרשימה לא נמצאה');
  const level = C.LEVELS.includes(body.level) ? body.level : list.level;
  const wanted = new Set((body.words || []).map(s => String(s).toLowerCase()));
  const words = list.words.filter(w => wanted.has(w.en.toLowerCase())).slice(0, 100);
  if (!words.length) throw new HttpError(400, 'לא נבחרו מילים');
  const job = { id: Math.random().toString(36).slice(2), total: words.length, done: 0, added: [], skipped: [], notes: [], finished: false, error: '' };
  importJobs.set(job.id, job);
  (async () => {
    const queue = words.slice();
    const worker = async () => {
      while (queue.length) {
        const w = queue.shift();
        try {
          if (store.data.words.some(x => x.en.toLowerCase() === w.en.toLowerCase())) { job.skipped.push(w.en); continue; }
          const { word, notes } = await sources.buildWord(w.en, w.pos);
          const saved = L.addWordToBank(store, { ...word, level }, { status: 'draft', source: `list:${list.id}` });
          job.added.push(saved.id);
          if (notes.length) job.notes.push(`${w.en}: ${notes.join(', ')}`);
        } catch (e) {
          job.notes.push(`${w.en}: ${e.message}`);
        } finally { job.done++; }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    // מסיחים בלי AI — אחרי שכל המילים נכנסו, כדי שיהיה ממה לבחור
    for (const id of job.added) { const w = store.word(id); if (w) sources.fillDistractors(store, w); }
    store.save();
    job.finished = true;
  })().catch(e => { job.error = e.message; job.finished = true; });
  return { jobId: job.id, total: job.total };
});
route('GET', '/api/import/:id', 'admin', async ({ params }) => {
  const job = importJobs.get(params.id);
  if (!job) throw new HttpError(404, 'הייבוא לא נמצא');
  return { ...job, added: job.added.length };
});
route('POST', '/api/words/generate', 'admin', async ({ body }) => {
  const level = C.LEVELS.includes(body.level) ? body.level : 'beginner';
  const added = await L.generateWords(store, { count: int(body.count, 1, 30, 10), level, topic: C.TOPICS[body.topic] ? body.topic : '', age: body.age });
  return { added: added.length, words: added };
});
// אישור מרוכז של מילים במאגר
route('POST', '/api/words/approve', 'admin', async ({ body }) => {
  const results = [];
  for (const id of body.ids || []) {
    const w = store.word(id);
    try {
      if (!w) throw new HttpError(404, 'המילה לא נמצאה');
      L.approveWord(store, w);
      results.push({ id: Number(id), ok: true });
    } catch (e) { results.push({ id: Number(id), en: w && w.en, ok: false, error: e.message }); }
  }
  return { results };
});
route('PUT', '/api/words/:id', 'admin', async ({ params, body }) => {
  const w = store.word(params.id);
  if (!w) throw new HttpError(404, 'המילה לא נמצאה');
  const c = C.sanitizeContent(body, w);
  if (c.en.toLowerCase() !== w.en.toLowerCase() && store.data.words.some(x => x.id !== w.id && x.en.toLowerCase() === c.en.toLowerCase())) {
    throw new HttpError(409, 'מילה זו כבר קיימת במאגר');
  }
  Object.assign(w, c);
  if ('level' in body && C.LEVELS.includes(body.level)) w.level = body.level;
  if ('topic' in body) w.topic = C.TOPICS[body.topic] ? body.topic : '';
  if ('difficulty' in body) w.difficulty = int(body.difficulty, 1, 10, w.difficulty);
  if (body.status === 'approved') L.approveWord(store, w);
  else if (body.status === 'draft') w.status = 'draft';
  w.updatedAt = U.now().toISOString();
  store.save();
  return wordRow(w);
});
route('POST', '/api/words/:id/autofill', 'admin', async ({ params }) => {
  const w = store.word(params.id);
  if (!w) throw new HttpError(404, 'המילה לא נמצאה');
  const g = await gemini.completeWord({ en: w.en, level: w.level });
  Object.assign(w, C.sanitizeContent({ ...g, en: w.en, image: w.image, imageCredit: w.imageCredit }, w), { status: 'draft', updatedAt: U.now().toISOString() });
  store.save();
  return wordRow(w);
});
route('DELETE', '/api/words/:id', 'admin', async ({ params }) => {
  const id = Number(params.id);
  const inUse = store.data.lessons.some(l => l.status !== 'completed' && l.items.some(i => i.wordId === id));
  if (inUse) throw new HttpError(409, 'המילה משובצת בשיעור שעוד לא הושלם — הסירו אותה מהשיעור קודם');
  store.data.words = store.data.words.filter(w => w.id !== id);
  for (const m of Object.values(store.data.progress)) delete m[id];
  store.save();
  return { ok: true };
});

// ---- מנהל: תמונות ----
route('GET', '/api/images/search', 'admin', async ({ query }) => ({
  results: query.get('source') === 'openverse' ? await images.search(query.get('q') || '') : await sources.arasaacImages(query.get('q') || '')
}));
route('POST', '/api/images/import', 'admin', async ({ body }) => String(body.id).startsWith('arasaac:')
  ? sources.importArasaac(String(body.id).slice(8))
  : images.importOpenverse(body.id, body.credit));
route('POST', '/api/images/upload', 'admin', async ({ body }) => ({ image: images.saveDataUrl(body.dataUrl), imageCredit: body.credit || '' }));
route('POST', '/api/images/generate', 'admin', async ({ body }) => {
  const g = await gemini.generateImage({ en: body.en, he: body.he });
  return { dataUrl: `data:${g.mime};base64,${g.data}` };
});

// ---- מנהל: שיעורים (צפייה בלבד — השיעורים נבנים אוטומטית ממילים מאושרות) ----
route('GET', '/api/lessons', 'admin', async ({ query }) => {
  const status = query.get('status'), cid = query.get('childId');
  const from = query.get('from') || U.addDays(U.today(), -30);
  return store.data.lessons
    .filter(l => l.date >= from && (!cid || String(l.childId) === cid))
    .map(lessonSummaryRow)
    .filter(l => !status || l.status === status)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
});
route('GET', '/api/lessons/:id', 'admin', async ({ params }) => lessonDetail(lessonOr404(params.id)));
// תצוגה מקדימה של השיעור הבא של ילד — כמו שהוא יראה אותו, בלי לשמור כלום
route('POST', '/api/children/:id/preview', 'admin', async ({ params }) => L.startPreview(store, childOr404(params.id)));
route('POST', '/api/preview/:token/answer', 'admin', async ({ params, body }) => L.previewAnswer(store, params.token, body.step, body));

// ---- מנהל: דוחות והגדרות ----
route('GET', '/api/reports/:id', 'admin', async ({ params, query }) => {
  const c = childOr404(params.id);
  const to = query.get('to') || U.today();
  const from = query.get('from') || U.addDays(to, -6);
  if (from > to) throw new HttpError(400, 'טווח תאריכים לא תקין');
  return R.report(store, c, from, to);
});

async function systemStatus() {
  return {
    ha: { mode: ha.mode, connected: ha.connected() }, panelUrl: scheduler.getPanelUrl(),
    gemini: gemini.info(), timeZone: U.timeZone(), now: U.localParts(), dev: DEV
  };
}
route('GET', '/api/settings', 'admin', async () => ({ settings: store.data.settings, status: await systemStatus() }));
route('PUT', '/api/settings', 'admin', async ({ body }) => {
  const s = store.data.settings;
  if ('adminNotifyService' in body) s.adminNotifyService = /^mobile_app_[a-z0-9_]+$/.test(body.adminNotifyService || '') ? body.adminNotifyService : '';
  if ('prepTime' in body && U.toMinutes(body.prepTime) != null) s.prepTime = body.prepTime;
  if ('daysAhead' in body) s.daysAhead = int(body.daysAhead, 1, 14, 1);
  if ('imageSource' in body && ['arasaac', 'openverse', 'gemini', 'none'].includes(body.imageSource)) s.imageSource = body.imageSource;
  if ('notifyReviewDays' in body) s.notifyReviewDays = !!body.notifyReviewDays;
  if (body.aiReview && typeof body.aiReview === 'object') {
    const a = body.aiReview;
    s.aiReview = { enabled: !!a.enabled, perDay: int(a.perDay, 1, 100, 10), intervalMin: int(a.intervalMin, 5, 1440, 60), retryMin: int(a.retryMin, 1, 1440, 10) };
  }
  if ('startDate' in body) s.startDate = /^\d{4}-\d{2}-\d{2}$/.test(body.startDate || '') ? body.startDate : '';
  if ('adminUserIds' in body && Array.isArray(body.adminUserIds)) s.adminUserIds = body.adminUserIds.map(String);
  store.save();
  return s;
});
route('POST', '/api/settings/test-gemini', 'admin', async () => ({ reply: await gemini.test() }));
route('POST', '/api/settings/test-admin-notify', 'admin', async ({ body }) => scheduler.send(store, {
  kind: 'test', service: body.service || store.data.settings.adminNotifyService,
  title: 'WordSteps — בדיקה', message: 'התראת בדיקה למנהל. כאן תגיע ההודעה כשיש מילים לאישור או כשלילד נגמרות המילים המאושרות.'
}));

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.json': 'application/json' };

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

function serveFile(res, file, cache) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    send(res, 200, buf, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache || 'no-cache' });
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (DEV && url.searchParams.get('as')) {
    res.setHeader('Set-Cookie', `dev_user=${encodeURIComponent(url.searchParams.get('as'))}; Path=/; SameSite=Lax`);
  }
  if (!p.startsWith('/api/')) {
    const user = identify(req, url);
    if (!user) return send(res, 403, 'גישה רק דרך Home Assistant', { 'Content-Type': 'text/plain; charset=utf-8' });
    if (p.startsWith('/img/')) {
      const name = path.basename(p);
      if (!/^[0-9a-f]{20}\.(jpg|png|webp|gif)$/.test(name)) return send(res, 404, { error: 'not found' });
      return serveFile(res, path.join(images.imageDir(), name), 'private, max-age=31536000, immutable');
    }
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
    const code = e instanceof HttpError ? e.code : 500;
    if (code === 500) console.error(e);
    if (!res.headersSent) send(res, code, { error: e.message || 'שגיאה' });
  });
});

async function init() {
  if (ha.connected()) {
    try { const c = await ha.config(); if (!process.env.WS_TZ && c?.time_zone) U.setTimeZone(c.time_zone); } catch (e) { console.warn('HA config:', e.message); }
    const info = await ha.selfInfo();
    if (info?.slug) scheduler.setPanelUrl(`/hassio/ingress/${info.slug}`);
  }
  if (options.panel_url) scheduler.setPanelUrl(options.panel_url);
  if (process.env.WORDSTEPS_NO_SCHEDULER !== '1') scheduler.start(store);
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`WordSteps listening on ${PORT} (HA: ${ha.mode}, Gemini: ${gemini.isConfigured() ? 'on' : 'off'}, dev: ${DEV})`);
    init().catch(e => console.error('init', e));
  });
  const shutdown = () => { try { store.flush(); } catch (e) { console.error(e); } process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { server, store, init };
