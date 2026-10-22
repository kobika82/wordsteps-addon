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

let child;
const dailyLessons = date => store.data.lessons.filter(l => l.childId === child.id && l.kind === 'daily' && l.date === date);
const wordId = en => store.data.words.find(w => w.en === en).id;

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
  assert.equal((await kid('POST', 'words/approve', { ids: [1] })).status, 403);
  assert.equal((await kid('POST', `children/${child.id}/preview`)).status, 403);
});

test('מאגר מילים: הוספה, כפילות נדחית, חיפוש', async () => {
  for (const w of FIX) await ok(admin('POST', 'words', { ...w, level: 'beginner' }));
  assert.equal((await admin('POST', 'words', { en: 'Apple', he: 'x' })).status, 409);
  const found = await ok(admin('GET', 'words?q=' + encodeURIComponent('תפוח')));
  assert.deepEqual(found.map(w => w.en), ['apple']);
  assert.ok(found.every(w => w.status === 'draft'));
});

test('מילים שלא אושרו לא מגיעות לילד, ולא נוצר שיעור', async () => {
  const home = await ok(kid('GET', 'child/home'));
  assert.equal(home.mode, 'none');
  assert.equal(dailyLessons('2026-10-12').length, 0);
});

test('אישור מילים: מילה חסרה נחסמת, אישור מרוכז מחזיר מה הצליח ומה לא', async () => {
  const ids = FIX.slice(0, 8).map(f => wordId(f.en));
  await ok(admin('PUT', `words/${ids[0]}`, { he: '' }));
  assert.equal((await admin('PUT', `words/${ids[0]}`, { status: 'approved' })).status, 400);
  const r = await ok(admin('POST', 'words/approve', { ids }));
  assert.equal(r.results.filter(x => x.ok).length, 7);
  assert.match(r.results.find(x => !x.ok).error, /תרגום/);
  await ok(admin('PUT', `words/${ids[0]}`, { he: FIX[0].he, status: 'approved' }));
  assert.equal((await ok(admin('GET', 'words?status=approved'))).length, 8);
});

test('השיעור היומי נבנה מעצמו ממילים מאושרות — שיעור אחד ליום, גם בבקשות במקביל', async () => {
  const homes = await Promise.all(Array.from({ length: 6 }, () => ok(kid('GET', 'child/home'))));
  assert.ok(homes.every(h => h.mode === 'start'));
  assert.equal(dailyLessons('2026-10-12').length, 1, 'שיעור אחד בלבד ליום');
  const lesson = dailyLessons('2026-10-12')[0];
  assert.equal(lesson.items.length, 4);
  const approved = new Set(store.data.words.filter(w => w.status === 'approved').map(w => w.id));
  assert.ok(lesson.items.every(i => approved.has(i.wordId)), 'רק מילים מאושרות');
  const dash = await ok(admin('GET', 'dashboard'));
  const me = dash.children.find(c => c.id === child.id);
  assert.equal(me.todayStatus, 'approved');
  assert.deepEqual([me.pool.available, me.pool.days], [4, 1], 'נשארו 4 מאושרות = יום אחד');
  assert.equal(dash.draftsCount, 6);
});

test('תצוגה מקדימה של השיעור הבא לא משפיעה על נתוני הילד', async () => {
  const v = await ok(admin('POST', `children/${child.id}/preview`));
  assert.equal(v.plan.filter(s => s.t === 'card').length, 4);
  const s = v.plan.findIndex(x => x.t === 'mc');
  const r = await ok(admin('POST', `preview/${v.token}/answer`, { step: s, answer: v.plan[s].answer }));
  assert.equal(r.correct, true);
  assert.equal(store.data.answers.length, 0);
  assert.equal(dailyLessons('2026-10-12')[0].status, 'approved');
});

test('שיעור יומי: כרטיסים, תרגול, טעות מוסיפה סבב תיקון, המשך מנקודת עצירה, סיכום', async () => {
  const home = await ok(kid('GET', 'child/home'));
  let v = await ok(kid('POST', 'child/lesson/start', { lessonId: home.lessonId }));
  assert.equal(v.plan[0].t, 'stage');
  assert.equal(v.plan.filter(s => s.t === 'card').length, 4);
  const types = new Set(v.plan.map(s => s.t));
  for (const t of ['mc', 'match', 'cloze', 'type']) assert.ok(types.has(t), 'חסר תרגיל ' + t);
  const mc = v.plan.find(s => s.t === 'mc');
  assert.equal(mc.options.length, 4);
  assert.ok(mc.options.includes(mc.answer));

  await ok(kid('POST', `child/lesson/${v.id}/advance`, { step: 3 }));
  assert.equal((await ok(kid('GET', 'child/home'))).mode, 'resume');
  v = await ok(kid('POST', 'child/lesson/start', { lessonId: v.id }));
  assert.equal(v.step, 3);

  const weakWord = v.words[v.plan.find(s => s.t === 'card').w].en;
  const sum = await playLesson(v, [weakWord]);
  assert.equal(sum.newWords, 4);
  assert.ok(sum.total > 0 && sum.correct < sum.total);
  assert.deepEqual(sum.weak.map(w => w.en), [weakWord]);
  assert.equal((await ok(kid('GET', 'child/home'))).mode, 'done');
  assert.ok(store.lesson(v.id).session.plan.some(s => s.retry), 'טעות יוצרת תרגול חוזר');
  const prog = await ok(admin('GET', `children/${child.id}/words`));
  assert.equal(prog.find(p => p.en === weakWord).status, 'needs_reinforcement');
  assert.ok(prog.filter(p => p.en !== weakWord).every(p => p.status === 'learning'), 'הצלחה ראשונה לא הופכת מילה ל"נלמדה היטב"');
});

test('המנהל רואה את השיעור שהושלם — לצפייה בלבד', async () => {
  const l = dailyLessons('2026-10-12')[0];
  const d = await ok(admin('GET', `lessons/${l.id}`));
  assert.equal(d.status, 'completed');
  assert.equal(d.items.length, 4);
  assert.ok(d.summary.total > 0);
  assert.equal((await admin('PUT', `lessons/${l.id}/items/${l.items[0].id}`, { he: 'x' })).status, 404, 'אין עריכת שיעורים');
  const list = await ok(admin('GET', 'lessons'));
  assert.ok(list.some(x => x.id === l.id && x.pct != null));
});

test('למחרת: מילים חדשות לא חוזרות, מילה שדורשת חיזוק נבחרת לחזרה', async () => {
  setClock('2026-10-13T09:00:00Z');
  const learned = new Set(Object.keys(store.childProgress(child.id)).map(Number));
  const home = await ok(kid('GET', 'child/home'));
  assert.equal(home.mode, 'start');
  const lesson = store.lesson(home.lessonId);
  assert.ok(lesson.items.every(i => !learned.has(i.wordId)), 'מילה שנלמדה לא מוצעת שוב כחדשה');
  const v = await ok(kid('POST', 'child/lesson/start', { lessonId: home.lessonId }));
  const weak = Object.values(store.childProgress(child.id)).find(p => p.status === 'needs_reinforcement');
  const reviewIds = store.lesson(v.id).items.filter(i => i.role === 'review').map(i => i.wordId);
  assert.ok(reviewIds.includes(weak.wordId), 'מילה שדורשת חיזוק מקבלת עדיפות בחזרה');
  assert.ok(reviewIds.length <= 3, 'מכסת החזרה נשמרת');
  await playLesson(v, []);
  assert.notEqual(store.childProgress(child.id)[weak.wordId].status, 'needs_reinforcement');
});

test('נגמרו המילים המאושרות: אין שיעור ריק, יש חזרה, והמנהל מקבל הודעה', async () => {
  setClock('2026-10-14T09:00:00Z');
  const home = await ok(kid('GET', 'child/home'));
  assert.equal(home.mode, 'review');
  assert.equal(dailyLessons('2026-10-14').length, 0, 'לא נוצר שיעור ריק');
  const v = await ok(kid('POST', 'child/lesson/start', { mode: 'review' }));
  const approved = new Set(store.data.words.filter(w => w.status === 'approved').map(w => w.id));
  assert.ok(Object.keys(v.words).every(id => approved.has(Number(id))), 'חזרה רק על מילים מאושרות');
  assert.ok(v.plan.every(s => s.t !== 'card'));
  const dash = await ok(admin('GET', 'dashboard'));
  assert.ok(dash.notices.some(n => n.text.includes('אין מילים מאושרות')));
  assert.match(scheduler.adminDigest(store), /לנועה אין מילים מאושרות חדשות.*6 מילים ממתינות לאישור/);
});

test('הודעה יומית למנהל נשלחת בשעה שנקבעה, רק כשיש מה לעשות', async () => {
  const sent = [];
  ha.notify = async (service, msg) => { sent.push({ service, ...msg }); };
  await ok(admin('PUT', 'settings', { adminNotifyService: 'mobile_app_parent', prepTime: '19:00' }));
  setClock('2026-10-14T15:00:00Z'); // 18:00
  await scheduler.tick(store);
  assert.equal(sent.filter(s => s.service === 'mobile_app_parent').length, 0);
  setClock('2026-10-14T16:05:00Z'); // 19:05
  await scheduler.tick(store);
  await scheduler.tick(store);
  const adminMsgs = sent.filter(s => s.service === 'mobile_app_parent');
  assert.equal(adminMsgs.length, 1);
  assert.match(adminMsgs[0].message, /ממתינות לאישור/);
  // אחרי שהכול אושר — למחרת אין הודעה (עדיין יש מילים לכמה ימים?) — 6 מילים / 4 ביום = יום אחד, לכן כן תישלח אזהרה
  await ok(admin('POST', 'words/approve', { ids: store.data.words.filter(w => w.status === 'draft').map(w => w.id) }));
  assert.match(scheduler.adminDigest(store), /נשארו מילים מאושרות ל-1 ימים/);
  assert.doesNotMatch(scheduler.adminDigest(store), /ממתינות/);
});

test('התראות לילד: בשעה שנקבעה, פעם אחת, תזכורת עד להשלמה; שיעור שהוחמץ מחזיר את המילים לתור', async () => {
  const sent = [];
  ha.notify = async (service, msg) => { sent.push({ service, ...msg }); };
  scheduler.setPanelUrl('/hassio/ingress/abc_wordsteps');
  await ok(admin('PUT', `children/${child.id}`, { notifyService: 'mobile_app_noa_iphone', notifyTime: '16:00', reminderEnabled: true, reminderAfterMin: 60 }));
  setClock('2026-10-15T12:00:00Z'); // 15:00 — לפני השעה
  await scheduler.tick(store);
  assert.equal(sent.length, 0);
  assert.equal(dailyLessons('2026-10-15').length, 0, 'השיעור נבנה רק כשמגיע זמנו');
  setClock('2026-10-15T13:01:00Z'); // 16:01
  await scheduler.tick(store);
  await scheduler.tick(store);
  assert.equal(sent.length, 1, 'התראה אחת בלבד');
  assert.equal(sent[0].url, '/hassio/ingress/abc_wordsteps');
  assert.match(sent[0].message, /נועה/);
  assert.match(sent[0].message, /4 מילים חדשות/);
  assert.match(sent[0].message, /מוכנה/);
  assert.equal(dailyLessons('2026-10-15').length, 1);
  setClock('2026-10-15T14:05:00Z'); // שעה אחרי — תזכורת
  await scheduler.tick(store);
  assert.equal(sent.length, 2);
  await scheduler.tick(store);
  assert.equal(sent.length, 2, 'תזכורת אחת בלבד');
  const log = await ok(admin('GET', `notifications?childId=${child.id}`));
  assert.deepEqual(log.slice(0, 2).map(n => n.kind), ['reminder', 'daily']);
});

test('ביום שאינו יום לימוד או לילד מושהה אין התראה; שיעור שהושלם לפני השעה — אין התראה', async () => {
  const sent = [];
  ha.notify = async (service, msg) => { sent.push(msg); };
  const missed = dailyLessons('2026-10-15')[0];
  setClock('2026-10-16T13:30:00Z'); // שישי
  await scheduler.tick(store);
  assert.equal(sent.length, 0);
  assert.equal((await ok(admin('GET', `lessons/${missed.id}`))).status, 'missed');
  await ok(admin('PUT', `children/${child.id}`, { active: false }));
  setClock('2026-10-18T13:30:00Z'); // ראשון, מושהה
  await scheduler.tick(store);
  assert.equal(sent.length, 0);
  assert.equal((await ok(kid('GET', 'me'))).role, 'paused');
  await ok(admin('PUT', `children/${child.id}`, { active: true }));
  setClock('2026-10-18T10:00:00Z');
  const home = await ok(kid('GET', 'child/home'));
  const today = store.lesson(home.lessonId);
  const missedIds = missed.items.map(i => i.wordId);
  assert.ok(today.items.some(i => missedIds.includes(i.wordId)), 'מילים משיעור שהוחמץ חוזרות לתור');
  await playLesson(await ok(kid('POST', 'child/lesson/start', { lessonId: home.lessonId })), []);
  setClock('2026-10-18T13:30:00Z');
  await scheduler.tick(store);
  assert.equal(sent.length, 0);
});

test('כשל בשליחת התראה נרשם ביומן', async () => {
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

test('ייבוא מרשימה רשמית בלי AI: איור ותרגום מ-ARASAAC, משפט מ-Tatoeba, מסיחים מהמאגר', async () => {
  const lists = await ok(admin('GET', 'wordlists'));
  assert.deepEqual(lists.map(l => l.id), ['preband1', 'band1core1', 'band1core2', 'band2core1', 'band2core2', 'starters', 'movers', 'flyers']);
  const starters = lists.find(l => l.id === 'starters');
  assert.ok(starters.words.find(w => w.en === 'apple').inBank, 'מילה שכבר במאגר מסומנת');
  const HE = { banana: 'בננה', lemon: 'לימון', kite: 'עפיפון' };
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('api.arasaac.org')) {
      const m = /\/(en|he)\/(?:bestsearch\/|search\/)?([^/?]+)$/.exec(u);
      if (m[1] === 'he') return new Response(JSON.stringify({ _id: 1, keywords: [{ keyword: HE[{ 101: 'banana', 102: 'lemon', 103: 'kite' }[m[2]]] }] }));
      const id = { banana: 101, lemon: 102, kite: 103 }[m[2]];
      return new Response(JSON.stringify(id ? [{ _id: id, tags: ['food', 'fruit'], keywords: [{ keyword: m[2], type: 2 }] }] : []));
    }
    if (u.includes('static.arasaac.org')) return new Response(Buffer.from('fakepng-' + u), { headers: { 'content-type': 'image/png' } });
    if (u.includes('tatoeba')) {
      const w = decodeURIComponent(/q=([^&]+)/.exec(u)[1]);
      return new Response(JSON.stringify({ data: [
        { text: `I like the ${w}.`, translations: [[{ lang: 'heb', text: `אני אוהב את ה${HE[w]}.` }]] },
        { text: `This ${w} is very nice.`, translations: [[{ lang: 'heb', text: `ה${HE[w]} הזה נחמד מאוד.` }]] }
      ] }));
    }
    return realFetch(url, opts);
  };
  try {
    const { jobId } = await ok(admin('POST', 'import', { listId: 'starters', level: 'beginner', words: ['banana', 'lemon', 'kite', 'apple'] }));
    let job;
    do { await new Promise(r => setTimeout(r, 50)); job = await ok(admin('GET', 'import/' + jobId)); } while (!job.finished);
    assert.equal(job.added, 3);
    assert.deepEqual(job.skipped, ['apple']);
    const banana = (await ok(admin('GET', 'words?q=banana')))[0];
    assert.equal(banana.he, 'בננה');
    assert.equal(banana.status, 'draft');
    assert.match(banana.image, /^img\/[0-9a-f]{20}\.png$/);
    assert.match(banana.imageCredit, /ARASAAC/);
    const sents = ['I like the banana.', 'This banana is very nice.'];
    assert.ok(sents.includes(banana.exampleEn));
    const other = sents.find(s => s !== banana.exampleEn);
    assert.equal(banana.clozeEn, other.replace('banana', '___'), 'משפט ההשלמה שונה ממשפט הדוגמה');
    assert.equal(banana.topic, 'food');
    assert.equal(banana.distractorsHe.length, 3);
    assert.ok(!banana.distractorsHe.includes('בננה'));
    assert.equal(banana.distractorsEn.length, 3);
  } finally { global.fetch = realFetch; }
});
