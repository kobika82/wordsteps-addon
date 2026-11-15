'use strict';
// שאלות שעון: קריאת שעון אנלוגי, וכיוון מחוגים לפי שעה דיגיטלית.
//
// שלוש רמות, וההורה פותח אותן אחת-אחת כמו שהוא פותח כפולות. הדירוג הוא
// לפי הדקות ולא לפי השעות, כי זה מה שקשה: ילד שקורא "שלוש וחצי" עדיין
// לא בהכרח קורא "שלוש ועשרים וחמש".
const LEVELS = [
  { id: 1, name: 'שעות עגולות וחצי', minutes: [0, 30], step: 30 },
  { id: 2, name: 'עם רבעים', minutes: [0, 15, 30, 45], step: 15 },
  { id: 3, name: 'כל 5 דקות', minutes: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55], step: 5 },
];

const levelOf = (n) => LEVELS.find((l) => l.id === Number(n)) || LEVELS[0];
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (h, m) => `${pad(h)}:${pad(m)}`;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function shuffle(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}

// שעות היום של ילד: בין 6 בבוקר ל-9 בערב. 3 לפנות בוקר רק מבלבל.
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);

function randomTime(level) {
  const l = levelOf(level);
  return { hour: pick(HOURS), minute: pick(l.minutes) };
}

// מסיחים מהטעויות שילדים באמת עושים: מחוגים מוחלפים, שעה אחת סמוכה,
// וחמש דקות הלוך או חזור. מסיח אקראי לגמרי היה הופך את השאלה לניחוש קל.
function distractors(hour, minute, level) {
  const l = levelOf(level);
  const out = new Map();
  const add = (h, m) => {
    const hh = ((h % 24) + 24) % 24;
    const mm = ((m % 60) + 60) % 60;
    const k = hhmm(hh, mm);
    if (k !== hhmm(hour, minute) && !out.has(k)) out.set(k, { hour: hh, minute: mm });
  };
  // החלפת מחוגים: מה שהמחוג הקצר מראה נקרא כדקות ולהפך.
  // כל המסיחים נשארים באותה מחצית יום כמו התשובה — שעון אנלוגי לא מבדיל
  // בין 7:15 ל-19:15, ומסיח מהמחצית השנייה היה נפסל על פי הספרה הראשונה
  // במקום על פי המחוגים.
  const half = hour < 12 ? 0 : 12;
  const swapped = Math.round(minute / 5);
  if (swapped >= 1 && swapped <= 12) add(half + (swapped % 12), (hour % 12) * 5);
  add(hour + 1, minute);
  add(hour - 1, minute);
  const i = l.minutes.indexOf(minute);
  add(hour, l.minutes[(i + 1) % l.minutes.length]);
  add(hour, l.minutes[(i - 1 + l.minutes.length) % l.minutes.length]);
  return [...out.values()];
}

// שאלה אחת. שני סוגים, מתחלפים: קריאה מהשעון, וכיוון המחוגים.
function question(level, kind) {
  const { hour, minute } = randomTime(level);
  const l = levelOf(level);
  if (kind === 'set') {
    return { t: 'clock-set', hour, minute, step: l.step, answer: hhmm(hour, minute) };
  }
  const wrong = shuffle(distractors(hour, minute, level)).slice(0, 3);
  const options = shuffle([{ hour, minute }, ...wrong]).map((o) => hhmm(o.hour, o.minute));
  return { t: 'clock-read', hour, minute, options, answer: hhmm(hour, minute) };
}

// תרגול שלם. מתחלף בין קריאה לכיוון, כדי שהילד לא ילמד תבנית אחת.
function buildQuiz(level, count = 10) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(question(level, i % 2 === 0 ? 'read' : 'set'));
  return out;
}

// בדיקת תשובה. ב-clock-set התשובה מגיעה כשעה ודקה מהמחוגים.
function check(step, value) {
  const given = String(value == null ? '' : value).trim();
  return given === step.answer;
}

module.exports = { LEVELS, levelOf, randomTime, distractors, question, buildQuiz, check, hhmm };
