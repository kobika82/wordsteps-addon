'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../server/math');

test('כל סוגי השאלות: התשובה ברשימה, אין כפילויות, החשבון נכון', () => {
  for (let i = 0; i < 300; i++) {
    for (const t of ['mc', 'pad', 'pic', 'seq', 'miss']) {
      for (const n of M.TABLES) {
        const k = 1 + (i % 10);
        const q = M.question(t, n, k);
        if (q.options) {
          assert.strictEqual(new Set(q.options).size, 4, JSON.stringify(q));
          assert.ok(q.options.includes(q.answer));
          assert.ok(q.options.every(x => x > 0));
        }
        if (t === 'seq') {
          assert.strictEqual(q.seq.filter(x => x === null).length, 1);
          assert.notStrictEqual(q.seq[0], null);
          assert.strictEqual(q.answer % n, 0);
        } else if (t === 'miss') assert.strictEqual(q.a * q.answer, q.product);
        else assert.strictEqual(q.a * q.b, q.answer);
        if (t === 'pic') assert.strictEqual(q.b, n, 'בציור: קבוצות של n');
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

test('תוכנית: יום לימוד מתחיל בציור, בלי חזרה; אחר כך חזרה לפי האחוז', () => {
  const q = M.buildQuiz({}, { current: 3, others: [2], count: 10, learnDay: true, reviewShare: 30 });
  assert.strictEqual(q.length, 10);
  assert.strictEqual(q[0].t, 'pic');
  assert.ok(q.every(x => x.n === 3));
  const q2 = M.buildQuiz({}, { current: 3, others: [2, 5], count: 10, reviewShare: 30 });
  assert.strictEqual(q2.filter(x => x.role === 'review').length, 3);
});

test('שאלת חזרה על טעות היא בחירה מתוך ארבע, על אותה עובדה', () => {
  for (const t of ['mc', 'pad', 'pic', 'seq', 'miss']) {
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
