'use strict';
// חזרות במרווחי זמן (שיטת "קופסאות" בסגנון לייטנר) ומצב השליטה של ילד במילה.
// עיקרון: מענה נכון יחיד לא הופך מילה ל"נלמדה היטב" — הקופסה עולה לכל היותר פעם אחת ביום,
// ו"נלמדה היטב" דורש קופסה 5 ולפחות 4 ימים שונים של הצלחה.
const { addDays, daysBetween } = require('./util');

// מרווח בימים עד החזרה הבאה לפי הקופסה
const INTERVAL = [0, 1, 2, 4, 7, 14, 30, 60];
const MAX_BOX = INTERVAL.length - 1;

const STATUS_HE = {
  new: 'חדשה', learning: 'בתהליך למידה', needs_reinforcement: 'דורשת חיזוק',
  familiar: 'מוכרת', mastered: 'נלמדה היטב'
};

function newRecord(wordId, date) {
  return {
    wordId, introduced: date, box: 0, due: date, status: 'new', sessions: 0,
    correct: 0, wrong: 0, correctDays: 0, lastSeen: null, lastBoxDate: null, lastResult: null, lapses: 0
  };
}

function computeStatus(r) {
  if (!r.sessions) return 'new';
  if (r.lastResult === 'wrong') return 'needs_reinforcement';
  if (r.box >= 5 && r.correctDays >= 4) return 'mastered';
  if (r.box >= 3) return 'familiar';
  return 'learning';
}

// עדכון אחרי שיעור: correctCount/wrongCount הם תשובות הניסיון הראשון באותו שיעור (בלי סבבי תיקון)
function applySession(r, { correctCount, wrongCount }, date) {
  r.sessions += 1;
  r.correct += correctCount;
  r.wrong += wrongCount;
  r.lastSeen = date;
  if (wrongCount > 0) {
    r.box = r.box <= 2 ? 1 : r.box - 2;
    r.due = addDays(date, 1);
    r.lastResult = 'wrong';
    r.lapses += 1;
  } else if (correctCount > 0) {
    if (r.lastBoxDate !== date) {
      r.box = Math.min(r.box + 1, MAX_BOX);
      r.lastBoxDate = date;
      r.correctDays += 1;
    }
    r.due = addDays(date, INTERVAL[r.box]);
    r.lastResult = 'correct';
  }
  r.status = computeStatus(r);
  return r;
}

function priority(r, date) {
  const overdue = Math.max(0, daysBetween(r.due, date));
  const total = r.correct + r.wrong;
  let s = 0;
  if (r.status === 'needs_reinforcement') s += 100;
  s += Math.min(overdue, 30) * 3;
  if (total) s += (r.wrong / total) * 30;
  if (r.box <= 2) s += 15;           // נלמדה לאחרונה וטרם הוטמעה
  return s;
}

// בחירת עד n מילים לחזרה. קודם מילים שהגיע זמנן לפי עדיפות; אם חסר — המילים שזמנן הקרוב ביותר.
function selectReview(progressMap, n, date, exclude = new Set()) {
  if (n <= 0) return [];
  const recs = Object.values(progressMap).filter(r => r.sessions > 0 && !exclude.has(r.wordId));
  const due = recs.filter(r => r.due <= date)
    .map(r => ({ r, s: priority(r, date) + Math.random() }))
    .sort((a, b) => b.s - a.s).map(x => x.r);
  const picked = due.slice(0, n);
  if (picked.length < n) {
    const rest = recs.filter(r => r.due > date && r.lastSeen !== date)
      .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.box - b.box));
    picked.push(...rest.slice(0, n - picked.length));
  }
  return picked.map(r => r.wordId);
}

module.exports = { INTERVAL, STATUS_HE, newRecord, computeStatus, applySession, selectReview, priority };
