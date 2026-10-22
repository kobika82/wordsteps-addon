'use strict';
// משותף לממשק הילד והמנהל: קריאות API, בניית DOM, הגייה, ניתוב.
const WS = window.WS = {};

WS.api = async function (method, path, body) {
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
WS.get = p => WS.api('GET', p);
WS.post = (p, b) => WS.api('POST', p, b || {});
WS.put = (p, b) => WS.api('PUT', p, b || {});
WS.del = p => WS.api('DELETE', p);

// h('div.cls#id', {attrs}, ...children)
WS.h = function (sel, attrs, ...kids) {
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
const h = WS.h;
WS.en = text => h('span.en', { lang: 'en', dir: 'ltr' }, text);

WS.mount = function (...nodes) {
  const app = document.getElementById('app');
  app.innerHTML = '';
  nodes.forEach(n => n && app.appendChild(n));
  window.scrollTo(0, 0);
};

WS.toast = function (msg, bad) {
  const t = h('div.toast' + (bad ? '.bad' : ''), msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), bad ? 6000 : 2600);
};
WS.fail = e => WS.toast(e.message || String(e), true);

// כפתור שמבצע פעולה אסינכרונית ומונע לחיצה כפולה
WS.busy = async function (btn, fn) {
  if (btn.disabled) return;
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ ' + old;
  try { return await fn(); } catch (e) { WS.fail(e); } finally { btn.disabled = false; btn.innerHTML = old; }
};

WS.modal = function (title, body, { wide } = {}) {
  const bg = h('div.modal-bg');
  const close = () => bg.remove();
  const box = h('div.modal', { style: wide ? { maxWidth: '900px' } : null },
    h('div.row', h('h2.grow', title), h('button.btn.ghost', { onclick: close, 'aria-label': 'סגירה' }, '✕')), body);
  bg.appendChild(box);
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  document.body.appendChild(bg);
  return { close, box };
};

// ---- הגייה באנגלית (מנוע הדיבור של המכשיר) ----
let voice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices().filter(v => /^en[-_]/i.test(v.lang));
  voice = vs.find(v => /en[-_]US/i.test(v.lang) && /samantha|google|natural|enhanced/i.test(v.name))
    || vs.find(v => /en[-_]US/i.test(v.lang)) || vs[0] || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
WS.canSpeak = () => 'speechSynthesis' in window;
WS.speak = function (text, rate) {
  if (!WS.canSpeak() || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  if (voice) u.voice = voice;
  u.rate = rate || 0.85;
  speechSynthesis.speak(u);
};
WS.speakBtn = (text, cls) => WS.canSpeak()
  ? h('button.speak' + (cls || ''), { type: 'button', 'aria-label': 'השמעה', onclick: (e) => { e.stopPropagation(); WS.speak(text); } }, '🔊')
  : null;

WS.fmtDate = function (d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  const names = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const dow = new Date(Date.UTC(+y, +m - 1, +day)).getUTCDay();
  return `יום ${names[dow]} ${+day}/${+m}`;
};
WS.fmtTime = iso => iso ? new Date(iso).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

// הקטנת תמונה בדפדפן לפני שמירה (עד 800 פיקסלים, JPEG)
WS.shrinkImage = function (src, max = 800) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => reject(new Error('לא ניתן לקרוא את התמונה'));
    img.src = src;
  });
};
WS.readFile = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
  r.readAsDataURL(file);
});

// ---- ניתוב לפי hash ----
WS.routes = [];
WS.route = (pattern, fn) => WS.routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), fn });
WS.go = hash => { if (location.hash === hash) WS.render(); else location.hash = hash; };
WS.render = function () {
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  for (const r of WS.routes) {
    const m = r.re.exec(path);
    if (m) {
      Promise.resolve(r.fn(...m.slice(1).map(decodeURIComponent))).catch(e => {
        WS.mount(h('div.loading', '⚠️ ' + (e.message || e)));
      });
      return;
    }
  }
  WS.go('#/');
};

WS.boot = async function () {
  try {
    WS.me = await WS.get('me');
  } catch (e) {
    WS.mount(h('div.loading', '⚠️ ' + e.message));
    return;
  }
  const role = WS.me.role;
  if (role === 'admin') WS.Admin.init();
  else if (role === 'child') WS.Child.init();
  else {
    document.body.classList.add('kid');
    const msg = role === 'paused'
      ? 'הלמידה שלך מושהית כרגע. אפשר לבקש מההורה להפעיל אותה מחדש 🙂'
      : WS.me.setupNeeded
        ? 'כדי להתחיל, צריך להגדיר מנהל: בהגדרות התוסף ב-Home Assistant יש להוסיף את שם המשתמש שלכם ל-admin_users.'
        : `היי${WS.me.user ? ' ' + WS.me.user.name : ''}! עוד אין לך פרופיל ב-WordSteps. ההורה צריך לשייך אותך בממשק הניהול.`;
    WS.mount(h('div.kid-wrap', h('div.kid-card.center', h('div', { style: { fontSize: '64px' } }, '📚'), h('h2', 'WordSteps'), h('p', msg))));
    return;
  }
  window.addEventListener('hashchange', WS.render);
  WS.render();
};
