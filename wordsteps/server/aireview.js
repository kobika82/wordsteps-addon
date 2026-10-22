'use strict';
// בדיקה אוטומטית של מילים ממתינות ב-Gemini: מילה אחת בכל פעם, במרווח קבוע, עד מכסה יומית.
// Gemini מאשר / מתקן / פוסל — המילה נשארת טיוטה, והמנהל רואה את ההכרעה ומאשר סופית.
const { now, today } = require('./util');
const { LEVELS } = require('./content');
const gemini = require('./gemini');

const DEFAULTS = { enabled: true, perDay: 10, intervalMin: 60 };

function config(store) { return { ...DEFAULTS, ...(store.data.settings.aiReview || {}) }; }

function state(store) {
  const s = store.data.aiReviewState || (store.data.aiReviewState = { date: null, count: 0, lastRunAt: null, lastError: '', lastWord: '' });
  if (s.date !== today()) { s.date = today(); s.count = 0; }
  return s;
}

// הבאה בתור: טיוטה שעוד לא נבדקה. קודם רמות שהילדים צריכים (הרמה שלהם והקודמות), ואז הוותיקה ביותר
function queue(store) {
  const needed = new Set();
  for (const c of store.data.children) if (c.active) for (const l of LEVELS.slice(0, LEVELS.indexOf(c.level) + 1)) needed.add(l);
  return store.data.words.filter(w => w.status === 'draft' && !w.ai)
    .sort((a, b) => (needed.has(b.level) ? 1 : 0) - (needed.has(a.level) ? 1 : 0) || a.id - b.id);
}

async function reviewOne(store, w) {
  const child = store.data.children.find(c => c.active && c.level === w.level);
  const r = await gemini.reviewWord(w, { age: child?.age });
  if (r.verdict === 'fixed') for (const [k, v] of Object.entries(r.changes)) w[k] = v.to;
  w.ai = { verdict: r.verdict, reason: r.reason, changes: r.changes, model: r.model, at: now().toISOString() };
  w.updatedAt = now().toISOString();
  store.save();
  return w.ai;
}

function nextRunAt(store) {
  const c = config(store), s = state(store);
  if (!c.enabled || !gemini.isConfigured() || s.count >= c.perDay || !queue(store).length) return null;
  if (!s.lastRunAt) return now().toISOString();
  return new Date(Math.max(now().getTime(), Date.parse(s.lastRunAt) + c.intervalMin * 60000)).toISOString();
}

let running = false;
async function tick(store, { force = false } = {}) {
  const c = config(store), s = state(store);
  if (running || !gemini.isConfigured()) return null;
  if (!force) {
    if (!c.enabled || s.count >= c.perDay) return null;
    if (s.lastRunAt && now().getTime() - Date.parse(s.lastRunAt) < c.intervalMin * 60000) return null;
  }
  const w = queue(store)[0];
  if (!w) return null;
  running = true;
  s.lastRunAt = now().toISOString();
  s.lastWord = w.en;
  try {
    const ai = await reviewOne(store, w);
    s.count += 1;
    s.lastError = '';
    return { word: w.en, ...ai };
  } catch (e) {
    // כשל (למשל עומס) לא נספר במכסה; ננסה שוב אחרי המרווח
    s.lastError = `${w.en}: ${e.message}`;
    return { word: w.en, error: e.message };
  } finally {
    running = false;
    store.save();
  }
}

function status(store) {
  const words = store.data.words.filter(w => w.status === 'draft');
  const by = v => words.filter(w => w.ai && w.ai.verdict === v).length;
  return {
    config: config(store), state: state(store), configured: gemini.isConfigured(), nextRunAt: nextRunAt(store),
    counts: { unchecked: words.filter(w => !w.ai).length, ok: by('ok'), fixed: by('fixed'), reject: by('reject') }
  };
}

module.exports = { tick, status, config, queue, DEFAULTS };
