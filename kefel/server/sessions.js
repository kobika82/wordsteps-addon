'use strict';
// התרגול היומי: מצב מסך הבית, פתיחת תרגול, שלב הלימוד, בדיקת תשובות וסיכום.
//
// תרגול יומי אחד ליום הוא שמזכה בכוכבים. אפשר להתאמן עוד כמה שרוצים, אבל
// בלי כוכבים — אחרת הדרך לפרס היא ללחוץ הרבה, לא לדעת.
const U = require('./util');
const M = require('./math');
const RW = require('./rewards');
const C = require('./clock');
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

// באיזה שלב הכפולה הנוכחית:
//   learn — יום הפתיחה: שלב לימוד ואז שאלות על הכפולה
//   solo  — הימים שאחריו (soloDays, ברירת מחדל 2): שאלות על הכפולה הזו לבד
//   mix   — מכאן, עד שההורה פותח כפולה חדשה: חזרה על כל הכפולות שנלמדו
// ימים נספרים לפי תרגולים יומיים שהושלמו, לא לפי לוח השנה — סוף שבוע או יום שהוחמץ לא "שורפים" יום.
const soloDays = store => Math.max(0, Number(store.data.settings.soloDays ?? 2));
function phaseOf(store, child, date = U.today()) {
  const n = child.current;
  const rec = tableRec(child, n);
  if (!rec) return null;
  if (!rec.learnedAt) return { phase: 'learn', day: 1, solo: soloDays(store) };
  const before = new Set(store.data.sessions.filter(s => s.childId === child.id && s.table === n && s.kind === 'daily'
    && s.status === 'completed' && s.date < date).map(s => s.date)).size;
  const day = before + 1;
  // יום הלימוד נספר כיום הראשון, גם אם הלימוד קרה היום
  return { phase: day <= 1 + soloDays(store) ? 'solo' : 'mix', day, solo: soloDays(store) };
}

function lastSeenTables(store, child) {
  const seen = {};
  for (const s of store.data.sessions) {
    if (s.childId !== child.id || s.status !== 'completed') continue;
    for (const st of s.plan) if (st.n && (!seen[st.n] || seen[st.n] < s.date)) seen[st.n] = s.date;
  }
  return seen;
}

function homeState(store, child) {
  const date = U.today();
  const n = child.current;
  const facts = store.childFacts(child.id);
  const tables = (child.tables || []).map(t => ({ n: t.n, learned: !!t.learnedAt, pct: M.tableState(facts, t.n).pct }));
  // תרגול נוסף שההורה נתן מוצג בנפרד, ולא תלוי בשלב שבו הילד נמצא
  const extra = child.extra
    ? { type: child.extra.type || 'tables', tables: child.extra.tables || [], level: child.extra.level || null,
        stars: Number(child.extra.stars) || 0, questions: Number(child.extra.questions) || 0 }
    : null;
  const clockLevel = Number(child.clockLevel) || 0;
  if (!n) return { mode: 'none', tables, extra, clockLevel, date };
  const ph = phaseOf(store, child, date);
  const base = { table: n, needLearn: !tableRec(child, n)?.learnedAt, phase: ph.phase, phaseDay: ph.day, soloDays: ph.solo,
    mixTables: learnedTables(child).length, state: M.tableState(facts, n), tables, date, clockLevel: Number(child.clockLevel) || 0,
    studyDay: isStudyDay(child, date) };
  const open = inProgress(store, child, date);
  if (open) return { ...base, extra, mode: 'resume', sessionId: open.id, kind: open.kind };
  if (dailyDone(store, child, date)) return { ...base, extra, mode: 'done' };
  if (!base.studyDay) return { ...base, extra, mode: 'free' };
  return { ...base, extra, mode: 'daily' };
}

function view(s) {
  return { id: s.id, kind: s.kind, subject: s.subject || 'tables', level: s.level || null, table: s.table, plan: s.plan, step: s.step, results: s.results };
}

// אורך התרגול קבוע בכל השלבים, כדי לא להעמיס: גם כשנלמדו הרבה כפולות.
function buildPlan(store, child, n) {
  const facts = store.childFacts(child.id);
  const s = store.data.settings;
  const count = Number(s.questions) || 10;
  const ph = phaseOf(store, child);
  if (ph.phase === 'mix') {
    const tables = learnedTables(child);
    return M.buildMix(facts, { tables: tables.length ? tables : [n], count, maxTables: Number(s.mixMaxTables) || 4, lastSeen: lastSeenTables(store, child) });
  }
  const quiz = M.buildQuiz(facts, { current: n, count, learnDay: ph.phase === 'learn' });
  return ph.phase === 'learn' ? [{ t: 'learn', n }, ...quiz] : quiz;
}

// תרגול נוסף שההורה נתן: רק הכפולות שהוא בחר, ובלי תקרת mixMaxTables —
// הוא כבר החליט על מה לתרגל, ואין טעם שהתוסף יצמצם לו את הבחירה.
function buildExtraPlan(store, child, extra) {
  const count = Number(extra.questions) || Number(store.data.settings.questions) || 10;
  if (extra.type === 'clock') return C.buildQuiz(extra.level, count);
  const facts = store.childFacts(child.id);
  const tables = (extra.tables || []).map(Number).filter(Boolean);
  return M.buildMix(facts, { tables, count, maxTables: tables.length || 1, lastSeen: {} });
}

function startSession(store, child, { mode } = {}) {
  const date = U.today();
  const open = inProgress(store, child, date);
  if (open) return view(open);

  // התרגול שההורה נתן הוא חד-פעמי: ברגע שהתחיל הוא יורד מהילד, כדי שלא
  // יהיה אפשר להתחיל אותו שוב ולקבל את הכוכבים פעמיים.
  if (mode === 'extra') {
    const extra = child.extra;
    if (!extra) throw new HttpError(400, 'אין תרגול נוסף ממתין');
    const clock = extra.type === 'clock';
    const s = {
      id: store.nextId('session'), childId: child.id, date, kind: 'extra',
      subject: clock ? 'clock' : 'tables',
      table: clock ? null : (extra.tables[0] || child.current),
      tables: clock ? [] : extra.tables.slice(),
      level: clock ? Number(extra.level) || 1 : null,
      extraStars: Number(extra.stars) || 0, phase: 'extra',
      plan: buildExtraPlan(store, child, extra),
      step: 0, results: {}, status: 'in_progress', createdAt: U.now().toISOString(), completedAt: null, summary: null
    };
    delete child.extra;
    store.data.sessions.push(s);
    store.save();
    return view(s);
  }

  // תרגול שעון חופשי: הילד יכול לתרגל כמה שירצה, בלי כוכבים. הרמה היא
  // זו שההורה פתח לו, כדי שלא יתרגל שעות שעוד לא למד.
  if (mode === 'clock') {
    const level = Math.min(Number(child.clockLevel) || 1, 3);
    const s = {
      id: store.nextId('session'), childId: child.id, date, kind: 'practice', subject: 'clock',
      table: null, tables: [], level, phase: 'clock',
      plan: C.buildQuiz(level, Number(store.data.settings.questions) || 10),
      step: 0, results: {}, status: 'in_progress', createdAt: U.now().toISOString(), completedAt: null, summary: null
    };
    store.data.sessions.push(s);
    store.save();
    return view(s);
  }

  const n = child.current;
  if (!n) throw new HttpError(400, 'עוד לא נפתחה כפולה');
  // תרגול יומי רק ביום תרגול ורק פעם אחת; כל השאר הוא אימון נוסף בלי כוכבים
  const kind = mode !== 'practice' && isStudyDay(child, date) && !dailyDone(store, child, date) ? 'daily' : 'practice';
  const s = {
    id: store.nextId('session'), childId: child.id, date, kind, table: n, phase: phaseOf(store, child, date).phase, plan: buildPlan(store, child, n),
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
function factOf(st) { return [st.a, st.b]; }

const isClock = st => st && (st.t === 'clock-read' || st.t === 'clock-set');

function answer(store, child, id, step, value) {
  const s = ownSession(store, child, id);
  const st = s.plan[step];
  if (!st || st.t === 'learn') throw new HttpError(400, 'שלב לא תקין');
  if (s.results[step]) return { correct: s.results[step].correct, answer: st.answer, plan: s.plan, again: true };

  // שאלות שעון אינן עובדות כפל: אין מה לרשום בלוח השליטה, והחזרה על
  // טעות היא אותה שאלה בדיוק — לראות את אותו שעון שוב זה הלימוד.
  if (isClock(st)) {
    const correct = C.check(st, value);
    s.results[step] = { answer: String(value ?? ''), correct };
    if (!correct && !st.retry) s.plan.push({ ...st, retry: true });
    s.step = Math.max(s.step, step + 1);
    store.save();
    return { correct, answer: st.answer, plan: s.plan };
  }

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
  let streakBonus = 0;
  if (s.kind === 'daily') {
    streak = RW.streakOf(store, child, U.addDays(s.date, -1)) + 1;
    const award = RW.starsForLesson(store, pct, streak);
    stars = award.stars;
    streakBonus = award.streakBonus;
    child.stars = (child.stars || 0) + stars;
    child.starsEarned = (child.starsEarned || 0) + stars;
  } else if (s.kind === 'extra') {
    // הסכום שההורה קבע, במלואו. הוא בחר גם את הכפולות וגם את הפרס, ותרגול
    // מסתיים רק אחרי שכל הטעויות תוקנו — אז אין כאן דרך לקבל כוכבים בחינם.
    stars = Number(s.extraStars) || 0;
    child.stars = (child.stars || 0) + stars;
    child.starsEarned = (child.starsEarned || 0) + stars;
  }
  const clock = (s.subject || 'tables') === 'clock';
  const weakMap = new Map();
  if (!clock) for (const x of first.filter(y => !y.r.correct)) {
    const [a, b] = factOf(x.st);
    weakMap.set(M.factKey(a, b), { a, b, product: a * b });
  }
  const tState = clock ? { pct: 0 } : M.tableState(store.childFacts(child.id), s.table);
  s.status = 'completed';
  s.completedAt = U.now().toISOString();
  s.summary = {
    total, correct, pct, stars, streak, streakBonus, table: s.table, subject: s.subject || 'tables', phase: s.phase || '', learned: s.plan.some(x => x.t === 'learn'),
    weak: [...weakMap.values()], tablePct: tState.pct, message: praise(pct)
  };
  // סוף ימי התרגול על הכפולה לבד — זו נקודת ההחלטה של ההורה: לפתוח כפולה חדשה,
  // או שמחר מתחילה חזרה על כל הכפולות. הודעה אחת לכל כפולה.
  const rec = clock ? null : tableRec(child, s.table);
  let ready = false;
  if (!clock && s.kind === 'daily' && rec && child.current === s.table && !rec.readyAt && s.phase !== 'mix') {
    const ph = phaseOf(store, child, U.addDays(s.date, 1));
    if (ph && ph.phase === 'mix') { rec.readyAt = s.completedAt; ready = true; }
  }
  store.save();
  return { ...s.summary, kind: s.kind, subject: s.subject || 'tables', level: s.level || null, totalStars: child.stars || 0, ready };
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

// בונוס רצף רטרואקטיבי (0.4.1, בקשת המשתמש): תרגולים יומיים שהושלמו לפני שהיה בונוס
// רצף. לכל אחד שהיה בו רצף של יומיים לפחות — מוסיפים את הבונוס עכשיו.
// הסימון הוא summary.streakBonus: תרגול שכבר יש לו את השדה (גם 0) לא מקבל שוב,
// ולכן הפעלה חוזרת לא נותנת פעמיים.
function retroStreakBonus(store) {
  const bonus = Number(RW.starsConf(store).streakBonus) || 0;
  const granted = [];
  if (!bonus) return granted;
  for (const child of store.data.children) {
    const old = store.data.sessions
      .filter(s => s.childId === child.id && s.kind === 'daily' && s.status === 'completed' && s.summary && !('streakBonus' in s.summary))
      .sort((a, b) => a.date.localeCompare(b.date));
    let total = 0;
    const dates = [];
    for (const s of old) {
      const streak = RW.streakOf(store, child, s.date);
      const add = streak >= 2 ? bonus : 0;
      s.summary.streak = streak;
      s.summary.streakBonus = add;
      s.summary.stars = (s.summary.stars || 0) + add;
      if (add) { total += add; dates.push(s.date); }
    }
    if (total) {
      child.stars = (child.stars || 0) + total;
      child.starsEarned = (child.starsEarned || 0) + total;
      // הילד יראה הודעה אחת במסך הבית
      child.retroBonus = { stars: total, days: dates.length, seen: false };
      granted.push({ child, stars: total, dates });
    }
  }
  store.save();
  return granted;
}

module.exports = { isStudyDay, tableRec, learnedTables, homeState, startSession, markLearned, answer, complete,
  closeStale, previewPlan, dailyDone, inProgress, factOf, phaseOf, retroStreakBonus };
