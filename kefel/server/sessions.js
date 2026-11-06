'use strict';
// התרגול היומי: מצב מסך הבית, פתיחת תרגול, שלב הלימוד, בדיקת תשובות וסיכום.
//
// תרגול יומי אחד ליום הוא שמזכה בכוכבים. אפשר להתאמן עוד כמה שרוצים, אבל
// בלי כוכבים — אחרת הדרך לפרס היא ללחוץ הרבה, לא לדעת.
const U = require('./util');
const M = require('./math');
const RW = require('./rewards');
const { HttpError } = U;

const isStudyDay = (child, date) => (child.days || []).includes(U.dowOf(date));
const tableRec = (child, n) => (child.tables || []).find(t => t.n === Number(n)) || null;
const learnedTables = child => (child.tables || []).filter(t => t.learnedAt).map(t => t.n);

function todaysSessions(store, child, date) {
  return store.data.sessions.filter(s => s.childId === child.id && s.date === date);
}
function inProgress(store, child, date) {
  return todaysSessions(store, child, date).filter(s => s.status === 'in_progress').sort((a, b) => b.id - a.id)[0] || null;
}
function dailyDone(store, child, date) {
  return todaysSessions(store, child, date).some(s => s.kind === 'daily' && s.status === 'completed');
}

function homeState(store, child) {
  const date = U.today();
  const n = child.current;
  const facts = store.childFacts(child.id);
  const tables = (child.tables || []).map(t => ({ n: t.n, learned: !!t.learnedAt, pct: M.tableState(facts, t.n).pct }));
  if (!n) return { mode: 'none', tables, date };
  const base = { table: n, needLearn: !tableRec(child, n)?.learnedAt, state: M.tableState(facts, n), tables, date,
    studyDay: isStudyDay(child, date) };
  const open = inProgress(store, child, date);
  if (open) return { ...base, mode: 'resume', sessionId: open.id, kind: open.kind };
  if (dailyDone(store, child, date)) return { ...base, mode: 'done' };
  if (!base.studyDay) return { ...base, mode: 'free' };
  return { ...base, mode: 'daily' };
}

function view(s) {
  return { id: s.id, kind: s.kind, table: s.table, plan: s.plan, step: s.step, results: s.results };
}

function buildPlan(store, child, n) {
  const facts = store.childFacts(child.id);
  const learn = !tableRec(child, n)?.learnedAt;
  const s = store.data.settings;
  const quiz = M.buildQuiz(facts, {
    current: n, others: learnedTables(child).filter(x => x !== n), count: Number(s.questions) || 10,
    learnDay: learn, reviewShare: Number(s.reviewShare) || 0
  });
  return learn ? [{ t: 'learn', n }, ...quiz] : quiz;
}

function startSession(store, child, { mode } = {}) {
  const date = U.today();
  const open = inProgress(store, child, date);
  if (open) return view(open);
  const n = child.current;
  if (!n) throw new HttpError(400, 'עוד לא נפתחה כפולה');
  // תרגול יומי רק ביום תרגול ורק פעם אחת; כל השאר הוא אימון נוסף בלי כוכבים
  const kind = mode !== 'practice' && isStudyDay(child, date) && !dailyDone(store, child, date) ? 'daily' : 'practice';
  const s = {
    id: store.nextId('session'), childId: child.id, date, kind, table: n, plan: buildPlan(store, child, n),
    step: 0, results: {}, status: 'in_progress', createdAt: U.now().toISOString(), completedAt: null, summary: null
  };
  store.data.sessions.push(s);
  // לא שומרים היסטוריה בלי סוף: 400 תרגולים אחרונים לכל ילד מספיקים לכל דוח
  const mine = store.data.sessions.filter(x => x.childId === child.id);
  if (mine.length > 400) {
    const drop = new Set(mine.slice(0, mine.length - 400).map(x => x.id));
    store.data.sessions = store.data.sessions.filter(x => !drop.has(x.id));
  }
  store.save();
  return view(s);
}

function ownSession(store, child, id) {
  const s = store.session(id);
  if (!s || s.childId !== child.id) throw new HttpError(404, 'התרגול לא נמצא');
  if (s.status !== 'in_progress') throw new HttpError(409, 'התרגול כבר הסתיים');
  return s;
}

// סוף שלב הלימוד. מכאן הכפולה נחשבת "נלמדה", ותופיע גם בחזרות של כפולות אחרות.
function markLearned(store, child, id, step) {
  const s = ownSession(store, child, id);
  const st = s.plan[step];
  if (!st || st.t !== 'learn') throw new HttpError(400, 'זה לא שלב לימוד');
  s.results[step] = { learned: true };
  s.step = Math.max(s.step, step + 1);
  const rec = tableRec(child, st.n);
  if (rec && !rec.learnedAt) rec.learnedAt = U.now().toISOString();
  store.save();
  return { ok: true };
}

// אילו מספרים נכפלו בשאלה — לעדכון השליטה בעובדה
function factOf(st) { return st.t === 'seq' ? [st.answer / st.n, st.n] : [st.a, st.b]; }

function answer(store, child, id, step, value) {
  const s = ownSession(store, child, id);
  const st = s.plan[step];
  if (!st || st.t === 'learn') throw new HttpError(400, 'שלב לא תקין');
  if (s.results[step]) return { correct: s.results[step].correct, answer: st.answer, plan: s.plan, again: true };
  const given = Number(String(value ?? '').trim());
  const correct = Number.isFinite(given) && given === st.answer;
  const [a, b] = factOf(st);
  M.record(store.childFacts(child.id), a, b, correct, s.date);
  s.results[step] = { answer: given, correct };
  // טעות בשאלה רגילה → העובדה חוזרת בסוף התרגול, פעם אחת
  if (!correct && !st.retry) s.plan.push(M.retryOf(st));
  s.step = Math.max(s.step, step + 1);
  store.save();
  return { correct, answer: st.answer, plan: s.plan };
}

function praise(pct) {
  if (pct === 100) return 'מושלם! כל התשובות נכונות 🏆';
  if (pct >= 80) return 'עבודה מצוינת! 🌟';
  if (pct >= 60) return 'יפה מאוד, עוד קצת תרגול וזה שלך 💪';
  return 'כל הכבוד על ההתמדה! כל תרגול מקרב 💪';
}

function complete(store, child, id) {
  const s = ownSession(store, child, id);
  const open = s.plan.findIndex((st, i) => !s.results[i]);
  if (open !== -1) throw new HttpError(400, 'עוד לא ענית על כל השאלות');
  // הציון לפי הניסיון הראשון בלבד: חזרה על טעות היא לימוד, לא ציון
  const first = s.plan.map((st, i) => ({ st, r: s.results[i] })).filter(x => x.st.t !== 'learn' && !x.st.retry);
  const total = first.length;
  const correct = first.filter(x => x.r.correct).length;
  const pct = total ? Math.round((correct / total) * 100) : 0;
  let stars = 0;
  let streak = 0;
  if (s.kind === 'daily') {
    streak = RW.streakOf(store, child, U.addDays(s.date, -1)) + 1;
    stars = RW.starsForLesson(store, pct, streak).stars;
    child.stars = (child.stars || 0) + stars;
    child.starsEarned = (child.starsEarned || 0) + stars;
  }
  const weakMap = new Map();
  for (const x of first.filter(y => !y.r.correct)) {
    const [a, b] = factOf(x.st);
    weakMap.set(M.factKey(a, b), { a, b, product: a * b });
  }
  const tState = M.tableState(store.childFacts(child.id), s.table);
  s.status = 'completed';
  s.completedAt = U.now().toISOString();
  s.summary = {
    total, correct, pct, stars, streak, table: s.table, learned: s.plan.some(x => x.t === 'learn'),
    weak: [...weakMap.values()], tablePct: tState.pct, message: praise(pct)
  };
  // הילד שולט בכפולה — סימן להורה שאפשר לפתוח את הבאה. פעם אחת לכל כפולה.
  const rec = tableRec(child, s.table);
  const threshold = Number(store.data.settings.readyThreshold) || 80;
  let ready = false;
  if (rec && child.current === s.table && tState.pct >= threshold && !rec.readyAt) {
    rec.readyAt = s.completedAt;
    ready = true;
  }
  store.save();
  return { ...s.summary, kind: s.kind, totalStars: child.stars || 0, ready };
}

// סוף יום: תרגולים שלא הסתיימו מסומנים כנטושים, כדי שמחר יתחיל תרגול חדש
function closeStale(store, date) {
  let n = 0;
  for (const s of store.data.sessions) {
    if (s.status === 'in_progress' && s.date < date) { s.status = 'abandoned'; n++; }
  }
  if (n) store.save();
  return n;
}

// תצוגה מקדימה להורה: אותה תוכנית כמו אצל ילד שמתחיל את הכפולה מאפס. לא נשמר כלום.
function previewPlan(store, n, { learn = true } = {}) {
  const quiz = M.buildQuiz({}, { current: n, count: Number(store.data.settings.questions) || 10, learnDay: learn });
  return { id: 0, kind: 'preview', table: n, plan: learn ? [{ t: 'learn', n }, ...quiz] : quiz, step: 0, results: {} };
}

module.exports = { isStudyDay, tableRec, learnedTables, homeState, startSession, markLearned, answer, complete,
  closeStale, previewPlan, dailyDone, inProgress, factOf };
