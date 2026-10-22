'use strict';
// בונה את wordsteps/server/wordlists.json מרשימות המילים הרשמיות.
// קלט: תיקייה ובה —
//   x1/, x2/  ← קובצי ה-Excel הרשמיים של משרד החינוך, פרוסים (unzip):
//              https://meyda.education.gov.il/files/Mazkirut_Pedagogit/English/CurriculumFilesAugust21/LexicalBand1.xlsx
//              https://meyda.education.gov.il/files/Mazkirut_Pedagogit/English/CurriculumFilesAugust21/LexicalBand2.xlsx
//   flyers.txt ← טקסט שחולץ (pdfjs) מ-https://www.cambridgeenglish.org/pl/Images/149681-yle-flyers-word-list.pdf
// שימוש: node tools/build-wordlists.js <תיקייה>
// שימו לב: רשימות משרד החינוך מוגנות בזכויות יוצרים; הן נכללות בריפו באחריות בעליו.
const fs = require('fs');
const { readXlsx } = require('./xlsx-read');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('usage: node build-wordlists.js <dir>'); process.exit(1); }

// מילות דקדוק שלא מתאימות לכרטיס מילה עם תמונה
const STOP = new Set(('a an the am is are was were be been being do does did i you he she it we they me him her us them ' +
  'my your his its our their mine yours and or but of to will would shall should could might must than that this these those ' +
  "there here so as if not no yes ok okay oh hello hi bye goodbye please thank thanks i'm don't let's").split(' '));
const CAPITAL_OK = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|english)$/i;

function clean(en) {
  // "a good/great deal" — ביטוי עם חלופות; לא ניתן לחתוך בלי לשבור אותו
  if (/\S+\/\S+/.test(en) && /\s/.test(en.replace(/\(.*?\)/g, '').trim())) return '';
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

// גיליון של משרד החינוך: עמודה A = ערך, B = חלק דיבר, "Meaning" = הבהרת המשמעות
function parseBandSheet(sheet) {
  const out = [];
  let meaningCol = null;
  for (const row of sheet.rows) {
    const cell = c => (row.find(x => x.col === c) || {}).val || '';
    const head = row.find(x => x.val.trim() === 'Meaning');
    if (head) { meaningCol = head.col; continue; }
    const raw = cell('A').trim();
    if (!raw || /^(Entry|Phrasal verbs|PRE-BAND|BAND I)/.test(raw)) continue;
    const en = clean(raw);
    if (!keep(en)) continue;
    let pos = cell('B').split(/[ ,]+/).filter(Boolean)[0] || '';
    if (pos === 'aux') pos = 'v';
    const meaning = meaningCol ? cell(meaningCol).replace(/s+/g, ' ').trim() : '';
    out.push({ en: /^[A-Z]/.test(en) && CAPITAL_OK.test(en) ? en : en.toLowerCase(), pos, ...(meaning ? { meaning } : {}) });
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

const band1 = readXlsx(path.join(dir, 'x1'));
const band2 = readXlsx(path.join(dir, 'x2'));
const sheet = (wb, name) => { const x = wb.find(s => s.name === name); if (!x) throw new Error('missing sheet ' + name); return dedupe(parseBandSheet(x)); };
const yle = fs.readFileSync(path.join(dir, 'flyers.txt'), 'utf8');
const starters = dedupe(parseCambridge(yle, '4 Pre A1 Starters A–Z wordlist', ['8 A1 Movers A–Z wordlist']));
const movers = dedupe(parseCambridge(yle, '8 A1 Movers A–Z wordlist', ['12 A2 Flyers A–Z wordlist']));
const flyers = dedupe(parseCambridge(yle, '12 A2 Flyers A–Z wordlist', ['alphabetic vocabulary list', 'Pre A1 Starters and A1 Movers']));

const MOE1 = 'https://meyda.education.gov.il/files/Mazkirut_Pedagogit/English/CurriculumFilesAugust21/LexicalBand1.xlsx';
const MOE2 = 'https://meyda.education.gov.il/files/Mazkirut_Pedagogit/English/CurriculumFilesAugust21/LexicalBand2.xlsx';
const lists = [
  { id: 'preband1', name: 'משרד החינוך — Pre-Band I (תחילת היסודי)', source: MOE1, level: 'beginner', words: sheet(band1, 'Pre-Band I') },
  { id: 'band1core1', name: 'משרד החינוך — Band I Core I (יסודי)', source: MOE1, level: 'basic', words: sheet(band1, 'Band I Core I') },
  { id: 'band1core2', name: 'משרד החינוך — Band I Core II (יסודי, עד סוף ו׳)', source: MOE1, level: 'basic', words: sheet(band1, 'Band I Core II') },
  { id: 'band2core1', name: 'משרד החינוך — Band II Core I (חטיבת ביניים)', source: MOE2, level: 'intermediate', words: sheet(band2, 'Band II Core I') },
  { id: 'band2core2', name: 'משרד החינוך — Band II Core II (עד סוף ט׳)', source: MOE2, level: 'advanced', words: sheet(band2, 'Band II Core II') },
  { id: 'starters', name: 'Cambridge Pre A1 Starters', source: 'https://www.cambridgeenglish.org/', level: 'beginner', words: starters },
  { id: 'movers', name: 'Cambridge A1 Movers', source: 'https://www.cambridgeenglish.org/', level: 'basic', words: movers },
  { id: 'flyers', name: 'Cambridge A2 Flyers', source: 'https://www.cambridgeenglish.org/', level: 'intermediate', words: flyers }
];
const outFile = path.join(__dirname, '..', 'wordsteps', 'server', 'wordlists.json');
fs.writeFileSync(outFile, JSON.stringify({ lists }, null, 0).replace(/\},\{"en"/g, '},\n{"en"'));
for (const l of lists) console.log(l.id, l.words.length, l.words.slice(0, 12).map(w => w.en + (w.pos ? ':' + w.pos : '')).join(' '));
