'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const srs = require('../server/srs');
const { checkAnswer } = require('../server/lessons');
const { fixWord } = require('../server/gemini');
const { localParts, setNow } = require('../server/util');

test('חזרות במרווחים: הקופסה עולה פעם אחת ביום, ו"נלמדה היטב" רק אחרי הצלחות לאורך זמן', () => {
  const r = srs.newRecord(1, '2026-10-01');
  srs.applySession(r, { correctCount: 3, wrongCount: 0 }, '2026-10-01');
  srs.applySession(r, { correctCount: 3, wrongCount: 0 }, '2026-10-01');
  assert.equal(r.box, 1);
  assert.equal(r.status, 'learning');
  let d = '2026-10-02';
  for (let i = 0; i < 4; i++) {
    srs.applySession(r, { correctCount: 1, wrongCount: 0 }, d);
    d = r.due;
  }
  assert.equal(r.box, 5);
  assert.equal(r.status, 'mastered');
  srs.applySession(r, { correctCount: 0, wrongCount: 1 }, d);
  assert.equal(r.status, 'needs_reinforcement');
  assert.equal(r.box, 3);
});

test('בחירת חזרות: עדיפות לטעויות, שמירה על המכסה', () => {
  const m = {};
  for (let i = 1; i <= 10; i++) {
    m[i] = { ...srs.newRecord(i, '2026-10-01'), sessions: 1, box: 3, due: '2026-10-05', status: 'familiar', correct: 3 };
  }
  m[7] = { ...m[7], status: 'needs_reinforcement', box: 1, due: '2026-10-05', wrong: 2 };
  const pick = srs.selectReview(m, 3, '2026-10-05');
  assert.equal(pick.length, 3);
  assert.equal(pick[0], 7);
  assert.deepEqual(srs.selectReview(m, 3, '2026-10-05', new Set([7])).includes(7), false);
});

test('בדיקת תשובה כתובה: רישיות ורווחים, וטעות הקלדה אחת במילה ארוכה', () => {
  assert.equal(checkAnswer({ t: 'type', answer: 'apple' }, ' Apple ').correct, true);
  assert.deepEqual(checkAnswer({ t: 'type', answer: 'friend' }, 'freind'), { correct: false });
  assert.deepEqual(checkAnswer({ t: 'type', answer: 'friend' }, 'frend'), { correct: true, typo: true });
  assert.equal(checkAnswer({ t: 'type', answer: 'dog' }, 'dig').correct, false);
});

test('ניקוי תוכן מ-Gemini: משפט השלמה נגזר מהדוגמה כשחסר ___', () => {
  const w = fixWord({ en: 'apple', he: 'תפוח', exampleEn: 'I eat an apple.', exampleHe: 'אני אוכל תפוח.', clozeEn: 'no blank here', distractorsHe: ['תפוח', 'בננה'], distractorsEn: ['Apple', 'pear'], topic: 'xx' });
  assert.equal(w.clozeEn, 'I eat an ___.');
  assert.equal(w.clozeHe, 'אני אוכל תפוח.');
  assert.deepEqual(w.distractorsHe, ['בננה']);
  assert.deepEqual(w.distractorsEn, ['pear']);
  assert.equal(w.topic, '');
});

test('שעה מקומית לפי אזור הזמן של הבית', () => {
  setNow(() => new Date('2026-10-12T21:30:00Z'));
  const p = localParts();
  assert.equal(p.date, '2026-10-13');
  assert.equal(p.time, '00:30');
  assert.equal(p.dow, 2);
  setNow(null);
});
