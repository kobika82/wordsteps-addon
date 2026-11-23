'use strict';
// לאן מותר לשלוח התראות.
//
// הרשימה שהמסך מציג והבדיקה בשרת נגזרות מאותו כלל אחד. כששתיהן היו
// נפרדות, בחירה שהמסך הציע נזרקה בשרת בלי שום הודעה — והמנהל ראה
// שדה ריק בלי להבין למה.
const { test } = require('node:test');
const assert = require('node:assert');
const ha = require('../server/ha');

test('קבוצת התראות מתקבלת — אחרת כל החלפת נייד שוברת את ההתראות בשקט', () => {
  assert.ok(ha.isNotifyTarget('koby_phone'));
  assert.ok(ha.isNotifyTarget('lihi_phone'));
  assert.ok(ha.isNotifyTarget('mobile_app_iphone_aviv'));
});

test('ערך לא תקין נדחה', () => {
  assert.ok(!ha.isNotifyTarget(''));
  assert.ok(!ha.isNotifyTarget(null));
  assert.ok(!ha.isNotifyTarget('notify/../hack'));
  assert.ok(!ha.isNotifyTarget('persistent notification'));
  assert.ok(!ha.isNotifyTarget('Mobile_App_X'));
});

test('שליחה לשירות לא תקין נחסמת לפני הקריאה ל-HA', async () => {
  await assert.rejects(() => ha.notify('bad/service', { title: 'x', message: 'y' }), /לא תקין/);
});
