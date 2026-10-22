'use strict';
// מודל התוכן: רמות, נושאים, סוגי תרגילים, ושדות התוכן של מילה ובדיקת שלמותם.

const LEVELS = ['beginner', 'basic', 'intermediate', 'advanced'];
const LEVEL_HE = { beginner: 'מתחילים', basic: 'בסיסית', intermediate: 'בינונית', advanced: 'מתקדמת' };

const TOPICS = {
  animals: 'בעלי חיים', food: 'אוכל ושתייה', family: 'משפחה', body: 'גוף', colors: 'צבעים',
  numbers: 'מספרים', school: 'בית ספר', home: 'בית', clothes: 'בגדים', nature: 'טבע',
  weather: 'מזג אוויר', sports: 'ספורט ומשחקים', transport: 'תחבורה', feelings: 'רגשות',
  actions: 'פעולות (פעלים)', places: 'מקומות', time: 'זמן', jobs: 'מקצועות', describing: 'תארים'
};

// mc = בחירת תרגום, match = התאמה, cloze = השלמת משפט, type = כתיבת מילה
const EXERCISE_TYPES = ['mc', 'match', 'cloze', 'type'];
const DEFAULT_EXERCISES = {
  beginner: ['mc', 'match'],
  basic: ['mc', 'match', 'cloze'],
  intermediate: ['mc', 'match', 'cloze', 'type'],
  advanced: ['mc', 'match', 'cloze', 'type']
};

const CONTENT_FIELDS = ['en', 'he', 'emoji', 'image', 'imageCredit', 'exampleEn', 'exampleHe',
  'clozeEn', 'clozeHe', 'distractorsHe', 'distractorsEn'];

function pickContent(w) {
  const c = {};
  for (const f of CONTENT_FIELDS) {
    c[f] = Array.isArray(w[f]) ? w[f].slice() : (w[f] == null ? '' : String(w[f]));
  }
  if (!Array.isArray(c.distractorsHe)) c.distractorsHe = [];
  if (!Array.isArray(c.distractorsEn)) c.distractorsEn = [];
  return c;
}

function cleanList(v) {
  if (typeof v === 'string') v = v.split(/[,\n]/);
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x || '').trim()).filter(Boolean).slice(0, 3);
}

// מנקה קלט עריכה של שדות תוכן (מהמנהל או מ-Gemini)
function sanitizeContent(input, base = {}) {
  const out = { ...pickContent(base) };
  for (const f of CONTENT_FIELDS) {
    if (!(f in input)) continue;
    if (f === 'distractorsHe' || f === 'distractorsEn') out[f] = cleanList(input[f]);
    else out[f] = String(input[f] == null ? '' : input[f]).trim().slice(0, 400);
  }
  return out;
}

// מה חסר כדי שהפריט יהיה כשיר לאישור, בהתאם לסוגי התרגילים שבשימוש
function missingFields(c, exerciseTypes = EXERCISE_TYPES) {
  const miss = [];
  if (!c.en) miss.push('מילה באנגלית');
  if (!c.he) miss.push('תרגום');
  if (!c.exampleEn) miss.push('משפט דוגמה');
  if (!c.exampleHe) miss.push('תרגום המשפט');
  if ((c.distractorsHe || []).length < 3) miss.push('3 מסיחים בעברית');
  if (exerciseTypes.includes('cloze')) {
    if (!/_{2,}/.test(c.clozeEn || '')) miss.push('משפט השלמה עם ___');
    if ((c.distractorsEn || []).length < 3) miss.push('3 מסיחים באנגלית');
  }
  return miss;
}

module.exports = {
  LEVELS, LEVEL_HE, TOPICS, EXERCISE_TYPES, DEFAULT_EXERCISES, CONTENT_FIELDS,
  pickContent, sanitizeContent, missingFields
};
