'use strict';
// דיווח להורה: על מה מדווחים, ולאן מותר לשלוח.
//
// שתי התקלות שהבדיקות האלה שומרות עליהן התגלו יחד, אחרי שההורה שאל
// למה הוא לא מקבל כלום: תרגול ששלח בעצמו לא דווח מעולם, ובחירת מכשיר
// נדחתה בשקט כשהיא לא הייתה mobile_app_.
const { test } = require('node:test');
const assert = require('node:assert');

// ha מזויף, לפני שהמתזמן טוען אותו
const haPath = require.resolve('../server/ha.js');
const real = require('../server/ha.js');
const sent = [];
require.cache[haPath] = {
  id: haPath, filename: haPath, loaded: true,
  exports: {
    mode: 'test', connected: () => true,
    notify: async (service, p) => { sent.push({ service, ...p }); },
    isNotifyTarget: real.isNotifyTarget,
    rest: async () => ({}), wsCommand: async () => ({}), listUsers: async () => [],
    notifyServices: async () => [], config: async () => ({}), selfInfo: async () => null,
  },
};

const SC = require('../server/scheduler');

function fakeStore() {
  return {
    data: {
      settings: { adminNotifyService: 'mobile_app_test', notifyAdminSessionDone: true },
      notifications: [], notices: [],
    },
    nextId: () => 1,
    save() {},
  };
}
const child = { id: 1, name: 'נועם', gender: 'f' };
const base = { correct: 9, total: 10, pct: 90, stars: 3, weak: [], learned: false };

// ---------- על מה מדווחים ----------
test('תרגול שההורה שלח מדווח — זה מה שלא עבד', async () => {
  const s = fakeStore();
  const r = await SC.notifySessionDone(s, child, { ...base, kind: 'extra', subject: 'clock', level: 2, phase: 'extra' });
  assert.ok(r, 'תרגול ששלח ההורה חייב להגיע אליו');
  assert.strictEqual(r.service, 'mobile_app_test');
  assert.match(sent[sent.length - 1].title, /ששלחת/);
});

test('התרגול היומי ממשיך לדווח', async () => {
  const s = fakeStore();
  const r = await SC.notifySessionDone(s, child, { ...base, kind: 'daily', subject: 'tables', table: 7, phase: '' });
  assert.ok(r);
});

test('תרגול שעון חופשי לא מדווח — אחרת כל פתיחה של מגרש המשחקים מתריעה', async () => {
  const s = fakeStore();
  const r = await SC.notifySessionDone(s, child, { ...base, kind: 'practice', subject: 'clock', level: 1 });
  assert.strictEqual(r, null);
});

test('בלי מכשיר להורה לא נשלח כלום, גם כשהמתג דלוק', async () => {
  const s = fakeStore();
  s.data.settings.adminNotifyService = '';
  assert.strictEqual(await SC.notifySessionDone(s, child, { ...base, kind: 'daily', table: 7 }), null);
});

// ---------- מה כתוב בהודעה ----------
test('תרגול שעון מתואר כשעון ולא כ"כפולות של null"', () => {
  assert.strictEqual(SC.doneSubject({ subject: 'clock', level: 2, table: null }), 'שעון · עם רבעים');
  assert.strictEqual(SC.doneSubject({ subject: 'clock', level: 3, table: null }), 'שעון · כל 5 דקות');
  const m = SC.doneMessage(child, { ...base, kind: 'extra', subject: 'clock', level: 1, table: null });
  assert.doesNotMatch(m, /null/);
  assert.match(m, /ששלחת/);
  assert.match(m, /שעון/);
});

test('תרגול ביותר מכפולה אחת מונה את כולן', () => {
  assert.strictEqual(SC.doneSubject({ subject: 'tables', tables: [3, 4], table: 3 }), 'כפולות של 3, 4');
  assert.strictEqual(SC.doneSubject({ subject: 'tables', tables: [], table: 7 }), 'כפולות של 7');
  assert.strictEqual(SC.doneSubject({ subject: 'tables', phase: 'mix', table: null }), 'חזרה על כל הכפולות');
});

// ---------- לאן מותר לשלוח ----------
test('קבוצת התראות מתקבלת — אחרת כל החלפת נייד שוברת את ההתראות בשקט', () => {
  assert.ok(real.isNotifyTarget('koby_phone'));
  assert.ok(real.isNotifyTarget('lihi_phone'));
  assert.ok(real.isNotifyTarget('mobile_app_sm_a736bfroma'));
  assert.ok(!real.isNotifyTarget(''));
  assert.ok(!real.isNotifyTarget('notify/../hack'));
  assert.ok(!real.isNotifyTarget('Mobile_App_X'));
});
