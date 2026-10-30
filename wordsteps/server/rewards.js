'use strict';
// תוכנית כוכבים ופרסים.
//
// שני מספרים נפרדים לכל ילד, וזה מכוון:
//   stars       — היתרה. יורדת כשבוחרים פרס.
//   starsEarned — סך הכוכבים שנצברו מאז ומתמיד. לא יורד לעולם.
// בלי ההפרדה הזו, ילד שמימש פרס היה "מאבד" את ההישג שלו, וזה בדיוק ההפך
// ממה שתוכנית כוכבים אמורה לעשות.

const { now } = require('./util');

const DEFAULT_STARS = {
  base: 2,          // על עצם ההשלמה, גם כשהיה קשה
  max: 10,          // ב-100% הצלחה. זו גם יחידת החשבון: פרס של 300 = 30 שיעורים מושלמים
  streakBonus: 0,   // בונוס רצף מקצר את הדרך לפרס ולכן מכובה כברירת מחדל
  streakCap: 5,
  missPenalty: 5,   // כמה כוכבים יורדים על יום לימוד שהוחמץ
};

const starsConf = (store) => ({ ...DEFAULT_STARS, ...(store.data.settings.stars || {}) });

// כוכבים לשיעור לפי שיעור ההצלחה. הבסיס ניתן תמיד: ילד שהתאמץ וטעה הרבה
// עדיין מקבל משהו, אחרת יום גרוע אחד הופך את התוכנית למעניש.
function starsForLesson(store, pct, streakDays) {
  const c = starsConf(store);
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const earned = c.base + Math.round((c.max - c.base) * (p / 100));
  const bonus = Math.min(c.streakCap, Math.max(0, (Number(streakDays) || 0) - 1)) * c.streakBonus;
  return { stars: earned + bonus, base: c.base, byAccuracy: earned - c.base, streakBonus: bonus };
}

// רצף ימי לימוד עד לתאריך נתון, כולל אותו יום
function streakOf(store, child, date) {
  const done = new Set(store.data.lessons
    .filter((l) => l.childId === child.id && l.status === 'completed').map((l) => l.date));
  let n = 0;
  let d = date;
  while (done.has(d)) {
    n += 1;
    const t = new Date(d + 'T12:00:00Z');
    t.setUTCDate(t.getUTCDate() - 1);
    d = t.toISOString().slice(0, 10);
  }
  return n;
}

const rewards = (store) => store.data.settings.rewards || [];
const active = (store) => rewards(store).filter((r) => r.active !== false);

// מה הילד רואה: המחיר, האם הוא יכול כבר, וכמה חסר
function catalogFor(store, child) {
  const bal = child.stars || 0;
  return active(store).map((r) => ({
    id: r.id, name: r.name, emoji: r.emoji || '🎁', cost: Number(r.cost) || 0,
    joke: !!r.joke,
    goal: child.goalRewardId === r.id,
    affordable: bal >= (Number(r.cost) || 0),
    missing: Math.max(0, (Number(r.cost) || 0) - bal),
  })).sort((a, b) => a.cost - b.cost);
}


// הילד בוחר יעד מראש, עוד לפני שיש לו כוכבים. זה מה שהופך את הצבירה
// למשהו עם כיוון: סרגל שמתמלא לעבר דבר מסוים, לא מספר שעולה.
function setGoal(store, child, rewardId) {
  const r = active(store).find((x) => String(x.id) === String(rewardId));
  if (!r) throw Object.assign(new Error('הפרס לא נמצא'), { code: 404 });
  if (r.joke) return { joke: true, reward: r };   // לא נקבע יעד - זו בדיחה
  child.goalRewardId = r.id;
  store.save();
  return { joke: false, reward: r };
}

function goalOf(store, child) {
  const r = active(store).find((x) => x.id === child.goalRewardId && !x.joke);
  if (!r) return null;
  const cost = Number(r.cost) || 0;
  const bal = child.stars || 0;
  return { id: r.id, name: r.name, emoji: r.emoji || '🎁', cost,
    reached: bal >= cost, missing: Math.max(0, cost - bal),
    pct: cost ? Math.min(100, Math.round((bal / cost) * 100)) : 100 };
}

// כמה שיעורים מושלמים שווה פרס. זה המספר שההורה באמת שואל עליו:
// "כמה עבודה עומדת מאחורי הפרס הזה".
function lessonsFor(store, cost) {
  const per = starsConf(store).max || 1;
  return Math.ceil((Number(cost) || 0) / per);
}

// תחזית לפי אחוז הצלחה: כמה כוכבים לשיעור וכמה שיעורים לפרס
function economy(store, cost) {
  const c = starsConf(store);
  return [100, 90, 80, 70, 60, 50].map((pct) => {
    const per = starsForLesson(store, pct, 1).stars;
    return { pct, per, lessons: per > 0 ? Math.ceil((Number(cost) || 0) / per) : null };
  });
}

// קנס על יום לימוד שהוחמץ. היתרה לא יורדת מתחת לאפס: חוב כוכבים הוא
// מצב שאי אפשר להתאושש ממנו, וזה הופך את התוכנית למרתיעה במקום למניעה.
function applyMissPenalty(store, child) {
  const p = Number(starsConf(store).missPenalty) || 0;
  if (p <= 0) return 0;
  const before = child.stars || 0;
  child.stars = Math.max(0, before - p);
  return before - child.stars;
}
function pending(store, childId = null) {
  return store.data.redemptions.filter((x) => x.status === 'pending' && (childId == null || x.childId === childId));
}

// בקשת פרס. הכוכבים יורדים כבר עכשיו, אחרת אפשר לבקש שלושה פרסים באותם
// כוכבים ולחכות לראות מה יאושר. סירוב מחזיר אותם.
function request(store, child, rewardId) {
  const r = active(store).find((x) => String(x.id) === String(rewardId));
  if (!r) throw Object.assign(new Error('הפרס לא נמצא'), { code: 404 });
  if (r.joke) throw Object.assign(new Error('הפרס הזה הוא בדיחה'), { code: 400 });
  const cost = Number(r.cost) || 0;
  if (pending(store, child.id).length) throw Object.assign(new Error('יש כבר בקשה שממתינה לאישור'), { code: 400 });
  if ((child.stars || 0) < cost) throw Object.assign(new Error('אין מספיק כוכבים'), { code: 400 });
  child.stars = (child.stars || 0) - cost;
  const rec = {
    id: store.nextId('redemption'), childId: child.id, rewardId: r.id,
    name: r.name, emoji: r.emoji || '🎁', cost,
    at: now().toISOString(), status: 'pending', decidedAt: null,
  };
  store.data.redemptions.unshift(rec);
  store.save();
  return rec;
}

function decide(store, id, approve) {
  const rec = store.data.redemptions.find((x) => x.id === Number(id));
  if (!rec) throw Object.assign(new Error('הבקשה לא נמצאה'), { code: 404 });
  if (rec.status !== 'pending') throw Object.assign(new Error('הבקשה כבר טופלה'), { code: 400 });
  rec.status = approve ? 'given' : 'denied';
  rec.decidedAt = now().toISOString();
  if (!approve) {
    const child = store.data.children.find((c) => c.id === rec.childId);
    if (child) child.stars = (child.stars || 0) + rec.cost;   // החזר
  }
  store.save();
  return rec;
}

module.exports = { starsForLesson, streakOf, catalogFor, request, decide, pending, rewards, active,
  setGoal, goalOf, starsConf, lessonsFor, economy, applyMissPenalty, DEFAULT_STARS };
