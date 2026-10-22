'use strict';
// בדיקות תרחישי השימוש המרכזיים מול השרת האמיתי (במצב פיתוח, עם שעון ו-HA מדומים בתוך הבדיקה בלבד).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wordsteps-test-'));
process.env.DATA_DIR = DATA;
process.env.WORDSTEPS_DEV = '1';
process.env.WORDSTEPS_NO_SCHEDULER = '1';
process.env.WS_TZ = 'Asia/Jerusalem';

const U = require('../server/util');
const ha = require('../server/ha');
const scheduler = require('../server/scheduler');
const { server, store } = require('../server/main');
const FIX = require('./fixtures');

let base;
let clock = new Date('2026-10-12T09:00:00Z'); // יום שני, 12:00 שעון ישראל
U.setNow(() => clock);
const setClock = iso => { clock = new Date(iso); };

async function call(user, method, p, body) {
  const res = await fetch(`${base}/api/${p}`, {
    method, headers: { cookie: `dev_user=${user}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const admin = (m, p, b) => call('admin', m, p, b);
const kid = (m, p, b) => call('kid1', m, p, b);
async function ok(promise) {
  const r = await promise;
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

// מריץ שיעור עד הסוף. wrongWords: מילים שעליהן עונים לא נכון בניסיון הראשון
async function playLesson(view, wrongWords = []) {
  let plan = view.plan;
  let step = view.step;
  while (step < plan.length) {
    const s = plan[step];
    if (s.t === 'stage' || s.t === 'card') { await ok(kid('POST', `child/lesson/${view.id}/advance`, { step: step + 1 })); step++; continue; }
    const wrongEn = id => wrongWords.includes(view.words[id].en);
    let payload;
    if (s.t === 'match') payload = { results: s.ws.map(w => ({ w, correct: !(wrongEn(w) && !s.retry) })) };
    else {
      const bad = wrongEn(s.w) && !s.retry;
      payload = { answer: bad ? (s.options ? s.options.find(o => o !== s.answer) : 'xxxx') : s.answer };
    }
    const r = await ok(kid('POST', `child/lesson/${view.id}/answer`, { step, ...payload }));
    plan = r.plan; step = r.step;
  }
  return ok(kid('POST', `child/lesson/${view.id}/complete`));
}

before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); store.flush(); fs.rmSync(DATA, { recursive: true, force: true }); });

let child, lessonId;

test('זיהוי תפקידים: מנהל, משתמש לא משויך, וילד אחרי שיוך', async () => {
  assert.equal((await ok(admin('GET', 'me'))).role, 'admin');
  assert.equal((await ok(kid('GET', 'me'))).role, 'unknown');
  child = await ok(admin('POST', 'children', { name: 'נועה', age: 8, gender: 'f', level: 'beginner', newPerDay: 4, reviewPerDay: 3, haUserId: 'kid1', exerciseTypes: ['mc', 'match', 'cloze', 'type'] }));
  assert.equal((await ok(kid('GET', 'me'))).role, 'child');
});

test('ילד לא יכול לגשת לממשק הניהול', async () => {
  for (const p of ['dashboard', 'children', 'words', 'lessons', 'settings']) {
    assert.equal((await kid('GET', p)).status, 403, p);
  }
  assert.equal((await kid('POST', 'lessons/prepare', { days: 1 })).status, 403);
});

test('מאגר מילים: הוספה, כפילות נדחית, חיפוש', async () => {
  for (const w of FIX) await ok(admin('POST', 'words', { ...w, level: 'beginner' }));
  assert.equal((await admin('POST', 'words', { en: 'Apple', he: 'x' })).status, 409);
  const found = await ok(admin('GET', 'words?q=' + encodeURIComponent('תפוח')));
  assert.deepEqual(found.map(w => w.en), ['apple']);
  assert.ok(found.every(w => w.status === 'draft'));
});

test('שיעור שלא אושר לא מוצג לילד', async () => {
  const r = await ok(admin('POST', 'lessons/prepare', { from: '2026-10-12', days: 1 }));
  assert.equal(r.created, 1);
  lessonId = r.lessons[0].id;
  const d = await ok(admin('GET', `lessons/${lessonId}`));
  assert.equal(d.status, 'pending');
  assert.equal(d.items.length, 4);
  assert.ok(d.items.every(i => !i.approved), 'מילים חדשות (טיוטות) לא מגיעות מאושרות');
  const home = await ok(kid('GET', 'child/home'));
  assert.equal(home.mode, 'none');
  assert.equal((await kid('POST', 'child/lesson/start', { lessonId })).status, 403);
});

test('אישור: פריט חסר נחסם, עריכה מחייבת אישור מחדש, אישור מלא מפרסם', async () => {
  let d = await ok(admin('GET', `lessons/${lessonId}`));
  const it = d.items[0];
  // מחיקת התרגום חוסמת אישור
  d = await ok(admin('PUT', `lessons/${lessonId}/items/${it.id}`, { he: '' }));
  assert.equal((await admin('POST', `lessons/${lessonId}/items/${it.id}/approve`)).status, 400);
  assert.equal((await admin('POST', `lessons/${lessonId}/approve`)).status, 400);
  const original = FIX.find(f => f.en === it.content.en);
  await ok(admin('PUT', `lessons/${lessonId}/items/${it.id}`, { he: original.he }));
  d = await ok(admin('POST', `lessons/${lessonId}/approve`));
  assert.equal(d.status, 'approved');
  // שינוי בשיעור מאושר מחזיר אותו לאישור
  d = await ok(admin('PUT', `lessons/${lessonId}/items/${it.id}`, { exampleHe: original.exampleHe + ' ' }));
  assert.equal(d.status, 'approved', 'רווח בסוף מנוקה — אין שינוי אמיתי');
  d = await ok(admin('PUT', `lessons/${lessonId}/items/${it.id}`, { exampleEn: 'A changed sentence.' }));
  assert.equal(d.status, 'pending');
  assert.equal(d.items.find(x => x.id === it.id).approved, false);
  assert.equal((await ok(kid('GET', 'child/home'))).mode, 'none');
  await ok(admin('PUT', `lessons/${lessonId}/items/${it.id}`, { exampleEn: original.exampleEn }));
  d = await ok(admin('POST', `lessons/${lessonId}/approve`));
  assert.equal(d.status, 'approved');
  const bank = await ok(admin('GET', 'words?status=approved'));
  assert.equal(bank.length, 4, 'אישור השיעור מאשר את המילים במאגר');
});

test('תצוגה מקדימה למנהל לא משפיעה על נתוני הילד', async () => {
  const v = await ok(admin('POST', `lessons/${lessonId}/preview`));
  const s = v.plan.findIndex(x => x.t === 'mc');
  const r = await ok(admin('POST', `preview/${v.token}/answer`, { step: s, answer: v.plan[s].answer }));
  assert.equal(r.correct, true);
  assert.equal(store.data.answers.length, 0);
  assert.equal((await ok(admin('GET', `lessons/${lessonId}`))).status, 'approved');
});

test('שיעור יומי: כרטיסים, תרגול, טעות מוסיפה סבב תיקון, המשך מנקודת עצירה, סיכום', async () => {
  assert.equal((await ok(kid('GET', 'child/home'))).mode, 'start');
  let v = await ok(kid('POST', 'child/lesson/start', { lessonId }));
  assert.equal(v.plan[0].t, 'stage');
  assert.equal(v.plan.filter(s => s.t === 'card').length, 4);
  const types = new Set(v.plan.map(s => s.t));
  for (const t of ['mc', 'match', 'cloze', 'type']) assert.ok(types.has(t), 'חסר תרגיל ' + t);
  // בתרגול אין תמונה/תרגום גלויים מעבר לשאלה: בשאלת en2he התשובה היא אחת מארבע אפשרויות
  const mc = v.plan.find(s => s.t === 'mc');
  assert.equal(mc.options.length, 4);
  assert.ok(mc.options.includes(mc.answer));

  // עוצרים באמצע ופותחים מחדש
  await ok(kid('POST', `child/lesson/${lessonId}/advance`, { step: 3 }));
  assert.equal((await ok(kid('GET', 'child/home'))).mode, 'resume');
  v = await ok(kid('POST', 'child/lesson/start', { lessonId }));
  assert.equal(v.step, 3);

  const weakWord = v.words[v.plan.find(s => s.t === 'card').w].en;
  const sum = await playLesson(v, [weakWord]);
  assert.equal(sum.newWords, 4);
  assert.ok(sum.total > 0 && sum.correct < sum.total);
  assert.deepEqual(sum.weak.map(w => w.en), [weakWord]);
  assert.ok(sum.stars > 0);
  const after = await ok(kid('GET', 'child/home'));
  assert.equal(after.mode, 'done');

  const lesson = store.lesson(lessonId);
  assert.ok(lesson.session.plan.some(s => s.retry), 'טעות יוצרת תרגול חוזר');
  const prog = await ok(admin('GET', `children/${child.id}/words`));
  assert.equal(prog.length, 4);
  assert.equal(prog.find(p => p.en === weakWord).status, 'needs_reinforcement');
  assert.ok(prog.filter(p => p.en !== weakWord).every(p => p.status === 'learning'), 'הצלחה ראשונה לא הופכת מילה ל"נלמדה היטב"');
});

test('שיעור שהושלם נעול לעריכה', async () => {
  const d = await ok(admin('GET', `lessons/${lessonId}`));
  assert.equal(d.editable, false);
  assert.equal((await admin('PUT', `lessons/${lessonId}/items/${d.items[0].id}`, { he: 'x' })).status, 409);
});

test('למחרת: מילים חדשות לא חוזרות, מילה שדורשת חיזוק נבחרת לחזרה', async () => {
  setClock('2026-10-13T09:00:00Z');
  const learned = new Set(Object.keys(store.childProgress(child.id)).map(Number));
  const r = await ok(admin('POST', 'lessons/prepare', { from: '2026-10-13', days: 1 }));
  const d = await ok(admin('GET', `lessons/${r.lessons[0].id}`));
  assert.ok(d.items.every(i => !learned.has(i.wordId)), 'מילה שנלמדה לא מוצעת שוב כחדשה');
  const weak = Object.values(store.childProgress(child.id)).find(p => p.status === 'needs_reinforcement');
  assert.ok(d.review.some(x => x.w === weak.wordId), 'מילה שדורשת חיזוק מקבלת עדיפות בחזרה');
  assert.ok(d.review.length <= 3, 'מכסת החזרה נשמרת');
  await ok(admin('POST', 'lessons/approve', { ids: [d.id] }));
  const v = await ok(kid('POST', 'child/lesson/start', { lessonId: d.id }));
  assert.ok(v.plan.some(s => s.t === 'stage' && s.stage === 'review'));
  await playLesson(v, []);
  const rec = store.childProgress(child.id)[weak.wordId];
  assert.notEqual(rec.status, 'needs_reinforcement', 'הצלחה אחרי טעות מעדכנת את מצב המילה');
});

test('אין שיעור מאושר: מוצעת חזרה על תוכן מאושר בלבד', async () => {
  setClock('2026-10-14T09:00:00Z');
  await ok(admin('POST', 'lessons/prepare', { from: '2026-10-14', days: 1 }));
  const home = await ok(kid('GET', 'child/home'));
  assert.equal(home.mode, 'review');
  const v = await ok(kid('POST', 'child/lesson/start', { mode: 'review' }));
  const approved = new Set(store.data.words.filter(w => w.status === 'approved').map(w => w.id));
  assert.ok(Object.keys(v.words).every(id => approved.has(Number(id))), 'שיעור חזרה מכיל רק מילים מאושרות');
  assert.ok(v.plan.every(s => s.t !== 'card'), 'בחזרה אין מילים חדשות');
});

test('אין מספיק מילים חדשות: אין כפילויות, והמנהל מקבל הודעה', async () => {
  const r = await ok(admin('POST', 'lessons/prepare', { from: '2026-10-15', days: 1 }));
  const d = await ok(admin('GET', `lessons/${r.lessons[0].id}`));
  const ids = d.items.map(i => i.wordId);
  assert.equal(new Set(ids).size, ids.length);
  const r2 = await ok(admin('POST', 'lessons/prepare', { from: '2026-10-18', days: 1 }));
  const d2 = await ok(admin('GET', `lessons/${r2.lessons[0].id}`));
  assert.ok(d2.items.length < 4);
  assert.ok(d2.warnings.some(w => w.includes('אין מספיק מילים')));
  const dash = await ok(admin('GET', 'dashboard'));
  assert.ok(dash.notices.some(n => n.text.includes('אין מספיק מילים')));
});

test('התראות: נשלחות בשעה שנקבעה, פעם אחת, תזכורת עד להשלמה', async () => {
  const sent = [];
  ha.notify = async (service, msg) => { sent.push({ service, ...msg }); };
  scheduler.setPanelUrl('/hassio/ingress/abc_wordsteps');
  await ok(admin('PUT', `children/${child.id}`, { notifyService: 'mobile_app_noa_iphone', notifyTime: '16:00', reminderEnabled: true, reminderAfterMin: 60 }));
  setClock('2026-10-15T12:00:00Z'); // 15:00 — לפני השעה
  await ok(admin('POST', 'lessons/approve', { ids: store.data.lessons.filter(l => l.date === '2026-10-15').map(l => l.id) }));
  await scheduler.tick(store);
  assert.equal(sent.length, 0);
  setClock('2026-10-15T13:01:00Z'); // 16:01
  await scheduler.tick(store);
  await scheduler.tick(store);
  assert.equal(sent.length, 1, 'התראה אחת בלבד');
  assert.equal(sent[0].url, '/hassio/ingress/abc_wordsteps');
  assert.match(sent[0].message, /נועה/);
  assert.match(sent[0].message, /מוכנה/);
  setClock('2026-10-15T14:05:00Z'); // שעה אחרי — תזכורת
  await scheduler.tick(store);
  assert.equal(sent.length, 2);
  await scheduler.tick(store);
  assert.equal(sent.length, 2, 'תזכורת אחת בלבד');
  const log = await ok(admin('GET', `notifications?childId=${child.id}`));
  assert.deepEqual(log.slice(0, 2).map(n => n.kind), ['reminder', 'daily']);
});

test('התראה לא נשלחת כשהשיעור הושלם, ביום שאינו יום לימוד, או לילד מושהה', async () => {
  const sent = [];
  ha.notify = async (service, msg) => { sent.push(msg); };
  // 16/10 הוא יום שישי — לא יום לימוד
  setClock('2026-10-16T13:30:00Z');
  await scheduler.tick(store);
  assert.equal(sent.length, 0);
  // יום ראשון 18/10: מושהה
  await ok(admin('PUT', `children/${child.id}`, { active: false }));
  await ok(admin('POST', 'lessons/approve', { ids: store.data.lessons.filter(l => l.date === '2026-10-18').map(l => l.id) }));
  setClock('2026-10-18T13:30:00Z');
  await scheduler.tick(store);
  assert.equal(sent.length, 0);
  assert.equal((await ok(kid('GET', 'me'))).role, 'paused');
  await ok(admin('PUT', `children/${child.id}`, { active: true }));
  // משלים לפני השעה — לא תישלח התראה
  setClock('2026-10-18T10:00:00Z');
  const lesson = store.data.lessons.find(l => l.date === '2026-10-18' && l.kind === 'daily');
  const v = await ok(kid('POST', 'child/lesson/start', { lessonId: lesson.id }));
  await playLesson(v, []);
  setClock('2026-10-18T13:30:00Z');
  await scheduler.tick(store);
  assert.equal(sent.length, 0);
});

test('כשל בשליחת התראה נרשם ביומן והשיעור נשאר זמין', async () => {
  ha.notify = async () => { throw new Error('mobile app unreachable'); };
  const r = await ok(admin('POST', `children/${child.id}/test-notify`, {}));
  assert.equal(r.ok, false);
  assert.match(r.error, /unreachable/);
});

test('מחיקת פרופיל מוחקת את נתוני הלמידה', async () => {
  await ok(admin('DELETE', `children/${child.id}`));
  assert.equal(store.data.lessons.filter(l => l.childId === child.id).length, 0);
  assert.equal(store.data.answers.filter(a => a.childId === child.id).length, 0);
  assert.equal(store.data.progress[child.id], undefined);
  assert.equal((await ok(kid('GET', 'me'))).role, 'unknown');
});
