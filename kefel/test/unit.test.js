'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../server/math');

test('כל סוגי השאלות: התשובה ברשימה, אין כפילויות, החשבון נכון', () => {
  for (let i = 0; i < 300; i++) {
    for (const t of M.QUESTION_TYPES) {
      for (const n of M.TABLES) {
        const k = 1 + (i % 10);
        const q = M.question(t, n, k);
        if (q.options) {
          assert.strictEqual(new Set(q.options).size, 4, JSON.stringify(q));
          assert.ok(q.options.includes(q.answer));
          assert.ok(q.options.every(x => x > 0));
        }
        if (t === 'seq' && n === 1) assert.notStrictEqual(q.t, 'seq', 'אין רצף בכפולות של 1');
        if (q.t === 'seq') {
          assert.strictEqual(q.seq.filter(x => x === null).length, 1);
          assert.notStrictEqual(q.seq[0], null);
          assert.strictEqual(q.answer % n, 0);
          assert.ok(q.options.every(o => o === q.answer || !q.seq.includes(o)), 'מסיח ברצף לא מופיע ברצף עצמו');
        }
        assert.strictEqual(q.a * q.b, q.answer);
      }
    }
  }
});

test('שליטה בעובדה: שלוש נכונות ברצף; טעות מאפסת', () => {
  const f = {};
  M.record(f, 3, 4, true, 'd');
  assert.strictEqual(M.status(f['3x4']), 'learning');
  M.record(f, 4, 3, true, 'd');   // אותה עובדה בסדר הפוך
  assert.strictEqual(M.status(f['3x4']), 'good');
  M.record(f, 3, 4, true, 'd');
  assert.strictEqual(M.status(f['3x4']), 'mastered');
  M.record(f, 3, 4, false, 'd');
  assert.strictEqual(M.status(f['3x4']), 'weak');
  assert.strictEqual(M.tableState(f, 3).facts[3].status, 'weak');
  assert.strictEqual(M.tableState(f, 4).facts[2].status, 'weak', '3×4 נספרת גם בכפולות של 4');
});

test('בחירת עובדות: בלי חזרות עד שנגמרות, ומעדיפה חלשות', () => {
  const ks = M.pickFacts({}, 5, 10);
  assert.strictEqual(new Set(ks).size, 10);
  const f = {};
  for (let k = 1; k <= 10; k++) if (k !== 7) for (let i = 0; i < 3; i++) M.record(f, k, 6, true, 'd');
  M.record(f, 7, 6, false, 'd');
  let first7 = 0;
  for (let i = 0; i < 400; i++) if (M.pickFacts(f, 6, 1)[0] === 7) first7++;
  assert.ok(first7 > 150, 'העובדה החלשה נבחרת הרבה יותר: ' + first7);
});

test('רק שלוש תבניות: בחירה, הקלדה, רצף — ובלי רצף בכפולות של 1', () => {
  for (let i = 0; i < 100; i++) {
    const q = M.buildQuiz({}, { current: 3, count: 10, learnDay: i % 2 === 0 });
    assert.strictEqual(q.length, 10);
    assert.ok(q.every(x => x.n === 3 && ['mc', 'pad', 'seq'].includes(x.t)));
    assert.ok(M.buildQuiz({}, { current: 1, count: 10 }).every(x => x.t !== 'seq'));
    assert.ok(M.buildMix({}, { tables: [1, 2], count: 10 }).every(x => x.t !== 'seq' || x.n !== 1));
  }
  const learn = M.buildQuiz({}, { current: 4, count: 10, learnDay: true });
  assert.strictEqual(learn[0].t, 'mc', 'ביום הלימוד מתחילים בבחירה');
});

test('שאלת חזרה על טעות היא בחירה מתוך ארבע, על אותה עובדה', () => {
  for (const t of M.QUESTION_TYPES) {
    const q = M.question(t, 6, 7);
    const r = M.retryOf(q);
    assert.strictEqual(r.t, 'mc');
    assert.ok(r.retry);
    assert.strictEqual(r.answer, 42, t);
  }
});

test('כיתוב הציור', () => {
  assert.strictEqual(M.caption(4, 3), '4 סלסלות, בכל אחת 3 תותים');
  assert.strictEqual(M.caption(1, 6), 'קרטון אחד, בכל אחד 6 ביצים');
});

test('חזרה על הרבה כפולות לא מעמיסה: 10 שאלות, עד 4 כפולות, קודם החלשות', () => {
  const f = {};
  for (const n of [2, 3, 4, 5, 6, 10]) for (let k = 1; k <= 10; k++) for (let i = 0; i < 3; i++) M.record(f, k, n, true, 'd');
  M.record(f, 7, 8, false, 'd');   // כפולות של 8 (ושל 7) — חלשות
  const tables = [2, 3, 4, 5, 6, 8, 9, 10];
  for (let i = 0; i < 50; i++) {
    const q = M.buildMix(f, { tables, count: 10, maxTables: 4 });
    assert.strictEqual(q.length, 10);
    const ns = new Set(q.map(x => x.n));
    assert.ok(ns.size <= 4);
    assert.ok(ns.has(8) && ns.has(9), 'החלשות תמיד בפנים');
  }
  // סבב: כפולה שלא חזרו עליה הכי הרבה זמן נבחרת
  const picked = M.pickMixTables(f, tables, 4, { 2: '2026-11-20', 3: '2026-11-01', 4: '2026-11-20', 5: '2026-11-20', 6: '2026-11-20', 8: '2026-11-20', 9: '2026-11-20', 10: '2026-11-02' });
  assert.ok(picked.includes(3) && picked.includes(10));
});

test('בונוס רצף: 2 כוכבים קבועים מהיום השני, וסוף שבוע לא שובר את הרצף', () => {
  const RW = require('../server/rewards');
  const store = { data: { settings: {}, sessions: [] } };
  const child = { id: 1, days: [0, 1, 2, 3, 4] };   // ראשון–חמישי
  const done = d => store.data.sessions.push({ childId: 1, kind: 'daily', status: 'completed', date: d });
  assert.strictEqual(RW.starsForLesson(store, 100, 1).streakBonus, 0, 'יום ראשון של רצף — בלי בונוס');
  assert.strictEqual(RW.starsForLesson(store, 100, 2).streakBonus, 2);
  assert.strictEqual(RW.starsForLesson(store, 100, 9).streakBonus, 2, 'לא גדל עם אורך הרצף');
  assert.strictEqual(RW.starsForLesson(store, 100, 2).stars, 12);
  done('2026-11-11'); done('2026-11-12');           // רביעי, חמישי
  assert.strictEqual(RW.streakOf(store, child, '2026-11-14'), 2, 'שבת ושישי מדולגים');
  assert.strictEqual(RW.streakOf(store, child, '2026-11-15'), 0, 'ראשון שלא תורגל שובר');
  done('2026-11-15');
  assert.strictEqual(RW.streakOf(store, child, '2026-11-15'), 3);
  store.data.settings.stars = { streakBonus: 0 };
  assert.strictEqual(RW.starsForLesson(store, 100, 5).streakBonus, 0, 'ההורה יכול לכבות');
});

test('בונוס רצף רטרואקטיבי: רק על ימים ברצף, פעם אחת בלבד', () => {
  const S = require('../server/sessions');
  const child = { id: 1, name: 'שחר', gender: 'm', days: [0, 1, 2, 3, 4], stars: 30, starsEarned: 30 };
  const sess = (id, date, summary) => ({ id, childId: 1, kind: 'daily', status: 'completed', date, plan: [], summary });
  const store = { save() {}, data: { settings: {}, children: [child], sessions: [
    sess(1, '2026-11-04', { stars: 10 }),                   // רביעי — תחילת רצף
    sess(2, '2026-11-05', { stars: 8 }),                    // חמישי — רצף 2
    sess(3, '2026-11-08', { stars: 10 }),                   // ראשון — סוף שבוע לא שובר: רצף 3
    sess(4, '2026-11-09', { stars: 12, streakBonus: 2 })    // כבר קיבל בונוס בגרסה החדשה
  ] } };
  const g = S.retroStreakBonus(store);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].stars, 4);
  assert.deepStrictEqual(g[0].dates, ['2026-11-05', '2026-11-08']);
  assert.strictEqual(child.stars, 34);
  assert.strictEqual(child.starsEarned, 34);
  assert.strictEqual(store.data.sessions[1].summary.stars, 10);
  assert.strictEqual(S.retroStreakBonus(store).length, 0, 'הפעלה שנייה לא נותנת שוב');
  assert.strictEqual(child.stars, 34);
});
