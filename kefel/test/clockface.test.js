'use strict';
// בדיקות ללוח השעון שבדפדפן. כאן גרו שלוש תקלות — בחירת המחוג, קריאת מחוג
// השעות, והצמדה בשעה עגולה — ולכן שווה להריץ אותו בלי דפדפן: דום מזויף
// מינימלי, ואירועי מצביע אמיתיים דרך אותם מאזינים שהילד מפעיל באצבע.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SIZE = 232;                       // 116 יחידות viewBox × 2 פיקסלים
const C = SIZE / 2;
const UNIT = (SIZE / 116) * 50;         // פיקסלים לרדיוס מלא של הלוח

function fakeEl() {
  return {
    attrs: {}, children: [], style: {}, textContent: '', handlers: {},
    classList: {
      s: new Set(),
      add(c) { this.s.add(c); },
      toggle(c, on) { if (on) this.s.add(c); else this.s.delete(c); },
      contains(c) { return this.s.has(c); },
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); },
    fire(t, ev) { for (const f of this.handlers[t] || []) f(Object.assign({ pointerId: 1, preventDefault() {} }, ev)); },
    getBoundingClientRect() { return { left: 0, top: 0, width: SIZE, height: SIZE }; },
    setPointerCapture() {}, releasePointerCapture() {},
  };
}

function loadClock() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'clock.js'), 'utf8');
  const window = { KF: { num: (n) => String(n) } };
  const document = { createElementNS: () => fakeEl() };
  new Function('window', 'document', src)(window, document);
  return window.KF.clock;
}

const CLOCK = loadClock();
// נקודה על הלוח: frac הוא 0..1 סביב השעון, rad שבר מהרדיוס
const at = (frac, rad) => {
  const a = frac * 2 * Math.PI - Math.PI / 2;
  return { clientX: C + Math.cos(a) * rad * UNIT, clientY: C + Math.sin(a) * rad * UNIT };
};
const dragTo = (f, frac, rad) => { f.el.fire('pointerdown', at(frac, rad)); f.el.fire('pointerup', at(frac, rad)); };
const hhmm = (f) => String(f.hour).padStart(2, '0') + ':' + String(f.minute).padStart(2, '0');

test('הגרירה מזיזה רק את המחוג שנבחר, בכל מקום על הלוח', () => {
  const f = CLOCK.face({ hour: 10, minute: 10, draggable: true, step: 5 });
  assert.strictEqual(f.hand, 'minute', 'ברירת המחדל היא מחוג הדקות');

  // ליד המרכז — פעם זה היה נתפס כמחוג השעות
  dragTo(f, 3 / 12, 0.30);
  assert.strictEqual(hhmm(f), '10:15', 'רק הדקות זזו');

  f.setHand('hour');
  // בשפה — פעם זה היה נתפס כמחוג הדקות
  dragTo(f, 6 / 12, 0.95);
  assert.strictEqual(hhmm(f), '06:15', 'רק השעות זזו');

  f.setHand('minute');
  dragTo(f, 9 / 12, 0.20);
  assert.strictEqual(hhmm(f), '06:45', 'חזרה לדקות');
});

test('המחוג הנבחר מסומן על הלוח, ורק כשאפשר לגרור', () => {
  const f = CLOCK.face({ draggable: true });
  assert.ok(f.el.classList.contains('sel-minute'));
  f.setHand('hour');
  assert.ok(f.el.classList.contains('sel-hour') && !f.el.classList.contains('sel-minute'));
  const still = CLOCK.face({});
  assert.ok(!still.el.classList.contains('sel-minute'), 'שעון לקריאה בלבד אינו מסמן מחוג');
});

test('שעה עגולה נתפסת גם כשהאצבע החטיאה את הספרה', () => {
  for (const h of [1, 5, 12]) {
    for (const off of [0, -0.004, 0.004]) {       // בדיוק על הספרה, ומעט לפניה ואחריה
      const f = CLOCK.face({ hour: 9, minute: 0, draggable: true, hand: 'hour' });
      dragTo(f, (h % 12) / 12 + off, 0.45);
      assert.strictEqual(f.hour, h % 12, `הנחה על ${h} בסטייה ${off} נתנה ${f.hour}`);
    }
  }
});

test('מחוג השעות בחצי השעה נשאר בדיוק איפה שהונח', () => {
  // ב-7:30 המחוג עומד באמצע בין 7 ל-8. אם הקריאה הייתה "הספרה הקרובה" היה
  // מתקבל 8:30, ואם הייתה "המקטע שבו הוא עומד" הוא היה קופץ קדימה בציור.
  const f = CLOCK.face({ hour: 3, minute: 30, draggable: true, hand: 'hour', step: 30 });
  const drop = 7.5 / 12;
  dragTo(f, drop, 0.45);
  assert.strictEqual(hhmm(f), '07:30');
  const drawn = ((f.hour % 12) + f.minute / 60) / 12;
  assert.ok(Math.abs(drawn - drop) < 1e-9, 'המחוג זז מהמקום שבו הונח');
});

test('מחוג הדקות נצמד לקפיצות הרמה', () => {
  const f = CLOCK.face({ hour: 8, minute: 0, draggable: true, step: 15 });
  dragTo(f, 0.30, 0.8);                            // 18 דקות
  assert.strictEqual(f.minute, 15);
  dragTo(f, 0.38, 0.8);                            // 22.8 דקות
  assert.strictEqual(f.minute, 30);
});

test('אפשר לכבות את מספרי הדקות, והלוח מתרחב לתיבה', () => {
  const f = CLOCK.face({});
  const wide = f.el.getAttribute('viewBox');
  f.showMinutes(false);
  const tight = f.el.getAttribute('viewBox');
  assert.notStrictEqual(wide, tight, 'התיבה מתכווצת כשאין מספרים מסביב');
  f.showMinutes(true);
  assert.strictEqual(f.el.getAttribute('viewBox'), wide);

  const off = CLOCK.face({ minuteNumbers: false });
  assert.strictEqual(off.el.getAttribute('viewBox'), tight, 'אפשר לפתוח כבוי מראש');
});
