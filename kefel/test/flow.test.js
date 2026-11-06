'use strict';
// תרחישים מקצה לקצה דרך ה-HTTP: הורה פותח כפולה, ילד לומד, עונה, מקבל כוכבים ומבקש פרס.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kefel-'));
process.env.KEFEL_DEV = '1';
process.env.DATA_DIR = DIR;
process.env.KEFEL_NO_SCHEDULER = '1';
const U = require('../server/util');
const { server, store } = require('../server/main');
const M = require('../server/math');

let base;
async function call(as, method, p, body) {
  const res = await fetch(base + '/api/' + p + (p.includes('?') ? '&' : '?') + 'as=' + as, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const admin = (m, p, b) => call('admin', m, p, b);
const kid = (m, p, b) => call('kid1', m, p, b);

// עונה על כל השלבים; wrongSteps = אילו שאלות לענות בכוונה לא נכון
async function playAll(view, wrongSteps = new Set()) {
  let plan = view.plan;
  for (let i = 0; i < plan.length; i++) {
    const st = plan[i];
    if (st.t === 'learn') { assert.strictEqual((await kid('POST', `child/session/${view.id}/learned`, { step: i })).status, 200); continue; }
    const ans = wrongSteps.has(i) ? st.answer + 1 : st.answer;
    const r = await kid('POST', `child/session/${view.id}/answer`, { step: i, answer: ans });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    plan = r.data.plan;
  }
  return (await kid('POST', `child/session/${view.id}/complete`)).data;
}

test.before(async () => {
  await new Promise(r => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
  U.setNow(() => new Date('2026-11-08T10:00:00+02:00'));   // יום ראשון
});
test.after(() => { server.close(); store.flush(); fs.rmSync(DIR, { recursive: true, force: true }); });

let childId;
test('הורה יוצר ילד ופותח כפולה', async () => {
  const c = await admin('POST', 'children', { name: 'דני', gender: 'm', haUserId: 'kid1', days: [0, 1, 2, 3, 4] });
  assert.strictEqual(c.status, 200);
  childId = c.data.id;
  let home = await kid('GET', 'child/home');
  assert.strictEqual(home.data.mode, 'none');
  const u = await admin('POST', `children/${childId}/unlock`, { n: 3 });
  assert.strictEqual(u.data.child.current, 3);
  home = await kid('GET', 'child/home');
  assert.strictEqual(home.data.mode, 'daily');
  assert.strictEqual(home.data.needLearn, true);
});

test('ילד לא יכול לגשת לנתיבי הורה', async () => {
  assert.strictEqual((await kid('GET', 'children')).status, 403);
});

test('תרגול ראשון: שלב לימוד, טעות חוזרת בסוף, ציון לפי ניסיון ראשון', async () => {
  const v = (await kid('POST', 'child/session/start', { mode: 'daily' })).data;
  assert.strictEqual(v.kind, 'daily');
  assert.strictEqual(v.plan[0].t, 'learn');
  assert.ok(v.plan.slice(1).every(s => s.n === 3), 'ביום לימוד כל השאלות מהכפולה החדשה');
  const n = v.plan.length;
  // אי אפשר לסיים לפני שעונים על הכול
  assert.strictEqual((await kid('POST', `child/session/${v.id}/complete`)).status, 400);
  const sum = await playAll(v, new Set([1]));
  assert.strictEqual(sum.total, n - 1);
  assert.strictEqual(sum.correct, n - 2);
  assert.strictEqual(sum.pct, Math.round(((n - 2) / (n - 1)) * 100));
  assert.ok(sum.stars > 0);
  assert.strictEqual(sum.weak.length, 1);
  const s = store.session(v.id);
  assert.strictEqual(s.plan.length, n + 1, 'נוספה שאלת חזרה אחת');
  assert.ok(s.plan[n].retry);
  assert.ok(store.child(childId).tables[0].learnedAt, 'הכפולה סומנה כנלמדה');
});

test('אחרי התרגול היומי: מצב "סיום", אימון נוסף בלי כוכבים', async () => {
  const home = (await kid('GET', 'child/home')).data;
  assert.strictEqual(home.mode, 'done');
  assert.strictEqual(home.needLearn, false);
  const before = store.child(childId).stars;
  const v = (await kid('POST', 'child/session/start', { mode: 'daily' })).data;
  assert.strictEqual(v.kind, 'practice', 'תרגול יומי שני באותו יום הופך לאימון');
  assert.notStrictEqual(v.plan[0].t, 'learn');
  const sum = await playAll(v);
  assert.strictEqual(sum.stars, 0);
  assert.strictEqual(store.child(childId).stars, before);
});

test('תשובה כפולה לאותה שאלה לא נספרת פעמיים', async () => {
  U.setNow(() => new Date('2026-11-09T10:00:00+02:00'));
  const v = (await kid('POST', 'child/session/start', {})).data;
  const st = v.plan[0];
  await kid('POST', `child/session/${v.id}/answer`, { step: 0, answer: st.answer + 1 });
  const again = await kid('POST', `child/session/${v.id}/answer`, { step: 0, answer: st.answer });
  assert.strictEqual(again.data.correct, false);
  assert.strictEqual(again.data.again, true);
  assert.strictEqual(store.session(v.id).plan.filter(s => s.retry).length, 1);
});

test('תרגול שלא הסתיים נסגר למחרת', async () => {
  U.setNow(() => new Date('2026-11-10T10:00:00+02:00'));
  require('../server/sessions').closeStale(store, U.today());
  const home = (await kid('GET', 'child/home')).data;
  assert.strictEqual(home.mode, 'daily');
});

test('כפולה שנייה: החזרה כוללת את הכפולה הקודמת', async () => {
  await admin('POST', `children/${childId}/unlock`, { n: 4 });
  const v1 = (await kid('POST', 'child/session/start', {})).data;
  assert.strictEqual(v1.plan[0].t, 'learn');
  await playAll(v1);
  U.setNow(() => new Date('2026-11-11T10:00:00+02:00'));
  const v2 = (await kid('POST', 'child/session/start', {})).data;
  assert.ok(v2.plan.some(s => s.role === 'review' && s.n === 3), 'יש שאלות חזרה מכפולות של 3');
  assert.ok(v2.plan.filter(s => s.role === 'main').every(s => s.n === 4));
  await playAll(v2);
});

test('הודעה להורה כשהילד שולט בכפולה', async () => {
  const facts = store.childFacts(childId);
  for (let k = 1; k <= 10; k++) for (let i = 0; i < 3; i++) M.record(facts, k, 4, true, '2026-11-11');
  U.setNow(() => new Date('2026-11-12T10:00:00+02:00'));
  const v = (await kid('POST', 'child/session/start', {})).data;
  const sum = await playAll(v);
  assert.strictEqual(sum.ready, true);
  await new Promise(r => setTimeout(r, 50));
  const dash = (await admin('GET', 'dashboard')).data;
  assert.ok(dash.notices.some(n => /שולט בכפולות של 4/.test(n.text)));
  // פעם אחת בלבד
  U.setNow(() => new Date('2026-11-15T10:00:00+02:00'));
  const v2 = (await kid('POST', 'child/session/start', {})).data;
  assert.strictEqual((await playAll(v2)).ready, false);
});

test('פרס: יעד, בקשה, דחייה מחזירה כוכבים; פרס בדיחה לא ניתן לבקשה', async () => {
  const c = store.child(childId);
  c.stars = 50;
  const cat = (await kid('GET', 'child/rewards')).data.catalog;
  const joke = cat.find(r => r.joke);
  assert.strictEqual((await kid('POST', `child/rewards/${joke.id}/goal`)).data.joke, true);
  assert.notStrictEqual((await kid('POST', `child/rewards/${joke.id}/request`)).status, 200);
  const cheap = cat.find(r => !r.joke && r.cost <= 50);
  const req = await kid('POST', `child/rewards/${cheap.id}/request`);
  assert.strictEqual(req.status, 200);
  assert.strictEqual(store.child(childId).stars, 50 - cheap.cost);
  await admin('POST', `redemptions/${req.data.id}/decide`, { approve: false });
  assert.strictEqual(store.child(childId).stars, 50);
});

test('נעילת הכפולה הנוכחית מחזירה לכפולה הקודמת', async () => {
  const r = await admin('DELETE', `children/${childId}/tables/4`);
  assert.strictEqual(r.data.current, 3);
  assert.strictEqual((await admin('POST', `children/${childId}/unlock`, { n: 11 })).status, 400);
});

test('תצוגה מקדימה להורה לא שומרת כלום', async () => {
  const before = store.data.sessions.length;
  const p = (await admin('POST', 'preview', { n: 7 })).data;
  assert.strictEqual(p.plan[0].t, 'learn');
  assert.strictEqual(store.data.sessions.length, before);
});
