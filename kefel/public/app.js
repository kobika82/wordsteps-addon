'use strict';
// משותף לממשק הילד וההורה: קריאות API, בניית DOM, הקראה בעברית, ציורי הקבוצות, ניתוב.
const KF = window.KF = {};

KF.api = async function (method, path, body) {
  const res = await fetch('api/' + path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* גוף ריק */ }
  if (!res.ok) throw new Error((data && data.error) || `שגיאה ${res.status}`);
  return data;
};
KF.get = p => KF.api('GET', p);
KF.post = (p, b) => KF.api('POST', p, b || {});
KF.put = (p, b) => KF.api('PUT', p, b || {});
KF.del = p => KF.api('DELETE', p);

// h('div.cls#id', {attrs}, ...children)
KF.h = function (sel, attrs, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = k => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) return k.forEach(add);
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return el;
};
const h = KF.h;

KF.mount = function (...nodes) {
  const app = document.getElementById('app');
  app.innerHTML = '';
  nodes.forEach(n => n && app.appendChild(n));
  window.scrollTo(0, 0);
};

KF.toast = function (msg, bad) {
  const t = h('div.toast' + (bad ? '.bad' : ''), msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), bad ? 6000 : 2600);
};
KF.fail = e => KF.toast(e.message || String(e), true);

// כפתור שמבצע פעולה אסינכרונית ומונע לחיצה כפולה
KF.busy = async function (btn, fn) {
  if (btn.disabled) return;
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ ' + old;
  try { return await fn(); } catch (e) { KF.fail(e); } finally { btn.disabled = false; btn.innerHTML = old; }
};

KF.modal = function (title, body) {
  const bg = h('div.modal-bg');
  const close = () => bg.remove();
  const box = h('div.modal', h('div.row', h('h2.grow', title), h('button.btn.ghost', { onclick: close, 'aria-label': 'סגירה' }, '✕')), body);
  bg.appendChild(box);
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  document.body.appendChild(bg);
  return { close, box };
};

// ---- מספרים במילים, לקריאה בקול ----
// צורת הספירה (נקבה), כמו שסופרים בכיתה: "שלוש כפול ארבע שווה שתים עשרה"
const ONES = ['אפס', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע'];
const TEENS = ['עשר', 'אחת עשרה', 'שתים עשרה', 'שלוש עשרה', 'ארבע עשרה', 'חמש עשרה', 'שש עשרה', 'שבע עשרה', 'שמונה עשרה', 'תשע עשרה'];
const TENS = ['', '', 'עשרים', 'שלושים', 'ארבעים', 'חמישים', 'שישים', 'שבעים', 'שמונים', 'תשעים'];
KF.num = function (n) {
  n = Number(n);
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  if (n === 100) return 'מאה';
  if (n > 100) return String(n);
  const t = Math.floor(n / 10), o = n % 10;
  return o ? `${TENS[t]} ו${ONES[o]}` : TENS[t];
};
KF.sayFact = (a, b, p) => `${KF.num(a)} כפול ${KF.num(b)}` + (p == null ? '' : ` שווה ${KF.num(p)}`);

// ---- הקראה בעברית (מנוע הדיבור של המכשיר) ----
// ילד בכיתה ב עוד לא קורא שוטף, ולכן כמעט כל מסך גם מוקרא. אם אין במכשיר קול
// עברי, ננסה בכל זאת עם lang=he-IL — באנדרואיד המנוע בוחר קול לפי השפה.
let voice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices().filter(v => /^(he|iw)([-_]|$)/i.test(v.lang));
  voice = vs.find(v => /google|natural|enhanced|carmit/i.test(v.name)) || vs[0] || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
KF.canSpeak = () => 'speechSynthesis' in window;
KF.hasHebrewVoice = () => !!voice;
KF.muted = (() => { try { return localStorage.getItem('kf-muted') === '1'; } catch (e) { return false; } })();
KF.setMuted = m => { KF.muted = m; try { localStorage.setItem('kf-muted', m ? '1' : '0'); } catch (e) { /* אין אחסון */ } if (m) KF.stopSpeak(); };
KF.stopSpeak = () => { if (KF.canSpeak()) speechSynthesis.cancel(); };
// מחזיר Promise שמסתיים כשההקראה נגמרת (או מיד, אם אין הקראה)
KF.speak = function (text, { rate = 0.9, force = false } = {}) {
  return new Promise(resolve => {
    if (!KF.canSpeak() || !text || (KF.muted && !force)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}️]/gu, ''));
    u.lang = 'he-IL';
    if (voice) u.voice = voice;
    u.rate = rate;
    let done = false;
    const end = () => { if (!done) { done = true; resolve(); } };
    u.onend = end; u.onerror = end;
    // יש מנועים שלא מדווחים על סיום — לא נתקעים בגללם
    setTimeout(end, 1500 + String(text).length * 140);
    speechSynthesis.speak(u);
  });
};
KF.speakBtn = (text, cls) => KF.canSpeak()
  ? h('button.speak' + (cls || ''), { type: 'button', 'aria-label': 'להקריא', onclick: (e) => { e.stopPropagation(); KF.speak(typeof text === 'function' ? text() : text, { force: true }); } }, '🔊')
  : null;

// ---- ציור: a קבוצות, ב-b פריטים בכל קבוצה ----
KF.groups = function (a, b, item, { upTo = a, hideCount = false } = {}) {
  const total = a * b;
  const size = total <= 12 ? 'xl' : total <= 30 ? 'lg' : total <= 60 ? 'md' : 'sm';
  // קבוצה של עד 5 — שורה אחת; יותר — שתי שורות, כדי ששתי קבוצות ייכנסו זו לצד זו בטלפון
  const cols = b <= 5 ? b : Math.ceil(b / 2);
  return h('div.groups.' + size, { dir: 'ltr' },
    Array.from({ length: a }, (_, i) => h('div.group' + (i >= upTo ? '.dim' : ''),
      { style: { gridTemplateColumns: `repeat(${cols}, auto)` } },
      Array.from({ length: b }, () => h('span.it', item)),
      hideCount ? null : h('span.gcount', String((i + 1) * b)))));
};

// פס הכפולות: n, 2n, ... 10n — עם הדגשה של מה שכבר ראינו
KF.strip = function (n, upTo, { current = upTo, hide = null } = {}) {
  return h('div.strip', { dir: 'ltr' }, Array.from({ length: 10 }, (_, i) => {
    const k = i + 1;
    const cls = (k <= upTo ? '.on' : '') + (k === current ? '.cur' : '') + (k === hide ? '.hole' : '');
    return h('span.cell' + cls, k === hide ? '?' : String(k * n));
  }));
};

KF.fmtDate = function (d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  const names = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const dow = new Date(Date.UTC(+y, +m - 1, +day)).getUTCDay();
  return `יום ${names[dow]} ${String(+day).padStart(2, '0')}/${String(+m).padStart(2, '0')}/${y}`;
};
KF.fmtTime = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = x => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ---- ניתוב לפי hash ----
KF.routes = [];
KF.route = (pattern, fn) => KF.routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), fn });
KF.go = hash => { if (location.hash === hash) KF.render(); else location.hash = hash; };
KF.render = function () {
  KF.stopSpeak();
  document.querySelectorAll('.feedback').forEach(x => x.remove());
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  for (const r of KF.routes) {
    const m = r.re.exec(path);
    if (m) {
      Promise.resolve(r.fn(...m.slice(1).map(decodeURIComponent))).catch(e => KF.mount(h('div.loading', '⚠️ ' + (e.message || e))));
      return;
    }
  }
  KF.go('#/');
};

KF.boot = async function () {
  try {
    KF.me = await KF.get('me');
  } catch (e) {
    KF.mount(h('div.loading', '⚠️ ' + e.message));
    return;
  }
  const role = KF.me.role;
  if (role === 'admin') KF.Admin.init();
  else if (role === 'child') KF.Child.init();
  else {
    document.body.classList.add('kid');
    const msg = role === 'paused'
      ? 'התרגול שלך מושהה כרגע. אפשר לבקש מההורה להפעיל אותו מחדש 🙂'
      : KF.me.setupNeeded
        ? 'כדי להתחיל, צריך להגדיר מנהל: בהגדרות התוסף ב-Home Assistant יש להוסיף את שם המשתמש שלכם ל-admin_users.'
        : `היי${KF.me.user ? ' ' + KF.me.user.name : ''}! עוד אין לך פרופיל בלוח הכפל. ההורה צריך לשייך אותך בממשק הניהול.`;
    KF.mount(h('div.kid-wrap', h('div.kid-card.center', h('div', { style: { fontSize: '64px' } }, '✖️'), h('h2', 'לוח הכפל'), h('p', msg))));
    return;
  }
  window.addEventListener('hashchange', KF.render);
  KF.render();
};
