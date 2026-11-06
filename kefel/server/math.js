'use strict';
// לוח הכפל: נושא מצויר לכל כפולה, מצב השליטה בכל עובדה, ובניית שאלות.
//
// מוסכמה אחת לכל האפליקציה: a × b = a קבוצות, ב-b פריטים בכל קבוצה.
// בכפולות של 3, העובדה הרביעית היא 4 × 3: ארבע סלסלות, בכל אחת 3 תותים.
// כך הציור, ההקראה והשאלה מתארים תמיד את אותו דבר.
const { shuffle } = require('./util');

// הנושא של כל כפולה: מה מצויר בכל קבוצה ואיך מתארים את זה בעברית.
const THEMES = {
  1: { item: '🎈', one: 'ילד אחד', many: 'ילדים', inEach: 'לכל אחד', each: 'בלון אחד', things: 'בלונים', intro: 'לכל ילד יש בלון אחד' },
  2: { item: '🧦', one: 'זוג אחד', many: 'זוגות', inEach: 'בכל זוג', each: '2 גרביים', things: 'גרביים', intro: 'בכל זוג יש 2 גרביים' },
  3: { item: '🍓', one: 'סלסלה אחת', many: 'סלסלות', inEach: 'בכל אחת', each: '3 תותים', things: 'תותים', intro: 'בכל סלסלה יש 3 תותים' },
  4: { item: '🍪', one: 'צלחת אחת', many: 'צלחות', inEach: 'בכל אחת', each: '4 עוגיות', things: 'עוגיות', intro: 'בכל צלחת יש 4 עוגיות' },
  5: { item: '🍎', one: 'שקית אחת', many: 'שקיות', inEach: 'בכל אחת', each: '5 תפוחים', things: 'תפוחים', intro: 'בכל שקית יש 5 תפוחים' },
  6: { item: '🥚', one: 'קרטון אחד', many: 'קרטונים', inEach: 'בכל אחד', each: '6 ביצים', things: 'ביצים', intro: 'בכל קרטון יש 6 ביצים' },
  7: { item: '☀️', one: 'שבוע אחד', many: 'שבועות', inEach: 'בכל אחד', each: '7 ימים', things: 'ימים', intro: 'בכל שבוע יש 7 ימים' },
  8: { item: '🖍️', one: 'קופסה אחת', many: 'קופסאות', inEach: 'בכל אחת', each: '8 צבעים', things: 'צבעים', intro: 'בכל קופסה יש 8 צבעים' },
  9: { item: '🧁', one: 'מגש אחד', many: 'מגשים', inEach: 'בכל אחד', each: '9 עוגות', things: 'עוגות', intro: 'בכל מגש יש 9 עוגות' },
  10: { item: '⚽', one: 'סל אחד', many: 'סלים', inEach: 'בכל אחד', each: '10 כדורים', things: 'כדורים', intro: 'בכל סל יש 10 כדורים' }
};
const TABLES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
// סדר מקובל בכיתה ב: מהקל לקשה. ההורה יכול לבחור כל כפולה.
const SUGGESTED_ORDER = [2, 10, 5, 3, 4, 1, 6, 9, 8, 7];

function caption(a, b) {
  const t = THEMES[b];
  return a === 1 ? `${t.one}, ${t.inEach} ${t.each}` : `${a} ${t.many}, ${t.inEach} ${t.each}`;
}

// ---------- שליטה בעובדות ----------
// 3×4 ו-4×3 הן אותה עובדה: מי שלמד אותה בכפולות של 3 כבר יודע אותה בכפולות של 4.
const factKey = (a, b) => `${Math.min(a, b)}x${Math.max(a, b)}`;

const STATUS_HE = { new: 'עוד לא תרגלנו', learning: 'בלמידה', weak: 'צריך חיזוק', good: 'כמעט שם', mastered: 'יודע/ת היטב' };
const MASTER_STREAK = 3;   // שלוש תשובות נכונות ברצף, ולא אחת שעלולה להיות ניחוש
function status(rec) {
  if (!rec || !rec.attempts) return 'new';
  if (rec.streak >= MASTER_STREAK) return 'mastered';
  if (rec.streak === 0) return 'weak';
  if (rec.streak === MASTER_STREAK - 1) return 'good';
  return 'learning';
}

function record(facts, a, b, correct, date) {
  const k = factKey(a, b);
  const r = facts[k] || (facts[k] = { a: Math.min(a, b), b: Math.max(a, b), attempts: 0, correct: 0, wrong: 0, streak: 0, lastDate: '' });
  r.attempts += 1;
  if (correct) { r.correct += 1; r.streak += 1; } else { r.wrong += 1; r.streak = 0; }
  r.lastDate = date;
  return r;
}

// מצב כפולה אחת: עשר העובדות שלה (1×n עד 10×n)
function tableState(facts, n) {
  const list = TABLES.map(k => ({ k, product: k * n, status: status(facts[factKey(k, n)]) }));
  const mastered = list.filter(x => x.status === 'mastered').length;
  return { n, facts: list, mastered, pct: Math.round((mastered / 10) * 100),
    weak: list.filter(x => x.status === 'weak').map(x => x.k) };
}

// ---------- בניית שאלות ----------
// מסיחים שהם טעויות אמיתיות של ילדים: עובדה שכנה (±n), טעות ספירה (±1),
// וחיבור במקום כפל.
function distractors(a, b, answer, count = 3) {
  const cand = [answer + b, answer - b, answer + a, answer - a, answer + 1, answer - 1, a + b, answer + 2, answer - 2, answer + 10]
    .filter(x => x > 0 && x !== answer && x <= 110);
  const out = [];
  for (const x of shuffle([...new Set(cand)])) { if (out.length < count) out.push(x); }
  let pad = answer + 3;
  while (out.length < count) { if (!out.includes(pad) && pad !== answer) out.push(pad); pad++; }
  return out;
}
function withOptions(q, a, b, answer) {
  return { ...q, answer, options: shuffle([answer, ...distractors(a, b, answer)]) };
}

// שאלה אחת על העובדה k בכפולה n. שלוש תבניות (החלטת המשתמש, 0.3.0):
//   mc  — "כמה זה 4 × 3?" ובחירה מתוך ארבע
//   pad — אותה שאלה, והילד מקליד את התשובה בעצמו
//   seq — מספר חסר ברצף הכפולות של n. לא בכפולות של 1 — שם זה סתם 1, 2, 3.
// התבניות ספירה מתוך ציור וגורם חסר הוסרו.
const QUESTION_TYPES = ['mc', 'pad', 'seq'];
function question(type, n, k, extra = {}) {
  if (type === 'seq' && n === 1) type = 'mc';
  if (type === 'seq') {
    // חמש כפולות רצופות של n, אחת מהן חסרה (לא הראשונה, כדי שיהיה ממה להמשיך)
    const start = Math.max(1, Math.min(6, k - 1 - Math.floor(Math.random() * 3)));
    const seq = [0, 1, 2, 3, 4].map(i => (start + i) * n);
    const idx = seq.indexOf(k * n) > 0 ? seq.indexOf(k * n) : 1 + Math.floor(Math.random() * 4);
    const answer = seq[idx];
    // מסיחים: מספרים קרובים שאינם מופיעים ברצף — טעות ספירה, לא מספר שכבר רואים על המסך
    const near = [answer + 1, answer - 1, answer + 2, answer - 2, answer + 3, answer - 3].filter(x => x > 0 && !seq.includes(x));
    return { t: 'seq', n, a: answer / n, b: n, seq: seq.map((x, i) => (i === idx ? null : x)), answer,
      options: shuffle([answer, ...shuffle(near.slice(0, 4)).slice(0, 3)]), ...extra };
  }
  const [a, b] = Math.random() < 0.5 ? [n, k] : [k, n];
  const product = a * b;
  if (type === 'pad') return { t: 'pad', n, a, b, answer: product, ...extra };
  return withOptions({ t: 'mc', n, a, b, ...extra }, a, b, product);
}

// משקל לבחירת עובדה: מה שלא נלמד או שנכשל — יותר; מה שנלמד היטב — מעט, כדי לשמור עליו.
const WEIGHT = { new: 3, weak: 4, learning: 2, good: 1.5, mastered: 0.6 };
function pickFacts(facts, n, count) {
  const pool = TABLES.map(k => ({ k, w: WEIGHT[status(facts[factKey(k, n)])] * (k === 1 ? 0.4 : 1) }));
  const out = [];
  while (out.length < count) {
    const avail = pool.filter(p => !out.includes(p.k));
    if (!avail.length) { out.push(...pickFacts(facts, n, count - out.length)); break; }
    let r = Math.random() * avail.reduce((s, p) => s + p.w, 0);
    const p = avail.find(x => (r -= x.w) <= 0) || avail[avail.length - 1];
    out.push(p.k);
  }
  return out;
}

// ביום הלימוד: קודם בחירה ורצף (קל יותר, מיד אחרי הלימוד), ואז הקלדה.
// בשאר הימים: יותר הקלדה — לזכור לבד הוא המבחן האמיתי.
const LEARN_TYPES = ['mc', 'mc', 'seq', 'pad', 'mc', 'pad', 'mc', 'seq', 'pad', 'pad', 'mc', 'pad'];
const DRILL_TYPES = ['mc', 'pad', 'seq', 'mc', 'pad', 'mc', 'pad', 'pad', 'seq', 'pad', 'mc', 'pad'];

// תוכנית השאלות על הכפולה הנוכחית בלבד (יום הלימוד והימים שאחריו)
function buildQuiz(facts, { current, count = 10, learnDay = false }) {
  const types = learnDay ? LEARN_TYPES : DRILL_TYPES;
  const qs = pickFacts(facts, current, count).map((k, i) => ({ q: question(types[i % types.length], current, k, { role: 'main' }), i }));
  if (!learnDay) return shuffle(qs.map(x => x.q));
  // ביום הלימוד שומרים על הסדר: הבחירות בהתחלה, ההקלדות בהמשך
  return qs.map(x => x.q);
}

// חזרה על כל הכפולות שנלמדו. כדי לא להעמיס, התרגול נשאר באותו אורך, ובכל
// יום נכנסות עד maxTables כפולות: קודם החלשות, ואחריהן אלה שלא חזרו עליהן הכי הרבה זמן.
// lastSeen = { n: 'YYYY-MM-DD' } — מתי הכפולה הופיעה לאחרונה בתרגול.
const MIX_TYPES = ['mc', 'pad', 'pad', 'seq', 'mc', 'pad'];
function pickMixTables(facts, tables, maxTables = 4, lastSeen = {}) {
  if (tables.length <= maxTables) return tables.slice();
  const ranked = tables.map(n => ({ n, pct: tableState(facts, n).pct, seen: lastSeen[n] || '' }));
  // חצי מהמקומות לחלשות ביותר, השאר לאלה שחיכו הכי הרבה
  const weakSlots = Math.ceil(maxTables / 2);
  const out = ranked.slice().sort((a, b) => a.pct - b.pct || a.seen.localeCompare(b.seen)).slice(0, weakSlots).map(x => x.n);
  for (const x of ranked.slice().sort((a, b) => a.seen.localeCompare(b.seen) || a.pct - b.pct)) {
    if (out.length >= maxTables) break;
    if (!out.includes(x.n)) out.push(x.n);
  }
  return out;
}
function buildMix(facts, { tables, count = 10, maxTables = 4, lastSeen = {} }) {
  const chosen = pickMixTables(facts, tables, maxTables, lastSeen);
  // חלוקה שווה בין הכפולות; השארית לחלשות
  const order = chosen.slice().sort((a, b) => tableState(facts, a).pct - tableState(facts, b).pct);
  const per = Object.fromEntries(order.map(n => [n, Math.floor(count / order.length)]));
  for (let i = 0; i < count % order.length; i++) per[order[i]]++;
  const qs = [];
  for (const n of order) pickFacts(facts, n, per[n]).forEach(k => qs.push(question(MIX_TYPES[qs.length % MIX_TYPES.length], n, k, { role: 'mix' })));
  return shuffle(qs);
}

// חזרה על עובדה שנכשלה, בסוף השיעור, בצורה אחרת: בחירה מתוך ארבע
function retryOf(step) {
  return question('mc', step.n, step.a === step.n ? step.b : step.a, { role: step.role, retry: true });
}

module.exports = { THEMES, TABLES, SUGGESTED_ORDER, STATUS_HE, caption, factKey, status, record, tableState,
  distractors, question, QUESTION_TYPES, pickFacts, buildQuiz, buildMix, pickMixTables, retryOf, MASTER_STREAK };
