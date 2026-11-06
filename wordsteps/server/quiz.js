'use strict';
// מבדק: בדיקה אחת שעוברת על המילים שהילד כבר למד, ושואלת רק דבר אחד —
// מה הפירוש בעברית. ארבע אפשרויות לכל מילה.
//
// מבדק הוא מדידה, לא שיעור. הוא לא מזיז את לוח החזרות (SRS), לא מזכה
// בכוכבים ולא נחשב כשיעור יומי — אחרת הוא היה משנה בדיוק את מה שהוא בא
// למדוד, וגם היה הופך "עוד מבדק" לדרך קלה לצבור כוכבים.

const C = require('./content');
const U = require('./util');

const shuffle = (a) => {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
};

// המילים שהילד כבר נפגש איתן, עם התוכן העדכני מהמאגר
function learned(store, childId) {
  const prog = store.childProgress(childId);
  const byId = new Map(store.data.words.map((w) => [w.id, w]));
  const out = [];
  for (const r of Object.values(prog)) {
    if (!r.sessions) continue;
    const w = byId.get(r.wordId);
    if (!w || w.status !== 'approved') continue;
    const c = C.pickContent(w);
    if (!c.en || !c.he) continue;
    out.push({ wordId: w.id, content: c, record: r });
  }
  return out;
}

// מסיחים בעברית: קודם אלה שהוגדרו למילה, ואם חסרים — פירושים של מילים
// אחרות שהילד למד. מסיח מתוך עולם המילים שלו קשה יותר מניחוש אקראי.
function optionsFor(item, pool) {
  const answer = item.content.he;
  const seen = new Set([answer]);
  const dis = [];
  for (const d of item.content.distractorsHe || []) {
    const v = String(d || '').trim();
    if (v && !seen.has(v)) { seen.add(v); dis.push(v); }
  }
  for (const other of shuffle(pool)) {
    if (dis.length >= 3) break;
    const v = other.content.he;
    if (v && !seen.has(v)) { seen.add(v); dis.push(v); }
  }
  return shuffle([answer, ...dis.slice(0, 3)]);
}

// בניית מבדק. count ריק או 0 = כל המילים שנלמדו.
function build(store, child, count) {
  const pool = learned(store, child.id);
  if (pool.length < 4) return { error: 'צריך לפחות 4 מילים שנלמדו כדי לבנות מבדק' };
  const n = count > 0 ? Math.min(count, pool.length) : pool.length;
  const picked = shuffle(pool).slice(0, n);
  return {
    questions: picked.map((it) => ({
      wordId: it.wordId,
      en: it.content.en,
      he: it.content.he,
      options: optionsFor(it, pool.filter((p) => p.wordId !== it.wordId)),
    })),
    poolSize: pool.length,
  };
}

function create(store, child, count) {
  const built = build(store, child, count);
  if (built.error) return built;
  const quiz = {
    id: store.nextId('quiz'),
    childId: child.id,
    createdAt: U.now().toISOString(),
    date: U.today(),
    status: 'pending',
    poolSize: built.poolSize,
    questions: built.questions,
    answers: [],          // answers[i] = מה שהילד בחר
    finishedAt: null,
  };
  store.data.quizzes.unshift(quiz);
  // לא שומרים היסטוריה אינסופית
  if (store.data.quizzes.length > 200) store.data.quizzes.length = 200;
  store.save();
  return quiz;
}

const openFor = (store, childId) =>
  store.data.quizzes.find((q) => q.childId === childId && q.status !== 'done') || null;

const byId = (store, id) => store.data.quizzes.find((q) => q.id === Number(id)) || null;

// מה שנשלח לילד: בלי התשובה הנכונה, כדי שלא תהיה בדף
function forChild(q) {
  if (!q) return null;
  return {
    id: q.id, total: q.questions.length, step: q.answers.length,
    question: q.answers.length < q.questions.length
      ? { en: q.questions[q.answers.length].en, options: q.questions[q.answers.length].options }
      : null,
  };
}

function answer(store, q, choice) {
  if (q.status === 'done') return { done: true, ...score(q) };
  const i = q.answers.length;
  if (i >= q.questions.length) return { done: true, ...score(q) };
  const cur = q.questions[i];
  const ok = String(choice) === cur.he;
  q.answers.push(String(choice == null ? '' : choice));
  q.status = 'in_progress';
  if (q.answers.length >= q.questions.length) {
    q.status = 'done';
    q.finishedAt = U.now().toISOString();
  }
  store.save();
  return { ok, correct: cur.he, en: cur.en, done: q.status === 'done', ...score(q) };
}

function score(q) {
  let right = 0;
  const wrong = [];
  q.answers.forEach((a, i) => {
    if (a === q.questions[i].he) right += 1;
    else wrong.push({ en: q.questions[i].en, he: q.questions[i].he, chose: a });
  });
  const answered = q.answers.length;
  return { right, answered, total: q.questions.length, wrong,
    pct: answered ? Math.round((right / answered) * 100) : 0 };
}

// סיכום להורה
function summary(store, q) {
  const child = store.data.children.find((c) => c.id === q.childId);
  return { id: q.id, childId: q.childId, childName: child ? child.name : '',
    createdAt: q.createdAt, finishedAt: q.finishedAt, status: q.status,
    poolSize: q.poolSize, ...score(q) };
}

module.exports = { learned, build, create, openFor, byId, forChild, answer, score, summary };
