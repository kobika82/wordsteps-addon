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

test('Gemini: מודל שהוצא משימוש מוחלף אוטומטית בעדכני ביותר', async () => {
  const gemini = require('../server/gemini');
  const names = ['gemini-2.0-flash', 'gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-3.10-flash-tts', 'gemini-3.8-flash-image-preview', 'gemini-3.5-flash'];
  assert.equal(gemini.pickLatest(names, 'text'), 'gemini-3.8-flash');
  assert.equal(gemini.pickLatest(names, 'image'), 'gemini-3.8-flash-image-preview');
  assert.equal(gemini.pickLatest(['gemini-3.8-flash', 'gemini-3.10-flash'], 'text'), 'gemini-3.10-flash');
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    if (url.includes('?pageSize')) return new Response(JSON.stringify({ models: names.map(n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) }));
    if (url.includes('gemini-2.5-flash:')) return new Response(JSON.stringify({ error: { message: 'no longer available' } }), { status: 404 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
  };
  try {
    gemini.configure({ apiKey: 'k', model: 'gemini-2.5-flash' });
    assert.equal(await gemini.test(), 'ok');
    assert.equal(gemini.info().model, 'gemini-3.8-flash');
    assert.ok(calls.at(-1).includes('gemini-3.8-flash:generateContent'));
  } finally { global.fetch = realFetch; }
});

test('Gemini: עומס זמני (503) — ניסיונות חוזרים ואז מודל חלופי', async () => {
  const gemini = require('../server/gemini');
  gemini.setSleep(async () => {});
  const realFetch = global.fetch;
  const calls = [];
  const names = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.8-flash-lite'];
  global.fetch = async (url) => {
    calls.push(url);
    if (url.includes('?pageSize')) return new Response(JSON.stringify({ models: names.map(n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) }));
    if (url.includes('gemini-3.8-flash:')) return new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
  };
  try {
    gemini.configure({ apiKey: 'k', model: 'gemini-3.8-flash' });
    assert.equal(await gemini.test(), 'ok');
    assert.equal(calls.filter(u => u.includes('gemini-3.8-flash:')).length, 3, 'שלושה ניסיונות על המודל הראשי');
    assert.ok(calls.at(-1).includes('gemini-3.8-flash-lite:') || calls.at(-1).includes('gemini-3.5-flash:'));
    assert.equal(gemini.info().model, 'gemini-3.8-flash', 'עומס זמני לא משנה את ברירת המחדל');
    global.fetch = async (url) => url.includes('?pageSize')
      ? new Response(JSON.stringify({ models: [] }))
      : new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 });
    await assert.rejects(gemini.test(), /עמוס/);
  } finally { global.fetch = realFetch; }
});

test('בדיקת Gemini אוטומטית: אקראית מהרמה, שעה אחרי הצלחה, 10 דקות אחרי עומס, עד 10 ביום', async () => {
  const gemini = require('../server/gemini');
  const aireview = require('../server/aireview');
  const util = require('../server/util');
  const words = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, en: 'w' + i, he: 'מ' + i, level: i < 25 ? 'beginner' : 'advanced', status: 'draft' }));
  const store = { data: { settings: {}, words, children: [{ active: true, level: 'beginner', age: 8 }] }, save() {} };
  let clock = new Date('2026-10-23T05:00:00Z');
  util.setNow(() => clock);
  const after = min => { clock = new Date(clock.getTime() + min * 60000); };
  gemini.configure({ apiKey: 'k' });
  const realReview = gemini.reviewWord;
  let fail = false, calls = 0;
  gemini.reviewWord = async (w) => {
    calls++;
    if (fail) throw new Error('503 high demand');
    return calls === 1 ? { verdict: 'fixed', reason: 'תוקן התרגום', changes: { he: { from: w.he, to: 'מתוקן' } }, model: 'm' } : { verdict: 'ok', reason: 'תקין', changes: {}, model: 'm' };
  };
  try {
    const first = await aireview.tick(store);
    const fw = words.find(w => w.en === first.word);
    assert.equal(fw.level, 'beginner', 'קודם מילים ברמה שילד צריך');
    assert.equal(fw.he, 'מתוקן');
    assert.equal(fw.status, 'draft', 'Gemini לא מאשר סופית');
    after(30);
    assert.equal(await aireview.tick(store), null, 'אחרי הצלחה — לא לפני שעה');
    after(30);
    fail = true;
    const bad = await aireview.tick(store);
    assert.match(bad.error, /503/);
    after(9);
    assert.equal(await aireview.tick(store), null, 'אחרי עומס — לא לפני 10 דקות');
    after(1);
    const retry = await aireview.tick(store);
    assert.match(retry.error, /503/, 'ניסיון חוזר אחרי 10 דקות');
    assert.equal(aireview.status(store).state.count, 1, 'כשלים לא נספרים במכסה');
    fail = false;
    after(10);
    for (let i = 0; i < 30; i++) { await aireview.tick(store); const next = new Date(clock.getTime() + 60 * 60000); if (next.toISOString() >= '2026-10-23T20:30') break; clock = next; }
    assert.equal(aireview.status(store).state.count, 10, 'עד 10 ביום');
    const order = words.filter(w => w.ai).sort((a, b) => a.ai.at.localeCompare(b.ai.at)).map(w => w.id);
    assert.ok(order.every(id => id <= 25), 'כל הנבדקות מהרמה שהילדים צריכים');
    assert.ok(order.some((id, i) => i && id < order[i - 1]), 'הסדר אקראי, לא לפי הרשימה');
  } finally { gemini.reviewWord = realReview; util.setNow(null); gemini.configure({ apiKey: '' }); }
});

test('בדיקה ידנית בזמן שהבדיקה האוטומטית באמצע קריאה ל-Gemini — הודעת "תפוס", לא "אין מילים"', async () => {
  const gemini = require('../server/gemini');
  const aireview = require('../server/aireview');
  const words = [{ id: 1, en: 'cat', he: 'חתול', level: 'beginner', status: 'draft' }];
  const store = { data: { settings: {}, words, children: [{ active: true, level: 'beginner', age: 8 }] }, save() {} };
  gemini.configure({ apiKey: 'k' });
  const realReview = gemini.reviewWord;
  let resolveReview;
  gemini.reviewWord = () => new Promise(r => { resolveReview = r; });
  try {
    const slow = aireview.tick(store); // לא ממתינים: נשאר "תקוע" באמצע הקריאה ל-Gemini, בדיוק כמו הבדיקה האוטומטית התקופתית
    const manual = await aireview.tick(store, { force: true });
    assert.match(manual.error, /כבר פועלת/, 'לא ההודעה הגנרית "אין מילים שממתינות... Gemini לא מוגדר"');
    resolveReview({ verdict: 'ok', reason: 'תקין', changes: {}, model: 'm' });
    const first = await slow;
    assert.equal(first.word, 'cat', 'הבדיקה שהייתה באמצע ממשיכה כרגיל');
  } finally { gemini.reviewWord = realReview; gemini.configure({ apiKey: '' }); }
});


test('חופשה חוזרת כל שנה: לפי חודש-יום, כולל טווח שעובר את סוף השנה', () => {
  const s = require('../server/scheduler');
  const store = { data: { settings: { holidays: [
    { name: 'חופש גדול', from: '2027-06-21', to: '2027-08-31', time: '10:00', yearly: true },
    { name: 'חג המולד', from: '2026-12-25', to: '2027-01-02', time: '09:00', yearly: true },
    { name: 'חד-פעמי', from: '2027-03-23', to: '2027-03-24', time: '11:00' }
  ] } } };
  assert.equal(s.holidayOn(store, '2030-07-15').name, 'חופש גדול', 'שנה אחרת — אותם תאריכים');
  assert.equal(s.holidayOn(store, '2030-09-01'), null);
  assert.equal(s.holidayOn(store, '2031-01-01').name, 'חג המולד', 'טווח שעובר את סוף השנה');
  assert.equal(s.holidayOn(store, '2027-03-24').name, 'חד-פעמי');
  assert.equal(s.holidayOn(store, '2028-03-24'), null, 'חופשה לא-חוזרת לא חוזרת');
  assert.equal(s.notifyTimeFor(store, { notifyTime: '16:00' }, '2029-08-01'), '10:00');
});
