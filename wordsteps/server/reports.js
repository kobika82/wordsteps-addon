'use strict';
// דוחות התקדמות ונתוני לוח הבקרה.
const { today, addDays } = require('./util');
const L = require('./lessons');

function statusCounts(progressMap) {
  const c = { new: 0, learning: 0, needs_reinforcement: 0, familiar: 0, mastered: 0 };
  for (const r of Object.values(progressMap)) c[r.status] = (c[r.status] || 0) + 1;
  return c;
}

function accuracy(answers) {
  const first = answers.filter(a => !a.retry);
  const correct = first.filter(a => a.correct).length;
  return { correct, total: first.length, pct: first.length ? Math.round((correct / first.length) * 100) : null };
}

function wordLabel(store, lessonItemsCache, wordId) {
  const w = store.word(wordId);
  if (w) return { en: w.en, he: w.he };
  return lessonItemsCache[wordId] || { en: '?', he: '' };
}

function report(store, child, from, to) {
  const progress = store.childProgress(child.id);
  const answers = store.data.answers.filter(a => a.childId === child.id && a.date >= from && a.date <= to);
  const lessons = store.data.lessons.filter(l => l.childId === child.id && l.date >= from && l.date <= to);
  const daily = lessons.filter(l => l.kind === 'daily');
  const cache = {};
  for (const l of lessons) for (const it of l.items) cache[it.wordId] = { en: it.content.en, he: it.content.he };

  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const a = answers.filter(x => x.date === d);
    const acc = accuracy(a);
    const newWords = Object.values(progress).filter(r => r.introduced === d && r.sessions > 0).length;
    days.push({ date: d, ...acc, newWords, studied: a.length > 0 });
    if (days.length > 400) break;
  }

  const wrongBy = {};
  for (const a of answers) if (!a.correct && !a.retry) wrongBy[a.wordId] = (wrongBy[a.wordId] || 0) + 1;
  const hard = Object.entries(wrongBy).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w, n]) => ({
    w: Number(w), wrong: n, ...wordLabel(store, cache, Number(w)), status: progress[w]?.status || 'new'
  }));

  return {
    child: { id: child.id, name: child.name, level: child.level },
    from, to,
    newWordsLearned: Object.values(progress).filter(r => r.introduced >= from && r.introduced <= to && r.sessions > 0).length,
    status: statusCounts(progress),
    learnedTotal: Object.values(progress).filter(r => r.sessions > 0).length,
    accuracy: accuracy(answers),
    studyDays: days.filter(d => d.studied).length,
    lessonsCompleted: daily.filter(l => l.status === 'completed').length,
    lessonsMissed: daily.filter(l => L.displayStatus(l) === 'missed').length,
    extraSessions: lessons.filter(l => l.kind !== 'daily' && l.status === 'completed').length,
    days, hard,
    lessons: daily.map(l => ({ id: l.id, date: l.date, status: L.displayStatus(l), pct: l.summary?.pct ?? null, newWords: l.items.filter(i => i.role === 'new').length }))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
  };
}

function dashboard(store) {
  L.resolveNotices(store);
  const date = today();
  const weekAgo = addDays(date, -6);
  const children = store.data.children.map(c => {
    const progress = store.childProgress(c.id);
    const lessonToday = store.data.lessons.find(l => l.childId === c.id && l.date === date && l.kind === 'daily');
    const ans = store.data.answers.filter(a => a.childId === c.id && a.date >= weekAgo);
    const lastNotif = store.data.notifications.find(n => n.childId === c.id && n.kind !== 'test');
    const hard = Object.values(progress).filter(r => r.status === 'needs_reinforcement' && r.wrong >= 2)
      .map(r => ({ w: r.wordId, en: store.word(r.wordId)?.en || '?', he: store.word(r.wordId)?.he || '', wrong: r.wrong }));
    return {
      id: c.id, name: c.name, active: c.active, level: c.level, stars: c.stars || 0,
      todayStatus: lessonToday ? L.displayStatus(lessonToday) : (L.isStudyDay(c, date) ? 'none' : 'off'),
      todayLessonId: lessonToday?.id || null,
      learned: Object.values(progress).filter(r => r.sessions > 0).length,
      status: statusCounts(progress),
      weekAccuracy: accuracy(ans).pct,
      lastNotification: lastNotif ? { at: lastNotif.at, ok: lastNotif.ok, kind: lastNotif.kind, error: lastNotif.error } : null,
      pool: L.poolInfo(store, c),
      hard
    };
  });
  return {
    date, children,
    draftsCount: store.data.words.filter(w => w.status === 'draft').length,
    startDate: L.startDate(store),
    stock: ['beginner', 'basic', 'intermediate', 'advanced'].map(level => ({
      level,
      approved: store.data.words.filter(w => w.level === level && w.status === 'approved').length,
      drafts: store.data.words.filter(w => w.level === level && w.status === 'draft').length
    })),
    notices: store.data.adminNotices.filter(n => !n.dismissed).slice(0, 20),
    bank: { total: store.data.words.length, approved: store.data.words.filter(w => w.status === 'approved').length }
  };
}

module.exports = { report, dashboard, statusCounts };
