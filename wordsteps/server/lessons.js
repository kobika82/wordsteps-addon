'use strict';
// בניית השיעור היומי, רצף התרגילים, בדיקת תשובות וסיכום שיעור.
// כלל היסוד: המנהל מאשר מילים במאגר, והילד רואה רק מילים מאושרות — בשיעור החדש ובחזרות.
const { today, addDays, dowOf, shuffle, normalizeAnswer, levenshtein, HttpError, now } = require('./util');
const { pickContent, sanitizeContent, missingFields, DEFAULT_EXERCISES, EXERCISE_TYPES, LEVELS } = require('./content');
const srs = require('./srs');
const gemini = require('./gemini');
const images = require('./images');
const sources = require('./sources');

const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000];
const MATCH_MAX = 5;

// ---------- עזרים ----------
function nowIso() { return now().toISOString(); }

function learnedIds(store, childId) {
  return new Set(Object.keys(store.childProgress(childId)).map(Number));
}

// מילים חדשות ששובצו בשיעור יומי פתוח של הילד (היום, או שהתחיל ולא הסתיים) — כדי לא לשבץ אותה מילה פעמיים.
// שיעור שהוחמץ לא שומר את מילותיו: הן חוזרות לתור.
function reservedIds(store, childId) {
  const s = new Set();
  const d = today();
  for (const l of store.data.lessons) {
    if (l.childId !== childId || l.kind !== 'daily' || l.status === 'completed') continue;
    if (l.status !== 'in_progress' && l.date < d) continue;
    for (const it of l.items) if (it.role === 'new') s.add(it.wordId);
  }
  return s;
}

function notice(store, text, childId) {
  const list = store.data.adminNotices;
  if (list.some(n => n.text === text && !n.dismissed)) return;
  list.unshift({ id: Date.now() + Math.random(), at: nowIso(), childId: childId || null, text, dismissed: false });
  if (list.length > 100) list.length = 100;
}

// ---------- מאגר המילים ----------
function addWordToBank(store, data, { status = 'draft', source = 'manual', level, topic } = {}) {
  const c = sanitizeContent(data);
  if (!c.en) throw new HttpError(400, 'חסרה מילה באנגלית');
  const dup = store.data.words.find(w => w.en.toLowerCase() === c.en.toLowerCase());
  if (dup) return dup;
  const w = {
    id: store.nextId('word'), ...c,
    level: LEVELS.includes(data.level || level) ? (data.level || level) : 'beginner',
    topic: String(data.topic || topic || ''),
    difficulty: Math.max(1, Math.min(10, Number(data.difficulty) || 5)),
    imageQuery: String(data.imageQuery || ''), concrete: data.concrete !== false, pos: String(data.pos || ''),
    status, source, createdAt: nowIso(), updatedAt: nowIso()
  };
  store.data.words.push(w);
  return w;
}

async function proposeImage(store, w) {
  if (w.image) return;
  const src = store.data.settings.imageSource;
  try {
    if (src === 'arasaac') {
      // איורי ARASAAC מתאימים גם למילים מופשטות; אם אין — חיפוש תמונה רגיל למילים מוחשיות
      const pics = await sources.arasaacSearch(w.en, w.pos);
      if (pics.length) Object.assign(w, await sources.importArasaac(pics[0]._id));
      else if (w.concrete !== false) { const r = await images.autoPick(w.imageQuery || w.en); if (r) Object.assign(w, r); }
    } else if (w.concrete === false) {
      return;
    } else if (src === 'openverse') {
      const r = await images.autoPick(w.imageQuery || w.en);
      if (r) Object.assign(w, r);
    } else if (src === 'gemini' && gemini.isConfigured()) {
      const g = await gemini.generateImage(w);
      w.image = images.saveBuffer(Buffer.from(g.data, 'base64'), g.mime);
      w.imageCredit = 'איור Gemini';
    }
  } catch (e) {
    // אין תמונה מתאימה — המילה תוצג עם האימוג'י או בלי תמונה, והמנהל יוכל לבחור
    console.warn('image proposal failed for', w.en, e.message);
  }
}

// יצירת מילים חדשות ב-Gemini והוספתן למאגר כטיוטות
async function generateWords(store, { count, level, topic, age }) {
  const exclude = store.data.words.map(w => w.en);
  const list = await gemini.suggestWords({ count, level, topic, age, exclude });
  const added = [];
  for (const g of list) {
    const before = store.data.words.length;
    const w = addWordToBank(store, g, { status: 'draft', source: 'gemini', level, topic: g.topic || topic });
    if (store.data.words.length > before) added.push(w);
  }
  await Promise.all(added.map(w => proposeImage(store, w)));
  store.save();
  return added;
}

// ---------- בניית השיעור היומי (אוטומטית, רק ממילים מאושרות) ----------
// המנהל מאשר מילים במאגר; השיעור נבנה מעצמו ביום שבו הילד לומד. אין אישור שיעורים ואין שיעורים מוכנים מראש.
function isStudyDay(child, date) { return (child.days || []).includes(dowOf(date)); }

function candidateWords(store, child, exclude = new Set()) {
  const topics = child.topics || [];
  return store.data.words
    .filter(w => w.status === 'approved' && w.level === child.level && !exclude.has(w.id) && (!topics.length || topics.includes(w.topic)))
    .sort((a, b) => a.difficulty - b.difficulty || a.id - b.id);
}

// כמה מילים מאושרות שהילד עוד לא למד נשארו — ולכמה ימי לימוד הן מספיקות
// השיעורים מתחילים מתאריך שנקבע בהגדרות (ריק = מיד)
function startDate(store) { return store.data.settings.startDate || ''; }
function beforeStart(store, date) { const s = startDate(store); return !!s && date < s; }

// מלאי: כמה מילים מאושרות שהילד עוד לא למד, לכמה שיעורים הן מספיקות, ועד איזה תאריך (לפי ימי הלימוד שלו)
function poolInfo(store, child) {
  const exclude = new Set([...learnedIds(store, child.id), ...reservedIds(store, child.id)]);
  const available = candidateWords(store, child, exclude).length;
  const per = child.newPerDay || 0;
  const lessons = per ? Math.ceil(available / per) : 0;
  const drafts = store.data.words.filter(w => w.status === 'draft' && w.level === child.level).length;
  let lastDate = null;
  if (lessons && child.active && (child.days || []).length) {
    const t = today();
    const hasToday = store.data.lessons.some(l => l.childId === child.id && l.date === t && l.kind === 'daily');
    let d = hasToday ? addDays(t, 1) : t;
    if (startDate(store) > d) d = startDate(store);
    for (let n = 0, i = 0; i < 1000; i++, d = addDays(d, 1)) {
      if (isStudyDay(child, d) && ++n === lessons) { lastDate = d; break; }
    }
  }
  return { available, perLesson: per, lessons, lastDate, drafts };
}

// יוצר (פעם אחת) את השיעור של היום. סינכרוני — כך שאין מצב של שני שיעורים לאותו יום.
function ensureDailyLesson(store, child, date = today()) {
  const existing = store.data.lessons.find(l => l.childId === child.id && l.date === date && l.kind === 'daily');
  if (existing) return existing;
  if (!child.active || !isStudyDay(child, date) || beforeStart(store, date)) return null;
  const exclude = new Set([...learnedIds(store, child.id), ...reservedIds(store, child.id)]);
  const pool = candidateWords(store, child, exclude);
  if (!pool.length) {
    notice(store, `${child.name}: אין מילים מאושרות חדשות ברמה שלו — היום יהיה רק תרגול חזרה. אשרו מילים במאגר.`, child.id);
    return null;
  }
  const items = pool.slice(0, child.newPerDay).map(w => ({
    id: store.nextId('item'), wordId: w.id, role: 'new', content: pickContent(w), approved: true
  }));
  const lesson = {
    id: store.nextId('lesson'), childId: child.id, date, kind: 'daily', status: 'approved',
    items, warnings: [], createdAt: nowIso(), approvedAt: nowIso(),
    session: null, completedAt: null, summary: null
  };
  store.data.lessons.push(lesson);
  store.save();
  return lesson;
}

// אישור מילה במאגר: מה שנדרש כדי שיהיה כרטיס ותרגיל בחירת תרגום
function approveWord(store, w) {
  const miss = missingFields(w, ['mc']);
  if (miss.length) throw new HttpError(400, `לא ניתן לאשר את "${w.en}" — חסר: ${miss.join(', ')}`);
  w.status = 'approved';
  w.updatedAt = nowIso();
  store.save();
  return w;
}

// ---------- בניית רצף התרגילים ----------
function fallbackOptions(store, field, exclude, n) {
  const pool = shuffle(store.data.words.filter(w => w.status === 'approved' && w[field] && !exclude.includes(w[field])).map(w => w[field]));
  return pool.slice(0, n);
}

function mcStep(store, w, c, dir, extra = {}) {
  const answer = dir === 'en2he' ? c.he : c.en;
  let dis = (dir === 'en2he' ? c.distractorsHe : c.distractorsEn).filter(x => x && x !== answer);
  if (dis.length < 3) dis = dis.concat(fallbackOptions(store, dir === 'en2he' ? 'he' : 'en', [answer, ...dis], 3 - dis.length));
  return { t: 'mc', w, dir, options: shuffle([answer, ...dis.slice(0, 3)]), answer, ...extra };
}
function clozeStep(store, w, c, extra = {}) {
  let dis = c.distractorsEn.filter(x => x && x !== c.en);
  if (dis.length < 3) dis = dis.concat(fallbackOptions(store, 'en', [c.en, ...dis], 3 - dis.length));
  return { t: 'cloze', w, sentence: c.clozeEn, he: c.clozeHe, options: shuffle([c.en, ...dis.slice(0, 3)]), answer: c.en, ...extra };
}
function typeStep(w, c, extra = {}) {
  return { t: 'type', w, prompt: c.he, answer: c.en, ...extra };
}
function matchStep(group, contents) {
  const pairs = group.map(w => ({ w, en: contents[w].en, he: contents[w].he }));
  return { t: 'match', ws: group, pairs, right: shuffle(pairs.map(p => p.w)) };
}
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  // לא משאירים קבוצה של מילה אחת
  if (out.length > 1 && out[out.length - 1].length < 2) out[out.length - 2].push(...out.pop());
  return out;
}

function buildPlan(store, child, items, progressMap) {
  const types = (child.exerciseTypes && child.exerciseTypes.length) ? child.exerciseTypes : DEFAULT_EXERCISES[child.level];
  const has = t => types.includes(t);
  const contents = Object.fromEntries(items.map(i => [i.wordId, i.content]));
  const newIds = items.filter(i => i.role === 'new').map(i => i.wordId);
  const revIds = items.filter(i => i.role === 'review').map(i => i.wordId);
  const plan = [];

  if (newIds.length) {
    plan.push({ t: 'stage', stage: 'cards', count: newIds.length });
    for (const w of newIds) plan.push({ t: 'card', w });
    plan.push({ t: 'stage', stage: 'practice', count: newIds.length });
    const singles = has('mc') || (!has('cloze') && !has('type') && !(has('match') && newIds.length >= 2));
    if (singles) for (const w of shuffle(newIds)) plan.push(mcStep(store, w, contents[w], 'en2he'));
    if (has('match') && newIds.length >= 2) for (const g of chunk(shuffle(newIds), MATCH_MAX)) plan.push(matchStep(g, contents));
    if (has('cloze')) for (const w of shuffle(newIds)) if (/_{2,}/.test(contents[w].clozeEn)) plan.push(clozeStep(store, w, contents[w]));
    if (has('type')) for (const w of shuffle(newIds)) plan.push(typeStep(w, contents[w]));
  }

  if (revIds.length) {
    plan.push({ t: 'stage', stage: 'review', count: revIds.length });
    const ordered = shuffle(revIds);
    if (has('match') && ordered.length >= 4) plan.push(matchStep(ordered.slice(0, 4), contents));
    for (const w of ordered) {
      const r = progressMap[w] || { box: 0, status: 'new' };
      const c = contents[w];
      let step;
      if (r.status === 'needs_reinforcement' || r.box <= 1) step = mcStep(store, w, c, 'en2he');
      else if (r.box >= 4 && has('type')) step = typeStep(w, c);
      else if (r.box >= 3 && has('cloze') && /_{2,}/.test(c.clozeEn)) step = clozeStep(store, w, c);
      else step = mcStep(store, w, c, 'he2en');
      plan.push(step);
    }
  }
  return plan;
}

// ---------- בדיקת תשובה ----------
function checkAnswer(step, given) {
  if (step.t === 'type') {
    const g = normalizeAnswer(given), a = normalizeAnswer(step.answer);
    if (g === a) return { correct: true };
    if (a.length >= 5 && levenshtein(g, a) === 1) return { correct: true, typo: true };
    return { correct: false };
  }
  return { correct: String(given) === String(step.answer) };
}

function retryStepFor(store, step, contents, w) {
  const c = contents[w];
  if (step.t === 'cloze') return clozeStep(store, w, c, { retry: true });
  if (step.t === 'type') return typeStep(w, c, { retry: true });
  if (step.t === 'mc') return mcStep(store, w, c, step.dir, { retry: true });
  return mcStep(store, w, c, 'en2he', { retry: true });
}

function addRetry(store, session, step, contents, wordIds) {
  if (step.retry) return;
  if (!session.plan.some(s => s.t === 'stage' && s.stage === 'retry')) {
    session.plan.push({ t: 'stage', stage: 'retry' });
  }
  for (const w of wordIds) session.plan.push(retryStepFor(store, step, contents, w));
}

// מעבד תשובה לשלב. record(wordId, type, correct, retry) נקרא רק בשיעור אמיתי (לא בתצוגה מקדימה)
function answerStep(store, session, contents, stepIndex, payload, record) {
  const step = session.plan[stepIndex];
  if (!step) throw new HttpError(400, 'שלב לא קיים');
  if (session.results[stepIndex]) return { ...session.results[stepIndex], plan: session.plan, step: session.step, duplicate: true };
  let result;
  if (step.t === 'match') {
    const res = Array.isArray(payload.results) ? payload.results : [];
    const wrong = step.ws.filter(w => res.find(r => Number(r.w) === w)?.correct === false);
    for (const w of step.ws) record && record(w, 'match', !wrong.includes(w), !!step.retry);
    if (wrong.length) addRetry(store, session, step, contents, wrong);
    result = { correct: wrong.length === 0, wrong };
  } else if (['mc', 'cloze', 'type'].includes(step.t)) {
    const r = checkAnswer(step, payload.answer);
    record && record(step.w, step.t, r.correct, !!step.retry);
    if (!r.correct) addRetry(store, session, step, contents, [step.w]);
    result = { ...r, answer: step.answer };
  } else {
    throw new HttpError(400, 'לשלב הזה אין תשובה');
  }
  session.results[stepIndex] = result;
  session.step = Math.max(session.step, stepIndex + 1);
  return { ...result, plan: session.plan, step: session.step };
}

// ---------- צד הילד ----------
function childLessons(store, childId) { return store.data.lessons.filter(l => l.childId === childId); }

function approvedReviewWords(store, ids) {
  return ids.map(id => store.word(id)).filter(w => w && w.status === 'approved');
}

// מצב "היום" של הילד: שיעור להמשך, שיעור מאושר להתחלה, הושלם, או חזרה בלבד
function homeState(store, child) {
  const date = today();
  ensureDailyLesson(store, child, date);
  const mine = childLessons(store, child.id);
  const daily = mine.find(l => l.kind === 'daily' && l.date === date);
  // ממשיכים שיעור יומי שלא הסתיים (גם מאתמול); סבב חזרה/תרגול שלא הסתיים — רק אם הוא מהיום ואין שיעור יומי חדש שמחכה
  const open = mine.filter(l => l.status === 'in_progress').sort((a, b) => b.id - a.id);
  const inProgress = open.find(l => l.kind === 'daily')
    || (!(daily && daily.status === 'approved') ? open.find(l => l.date === date) : null);
  const learned = Object.values(store.childProgress(child.id)).filter(r => r.sessions > 0).length;
  const canReview = learned >= 3;
  let state;
  if (beforeStart(store, date)) return { mode: 'soon', startDate: startDate(store), studyDay: isStudyDay(child, date), date };
  if (inProgress) state = { mode: 'resume', lessonId: inProgress.id, kind: inProgress.kind };
  else if (daily && daily.status === 'approved') state = { mode: 'start', lessonId: daily.id, newCount: daily.items.length, reviewCount: Math.min(child.reviewPerDay, learned) };
  else if (daily && daily.status === 'completed') state = { mode: 'done', lessonId: daily.id, canPractice: canReview };
  else if (canReview) state = { mode: 'review', reviewCount: Math.max(child.reviewPerDay, 5) };
  else state = { mode: 'none' };
  return { ...state, studyDay: isStudyDay(child, date), date };
}

function lessonView(store, lesson) {
  const words = {};
  for (const it of lesson.items) words[it.wordId] = it.content;
  return {
    id: lesson.id, kind: lesson.kind, date: lesson.date, status: lesson.status,
    plan: lesson.session.plan, step: lesson.session.step, results: lesson.session.results, words
  };
}

function reviewItems(store, child, wordIds) {
  return approvedReviewWords(store, wordIds).map(w => ({
    id: store.nextId('item'), wordId: w.id, role: 'review', content: pickContent(w), approved: true
  }));
}

// התחלת שיעור: היומי המאושר, שיעור חזרה (כשאין שיעור מאושר), או תרגול נוסף אחרי שהשיעור הושלם
function startLesson(store, child, { lessonId, mode }) {
  const date = today();
  const progress = store.childProgress(child.id);
  let lesson;
  if (lessonId) {
    lesson = store.lesson(lessonId);
    if (!lesson || lesson.childId !== child.id) throw new HttpError(404, 'השיעור לא נמצא');
    if (lesson.status === 'in_progress') return lessonView(store, lesson);
    if (lesson.status !== 'approved') throw new HttpError(403, 'השיעור עוד לא אושר');
    if (lesson.date > date) throw new HttpError(403, 'השיעור עוד לא זמין');
    if (lesson.items.some(i => !i.approved)) throw new HttpError(403, 'יש בשיעור תוכן שלא אושר');
    const exclude = new Set(lesson.items.map(i => i.wordId));
    const revIds = srs.selectReview(progress, child.reviewPerDay, date, exclude);
    lesson.items = lesson.items.filter(i => i.role === 'new').concat(reviewItems(store, child, revIds));
  } else {
    const n = Math.max(child.reviewPerDay, 5);
    let ids;
    if (mode === 'practice') {
      ids = Object.values(progress).filter(r => r.sessions > 0)
        .map(r => ({ r, s: srs.priority(r, date) + Math.random() * 5 }))
        .sort((a, b) => b.s - a.s).slice(0, n).map(x => x.r.wordId);
    } else {
      ids = srs.selectReview(progress, n, date);
    }
    const items = reviewItems(store, child, ids);
    if (items.length < 3) throw new HttpError(404, 'עוד אין מספיק מילים לחזרה');
    lesson = {
      id: store.nextId('lesson'), childId: child.id, date, kind: mode === 'practice' ? 'practice' : 'review',
      status: 'approved', items, reviewPreview: [], warnings: [], createdAt: nowIso(), approvedAt: nowIso(),
      session: null, completedAt: null, summary: null, notified: { daily: null, reminder: null }
    };
    store.data.lessons.push(lesson);
  }
  lesson.session = { plan: buildPlan(store, child, lesson.items, progress), step: 0, results: {}, startedAt: nowIso() };
  lesson.status = 'in_progress';
  store.save();
  return lessonView(store, lesson);
}

function sessionLesson(store, child, lessonId) {
  const lesson = store.lesson(lessonId);
  if (!lesson || lesson.childId !== child.id) throw new HttpError(404, 'השיעור לא נמצא');
  if (lesson.status !== 'in_progress') throw new HttpError(409, 'השיעור אינו פעיל');
  return lesson;
}

function answer(store, child, lessonId, stepIndex, payload) {
  const lesson = sessionLesson(store, child, lessonId);
  const contents = Object.fromEntries(lesson.items.map(i => [i.wordId, i.content]));
  const record = (wordId, type, correct, retry) => {
    store.data.answers.push({
      id: store.nextId('answer'), childId: child.id, lessonId: lesson.id, wordId, type, correct, retry,
      date: today(), at: nowIso()
    });
  };
  const r = answerStep(store, lesson.session, contents, Number(stepIndex), payload || {}, record);
  store.save();
  return r;
}

// התקדמות בשלבים שאין בהם תשובה (כרטיסים ומעברים) — לצורך המשך מאותה נקודה
function advance(store, child, lessonId, stepIndex) {
  const lesson = sessionLesson(store, child, lessonId);
  const s = lesson.session;
  const i = Math.max(0, Math.min(Number(stepIndex) || 0, s.plan.length));
  s.step = i;
  store.save();
  return { step: s.step };
}

const CHEERS = [
  'כל הכבוד! עוד צעד קדימה באנגלית 🚀', 'איזה יופי! המוח שלך מתחזק 💪', 'מעולה! מחר נמשיך עוד צעד 🌟',
  'נהדר! כל יום קצת — וזה מצטבר 🧠', 'וואו, השקעת היום! 🎉'
];

function complete(store, child, lessonId) {
  const lesson = sessionLesson(store, child, lessonId);
  const date = today();
  const progress = store.childProgress(child.id);
  const learnedBefore = Object.values(progress).filter(r => r.sessions > 0).length;
  const ans = store.data.answers.filter(a => a.lessonId === lesson.id);
  const first = ans.filter(a => !a.retry);
  const weak = [];
  for (const it of lesson.items) {
    const mine = first.filter(a => a.wordId === it.wordId);
    const correctCount = mine.filter(a => a.correct).length;
    const wrongCount = mine.length - correctCount;
    const rec = progress[it.wordId] || (progress[it.wordId] = srs.newRecord(it.wordId, date));
    srs.applySession(rec, { correctCount, wrongCount }, date);
    if (wrongCount) weak.push({ w: it.wordId, en: it.content.en, he: it.content.he });
  }
  const learnedAfter = Object.values(progress).filter(r => r.sessions > 0).length;
  const correct = first.filter(a => a.correct).length;
  const stars = correct + (lesson.kind === 'daily' ? 5 : 2);
  child.stars = (child.stars || 0) + stars;
  const milestone = MILESTONES.filter(m => learnedBefore < m && learnedAfter >= m).pop() || null;
  lesson.summary = {
    newWords: lesson.items.filter(i => i.role === 'new').length,
    practiced: lesson.items.length,
    correct, total: first.length,
    pct: first.length ? Math.round((correct / first.length) * 100) : 100,
    weak, stars, totalStars: child.stars, milestone, learnedTotal: learnedAfter,
    message: CHEERS[Math.floor(Math.random() * CHEERS.length)]
  };
  lesson.status = 'completed';
  lesson.completedAt = nowIso();
  store.save();
  return lesson.summary;
}

// ---------- תצוגה מקדימה למנהל (לא נשמרת ולא משפיעה על התקדמות) ----------
// מראה איך ייראה השיעור הבא של הילד לפי המצב הנוכחי של המאגר וההתקדמות שלו
const previews = new Map();
function nextLessonItems(store, child) {
  const date = today();
  const todays = store.data.lessons.find(l => l.childId === child.id && l.date === date && l.kind === 'daily' && l.status !== 'completed');
  const newItems = todays ? todays.items.filter(i => i.role === 'new')
    : candidateWords(store, child, new Set([...learnedIds(store, child.id), ...reservedIds(store, child.id)]))
      .slice(0, child.newPerDay).map(w => ({ wordId: w.id, role: 'new', content: pickContent(w) }));
  const revIds = srs.selectReview(store.childProgress(child.id), child.reviewPerDay, date, new Set(newItems.map(i => i.wordId)));
  return newItems.concat(approvedReviewWords(store, revIds).map(w => ({ wordId: w.id, role: 'review', content: pickContent(w) })));
}
function startPreview(store, child) {
  const all = nextLessonItems(store, child);
  if (!all.length) throw new HttpError(404, 'אין עדיין מילים מאושרות לשיעור של הילד הזה');
  const token = Math.random().toString(36).slice(2);
  const session = { plan: buildPlan(store, child, all, store.childProgress(child.id)), step: 0, results: {} };
  const contents = Object.fromEntries(all.map(i => [i.wordId, i.content]));
  previews.set(token, { session, contents, at: Date.now() });
  for (const [k, v] of previews) if (Date.now() - v.at > 3 * 3600 * 1000) previews.delete(k);
  return { token, kind: 'preview', plan: session.plan, step: 0, results: {}, words: contents };
}
function previewAnswer(store, token, stepIndex, payload) {
  const p = previews.get(token);
  if (!p) throw new HttpError(404, 'התצוגה המקדימה פגה');
  return answerStep(store, p.session, p.contents, Number(stepIndex), payload || {}, null);
}

// סטטוס לתצוגה: שיעור מאושר שעבר תאריכו ולא התחיל = הוחמץ
function displayStatus(l) {
  if (l.status === 'approved' && l.kind === 'daily' && l.date < today()) return 'missed';
  return l.status;
}

module.exports = {
  addWordToBank, generateWords, proposeImage, isStudyDay, startDate, candidateWords, poolInfo, ensureDailyLesson, approveWord,
  buildPlan, checkAnswer, answerStep, homeState, startLesson, answer, advance, complete,
  nextLessonItems, startPreview, previewAnswer, displayStatus, notice, EXERCISE_TYPES
};
