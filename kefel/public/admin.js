'use strict';
// ממשק ההורה: לוח בקרה, ילדים ופתיחת כפולות, כוכבים ופרסים, הגדרות.
(function () {
  const h = KF.h;
  const Admin = KF.Admin = {};
  const DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const TODAY = {
    none: ['אין כפולה פתוחה', 'warn'], waiting: ['עוד לא תרגל היום', ''], in_progress: ['באמצע תרגול', 'info'],
    completed: ['תרגל היום ✓', 'ok'], abandoned: ['התחיל ולא סיים', 'warn'], off: ['לא יום תרגול', '']
  };
  const KINDS = { daily: 'יומית', reminder: 'תזכורת', test: 'בדיקה', unlock: 'כפולה חדשה', 'session-done': 'סיום תרגול',
    ready: 'מוכן להמשיך', 'day-summary': 'סיכום יום', penalty: 'קנס', reward: 'בקשת פרס', 'reward-result': 'תשובה על פרס' };
  const ST_CLS = { mastered: 'st-m', good: 'st-g', learning: 'st-l', weak: 'st-w', new: 'st-n' };
  const badge = (map, k) => { const [t, c] = map[k] || [k, '']; return h('span.badge' + (c ? '.' + c : ''), t); };

  const NAV = [['#/', 'לוח בקרה'], ['#/children', 'ילדים'], ['#/stars', 'כוכבים ופרסים'], ['#/settings', 'הגדרות']];
  function page(title, ...content) {
    document.body.classList.remove('kid');
    document.body.classList.add('admin');
    const cur = '#' + (location.hash.replace(/^#/, '').split('/').slice(0, 2).join('/') || '/');
    const on = href => cur === href || (href === '#/children' && cur.startsWith('#/child'));
    KF.mount(
      h('header.top', h('div.top-in', h('div.brand', '✖️ לוח הכפל', h('span.badge.brand', 'הורה')),
        h('nav', NAV.map(([href, t]) => h('a' + (on(href) ? '.on' : ''), { href }, t))))),
      h('main', h('h1', title), ...content));
  }

  Admin.init = function () {
    KF.route('/', dashboard);
    KF.route('/children', children);
    KF.route('/child/new', () => childForm(null));
    KF.route('/child/:id', id => childPage(Number(id)));
    KF.route('/child/:id/edit', id => childForm(Number(id)));
    KF.route('/stars', starsPage);
    KF.route('/settings', settings);
    KF.route('/try/:n', n => tryTable(Number(n)));
  };

  // ---------- לוח בקרה ----------
  async function dashboard() {
    const d = await KF.get('dashboard');
    const alerts = [];
    if (!d.status.ha.connected) alerts.push(h('div.alert.warn', '⚠️', h('div', 'אין חיבור ל-Home Assistant — התראות לא יישלחו.')));
    for (const r of d.pending) {
      alerts.push(h('div.alert', '🎁',
        h('div.grow', h('b', r.childName), ` מבקש/ת: ${r.emoji} ${r.name} — ${r.cost} כוכבים`),
        h('button.btn.sm.primary', { onclick: (e) => KF.busy(e.currentTarget, async () => { await KF.post(`redemptions/${r.id}/decide`, { approve: true }); KF.toast('אושר ✓'); dashboard(); }) }, 'אישור'),
        h('button.btn.sm.ghost', { onclick: (e) => { if (confirm('לדחות את הבקשה? הכוכבים יוחזרו לילד.')) KF.busy(e.currentTarget, async () => { await KF.post(`redemptions/${r.id}/decide`, { approve: false }); dashboard(); }); } }, 'דחייה')));
    }
    for (const n of d.notices) {
      alerts.push(h('div.alert.info', '💡', h('div.grow', n.text, h('div.small.muted', KF.fmtTime(n.at))),
        h('button.btn.sm.ghost', { onclick: async (e) => { await KF.post(`notices/${n.id}/dismiss`); e.target.closest('.alert').remove(); } }, 'הסתרה')));
    }
    const cards = d.children.length ? h('div.grid2', d.children.map(c => kidCard(c, dashboard)))
      : h('div.card', h('p', 'עוד אין ילדים. '), h('button.btn.primary', { onclick: () => KF.go('#/child/new') }, '+ יצירת פרופיל ראשון'));
    page('לוח בקרה', ...alerts, cards,
      h('p.small.muted', `אזור זמן: ${d.status.timeZone} · ${KF.fmtDate(d.status.now.date)} ${d.status.now.time}`));
  }

  function kidCard(c, after) {
    const cur = c.tables.find(t => t.n === c.current);
    return h('div.card.kid-sum',
      h('div.row', h('h2.grow', c.name, c.active ? null : h('span.badge', ' מושהה')), h('span.badge.brand', '⭐ ' + (c.stars || 0))),
      cur ? h('div.cur-table',
        h('div.big', `${KF.me.meta.themes[cur.n].item} כפולות של ${cur.n}`),
        h('div.small.muted', cur.learnedAt ? `נפתחה ${KF.fmtTime(cur.openedAt).slice(0, 10)} · יודע/ת ${cur.mastered} מתוך 10` : 'נפתחה — שלב הלימוד עוד לא הושלם'),
        h('div.bar', h('i', { style: { width: cur.pct + '%' } })),
        c.phase ? h('div.small', { style: { marginTop: '6px' } }, c.phase.phase === 'learn' ? '📖 התרגול הבא: יום לימוד'
          : c.phase.phase === 'solo' ? (c.phase.day === 1 ? `🆕 יום 1 מתוך ${1 + c.phase.solo}: לימוד ושאלות על הכפולה` : `🎯 יום ${c.phase.day} מתוך ${1 + c.phase.solo}: שאלות על הכפולה לבד`)
          : '🔁 חזרה על כל הכפולות שנלמדו — עד שתפתחו כפולה חדשה') : null)
        : h('p.muted', 'עוד לא נפתחה כפולה.'),
      h('div.row', { style: { margin: '10px 0' } },
        badge(TODAY, c.today), c.todayPct != null ? h('span.badge', c.todayPct + '%') : null,
        h('span.small.muted', c.weekAccuracy == null ? 'אין תרגולים השבוע' : `השבוע: ${c.weekSessions} תרגולים, ${c.weekAccuracy}% הצלחה`)),
      h('div.row',
        c.suggestNext ? h('button.btn.primary', { onclick: (e) => unlock(c, c.suggestNext, e.currentTarget, after) }, `🔓 לפתוח את כפולות של ${c.suggestNext}`) : null,
        h('button.btn', { onclick: () => KF.go('#/child/' + c.id) }, 'כל הכפולות והפרטים')));
  }

  async function unlock(c, n, btn, after) {
    const who = c.notifyService ? ` ${c.name} יקבל/תקבל התראה.` : '';
    if (!confirm(`לפתוח ל${c.name} את כפולות של ${n}? זו תהיה הכפולה היומית, והתרגול הבא יתחיל בשלב לימוד.${who}`)) return;
    await KF.busy(btn, async () => {
      const r = await KF.post(`children/${c.id}/unlock`, { n });
      KF.toast(r.notified ? (r.notified.ok ? 'נפתחה ✓ ההתראה נשלחה' : 'נפתחה, אבל ההתראה נכשלה: ' + r.notified.error) : 'נפתחה ✓', r.notified && !r.notified.ok);
      after();
    });
  }

  // ---------- ילדים ----------
  async function children() {
    const list = await KF.get('children');
    page('ילדים',
      h('div.row', { style: { marginBottom: '12px' } }, h('button.btn.primary', { onclick: () => KF.go('#/child/new') }, '+ ילד חדש')),
      list.length ? h('div.grid2', list.map(c => kidCard(c, children))) : h('p.muted', 'עוד אין ילדים.'));
  }

  async function childPage(id) {
    const d = await KF.get('children/' + id);
    const c = d.child;
    const reload = () => childPage(id);
    const opened = new Map(c.tables.map(t => [t.n, t]));

    // עשר הכפולות: פתוחות (עם מצב) ונעולות (לחיצה = פתיחה)
    const tables = h('div.tgrid', Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
      const t = opened.get(n);
      if (!t) {
        return h('button.tbox.locked', { onclick: (e) => unlock(c, n, e.currentTarget, reload) },
          h('div.n', '×' + n), h('div.small', '🔒 לפתוח'));
      }
      return h('button.tbox' + (c.current === n ? '.current' : ''), { onclick: () => tableMenu(c, t, reload) },
        h('div.n', '×' + n), h('div.small', c.current === n ? '⭐ הכפולה היומית' : t.learnedAt ? 'נלמדה' : 'טרם נלמדה'),
        h('div.bar', h('i', { style: { width: t.pct + '%' } })), h('div.small', `${t.mastered}/10`));
    }));

    const grid = h('table.grid10', { dir: 'ltr' },
      h('tr', h('th', '×'), ...Array.from({ length: 10 }, (_, j) => h('th', String(j + 1)))),
      d.grid.map((row, i) => h('tr', h('th', String(i + 1)), row.map((cell, j) =>
        h('td.' + ST_CLS[cell.s], { title: `${i + 1}×${j + 1} — ${KF.me.meta.statusHe[cell.s]}${cell.w ? ` (${cell.w} טעויות)` : ''}` }, String((i + 1) * (j + 1)))))));

    const notifs = await KF.get('notifications?childId=' + id).catch(() => []);
    page(c.name,
      h('div.row', { style: { marginBottom: '12px' } },
        h('button.btn', { onclick: () => KF.go('#/child/' + id + '/edit') }, '✏️ עריכת פרופיל'),
        c.notifyService ? h('button.btn', { onclick: (e) => KF.busy(e.currentTarget, async () => { const r = await KF.post(`children/${id}/test-notify`); KF.toast(r.ok ? 'נשלחה ✓' : 'נכשלה: ' + r.error, !r.ok); }) }, '🔔 התראת בדיקה') : null,
        h('span.grow'), h('span.badge.brand', `⭐ ${c.stars || 0} (נצברו ${c.starsEarned || 0})`)),
      h('div.card', h('h2', 'הכפולות'),
        h('p.small.muted', 'לחיצה על כפולה נעולה פותחת אותה והופכת אותה לכפולה היומית. לחיצה על כפולה פתוחה — אפשרויות נוספות.'),
        tables),
      d.hard.length ? h('div.card', h('h2', '⚠️ עובדות קשות'),
        h('div.chips', d.hard.map(x => h('span.chip', { dir: 'ltr' }, `${x.a}×${x.b}=${x.a * x.b}`, h('span.small.muted', ` · ${x.wrong} טעויות`))))) : null,
      h('div.card', h('h2', 'לוח הכפל של ' + c.name),
        h('div.table-wrap', grid),
        h('div.legend.admin-legend', ['mastered', 'good', 'learning', 'weak', 'new'].map(k => h('span', h('i.' + ST_CLS[k]), KF.me.meta.statusHe[k]))),
        h('p.small.muted', '"יודע/ת היטב" = שלוש תשובות נכונות ברצף. 3×4 ו-4×3 נספרות כעובדה אחת.')),
      h('div.card', h('h2', 'תרגולים אחרונים'),
        d.sessions.length ? h('div.table-wrap', h('table.t',
          h('tr', h('th', 'תאריך'), h('th', 'סוג'), h('th', 'כפולה'), h('th', 'נכון'), h('th', 'כוכבים'), h('th', 'טעויות')),
          d.sessions.map(s => h('tr',
            h('td', KF.fmtDate(s.date)), h('td', s.kind === 'daily' ? 'יומי' : 'אימון נוסף', s.learned ? h('span.badge.info', ' + לימוד') : null),
            h('td', s.phase === 'mix' ? 'חזרה על הכל' : '×' + s.table), h('td', `${s.correct}/${s.total} (${s.pct}%)`), h('td', s.stars ? '+' + s.stars : '—'),
            h('td', { dir: 'ltr', style: { textAlign: 'right' } }, (s.weak || []).map(w => `${w.a}×${w.b}`).join(', ') || '—')))))
          : h('p.muted', 'עוד אין תרגולים.')),
      h('div.card', h('h2', 'יומן התראות'),
        notifs.length ? h('div.table-wrap', h('table.t',
          h('tr', h('th', 'זמן'), h('th', 'סוג'), h('th', 'הודעה'), h('th', 'מצב')),
          notifs.slice(0, 20).map(n => h('tr', h('td', KF.fmtTime(n.at)), h('td', KINDS[n.kind] || n.kind), h('td.small', n.message),
            h('td', n.ok ? h('span.badge.ok', 'נשלחה') : h('span.badge.bad', 'נכשלה: ' + n.error))))))
          : h('p.muted', 'עוד לא נשלחו התראות.')));
  }

  function tableMenu(c, t, after) {
    const act = (label, fn, cls = '') => h('button.btn' + cls, { onclick: (e) => KF.busy(e.currentTarget, async () => { await fn(); m.close(); after(); }) }, label);
    const m = KF.modal(`כפולות של ${t.n}`, h('div',
      h('p', `נפתחה ${KF.fmtTime(t.openedAt)}. ${t.learnedAt ? 'שלב הלימוד הושלם ' + KF.fmtTime(t.learnedAt) + '.' : 'שלב הלימוד עוד לא הושלם.'} יודע/ת היטב ${t.mastered} מתוך 10.`),
      h('div.facts', { dir: 'ltr' }, t.facts.map(f => h('span.fact.' + ST_CLS[f.status], h('small', `${f.k}×${t.n}`), h('b', String(f.product))))),
      h('div.row', { style: { marginTop: '14px' } },
        c.current !== t.n ? act('⭐ להפוך לכפולה היומית', () => KF.post(`children/${c.id}/current`, { n: t.n }), '.primary') : null,
        t.learnedAt ? act('📖 ללמוד שוב (שלב לימוד בתרגול הבא)', () => KF.post(`children/${c.id}/relearn`, { n: t.n })) : null,
        h('button.btn', { onclick: () => { m.close(); KF.go('#/try/' + t.n); } }, '👀 לנסות כמו הילד'),
        h('span.grow'),
        h('button.btn.danger', { onclick: (e) => { if (confirm('לנעול את הכפולה? מה שהילד כבר יודע נשמר.')) KF.busy(e.currentTarget, async () => { await KF.del(`children/${c.id}/tables/${t.n}`); m.close(); after(); }); } }, '🔒 לנעול'))));
  }

  async function childForm(id) {
    const [c, users, services] = await Promise.all([
      id ? KF.get('children/' + id).then(d => d.child) : Promise.resolve({ name: '', gender: '', days: [0, 1, 2, 3, 4], notifyTime: '16:00', active: true, reminderAfterMin: 120 }),
      KF.get('ha/users').catch(() => ({ users: [] })),
      KF.get('ha/services').catch(() => ({ services: [] }))
    ]);
    const I = {
      name: h('input', { type: 'text', value: c.name }),
      gender: h('select', h('option', { value: '' }, '—'), h('option', { value: 'm', selected: c.gender === 'm' }, 'בן'), h('option', { value: 'f', selected: c.gender === 'f' }, 'בת')),
      user: h('select', h('option', { value: '' }, '— לא משויך —'), users.users.filter(u => !u.isAdmin || u.id === c.haUserId).map(u => h('option', { value: u.id, selected: u.id === c.haUserId }, u.name))),
      service: h('select', h('option', { value: '' }, '— בלי התראות —'), services.services.map(s => h('option', { value: s, selected: s === c.notifyService }, s))),
      time: h('input', { type: 'text', value: c.notifyTime, placeholder: 'HH:MM', inputmode: 'numeric', style: { maxWidth: '110px' } }),
      reminder: h('input', { type: 'checkbox', checked: c.reminderEnabled }),
      after: h('input', { type: 'number', min: 15, max: 720, value: c.reminderAfterMin || 120, style: { maxWidth: '100px' } }),
      active: h('input', { type: 'checkbox', checked: c.active !== false })
    };
    if (c.notifyService && !services.services.includes(c.notifyService)) I.service.append(h('option', { value: c.notifyService, selected: true }, c.notifyService));
    const days = DAYS.map((d, i) => { const cb = h('input', { type: 'checkbox', checked: (c.days || []).includes(i) }); return { i, cb, el: h('label', cb, d) }; });
    const save = h('button.btn.primary', { onclick: (e) => KF.busy(e.currentTarget, async () => {
      const body = { name: I.name.value, gender: I.gender.value, haUserId: I.user.value, notifyService: I.service.value,
        notifyTime: I.time.value, days: days.filter(x => x.cb.checked).map(x => x.i), reminderEnabled: I.reminder.checked,
        reminderAfterMin: +I.after.value, active: I.active.checked };
      const r = id ? await KF.put('children/' + id, body) : await KF.post('children', body);
      KF.toast('נשמר ✓');
      KF.go('#/child/' + r.id);
    }) }, 'שמירה');
    page(id ? 'עריכת ' + c.name : 'ילד חדש',
      h('div.card', h('div.grid2',
        h('label.f', h('span', 'שם'), I.name),
        h('label.f', h('span', 'בן / בת (לניסוח הפניות)'), I.gender),
        h('label.f', h('span', 'משתמש Home Assistant של הילד'), I.user),
        h('label.f', h('span', 'מכשיר להתראות'), I.service)),
        users.error ? h('p.small.muted', 'לא ניתן לקרוא משתמשים מ-HA: ' + users.error + '. משתמש שנכנס לאפליקציה פעם אחת יופיע ברשימה.') : null,
        h('h3', { style: { marginTop: '14px' } }, 'ימי תרגול'),
        h('div.checks', days.map(x => x.el)),
        h('p.small.muted', 'רק בימים אלה יש תרגול יומי שמזכה בכוכבים, ונשלחת התראה. בשאר הימים אפשר להתאמן בלי כוכבים.'),
        h('div.grid2', { style: { marginTop: '10px' } },
          h('label.f', h('span', 'שעת ההתראה'), I.time),
          h('label.f', h('span', 'תזכורת אם לא תרגל (דקות אחרי ההתראה)'), h('div.row', I.reminder, I.after))),
        h('label.checks', { style: { marginTop: '10px' } }, I.active, 'פעיל'),
        h('div.row', { style: { marginTop: '14px' } }, save,
          id ? h('button.btn.danger', { onclick: (e) => {
            if (!confirm(`למחוק את ${c.name} ואת כל נתוני התרגול והכוכבים? אי אפשר לבטל.`)) return;
            KF.busy(e.currentTarget, async () => { await KF.del('children/' + id); KF.go('#/children'); });
          } }, 'מחיקה') : null)));
  }

  // תצוגה מקדימה: ההורה עובר את מה שהילד יעבור בכפולה חדשה, בלי שום שמירה
  async function tryTable(n) {
    const view = await KF.post('preview', { n, learn: true });
    KF.me.child = KF.me.child || { name: 'הורה', gender: '', stars: 0 };
    KF.Child.play(view, { preview: true, onExit: () => history.back() });
  }

  // ---------- כוכבים ופרסים ----------
  async function starsPage() {
    const [d, rd] = await Promise.all([KF.get('stars'), KF.get('redemptions').catch(() => ({ pending: [], recent: [] }))]);
    const I = {
      max: h('input', { type: 'number', min: 1, max: 200, value: d.conf.max, style: { width: '80px' } }),
      base: h('input', { type: 'number', min: 0, max: 50, value: d.conf.base, style: { width: '80px' } }),
      streak: h('input', { type: 'number', min: 0, max: 20, value: d.conf.streakBonus, style: { width: '80px' } }),
      miss: h('input', { type: 'number', min: 0, max: 100, value: d.conf.missPenalty, style: { width: '80px' } })
    };
    const rows = [];
    const rewBox = h('div');
    function addRow(r) {
      const row = {
        id: r.id || Date.now() + Math.floor(Math.random() * 999), joke: !!r.joke,
        emoji: h('input', { type: 'text', value: r.emoji || '🎁', style: { width: '52px', textAlign: 'center' } }),
        name: h('input', { type: 'text', value: r.name || '', placeholder: 'שם הפרס', style: { maxWidth: '240px' } }),
        cost: h('input', { type: 'number', min: 1, max: 999999, value: r.cost || 100, style: { width: '96px' } }),
        act: h('input', { type: 'checkbox', checked: r.active !== false })
      };
      const note = h('span.small.muted');
      const refresh = () => { note.textContent = row.joke ? 'פרס בדיחה 😄' : '≈ ' + Math.ceil((+row.cost.value || 0) / Math.max(1, +I.max.value)) + ' תרגולים מושלמים'; };
      row.cost.oninput = refresh; I.max.addEventListener('input', refresh); refresh();
      row.el = h('div.row', { style: { marginBottom: '6px' } }, row.emoji, row.name, row.cost, h('span.small.muted', 'כוכבים'), note,
        h('label.checks', row.act, ' פעיל'),
        row.joke ? null : h('button.btn.sm.danger', { onclick: () => row.el.remove() }, 'הסר'));
      rows.push(row); rewBox.appendChild(row.el);
    }
    d.rewards.forEach(addRow);
    const table = h('div.table-wrap');
    const draw = () => {
      const per = pct => (+I.base.value) + Math.round(((+I.max.value) - (+I.base.value)) * (pct / 100));
      const cheapest = Math.min(...d.rewards.filter(r => !r.joke).map(r => +r.cost), 300);
      table.innerHTML = '';
      table.appendChild(h('table.t',
        h('tr', h('th', 'אחוז הצלחה'), h('th', 'כוכבים לתרגול'), h('th', 'תרגולים לפרס הזול ביותר')),
        [100, 90, 80, 70, 60, 50].map(p => h('tr', h('td', p + '%'), h('td', String(per(p))), h('td', per(p) > 0 ? String(Math.ceil(cheapest / per(p))) : '—')))));
    };
    [I.base, I.max].forEach(x => x.addEventListener('input', draw));
    draw();
    page('כוכבים ופרסים',
      h('div.card',
        h('h2', '⭐ תוכנית הכוכבים'),
        h('p.small.muted', 'רק התרגול היומי מזכה בכוכבים, לפי אחוז התשובות הנכונות בניסיון הראשון. אימון נוסף באותו יום — בלי כוכבים, כדי שהדרך לפרס תהיה לדעת ולא ללחוץ הרבה. היתרה נפרדת מ-WordSteps.'),
        h('div.row', { style: { marginTop: '10px', gap: '14px' } },
          h('label.checks', 'מקסימום ב-100%', I.max),
          h('label.checks', 'בסיס על השלמה', I.base),
          h('label.checks', 'בונוס לכל יום רצוף', I.streak),
          h('label.checks', 'קנס על יום שהוחמץ', I.miss)),
        h('p.small.muted', 'הקנס כבוי (0) כברירת מחדל — לכיתה ב עדיף לעודד מאשר להעניש. אם מפעילים, הוא יורד בשעת הסיכום, רק ביום תרגול, ולא מתחת לאפס.'),
        table,
        h('h3', { style: { marginTop: '14px' } }, 'הפרסים'),
        rewBox,
        h('div.row',
          h('button.btn.sm', { onclick: () => addRow({ emoji: '🎁', name: '', cost: 100 }) }, '➕ הוסף פרס'),
          h('span.grow'),
          h('button.btn.primary', { onclick: (e) => KF.busy(e.currentTarget, async () => {
            await KF.put('stars', { max: +I.max.value, base: +I.base.value, streakBonus: +I.streak.value, missPenalty: +I.miss.value,
              rewards: rows.filter(r => r.el.isConnected && r.name.value.trim()).map(r => ({ id: r.id, emoji: r.emoji.value, name: r.name.value.trim(), cost: +r.cost.value, active: r.act.checked, joke: r.joke })) });
            KF.toast('נשמר ✓');
          }) }, 'שמירה'))),
      h('div.card', h('h2', 'בקשות פרסים'),
        rd.pending.length || rd.recent.length ? h('div.table-wrap', h('table.t',
          h('tr', h('th', 'זמן'), h('th', 'ילד'), h('th', 'פרס'), h('th', 'כוכבים'), h('th', 'מצב')),
          [...rd.pending, ...rd.recent].map(r => h('tr', h('td', KF.fmtTime(r.at)), h('td', r.childName), h('td', r.emoji + ' ' + r.name), h('td', String(r.cost)),
            h('td', r.status === 'pending' ? h('span.badge.warn', 'ממתין — אישור בלוח הבקרה') : r.status === 'given' ? h('span.badge.ok', 'ניתן') : h('span.badge', 'נדחה'))))))
          : h('p.muted', 'עוד אין בקשות.')));
  }

  // ---------- הגדרות ----------
  async function settings() {
    const [d, services, users] = await Promise.all([KF.get('settings'), KF.get('ha/services').catch(() => ({ services: [] })), KF.get('ha/users').catch(() => ({ users: [] }))]);
    const s = d.settings;
    const chk = v => h('input', { type: 'checkbox', checked: v });
    const I = {
      service: h('select', h('option', { value: '' }, '— בלי התראות —'), services.services.map(x => h('option', { value: x, selected: x === s.adminNotifyService }, x))),
      questions: h('input', { type: 'number', min: 4, max: 30, value: s.questions, style: { maxWidth: '100px' } }),
      soloDays: h('input', { type: 'number', min: 0, max: 14, value: s.soloDays ?? 2, style: { maxWidth: '100px' } }),
      mixMax: h('input', { type: 'number', min: 1, max: 10, value: s.mixMaxTables ?? 4, style: { maxWidth: '100px' } }),
      done: chk(s.notifyAdminSessionDone), ready: chk(s.notifyAdminReady), unlock: chk(s.notifyChildOnUnlock), sum: chk(s.notifyAdminDaySummary),
      sumTime: h('input', { type: 'text', value: s.summaryTime, placeholder: 'HH:MM', style: { maxWidth: '110px' } })
    };
    if (s.adminNotifyService && !services.services.includes(s.adminNotifyService)) I.service.append(h('option', { value: s.adminNotifyService, selected: true }, s.adminNotifyService));
    const admins = users.users.filter(u => !u.isAdmin).map(u => ({ u, cb: chk(s.adminUserIds.includes(u.id)) }));
    page('הגדרות',
      h('div.card', h('h2', 'התראות להורה'),
        h('div.grid2', h('label.f', h('span', 'המכשיר של ההורה'), I.service)),
        h('div.checks', { style: { flexDirection: 'column', marginTop: '10px' } },
          h('label', I.done, 'דיווח מיד כשילד מסיים את התרגול היומי'),
          h('label', I.ready, 'הודעה בסוף ימי הכפולה לבד: לפתוח כפולה חדשה, או שתתחיל חזרה'),
          h('label', I.unlock, 'הודעה לילד כשנפתחת לו כפולה חדשה'),
          h('label', I.sum, 'סיכום יומי: מי תרגל ומי לא')),
        h('div.grid2', { style: { marginTop: '10px' } }, h('label.f', h('span', 'שעת הסיכום היומי (וגם הקנס, אם הוגדר)'), I.sumTime)),
        h('button.btn', { style: { marginTop: '10px' }, onclick: (e) => KF.busy(e.currentTarget, async () => { const r = await KF.post('settings/test-admin-notify', { service: I.service.value }); KF.toast(r.ok ? 'נשלחה ✓' : 'נכשלה: ' + r.error, !r.ok); }) }, '🔔 התראת בדיקה')),
      h('div.card', h('h2', 'התרגול'),
        h('div.grid3',
          h('label.f', h('span', 'שאלות בתרגול'), I.questions),
          h('label.f', h('span', 'ימים על כפולה חדשה לבד (אחרי יום הלימוד)'), I.soloDays),
          h('label.f', h('span', 'בחזרה: כמה כפולות לכל היותר בתרגול'), I.mixMax)),
        h('p.small.muted', 'סדר הימים בכל כפולה חדשה: יום לימוד + שאלות, אחר כך ימים על הכפולה לבד, ואז — עד שתפתחו כפולה חדשה — חזרה על כל הכפולות שנלמדו. בסוף ימי הכפולה לבד תגיע אליכם הודעה. הימים נספרים לפי תרגולים שהושלמו, כך שיום שהוחמץ לא "נשרף".'),
        h('p.small.muted', 'כדי לא להעמיס, התרגול באותו אורך בכל השלבים. בחזרה נבחרות בכל יום עד כמה כפולות (קודם החלשות, ואז אלה שלא חזרו עליהן הכי הרבה זמן), כך שכולן חוזרות לאורך הימים. שאלה שנענתה לא נכון חוזרת בסוף התרגול, ולא נספרת שוב בציון.')),
      admins.length ? h('div.card', h('h2', 'הורים נוספים'),
        h('p.small.muted', 'מנהלי Home Assistant מזוהים כהורים אוטומטית. כאן אפשר להוסיף משתמשים שאינם מנהלים.'),
        h('div.checks', admins.map(x => h('label', x.cb, x.u.name)))) : null,
      h('button.btn.primary', { onclick: (e) => KF.busy(e.currentTarget, async () => {
        await KF.put('settings', {
          adminNotifyService: I.service.value, questions: +I.questions.value, soloDays: +I.soloDays.value, mixMaxTables: +I.mixMax.value,
          notifyAdminSessionDone: I.done.checked, notifyAdminReady: I.ready.checked, notifyChildOnUnlock: I.unlock.checked,
          notifyAdminDaySummary: I.sum.checked, summaryTime: I.sumTime.value,
          adminUserIds: [...s.adminUserIds.filter(id => !admins.some(x => x.u.id === id)), ...admins.filter(x => x.cb.checked).map(x => x.u.id)]
        });
        KF.toast('נשמר ✓');
      }) }, 'שמירה'),
      h('p.small.muted', { style: { marginTop: '14px' } }, `חיבור ל-HA: ${d.status.ha.connected ? 'מחובר' : 'לא מחובר'} · קישור בהתראות: ${d.status.panelUrl || '(לא נקבע)'}`));
  }
})();
