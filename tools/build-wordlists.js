'use strict';
// בונה את wordsteps/server/wordlists.json מרשימות המילים הרשמיות.
// קלט: טקסט שחולץ מקבצי ה-PDF (pdfjs) —
//   band1.txt   ← https://meyda.education.gov.il/files/Mazkirut_Pedagogit/English/band11July18.pdf
//   flyers.txt  ← https://www.cambridgeenglish.org/pl/Images/149681-yle-flyers-word-list.pdf (כולל Starters/Movers/Flyers)
// שימוש: node tools/build-wordlists.js <תיקייה עם band1.txt ו-flyers.txt>
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('usage: node build-wordlists.js <dir>'); process.exit(1); }

// מילות דקדוק שלא מתאימות לכרטיס מילה עם תמונה
const STOP = new Set(('a an the am is are was were be been being do does did i you he she it we they me him her us them ' +
  'my your his its our their mine yours and or but of to will would shall should could might must than that this these those ' +
  "there here so as if not no yes ok okay oh hello hi bye goodbye please thank thanks i'm don't let's").split(' '));
const CAPITAL_OK = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|english)$/i;

function clean(en) {
  return en.replace(/\(.*?\)/g, ' ').split(/[,/]/)[0].replace(/[…!?.]+$/g, '').replace(/\s+/g, ' ').trim();
}
function keep(en) {
  if (!en || en.length < 2) return false;
  if (!/^[A-Za-z][A-Za-z' -]*$/.test(en)) return false;
  if (en.split(' ').length > 2) return false;
  if (STOP.has(en.toLowerCase())) return false;
  if (/^[A-Z]/.test(en) && !CAPITAL_OK.test(en)) return false;   // שמות פרטיים
  return true;
}

function parseBand1(text) {
  const out = [];
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line || /^(Foundation Level|Learners have|--- page|pages:)/.test(line)) continue;
    if (/[.!?…]$/.test(line) && /\s/.test(line)) continue;           // משפט דוגמה
    const posM = /\((n|v|adj|adv)\)/.exec(line);
    const en = clean(line);
    if (!keep(en)) continue;
    out.push({ en: /^[A-Z]/.test(en) && CAPITAL_OK.test(en) ? en : en.toLowerCase(), pos: posM ? posM[1] : '' });
  }
  return out;
}

const POS = '(?:n|v|adj|adv|prep|det|conj|pron|int|excl|dis|poss(?: adj| pron)?)';
const POS_RE = new RegExp(`^(.+?)\\s{2,}(${POS}(?:\\s*\\+\\s*${POS})*)(?:\\s+.*)?$`);
function parseCambridge(text, title, stopTitle) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.includes(title));
  let end = lines.findIndex((l, i) => i > start && stopTitle.some(t => l.includes(t)));
  if (end < 0) end = lines.length;
  const out = [];
  let pending = '';
  let inKey = false;
  for (let i = start + 1; i < end; i++) {
    let line = lines[i].replace(/\s+$/, '');
    if (/A–Z wordlist|--- page|alphabetic vocabulary list/.test(line)) { inKey = false; continue; }
    if (/^Grammatical key/.test(line)) { inKey = true; continue; }
    if (inKey || !line.trim()) continue;
    line = line.replace(/^[A-Z]\s{2,}(?=\S)/, '');                   // אות הפרק
    if (pending) { line = pending + '   ' + line.trim(); pending = ''; }
    const m = POS_RE.exec(line);
    if (!m) { pending = line.trim(); continue; }
    const en = clean(m[1]);
    if (!keep(en)) continue;
    const pos = m[2].split('+')[0].trim().split(' ')[0];
    out.push({ en: /^[A-Z]/.test(en) && CAPITAL_OK.test(en) ? en : en.toLowerCase(), pos });
  }
  return out;
}

function dedupe(list, seen = new Set()) {
  return list.filter(w => { const k = w.en.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

const band = fs.readFileSync(path.join(dir, 'band1.txt'), 'utf8');
const yle = fs.readFileSync(path.join(dir, 'flyers.txt'), 'utf8');
const starters = dedupe(parseCambridge(yle, '4 Pre A1 Starters A–Z wordlist', ['8 A1 Movers A–Z wordlist']));
const movers = dedupe(parseCambridge(yle, '8 A1 Movers A–Z wordlist', ['12 A2 Flyers A–Z wordlist']));
const flyers = dedupe(parseCambridge(yle, '12 A2 Flyers A–Z wordlist', ['alphabetic vocabulary list', 'Pre A1 Starters and A1 Movers']));

const lists = [
  { id: 'band1', name: 'משרד החינוך — Band I (עד סוף כיתה ו׳)', source: 'https://meyda.education.gov.il/files/Mazkirut_Pedagogit/English/band11July18.pdf', level: 'basic', words: dedupe(parseBand1(band)) },
  { id: 'starters', name: 'Cambridge Pre A1 Starters', source: 'https://www.cambridgeenglish.org/', level: 'beginner', words: starters },
  { id: 'movers', name: 'Cambridge A1 Movers', source: 'https://www.cambridgeenglish.org/', level: 'basic', words: movers },
  { id: 'flyers', name: 'Cambridge A2 Flyers', source: 'https://www.cambridgeenglish.org/', level: 'intermediate', words: flyers }
];
const outFile = path.join(__dirname, '..', 'wordsteps', 'server', 'wordlists.json');
fs.writeFileSync(outFile, JSON.stringify({ lists }, null, 0).replace(/\},\{"en"/g, '},\n{"en"'));
for (const l of lists) console.log(l.id, l.words.length, l.words.slice(0, 12).map(w => w.en + (w.pos ? ':' + w.pos : '')).join(' '));
