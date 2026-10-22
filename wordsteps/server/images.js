'use strict';
// תמונות: חיפוש ב-Openverse (תמונות ברישיון פתוח, בלי מפתח), הורדה ושמירה מקומית, והעלאה מהמנהל.
// כל תמונה שנבחרה נשמרת ב-/data/images ומוגשת מהתוסף — הילד לא טוען תמונות מאתרים חיצוניים.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HttpError } = require('./util');

let dir = '/data/images';
function configure(d) { dir = d; fs.mkdirSync(dir, { recursive: true }); }
function imageDir() { return dir; }

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 6 * 1024 * 1024;

function saveBuffer(buf, mime) {
  const ext = EXT[mime];
  if (!ext) throw new HttpError(415, 'סוג תמונה לא נתמך');
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'התמונה גדולה מדי');
  const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20) + '.' + ext;
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  return 'img/' + name;
}

function saveDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'תמונה לא תקינה');
  return saveBuffer(Buffer.from(m[2], 'base64'), m[1]);
}

async function search(q, n = 8) {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=${n}&mature=false&extension=jpg,png`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'WordSteps/1.0 (Home Assistant add-on)' }, signal: AbortSignal.timeout(20000) });
  } catch (e) { throw new HttpError(502, 'חיפוש התמונות אינו זמין: ' + e.message); }
  if (!res.ok) throw new HttpError(502, `חיפוש התמונות החזיר שגיאה ${res.status}`);
  const j = await res.json();
  return (j.results || []).map(r => ({
    id: r.id, thumb: r.thumbnail || r.url, title: r.title || '',
    credit: [r.creator, r.license ? `CC ${String(r.license).toUpperCase()}` : '', r.source].filter(Boolean).join(' · ')
  }));
}

// מוריד את התמונה המוקטנת של תוצאת Openverse ושומר מקומית
async function importOpenverse(id, credit) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new HttpError(400, 'מזהה תמונה לא תקין');
  let res;
  try {
    res = await fetch(`https://api.openverse.org/v1/images/${id}/thumb/`, {
      headers: { 'User-Agent': 'WordSteps/1.0 (Home Assistant add-on)' }, signal: AbortSignal.timeout(30000)
    });
  } catch (e) { throw new HttpError(502, 'הורדת התמונה נכשלה: ' + e.message); }
  if (!res.ok) throw new HttpError(502, `הורדת התמונה נכשלה (${res.status})`);
  const mime = (res.headers.get('content-type') || '').split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  return { image: saveBuffer(buf, mime), imageCredit: credit || 'Openverse' };
}

// הצעה אוטומטית: התוצאה הראשונה בחיפוש
async function autoPick(query) {
  const results = await search(query, 3);
  if (!results.length) return null;
  return importOpenverse(results[0].id, results[0].credit);
}

module.exports = { configure, imageDir, saveBuffer, saveDataUrl, search, importOpenverse, autoPick };
