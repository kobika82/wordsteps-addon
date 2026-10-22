'use strict';
// מקורות תוכן שאינם AI:
//  ARASAAC — איורים ברורים לכל מילה + תרגום לעברית שמתויג על אותו איור (CC BY-NC-SA, ממשלת אראגון / Sergio Palao)
//  Tatoeba — משפטים אמיתיים באנגלית עם תרגום לעברית שנכתב בידי מתנדבים (CC BY 2.0 FR)
//  רשימות מילים רשמיות — wordlists.json (משרד החינוך Band I, Cambridge Starters/Movers/Flyers)
const { HttpError, shuffle } = require('./util');
const images = require('./images');

const ARASAAC = 'https://api.arasaac.org/v1/pictograms';
const ARASAAC_IMG = id => `https://static.arasaac.org/pictograms/${id}/${id}_500.png`;
const ARASAAC_THUMB = id => `https://static.arasaac.org/pictograms/${id}/${id}_300.png`;
const ARASAAC_CREDIT = 'ARASAAC · Sergio Palao · CC BY-NC-SA';
const TATOEBA = 'https://api.tatoeba.org/unstable/sentences';
const UA = { 'User-Agent': 'WordSteps/1.0 (Home Assistant add-on)' };

async function getJson(url, ms = 20000) {
  let res;
  try { res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) }); } catch (e) { throw new HttpError(502, 'המקור החיצוני אינו זמין: ' + e.message); }
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `המקור החיצוני החזיר ${res.status}`);
  return res.json();
}

// ---------- ARASAAC ----------
// סוג מילת המפתח ב-ARASAAC: 2 = שם עצם, 3 = פועל, 4 = תואר
const POS_TYPE = { n: 2, v: 3, adj: 4, adv: 4 };

async function arasaacSearch(word, pos) {
  const q = encodeURIComponent(word.toLowerCase());
  let list = await getJson(`${ARASAAC}/en/bestsearch/${q}`).catch(() => null);
  if (!Array.isArray(list) || !list.length) list = await getJson(`${ARASAAC}/en/search/${q}`).catch(() => null);
  if (!Array.isArray(list)) return [];
  const want = POS_TYPE[pos];
  const w = word.toLowerCase();
  // רק איור שמילת המפתח האנגלית שלו זהה למילה — אחרת "about" מקבל איור של כיכר ("roundabout")
  const exact = p => (p.keywords || []).some(k => (k.keyword || '').toLowerCase() === w);
  const typed = p => (p.keywords || []).some(k => (k.keyword || '').toLowerCase() === w && k.type === want);
  return list.filter(exact).sort((a, b) => (typed(b) ? 1 : 0) - (typed(a) ? 1 : 0));
}

async function arasaacHebrew(id, pos) {
  const p = await getJson(`${ARASAAC}/he/${id}`).catch(() => null);
  const ks = (p?.keywords || []).filter(x => /[א-ת]/.test(x.keyword || ''));
  if (!ks.length) return '';
  // לפועל — מעדיפים צורת מקור ("לרוץ"); לשם עצם — מילת מפתח מסוג שם עצם
  let k;
  if (pos === 'v') k = ks.find(x => x.type === 3 && /^ל/.test(x.keyword.trim())) || ks.find(x => /^ל/.test(x.keyword.trim()));
  else if (POS_TYPE[pos]) k = ks.find(x => x.type === POS_TYPE[pos]);
  return (k || ks[0]).keyword.trim();
}

const TOPIC_TAGS = [
  ['animals', /animal|pet|insect|bird|mammal/], ['food', /food|feeding|fruit|vegetable|drink|meal|dessert/],
  ['family', /family|relative/], ['body', /body|anatomy/], ['colors', /colou?r/], ['numbers', /number|mathematic|quantity/],
  ['school', /school|education|stationery/], ['clothes', /cloth|garment|footwear|accessor/], ['weather', /weather|meteorolog|season/],
  ['transport', /transport|vehicle/], ['sports', /sport|game|toy|leisure|hobby/], ['feelings', /feeling|emotion/],
  ['jobs', /profession|job|work/], ['home', /house|home|furniture|room|household/], ['nature', /nature|plant|landscape|environment/],
  ['time', /time|calendar|day|month/], ['places', /place|building|city|shop/]
];
function topicFrom(tags = [], pos = '') {
  if (['prep', 'conj', 'det', 'pron', 'dis', 'int', 'excl'].includes(pos)) return '';
  const t = tags.join(' ').toLowerCase();
  for (const [topic, re] of TOPIC_TAGS) if (re.test(t)) return topic;
  if (pos === 'v') return 'actions';
  if (pos === 'adj') return 'describing';
  return '';
}

async function downloadArasaac(id) {
  let res;
  try { res = await fetch(ARASAAC_IMG(id), { headers: UA, signal: AbortSignal.timeout(30000) }); } catch (e) { throw new HttpError(502, 'הורדת האיור נכשלה: ' + e.message); }
  if (!res.ok) throw new HttpError(502, `הורדת האיור נכשלה (${res.status})`);
  return { image: images.saveBuffer(Buffer.from(await res.arrayBuffer()), 'image/png'), imageCredit: ARASAAC_CREDIT };
}

// תוצאות לבורר התמונות של המנהל
// בבחירה ידנית מציגים את כל התוצאות (גם לא-זהות), כדי שהמנהל יבחר
async function arasaacImages(q) {
  const list = await getJson(`${ARASAAC}/en/search/${encodeURIComponent(q.toLowerCase())}`).catch(() => null);
  const strict = new Set((await arasaacSearch(q, '')).map(p => p._id));
  return (Array.isArray(list) ? list : []).sort((a, b) => (strict.has(b._id) ? 1 : 0) - (strict.has(a._id) ? 1 : 0)).slice(0, 16).map(p => ({
    id: 'arasaac:' + p._id, thumb: ARASAAC_THUMB(p._id),
    title: (p.keywords || []).map(k => k.keyword).join(', '), credit: ARASAAC_CREDIT
  }));
}
async function importArasaac(id) {
  if (!/^\d{1,7}$/.test(String(id))) throw new HttpError(400, 'מזהה איור לא תקין');
  return downloadArasaac(id);
}

// ---------- Tatoeba ----------
function wordRe(word) { return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'); }

// משפטים שלא מתאימים לילדים
const UNSAFE = /\b(die[sd]?|dying|dead|death|kill\w*|murder\w*|gun\w*|war|wars|blood\w*|drunk|beer|wine|whisky|alcohol|cigarette\w*|smok\w*|sex\w*|naked|suicide|hate[sd]?|stupid|idiot|damn|hell|god|church|bomb\w*|prison|police|steal\w*|stole|divorce\w*|marry|married|kiss\w*|girlfriend|boyfriend|drug\w*)\b/i;
// אוצר מילים "מוכר": כל מילות הרשימות + מילות דקדוק. משפט שרוב מילותיו מוכרות — פשוט יותר לילד
const FUNCTION_WORDS = ('a an the i you he she it we they me him her us them my your his its our their this that these those ' +
  'is am are was were be been do does did have has had will would can could should not no yes and or but so to of in on at for ' +
  'with from up down out about as if than then there here what who where when why how very too all some any one two three').split(' ');
let vocab = null;
function knownWords() {
  if (!vocab) {
    vocab = new Set(FUNCTION_WORDS);
    for (const l of wordLists()) for (const w of l.words) vocab.add(w.en.toLowerCase());
  }
  return vocab;
}
function simplicity(text) {
  const tokens = text.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);
  const known = knownWords();
  const base = t => t.replace(/'s$/, '').replace(/(ies)$/, 'y').replace(/(es|s|ed|ing)$/, '');
  const hits = tokens.filter(t => known.has(t) || known.has(base(t)) || known.has(t.replace(/s$/, ''))).length;
  return tokens.length ? hits / tokens.length : 0;
}

async function tatoebaPairs(word) {
  const url = `${TATOEBA}?lang=eng&q=${encodeURIComponent(word)}&trans:lang=heb&sort=words&limit=60`;
  const j = await getJson(url, 25000).catch(() => null);
  const pairs = [];
  for (const s of j?.data || []) {
    const he = (s.translations || []).flat().find(t => t && t.lang === 'heb');
    if (!he) continue;
    const text = s.text.trim();
    const n = text.split(/\s+/).length;
    if (n < 3 || n > 10 || UNSAFE.test(text)) continue;
    // שמות פרטיים באמצע המשפט (חוץ מ-I ותום/מרי הנפוצים) — בדרך כלל משפט מוזר לילד
    const inner = text.split(/\s+/).slice(1).filter(t => /^[A-Z]/.test(t) && !/^(I|I'm|I've|I'll|Tom|Mary|Tom's|Mary's)\b/.test(t));
    if (inner.length) continue;
    const score = simplicity(text) * 10 - Math.abs(n - 6) * 0.4 - (/\b(Tom|Mary)\b/.test(text) ? 0.5 : 0);
    pairs.push({ en: text, he: he.text.trim(), exact: wordRe(word).test(text), score });
  }
  return pairs.sort((a, b) => b.score - a.score);
}

// ---------- בניית מילה מהמקורות ----------
async function buildWord(en, pos) {
  const out = { en, pos: pos || '', he: '', topic: '', image: '', imageCredit: '', exampleEn: '', exampleHe: '', clozeEn: '', clozeHe: '', concrete: true };
  const notes = [];
  const pics = await arasaacSearch(en, pos);
  if (pics.length) {
    const p = pics[0];
    out.topic = topicFrom(p.tags, pos);
    out.he = await arasaacHebrew(p._id, pos);
    try { Object.assign(out, await downloadArasaac(p._id)); } catch (e) { notes.push('איור: ' + e.message); }
    if (!out.he) notes.push('אין תרגום עברי ב-ARASAAC');
  } else {
    out.topic = topicFrom([], pos);
    notes.push('לא נמצא איור');
  }
  const pairs = await tatoebaPairs(en);
  const exact = pairs.filter(p => p.exact);
  const ex = exact[0] || pairs[0];
  if (ex) { out.exampleEn = ex.en; out.exampleHe = ex.he; }
  const cl = exact.find(p => p !== ex && p.en.split(/\s+/).length >= 4) || exact.find(p => p !== ex) || (ex && ex.exact ? ex : null);
  if (cl) { out.clozeEn = cl.en.replace(wordRe(en), '___'); out.clozeHe = cl.he; }
  if (!ex) notes.push('לא נמצא משפט דוגמה');
  return { word: out, notes };
}

// מסיחים בלי AI: תרגומים של מילים אחרות מאותו נושא, ומילים אנגליות מאותו חלק דיבר
function fillDistractors(store, w) {
  const others = store.data.words.filter(x => x.id !== w.id && x.he && x.en);
  if ((w.distractorsHe || []).length < 3) {
    const same = shuffle(others.filter(x => x.topic && x.topic === w.topic && x.he !== w.he));
    const rest = shuffle(others.filter(x => x.he !== w.he && !same.includes(x)));
    w.distractorsHe = [...new Set([...(w.distractorsHe || []), ...same.concat(rest).map(x => x.he)])].filter(x => x !== w.he).slice(0, 3);
  }
  if ((w.distractorsEn || []).length < 3) {
    const samePos = shuffle(others.filter(x => w.pos && x.pos === w.pos));
    const rest = shuffle(others.filter(x => !samePos.includes(x)));
    w.distractorsEn = [...new Set([...(w.distractorsEn || []), ...samePos.concat(rest).map(x => x.en)])]
      .filter(x => x.toLowerCase() !== w.en.toLowerCase()).slice(0, 3);
  }
}

// ---------- רשימות מילים ----------
let lists = null;
function wordLists() {
  if (!lists) lists = require('./wordlists.json').lists;
  return lists;
}

module.exports = { arasaacSearch, arasaacImages, importArasaac, buildWord, fillDistractors, wordLists, topicFrom, tatoebaPairs, ARASAAC_CREDIT };
