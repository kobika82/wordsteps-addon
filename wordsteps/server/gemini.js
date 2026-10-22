'use strict';
// יצירת תוכן באמצעות Gemini: מילים, תרגומים, משפטים ומסיחים — ותמונות המחשה.
// כל מה שנוצר כאן נשמר כטיוטה ומחייב אישור מנהל לפני שילד רואה אותו.
const { HttpError } = require('./util');
const { LEVEL_HE, TOPICS } = require('./content');

const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
let cfg = { apiKey: '', model: 'gemini-2.5-flash', imageModel: 'gemini-2.5-flash-image' };
function configure(c) { cfg = { ...cfg, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v)) }; }
function isConfigured() { return !!cfg.apiKey; }
function info() { return { configured: isConfigured(), model: cfg.model, imageModel: cfg.imageModel }; }

async function call(model, body, timeoutMs = 90000) {
  if (!cfg.apiKey) throw new HttpError(503, 'Gemini לא מוגדר — יש להזין מפתח API בהגדרות התוסף');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API}${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new HttpError(502, 'שירות Gemini אינו זמין: ' + (e.name === 'AbortError' ? 'תם הזמן' : e.message));
  } finally { clearTimeout(t); }
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text).error.message; } catch (e) { /* טקסט גולמי */ }
    throw new HttpError(502, `Gemini החזיר שגיאה ${res.status}: ${msg}`);
  }
  return JSON.parse(text);
}

const STR = { type: 'STRING' };
const WORD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    en: STR, he: STR, topic: STR, difficulty: { type: 'INTEGER' }, concrete: { type: 'BOOLEAN' },
    emoji: STR, imageQuery: STR, exampleEn: STR, exampleHe: STR, clozeEn: STR, clozeHe: STR,
    distractorsHe: { type: 'ARRAY', items: STR }, distractorsEn: { type: 'ARRAY', items: STR }
  },
  required: ['en', 'he', 'topic', 'difficulty', 'concrete', 'emoji', 'imageQuery', 'exampleEn', 'exampleHe',
    'clozeEn', 'clozeHe', 'distractorsHe', 'distractorsEn']
};

const RULES = `
Rules for every word (the learner is a Hebrew-speaking child):
- "en": the English word in its base form, lowercase unless it is a proper noun.
- "he": an accurate, common Hebrew translation, without niqqud. Verbs in the infinitive (e.g. "לרוץ"). If two meanings are common, give the one a child meets first.
- "exampleEn": one short natural sentence that a child of this level understands and that shows the meaning. "exampleHe": its Hebrew translation.
- "clozeEn": a DIFFERENT short sentence where the exact word "en" (same form) is replaced by "___" and only that word fits logically. "clozeHe": its full Hebrew translation (with the word translated, no blank).
- "distractorsEn": exactly 3 English words of the same part of speech that clearly do NOT fit the cloze sentence.
- "distractorsHe": exactly 3 Hebrew words from a related category that are clearly wrong translations (never synonyms of the answer).
- "emoji": a single emoji that shows the meaning, or "" if none is clear.
- "concrete": true if the meaning can be shown unambiguously in a picture.
- "imageQuery": 1-3 English words to search a clear photo/illustration of the meaning.
- "difficulty": 1 (easiest) to 10.
- "topic": one of: ${Object.keys(TOPICS).join(', ')}.
- Content must be child-friendly: no violence, brands, religion or politics.`;

function parseWords(json) {
  const text = json?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new HttpError(502, 'תשובת Gemini אינה JSON תקין'); }
  const list = Array.isArray(data) ? data : data.words;
  if (!Array.isArray(list)) throw new HttpError(502, 'תשובת Gemini לא כללה רשימת מילים');
  return list.map(fixWord).filter(w => w.en && w.he);
}

function fixWord(w) {
  const out = { ...w };
  for (const k of ['en', 'he', 'exampleEn', 'exampleHe', 'clozeEn', 'clozeHe', 'emoji', 'imageQuery', 'topic']) {
    out[k] = String(out[k] || '').trim();
  }
  out.distractorsHe = (out.distractorsHe || []).map(s => String(s).trim()).filter(s => s && s !== out.he).slice(0, 3);
  out.distractorsEn = (out.distractorsEn || []).map(s => String(s).trim()).filter(s => s && s.toLowerCase() !== out.en.toLowerCase()).slice(0, 3);
  // אם משפט ההשלמה חסר את הקו התחתון — נגזור אותו ממשפט הדוגמה
  if (!/_{2,}/.test(out.clozeEn)) {
    const re = new RegExp(`\\b${out.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const src = re.test(out.clozeEn) ? out.clozeEn : out.exampleEn;
    if (re.test(src)) { out.clozeEn = src.replace(re, '___'); if (src === out.exampleEn) out.clozeHe = out.exampleHe; }
  }
  if (!TOPICS[out.topic]) out.topic = '';
  out.difficulty = Math.max(1, Math.min(10, Number(out.difficulty) || 5));
  out.emoji = [...out.emoji].slice(0, 2).join('');
  return out;
}

// הצעת מילים חדשות לרמה/נושא, בלי מילים שכבר קיימות
async function suggestWords({ count, level, age, topic, exclude = [] }) {
  const topicLine = topic ? `Topic: ${topic} (${TOPICS[topic] || topic}).` : 'Topics: a useful mix of everyday topics.';
  const prompt = `You are building an English vocabulary course for a Hebrew-speaking child.
Child age: ${age || 'about 9'}. English level: ${level} (${LEVEL_HE[level] || ''}).
${topicLine}
Suggest exactly ${count} useful, frequent, age-appropriate English words for this level, ordered from easier to harder.
Do NOT include any of these words (already known or already in the bank): ${exclude.slice(0, 600).join(', ') || '(none)'}.
${RULES}`;
  const json = await call(cfg.model, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8, responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { words: { type: 'ARRAY', items: WORD_SCHEMA } }, required: ['words'] }
    }
  });
  const ex = new Set(exclude.map(s => s.toLowerCase()));
  const seen = new Set();
  return parseWords(json).filter(w => {
    const k = w.en.toLowerCase();
    if (ex.has(k) || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// השלמת תוכן למילה שהמנהל הקליד
async function completeWord({ en, level, age }) {
  const prompt = `Prepare learning content for the English word "${en}" for a Hebrew-speaking child.
Child age: ${age || 'about 9'}. English level: ${level} (${LEVEL_HE[level] || ''}).
Return exactly one item in "words".
${RULES}`;
  const json = await call(cfg.model, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4, responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { words: { type: 'ARRAY', items: WORD_SCHEMA } }, required: ['words'] }
    }
  });
  const list = parseWords(json);
  if (!list.length) throw new HttpError(502, 'Gemini לא החזיר תוכן למילה');
  return { ...list[0], en: list[0].en || en };
}

// איור ידידותי לילדים. מחזיר base64 — הלקוח מקטין ושומר
async function generateImage({ en, he }) {
  const prompt = `A simple, friendly, colorful illustration for a children's vocabulary card showing the meaning of the English word "${en}"${he ? ` (Hebrew: ${he})` : ''}. One clear subject on a plain light background, no text, no letters, no words in the image.`;
  const json = await call(cfg.imageModel, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] }
  }, 120000);
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const img = parts.find(p => p.inlineData || p.inline_data);
  if (!img) throw new HttpError(502, 'Gemini לא החזיר תמונה');
  const d = img.inlineData || img.inline_data;
  return { mime: d.mimeType || d.mime_type || 'image/png', data: d.data };
}

async function test() {
  const json = await call(cfg.model, { contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }] }, 30000);
  return (json?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

module.exports = { configure, isConfigured, info, suggestWords, completeWord, generateImage, test, fixWord };
