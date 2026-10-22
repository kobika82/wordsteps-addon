'use strict';
// ממשק המנהל: לוח בקרה, ילדים, שיעורים ואישור, מאגר מילים, דוחות, הגדרות.
(function () {
  const h = WS.h, en = WS.en;
  const Admin = WS.Admin = {};
  let M; // meta: levels, topics, statusHe
  const DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const EX_HE = { mc: 'בחירת תרגום', match: 'התאמת מילים', cloze: 'השלמת משפט', type: 'כתיבת מילה' };
  const LESSON_ST = {
    pending: ['ממתין לאישור', 'warn'], approved: ['מאושר', 'ok'], in_progress: ['בתהליך', 'info'],
    completed: ['הושלם', 'brand'], missed: ['הוחמץ', ''], none: ['אין שיעור', 'bad'], off: ['לא יום לימוד', '']
  };
  const WORD_ST = { draft: ['טיוטה', 'warn'], approved: ['מאושרת', 'ok'] };
  const PROG_CLS = { new: '', learning: 'info', needs_reinforcement: 'warn', familiar: 'brand', mastered: 'ok' };
  const badge = (map, k) => { const [t, c] = map[k] || [k, '']; return h('span.badge' + (c ? '.' + c : ''), t); };
  const progBadge = st => h('span.badge' + (PROG_CLS[st] ? '.' + PROG_CLS[st] : ''), M.statusHe[st] || st);

  const NAV = [['#/', 'לוח בקרה'], ['#/children', 'ילדים'], ['#/lessons', 'שיעורים'], ['#/words', 'מאגר מילים'], ['#/reports', 'דוחות'], ['#/settings', 'הגדרות']];
  function page(title, ...content) {
    document.body.classList.remove('kid');
    document.body.classList.add('admin');
    const cur = '#' + (location.hash.replace(/^#/, '').split('?')[0].split('/').slice(0, 2).join('/') || '/');
    const nav = h('nav', NAV.map(([href, t]) => h('a' + (cur === href || (href !== '#/' && cur.startsWith(href.replace(/s$/, ''))) ? '.on' : ''), { href }, t)));
    WS.mount(
      h('header.top', h('div.top-in', h('div.brand', '📚 WordSteps', h('span.badge.brand', 'ניהול')), nav)),
      h('main', title ? h('h1', title) : null, ...content));
  }

  Admin.init = function () {
    M = WS.me.meta;
    WS.route('/', dashboard);
    WS.route('/children', children);
    WS.route('/child/:id', childPage);
    WS.route('/lessons', lessons);
    WS.route('/lesson/:id', lessonPage);
    WS.route('/words', words);
    WS.route('/reports', () => reports());
    WS.route('/reports/:id', reports);
    WS.route('/settings', settings);
  };

  // ---------------- לוח בקרה ----------------
  async function dashboard() {
    const d = await WS.get('dashboard');
    const alerts = [];
    if (!d.status.gemini.configured) alerts.push(h('div.alert.warn', '⚠️', h('div', 'Gemini לא מוגדר — לא תתבצע הצעת מילים אוטומטית. אפשר להוסיף מילים ידנית, או להזין מפתח API בהגדרות התוסף ב-Home Assistant.')));
    if (!d.status.ha.connected) alerts.push(h('div.alert.warn', '⚠️', h('div', 'אין חיבור ל-Home Assistant — התראות לא יישלחו.')));
    for (const n of d.notices) {
      alerts.push(h('div.alert.info', 'ℹ️', h('div.grow', n.text, h('div.small.muted', WS.fmtTime(n.at))),
        h('button.btn.sm.ghost', { onclick: async (e) => { await WS.post(`notices/${n.id}/dismiss`); e.target.closest('.alert').remove(); } }, 'הסתרה')));
    }
    const pendingCard = h('div.card',
      h('div.row', h('h2.grow', `ממתינים לאישור (${d.pending.length})`),
        h('button.btn', { onclick: (e) => WS.busy(e.currentTarget, async () => { const r = await WS.post('lessons/prepare', { days: 1 }); WS.toast(r.created ? `הוכנו ${r.created} שיעורים` : 'שיעורי המחר כבר קיימים'); dashboard(); }) }, '🪄 הכנת שיעורי מחר'),
        d.pending.length ? h('button.btn.primary', { onclick: () => WS.go('#/lessons?pending') }, `✔ לאישור שיעורי מחר (${d.tomorrowPending})`) : null),
      d.pending.length ? h('div.table-wrap', h('table.t',
        h('tr', h('th', 'תאריך'), h('th', 'ילד'), h('th', 'מילים מאושרות')),
        d.pending.map(p => h('tr.click', { onclick: () => WS.go('#/lesson/' + p.id) },
          h('td', WS.fmtDate(p.date)), h('td', p.childName), h('td', `${p.approvedItems}/${p.items}`)))))
        : h('p.muted', 'אין שיעורים שממתינים לאישור.'));
    const kids = h('div.card', h('h2', 'הילדים היום'),
      d.children.length ? h('div.table-wrap', h('table.t',
        h('tr', h('th', 'שם'), h('th', 'השיעור היום'), h('th', 'מילים שנלמדו'), h('th', 'נלמדו היטב'), h('th', 'דורשות חיזוק'), h('th', 'הצלחה (7 ימים)'), h('th', 'התראה אחרונה')),
        d.children.map(c => h('tr.click', { onclick: () => WS.go('#/child/' + c.id) },
          h('td', h('b', c.name), c.active ? null : h('span.badge', ' מושהה')),
          h('td', badge(LESSON_ST, c.todayStatus)),
          h('td', String(c.learned)), h('td', String(c.status.mastered || 0)), h('td', String(c.status.needs_reinforcement || 0)),
          h('td', c.weekAccuracy == null ? '—' : c.weekAccuracy + '%'),
          h('td', c.lastNotification ? h('span.badge' + (c.lastNotification.ok ? '.ok' : '.bad'), (c.lastNotification.ok ? 'נשלחה ' : 'נכשלה ') + WS.fmtTime(c.lastNotification.at)) : '—')))))
        : h('p', 'עוד אין ילדים. ', h('a', { href: '#/child/new' }, 'יצירת פרופיל ראשון')));
    const hard = d.children.filter(c => c.hard.length);
    const hardCard = hard.length ? h('div.card', h('h2', '⚠️ מילים קשות'),
      hard.map(c => h('div', { style: { marginBottom: '8px' } }, h('b', c.name + ': '),
        h('span.chips', c.hard.map(w => h('span.chip', en(w.en), ` — ${w.he} (${w.wrong} טעויות)`)))))) : null;
    page('לוח בקרה', ...alerts, pendingCard, kids, hardCard,
      h('p.small.muted', `מאגר המילים: ${d.bank.total} מילים, ${d.bank.approved} מאושרות. אזור זמן: ${d.status.timeZone}.`));
  }

  // ---------------- ילדים ----------------
  async function children() {
    const list = await WS.get('children');
    page('ילדים',
      h('div.row', { style: { marginBottom: '12px' } }, h('button.btn.primary', { onclick: () => WS.go('#/child/new') }, '+ ילד חדש')),
      list.length ? h('div.grid2', list.map(c => h('div.card', { style: { cursor: 'pointer' }, onclick: () => WS.go('#/child/' + c.id) },
        h('div.row', h('h2.grow', c.name), c.active ? h('span.badge.ok', 'פעיל') : h('span.badge', 'מושהה')),
        h('div.muted', `גיל ${c.age} · רמה ${M.levels[c.level]}`),
        h('div.muted', `${c.newPerDay} מילים חדשות + ${c.reviewPerDay} לחזרה ביום`),
        h('div.muted', `התראה ${c.notifyTime} · ימים: ${c.days.map(d => DAYS[d]).join(' ')}`),
        h('div.small', c.haUserId ? '✓ משויך למשתמש Home Assistant' : h('span', { style: { color: 'var(--bad)' } }, 'לא משויך למשתמש')),
        h('div.small', c.notifyService ? `📱 ${c.notifyService.replace('mobile_app_', '')}` : 'ללא מכשיר להתראות')))) : h('p.muted', 'עוד אין ילדים.'));
  }

  function field(label, input, hint) { return h('label.f', h('span', label), input, hint ? h('span.small', hint) : null); }
  function checks(options, selected, name) {
    return h('div.checks', options.map(([v, t]) => h('label', h('input', { type: 'checkbox', name, value: v, checked: selected.includes(v) }), t)));
  }
  const checked = (root, name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);

  async function childPage(id) {
    const isNew = id === 'new';
    const [c, usersR, servR] = await Promise.all([
      isNew ? null : WS.get('children').then(l => l.find(x => String(x.id) === id)),
      WS.get('ha/users'), WS.get('ha/services')
    ]);
    if (!isNew && !c) throw new Error('הילד לא נמצא');
    const v = c || { name: '', age: 9, gender: '', level: 'beginner', newPerDay: 5, reviewPerDay: 7, notifyTime: '16:00', days: [0, 1, 2, 3, 4], haUserId: '', notifyService: '', active: true, topics: [], exerciseTypes: ['mc', 'match'], reminderEnabled: false, reminderAfterMin: 120 };
    const I = {
      name: h('input', { type: 'text', value: v.name, maxlength: 40 }),
      age: h('input', { type: 'number', value: v.age, min: 3, max: 18 }),
      gender: h('select', [['', 'לא צוין'], ['f', 'בת'], ['m', 'בן']].map(([k, t]) => h('option', { value: k, selected: v.gender === k }, t))),
      level: h('select', Object.entries(M.levels).map(([k, t]) => h('option', { value: k, selected: v.level === k }, t))),
      active: h('input', { type: 'checkbox', checked: v.active }),
      newPerDay: h('input', { type: 'number', value: v.newPerDay, min: 0, max: 20 }),
      reviewPerDay: h('input', { type: 'number', value: v.reviewPerDay, min: 0, max: 40 }),
      notifyTime: h('input', { type: 'time', value: v.notifyTime }),
      haUserId: h('select', h('option', { value: '' }, '— לא משויך —'),
        usersR.users.filter(u => !u.isAdmin || u.id === v.haUserId).map(u => h('option', { value: u.id, selected: v.haUserId === u.id }, u.name + (u.source === 'seen' ? ' (נכנס לאפליקציה)' : '')))),
      notifyService: h('select', h('option', { value: '' }, '— ללא —'),
        [...new Set([...servR.services, v.notifyService].filter(Boolean))].map(s => h('option', { value: s, selected: v.notifyService === s }, s.replace('mobile_app_', '')))),
      reminderEnabled: h('input', { type: 'checkbox', checked: v.reminderEnabled }),
      reminderAfterMin: h('input', { type: 'number', value: v.reminderAfterMin, min: 15, max: 720 })
    };
    const days = checks(DAYS.map((d, i) => [String(i), d]), v.days.map(String), 'days');
    const topics = checks(Object.entries(M.topics), v.topics, 'topics');
    const exTypes = checks(Object.entries(EX_HE), v.exerciseTypes, 'ex');
    const form = h('div',
      h('div.card', h('h2', 'פרטי הילד'), h('div.grid3',
        field('שם תצוגה', I.name), field('גיל', I.age), field('מגדר (לניסוח ההודעות)', I.gender), field('רמת אנגלית', I.level)),
        h('label.checks', { style: { marginTop: '10px' } }, I.active, ' פעיל (כשמושהה — אין שיעורים והתראות)')),
      h('div.card', h('h2', 'תוכנית הלימוד'),
        h('div.grid3', field('מילים חדשות ביום', I.newPerDay), field('מילים לחזרה ביום', I.reviewPerDay)),
        h('h3', { style: { marginTop: '12px' } }, 'ימי לימוד'), days,
        h('h3', { style: { marginTop: '12px' } }, 'נושאים (ריק = כל הנושאים)'), topics,
        h('h3', { style: { marginTop: '12px' } }, 'סוגי תרגילים מותרים'), exTypes,
        h('p.small.muted', 'שינויים משפיעים על שיעורים עתידיים בלבד. שיעור שכבר הוכן וממתין לאישור אפשר להכין מחדש ממסך השיעור.')),
      h('div.card', h('h2', 'כניסה והתראות'),
        h('div.grid2',
          field('משתמש Home Assistant של הילד', I.haUserId, usersR.error ? 'לא ניתן לקרוא את רשימת המשתמשים מ-HA: ' + usersR.error + '. מוצגים משתמשים שכבר נכנסו לאפליקציה.' : 'הילד נכנס דרך אפליקציית Home Assistant שלו — בלי סיסמה נוספת.'),
          field('מכשיר להתראות', I.notifyService, servR.error || 'שירות notify של אפליקציית HA באייפון של הילד.'),
          field('שעת ההתראה היומית', I.notifyTime)),
        h('div.row', { style: { marginTop: '10px' } }, h('label.checks', I.reminderEnabled, ' תזכורת נוספת אם השיעור לא הושלם, אחרי'), h('div', { style: { width: '90px' } }, I.reminderAfterMin), 'דקות'),
        isNew ? null : h('div.row', { style: { marginTop: '12px' } },
          h('button.btn', { onclick: (e) => WS.busy(e.currentTarget, async () => {
            const r = await WS.post(`children/${c.id}/test-notify`, { service: I.notifyService.value });
            r.ok ? WS.toast('התראת הבדיקה נשלחה ✓') : WS.toast('השליחה נכשלה: ' + r.error, true);
            loadNotifs();
          }) }, '📨 שליחת התראת בדיקה')),
        isNew ? null : h('div#notifs', { style: { marginTop: '10px' } })));

    const save = h('button.btn.primary', { onclick: (e) => WS.busy(e.currentTarget, async () => {
      const body = {
        name: I.name.value, age: I.age.value, gender: I.gender.value, level: I.level.value, active: I.active.checked,
        newPerDay: I.newPerDay.value, reviewPerDay: I.reviewPerDay.value, notifyTime: I.notifyTime.value,
        haUserId: I.haUserId.value, notifyService: I.notifyService.value,
        reminderEnabled: I.reminderEnabled.checked, reminderAfterMin: I.reminderAfterMin.value,
        days: checked(form, 'days').map(Number), topics: checked(form, 'topics'), exerciseTypes: checked(form, 'ex')
      };
      if (!body.exerciseTypes.length) throw new Error('יש לבחור לפחות סוג תרגיל אחד');
      const r = isNew ? await WS.post('children', body) : await WS.put('children/' + c.id, body);
      WS.toast('נשמר ✓');
      if (isNew) WS.go('#/child/' + r.id);
    }) }, 'שמירה');
    const del = isNew ? null : h('button.btn.danger', { onclick: async () => {
      const typed = prompt(`מחיקת הפרופיל של ${c.name} תמחק גם את כל נתוני הלמידה שלו, ללא אפשרות שחזור.\nכדי לאשר, הקלידו את השם:`);
      if (typed == null) return;
      if (typed.trim() !== c.name) return WS.toast('השם לא תאם — לא נמחק', true);
      try { await WS.del('children/' + c.id); WS.toast('הפרופיל נמחק'); WS.go('#/children'); } catch (e) { WS.fail(e); }
    } }, 'מחיקת הפרופיל');

    const extra = isNew ? [] : [h('div.card#kidwords', h('div.loading', 'טוען מילים…'))];
    page(isNew ? 'ילד חדש' : c.name,
      isNew ? null : h('div.row', { style: { marginBottom: '12px' } },
        h('a.btn', { href: '#/reports/' + c.id }, '📊 דוח התקדמות'), h('a.btn', { href: '#/lessons?child=' + c.id }, '📅 שיעורים')),
      form, h('div.row', save, h('div.grow'), del), ...extra);

    async function loadNotifs() {
      const box = document.getElementById('notifs');
      if (!box) return;
      const list = await WS.get('notifications?childId=' + c.id);
      box.innerHTML = '';
      box.appendChild(list.length ? h('div.table-wrap', h('table.t', h('tr', h('th', 'מתי'), h('th', 'סוג'), h('th', 'סטטוס')),
        list.slice(0, 8).map(n => h('tr', h('td', WS.fmtTime(n.at)), h('td', { daily: 'יומית', reminder: 'תזכורת', test: 'בדיקה' }[n.kind] || n.kind),
          h('td', n.ok ? h('span.badge.ok', 'נשלחה') : h('span.badge.bad', 'נכשלה: ' + n.error)))))) : h('p.small.muted', 'עוד לא נשלחו התראות.'));
    }
    if (!isNew) {
      loadNotifs().catch(() => {});
      const ws = await WS.get(`children/${c.id}/words`);
      const box = document.getElementById('kidwords');
      box.innerHTML = '';
      box.append(h('h2', `מילים שנלמדו (${ws.length})`),
        ws.length ? h('div.table-wrap', h('table.t',
          h('tr', h('th', 'מילה'), h('th', 'תרגום'), h('th', 'מצב'), h('th', 'נכון/שגוי'), h('th', 'חזרה הבאה')),
          ws.map(w => h('tr', h('td', en(w.en)), h('td', w.he), h('td', progBadge(w.status)), h('td', `${w.correct}/${w.wrong}`), h('td', WS.fmtDate(w.due))))))
          : h('p.muted', 'עוד לא נלמדו מילים.'));
    }
  }

  // ---------------- שיעורים ----------------
  async function lessons() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const kids = await WS.get('children');
    const fStatus = h('select', [['', 'כל הסטטוסים'], ...Object.entries(LESSON_ST).filter(([k]) => !['none', 'off'].includes(k)).map(([k, v]) => [k, v[0]])]
      .map(([k, t]) => h('option', { value: k, selected: (q.has('pending') && k === 'pending') || q.get('status') === k }, t)));
    const fChild = h('select', h('option', { value: '' }, 'כל הילדים'), kids.map(c => h('option', { value: c.id, selected: q.get('child') === String(c.id) }, c.name)));
    const daysSel = h('select', [1, 2, 3, 5, 7].map(n => h('option', { value: n }, n === 1 ? 'יום אחד' : `${n} ימים`)));
    const list = h('div');
    const bulk = h('button.btn.ok', { disabled: true }, '✔ אישור השיעורים שסומנו');
    async function load() {
      const p = new URLSearchParams();
      if (fStatus.value) p.set('status', fStatus.value);
      if (fChild.value) p.set('childId', fChild.value);
      const rows = await WS.get('lessons?' + p);
      list.innerHTML = '';
      const all = h('input', { type: 'checkbox', title: 'סימון הכול', onchange: () => { list.querySelectorAll('input[data-id]').forEach(x => (x.checked = all.checked)); upd(); } });
      const upd = () => { const n = list.querySelectorAll('input[data-id]:checked').length; bulk.disabled = !n; bulk.textContent = n ? `✔ אישור ${n} שיעורים שסומנו` : '✔ אישור השיעורים שסומנו'; };
      list.appendChild(rows.length ? h('div.table-wrap', h('table.t',
        h('tr', h('th', all), h('th', 'תאריך'), h('th', 'ילד'), h('th', 'סטטוס'), h('th', 'מילים חדשות'), h('th', 'הצלחה'), h('th', '')),
        rows.map(r => h('tr.click', { onclick: (e) => { if (e.target.tagName !== 'INPUT') WS.go('#/lesson/' + r.id); } },
          h('td', r.status === 'pending' ? h('input', { type: 'checkbox', 'data-id': r.id, onchange: upd }) : null),
          h('td', WS.fmtDate(r.date)), h('td', r.childName), h('td', badge(LESSON_ST, r.status)),
          h('td', r.status === 'pending' ? `${r.approvedItems}/${r.items} מאושרות` : String(r.items)),
          h('td', r.pct == null ? '' : r.pct + '%'),
          h('td', r.warnings.length ? h('span.badge.warn', { title: r.warnings.join('\n') }, '⚠️ ' + r.warnings.length) : null)))))
        : h('p.muted', 'אין שיעורים בסינון הזה.'));
      upd();
    }
    bulk.onclick = () => WS.busy(bulk, async () => {
      const ids = [...list.querySelectorAll('input[data-id]:checked')].map(x => Number(x.dataset.id));
      const r = await WS.post('lessons/approve', { ids });
      const bad = r.results.filter(x => !x.ok);
      WS.toast(`אושרו ${r.results.length - bad.length} שיעורים`);
      if (bad.length) WS.toast(bad.map(b => b.error).join(' | '), true);
      load();
    });
    fStatus.onchange = load; fChild.onchange = load;
    page('שיעורים',
      h('div.card', h('div.row',
        h('span', 'הכנת שיעורים מראש החל ממחר, ל-'), h('div', { style: { width: '130px' } }, daysSel),
        h('button.btn.primary', { onclick: (e) => WS.busy(e.currentTarget, async () => {
          const r = await WS.post('lessons/prepare', { days: Number(daysSel.value), childId: fChild.value || undefined });
          WS.toast(r.created ? `הוכנו ${r.created} שיעורים חדשים` : 'לא נדרשו שיעורים חדשים (כבר קיימים או שאין ימי לימוד)');
          load();
        }) }, '🪄 הכנה')),
        h('p.small.muted', 'שיעור לא יוצג לילד עד שתאשרו אותו. מילים לחזרה נבחרות מתוכן שכבר אושר.')),
      h('div.row', { style: { marginBottom: '10px' } }, h('div', { style: { width: '170px' } }, fStatus), h('div', { style: { width: '170px' } }, fChild), h('div.grow'), bulk),
      list);
    await load();
  }

  // עורך שדות התוכן של מילה (משמש בשיעור ובמאגר)
  function contentFields(c, onChange) {
    const mk = (k, label, opts = {}) => {
      const val = Array.isArray(c[k]) ? c[k].join(', ') : (c[k] || '');
      const inp = h(opts.area ? 'textarea' : 'input', { type: 'text', value: val, dir: opts.ltr ? 'ltr' : 'rtl', rows: 2 });
      inp.addEventListener('input', () => onChange(k, opts.list ? inp.value.split(',').map(s => s.trim()).filter(Boolean) : inp.value));
      return field(label, inp, opts.hint);
    };
    return h('div.fields',
      mk('en', 'מילה באנגלית', { ltr: true }), mk('he', 'תרגום לעברית'),
      mk('exampleEn', 'משפט דוגמה', { ltr: true, area: true }), mk('exampleHe', 'תרגום המשפט', { area: true }),
      mk('clozeEn', 'משפט השלמה (עם ___)', { ltr: true, area: true }), mk('clozeHe', 'תרגום משפט ההשלמה', { area: true }),
      mk('distractorsHe', 'תשובות שגויות בעברית (מופרדות בפסיק)', { list: true }),
      mk('distractorsEn', 'תשובות שגויות באנגלית (מופרדות בפסיק)', { list: true, ltr: true }),
      mk('emoji', 'אימוג׳י (כשאין תמונה)'));
  }

  function exercisePreview(c, types) {
    const opt = (o, right) => h('span.chip', { class: right ? 'chip right' : 'chip' }, right ? '✓ ' : '', o);
    return h('div.ex',
      h('div', h('b', 'בחירת תרגום: '), 'מה הפירוש של ', en(c.en || '?'), '? ',
        h('span.chips', { style: { display: 'inline-flex' } }, [c.he, ...(c.distractorsHe || [])].map((o, i) => opt(o, i === 0)))),
      types.includes('cloze') ? h('div', { style: { marginTop: '6px' } }, h('b', 'השלמת משפט: '), en(c.clozeEn || '—'), ' ',
        h('span.chips', { style: { display: 'inline-flex' } }, [c.en, ...(c.distractorsEn || [])].map((o, i) => opt(h('span.en', o), i === 0)))) : null,
      types.includes('type') ? h('div', { style: { marginTop: '6px' } }, h('b', 'כתיבה: '), `"${c.he}" ← `, en(c.en)) : null);
  }

  // בחירת תמונה: חיפוש, יצירה ב-Gemini, העלאה
  async function imageSearch(query, onPick) {
    const qi = h('input', { type: 'search', value: query, dir: 'ltr' });
    const res = h('div.imgresults');
    let source = 'arasaac';
    const tabs = h('div.row', { style: { marginTop: '8px' } });
    const drawTabs = () => {
      tabs.innerHTML = '';
      for (const [k, t] of [['arasaac', '🎨 איורים (ARASAAC)'], ['openverse', '📷 תמונות (Openverse)']]) {
        tabs.appendChild(h('button.btn.sm' + (source === k ? '.primary' : ''), { onclick: () => { source = k; drawTabs(); run(); } }, t));
      }
    };
    const run = async () => {
      res.innerHTML = '<div class="muted">מחפש…</div>';
      try {
        const r = await WS.get(`images/search?source=${source}&q=` + encodeURIComponent(qi.value));
        res.innerHTML = '';
        if (!r.results.length) res.appendChild(h('div.muted', 'לא נמצאו תמונות.'));
        r.results.forEach(x => res.appendChild(h('button', { title: x.credit, onclick: async (e) => {
          e.currentTarget.style.opacity = .5;
          try { const im = await WS.post('images/import', { id: x.id, credit: x.credit }); m.close(); onPick(im); } catch (er) { WS.fail(er); }
        } }, h('img', { src: x.thumb, alt: x.title, loading: 'lazy', referrerpolicy: 'no-referrer' }))));
      } catch (e) { res.innerHTML = ''; res.appendChild(h('div.alert.bad', e.message)); }
    };
    qi.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    const m = WS.modal('חיפוש תמונה', h('div', h('div.row', h('div.grow', qi), h('button.btn.primary', { onclick: run }, 'חיפוש')), tabs, res,
      h('p.small.muted', 'ARASAAC: איורים ברישיון CC BY-NC-SA (שימוש לא מסחרי). Openverse: תמונות ברישיון פתוח.')), { wide: true });
    drawTabs();
    run();
  }
  async function imageGenerate(c, btn) {
    return WS.busy(btn, async () => {
      const r = await WS.post('images/generate', { en: c.en, he: c.he });
      const small = await WS.shrinkImage(r.dataUrl);
      return WS.post('images/upload', { dataUrl: small, credit: 'איור Gemini' });
    });
  }
  function imageUpload() {
    return new Promise((resolve) => {
      const f = h('input', { type: 'file', accept: 'image/*' });
      f.onchange = async () => {
        if (!f.files[0]) return resolve(null);
        try {
          const small = await WS.shrinkImage(await WS.readFile(f.files[0]));
          resolve(await WS.post('images/upload', { dataUrl: small, credit: 'הועלתה על ידי המנהל' }));
        } catch (e) { WS.fail(e); resolve(null); }
      };
      f.click();
    });
  }
  function imageBox(c, setImage) {
    return h('div',
      h('div.imgbox', c.image ? h('img', { src: c.image, alt: c.en }) : (c.emoji || h('span.small.muted', 'ללא תמונה'))),
      c.imageCredit ? h('div.small.muted', c.imageCredit) : null,
      h('div.imgtools',
        h('button.btn.sm', { title: 'חיפוש תמונה', onclick: () => imageSearch(c.imageQuery || c.en, setImage) }, '🔍'),
        h('button.btn.sm', { title: 'יצירת איור ב-Gemini', onclick: async (e) => { const r = await imageGenerate(c, e.currentTarget); if (r) setImage(r); } }, '✨'),
        h('button.btn.sm', { title: 'העלאת תמונה', onclick: async () => { const r = await imageUpload(); if (r) setImage(r); } }, '⬆'),
        c.image ? h('button.btn.sm', { title: 'הסרת התמונה', onclick: () => setImage({ image: '', imageCredit: '' }) }, '✕') : null));
  }

  async function lessonPage(id) {
    const L = await WS.get('lessons/' + id);
    renderLesson(L);
  }
  function renderLesson(L) {
    const reload = d => renderLesson(d);
    const act = (btn, fn) => WS.busy(btn, async () => reload(await fn()));
    const items = L.items.map(it => {
      const draft = { ...it.content };
      let dirty = false;
      const saveBtn = h('button.btn.primary.sm', { disabled: true, onclick: (e) => act(e.currentTarget, () => WS.put(`lessons/${L.id}/items/${it.id}`, draft)) }, '💾 שמירה');
      const onChange = (k, v) => { draft[k] = v; dirty = true; saveBtn.disabled = false; };
      const setImage = (im) => WS.put(`lessons/${L.id}/items/${it.id}`, { ...draft, ...im }).then(reload).catch(WS.fail);
      return h('div.card.item' + (it.approved ? '.approved' : ''),
        imageBox(it.content, L.editable ? setImage : () => {}),
        h('div',
          h('div.row', { style: { marginBottom: '8px' } },
            h('h2.grow', en(it.content.en), ' — ', it.content.he, ' ', WS.speakBtn(it.content.en, '.btn.sm')),
            it.approved ? h('span.badge.ok', '✓ מאושרת') : h('span.badge.warn', 'ממתינה לאישור'),
            it.bankStatus === 'draft' ? h('span.badge', 'מילה חדשה במאגר') : null),
          it.missing.length ? h('div.alert.bad', 'חסר: ' + it.missing.join(', ')) : null,
          L.editable ? contentFields(it.content, onChange) : null,
          exercisePreview(it.content, L.exerciseTypes),
          L.editable ? h('div.row', { style: { marginTop: '10px' } },
            saveBtn,
            !it.approved ? h('button.btn.ok.sm', { onclick: (e) => act(e.currentTarget, async () => {
              if (dirty) await WS.put(`lessons/${L.id}/items/${it.id}`, draft);
              return WS.post(`lessons/${L.id}/items/${it.id}/approve`);
            }) }, '✓ אישור מילה') : null,
            h('button.btn.sm', { onclick: (e) => act(e.currentTarget, () => WS.post(`lessons/${L.id}/items/${it.id}/autofill`)) }, '✨ השלמה מחדש ב-Gemini'),
            h('button.btn.sm', { onclick: (e) => act(e.currentTarget, () => WS.post(`lessons/${L.id}/items/${it.id}/replace`, {})) }, '🔄 החלפת מילה'),
            h('div.grow'),
            h('button.btn.danger.sm', { onclick: (e) => { if (confirm(`להסיר את "${it.content.en}" מהשיעור?`)) act(e.currentTarget, () => WS.del(`lessons/${L.id}/items/${it.id}`)); } }, 'הסרה')) : null));
    });

    const addIn = h('input', { type: 'text', dir: 'ltr', placeholder: 'מילה באנגלית', list: 'bankwords' });
    const dl = h('datalist#bankwords');
    WS.get('words').then(ws => ws.forEach(w => dl.appendChild(h('option', { value: w.en }, w.he)))).catch(() => {});
    const addBox = L.editable ? h('div.card', h('h3', 'הוספת מילה לשיעור'),
      h('div.row', h('div', { style: { width: '220px' } }, addIn), dl,
        h('button.btn', { onclick: (e) => { if (addIn.value.trim()) act(e.currentTarget, () => WS.post(`lessons/${L.id}/items`, { en: addIn.value.trim() })); } }, '+ הוספה')),
      h('p.small.muted', 'מילה מהמאגר תתווסף כפי שהיא; מילה חדשה תושלם ב-Gemini (אם מוגדר) ותחכה לאישור.')) : null;

    const allApproved = L.items.every(i => i.approved);
    page(null,
      h('div.row', { style: { marginBottom: '6px' } },
        h('a.btn.ghost', { href: '#/lessons' }, '→ כל השיעורים'), h('div.grow')),
      h('div.row', h('h1.grow', `שיעור של ${L.childName} · ${WS.fmtDate(L.date)}`), badge(LESSON_ST, L.status)),
      ...L.warnings.map(w => h('div.alert.warn', '⚠️', h('div', w))),
      h('div.card', h('div.row',
        h('div.grow', `${L.items.length} מילים חדשות · ${L.items.filter(i => i.approved).length} מאושרות · ${L.review.length} מילים לחזרה`),
        h('button.btn', { onclick: (e) => WS.busy(e.currentTarget, async () => {
          const v = await WS.post(`lessons/${L.id}/preview`);
          WS.Child.play(v, { preview: true, onExit: () => WS.render() });
        }) }, '👁 תצוגה מקדימה'),
        L.editable ? h('button.btn', { onclick: (e) => { if (confirm('להכין את השיעור מחדש? כל השינויים בשיעור הזה יימחקו.')) act(e.currentTarget, () => WS.post(`lessons/${L.id}/regenerate`)); } }, '🪄 הכנה מחדש') : null,
        L.editable && L.status !== 'approved' ? h('button.btn.ok', { onclick: (e) => act(e.currentTarget, () => WS.post(`lessons/${L.id}/approve`)) }, allApproved ? '✔ אישור השיעור' : '✔ אישור כל המילים והשיעור') : null),
        L.status === 'approved' ? h('p.small.muted', 'השיעור מאושר ויוצג לילד בתאריך שלו. שינוי בפריט יחזיר אותו לאישור.') : null,
        !L.editable ? h('p.small.muted', 'השיעור כבר התחיל או הושלם — התוכן נעול.') : null),
      L.summary ? h('div.card', h('h2', 'תוצאות'), h('div', `${L.summary.correct}/${L.summary.total} תשובות נכונות (${L.summary.pct}%)`),
        L.summary.weak.length ? h('div', 'מילים לחיזוק: ', L.summary.weak.map(w => w.en).join(', ')) : null) : null,
      ...items,
      addBox,
      h('div.card', h('h2', `מילים לחזרה (${L.review.length})`),
        L.review.length ? h('div.chips', L.review.map(r => h('span.chip', en(r.en), ` — ${r.he} `, progBadge(r.status)))) : h('p.muted', 'אין עדיין מילים לחזרה.'),
        !L.editable ? null : h('p.small.muted', 'כל מילות החזרה כבר אושרו בעבר. הרשימה מתעדכנת ברגע שהילד פותח את השיעור, לפי הביצועים העדכניים שלו.')),
      L.editable ? h('div.row', h('div.grow'), h('button.btn.danger', { onclick: async () => {
        if (!confirm('למחוק את השיעור?')) return;
        try { await WS.del('lessons/' + L.id); WS.go('#/lessons'); } catch (e) { WS.fail(e); }
      } }, 'מחיקת השיעור')) : null);
  }

  // ---------------- מאגר מילים ----------------
  async function words() {
    const q = h('input', { type: 'search', placeholder: 'חיפוש באנגלית או בעברית' });
    const fl = h('select', h('option', { value: '' }, 'כל הרמות'), Object.entries(M.levels).map(([k, t]) => h('option', { value: k }, t)));
    const ft = h('select', h('option', { value: '' }, 'כל הנושאים'), Object.entries(M.topics).map(([k, t]) => h('option', { value: k }, t)));
    const fs = h('select', h('option', { value: '' }, 'כל הסטטוסים'), h('option', { value: 'approved' }, 'מאושרות'), h('option', { value: 'draft' }, 'טיוטות'));
    const list = h('div');
    let timer;
    async function load() {
      const p = new URLSearchParams({ q: q.value, level: fl.value, topic: ft.value, status: fs.value });
      const rows = await WS.get('words?' + p);
      list.innerHTML = '';
      list.appendChild(h('p.small.muted', `${rows.length} מילים`));
      list.appendChild(rows.length ? h('div.table-wrap', h('table.t',
        h('tr', h('th', ''), h('th', 'מילה'), h('th', 'תרגום'), h('th', 'רמה'), h('th', 'נושא'), h('th', 'סטטוס'), h('th', 'נלמדת אצל')),
        rows.map(w => h('tr.click', { onclick: () => editWord(w, load) },
          h('td', w.image ? h('img.thumb', { src: w.image, alt: '' }) : h('span.thumb', w.emoji || '·')),
          h('td', en(w.en)), h('td', w.he), h('td', M.levels[w.level]), h('td', M.topics[w.topic] || ''),
          h('td', badge(WORD_ST, w.status)), h('td', w.usedBy ? `${w.usedBy} ילדים` : ''))))) : h('p.muted', 'אין מילים.'));
    }
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    [fl, ft, fs].forEach(s => (s.onchange = load));
    page('מאגר מילים',
      h('div.row', { style: { marginBottom: '12px' } },
        h('button.btn.primary', { onclick: () => newWord(load) }, '+ מילה חדשה'),
        h('button.btn', { onclick: () => importList(load) }, '📚 ייבוא מרשימה (בלי AI)'),
        h('button.btn', { onclick: () => generate(load) }, '✨ יצירת מילים עם Gemini')),
      h('div.grid3', { style: { marginBottom: '12px' } }, q, fl, ft, fs),
      list);
    await load();
  }

  function newWord(done) {
    const I = {
      en: h('input', { type: 'text', dir: 'ltr' }),
      level: h('select', Object.entries(M.levels).map(([k, t]) => h('option', { value: k }, t))),
      topic: h('select', h('option', { value: '' }, '—'), Object.entries(M.topics).map(([k, t]) => h('option', { value: k }, t))),
      auto: h('select', [['sources', 'איור ותרגום מ-ARASAAC + משפט מ-Tatoeba (בלי AI)'], ['gemini', 'השלמה ב-Gemini (AI)'], ['', 'ללא — אמלא ידנית']].map(([k, t]) => h('option', { value: k }, t)))
    };
    const m = WS.modal('מילה חדשה', h('div',
      h('div.grid3', field('מילה באנגלית', I.en), field('רמה', I.level), field('נושא', I.topic)),
      h('div', { style: { margin: '10px 0' } }, field('השלמת התוכן', I.auto)),
      h('button.btn.primary', { onclick: (e) => WS.busy(e.currentTarget, async () => {
        if (!I.en.value.trim()) throw new Error('יש להקליד מילה');
        const w = await WS.post('words', { en: I.en.value.trim(), level: I.level.value, topic: I.topic.value, autofill: I.auto.value || false });
        m.close(); done(); editWord(w, done);
      }) }, 'הוספה')));
    I.en.focus();
  }

  // ייבוא מרשימת מילים רשמית: איור + תרגום מ-ARASAAC, משפטים מ-Tatoeba
  async function importList(done) {
    const lists = await WS.get('wordlists');
    const POS_HE = { n: 'שם עצם', v: 'פועל', adj: 'תואר', adv: 'תואר הפועל', prep: 'מילת יחס' };
    const sel = new Set();
    const listSel = h('select', lists.map(l => h('option', { value: l.id }, `${l.name} (${l.count})`)));
    const level = h('select', Object.entries(M.levels).map(([k, t]) => h('option', { value: k }, t)));
    const q = h('input', { type: 'search', placeholder: 'סינון', dir: 'ltr' });
    const hideBank = h('input', { type: 'checkbox', checked: true });
    const nextN = h('input', { type: 'number', value: 20, min: 1, max: 100 });
    const grid = h('div.chips', { style: { maxHeight: '320px', overflowY: 'auto', padding: '4px' } });
    const count = h('b');
    const go = h('button.btn.primary', '📥 ייבוא');
    const status = h('div');
    const cur = () => lists.find(l => l.id === listSel.value);
    const visible = () => cur().words.filter(w => (!hideBank.checked || !w.inBank) && (!q.value || w.en.includes(q.value.toLowerCase())));
    const draw = () => {
      grid.innerHTML = '';
      for (const w of visible()) {
        const cb = h('input', { type: 'checkbox', checked: sel.has(w.en), disabled: w.inBank, onchange: () => { cb.checked ? sel.add(w.en) : sel.delete(w.en); count.textContent = sel.size; } });
        grid.appendChild(h('label.chip', { title: [POS_HE[w.pos], w.meaning].filter(Boolean).join(' — '), style: { opacity: w.inBank ? .5 : 1 } }, cb, ' ', en(w.en), w.inBank ? ' ✓' : ''));
      }
      count.textContent = sel.size;
    };
    listSel.onchange = () => { sel.clear(); level.value = cur().level; draw(); };
    q.oninput = draw; hideBank.onchange = draw;
    go.onclick = () => WS.busy(go, async () => {
      if (!sel.size) throw new Error('לא נבחרו מילים');
      const { jobId, total } = await WS.post('import', { listId: listSel.value, level: level.value, words: [...sel] });
      const bar = h('div.pbar', { style: { height: '12px', background: '#eef' } }, h('div', { style: { width: '0%' } }));
      status.innerHTML = '';
      status.append(h('p', `מייבא ${total} מילים — לוקח כ-2 שניות למילה…`), bar);
      let job;
      do {
        await new Promise(r => setTimeout(r, 1200));
        job = await WS.get('import/' + jobId);
        bar.firstChild.style.width = Math.round((job.done / job.total) * 100) + '%';
      } while (!job.finished);
      status.innerHTML = '';
      status.append(
        h('div.alert.' + (job.error ? 'bad' : 'info'), h('div',
          job.error ? 'הייבוא נעצר: ' + job.error : `נוספו ${job.added} מילים למאגר כטיוטות` + (job.skipped.length ? ` (${job.skipped.length} כבר היו במאגר)` : '') + '. ילד יראה אותן רק אחרי אישור.',
          job.notes.length ? h('details', { style: { marginTop: '6px' } }, h('summary', `${job.notes.length} הערות (חסר איור/תרגום/משפט — להשלים באישור)`),
            h('ul.small', job.notes.map(n => h('li', n)))) : null)));
      sel.clear();
      lists.splice(0, lists.length, ...(await WS.get('wordlists')));
      draw(); done();
    });
    WS.modal('ייבוא מרשימת מילים', h('div',
      h('div.grid2', field('רשימה', listSel), field('רמה במאגר', level)),
      h('div.row', { style: { margin: '10px 0' } },
        h('div', { style: { width: '160px' } }, q),
        h('label.checks', hideBank, ' להסתיר מילים שכבר במאגר'),
        h('div.grow'),
        h('span', 'בחירת'), h('div', { style: { width: '70px' } }, nextN),
        h('button.btn.sm', { onclick: () => { let n = Number(nextN.value) || 20; for (const w of visible()) { if (n <= 0) break; if (!w.inBank && !sel.has(w.en)) { sel.add(w.en); n--; } } draw(); } }, 'הבאות')),
      grid,
      h('div.row', { style: { marginTop: '10px' } }, h('span', 'נבחרו: ', count), h('div.grow'), go),
      status,
      h('p.small.muted', 'לכל מילה: איור ותרגום לעברית מ-ARASAAC, ומשפט דוגמה עם תרגום מ-Tatoeba — בלי AI. הכול נכנס כטיוטה לאישורך.')), { wide: true });
    level.value = cur().level;
    draw();
  }

  function generate(done) {
    const I = {
      level: h('select', Object.entries(M.levels).map(([k, t]) => h('option', { value: k }, t))),
      topic: h('select', h('option', { value: '' }, 'מגוון'), Object.entries(M.topics).map(([k, t]) => h('option', { value: k }, t))),
      count: h('input', { type: 'number', value: 10, min: 1, max: 30 })
    };
    const m = WS.modal('יצירת מילים עם Gemini', h('div',
      h('div.grid3', field('רמה', I.level), field('נושא', I.topic), field('כמות', I.count)),
      h('p.small.muted', 'המילים ייכנסו למאגר כטיוטות. ילד יראה אותן רק אחרי שתאשרו אותן בשיעור או במאגר.'),
      h('button.btn.primary', { onclick: (e) => WS.busy(e.currentTarget, async () => {
        const r = await WS.post('words/generate', { level: I.level.value, topic: I.topic.value, count: I.count.value });
        WS.toast(`נוספו ${r.added} מילים`);
        m.close(); done();
      }) }, '✨ יצירה')));
  }

  function editWord(w, done) {
    const draft = { ...w };
    const meta = {
      level: h('select', Object.entries(M.levels).map(([k, t]) => h('option', { value: k, selected: w.level === k }, t))),
      topic: h('select', h('option', { value: '' }, '—'), Object.entries(M.topics).map(([k, t]) => h('option', { value: k, selected: w.topic === k }, t))),
      difficulty: h('input', { type: 'number', min: 1, max: 10, value: w.difficulty })
    };
    const save = async (extra = {}) => {
      const r = await WS.put('words/' + w.id, { ...draft, level: meta.level.value, topic: meta.topic.value, difficulty: meta.difficulty.value, ...extra });
      done(); return r;
    };
    const setImage = async (im) => { Object.assign(draft, im); try { const r = await save(); m.close(); editWord(r, done); } catch (e) { WS.fail(e); } };
    const m = WS.modal(`${w.en} — ${w.he}`, h('div',
      h('div.item', { style: { border: 0, padding: 0 } }, imageBox(w, setImage), h('div',
        h('div.row', badge(WORD_ST, w.status), w.usedBy ? h('span.badge.info', `נלמדת אצל ${w.usedBy} ילדים`) : null),
        h('div.grid3', { style: { margin: '10px 0' } }, field('רמה', meta.level), field('נושא', meta.topic), field('קושי (1-10)', meta.difficulty)),
        contentFields(w, (k, v) => { draft[k] = v; }))),
      h('div.row', { style: { marginTop: '14px' } },
        h('button.btn.primary', { onclick: (e) => WS.busy(e.currentTarget, async () => { await save(); WS.toast('נשמר ✓'); m.close(); }) }, 'שמירה'),
        w.status !== 'approved' ? h('button.btn.ok', { onclick: (e) => WS.busy(e.currentTarget, async () => { await save({ status: 'approved' }); WS.toast('המילה אושרה ✓'); m.close(); }) }, '✓ שמירה ואישור') : null,
        h('button.btn', { onclick: (e) => WS.busy(e.currentTarget, async () => { const r = await WS.post(`words/${w.id}/autofill`); done(); m.close(); editWord(r, done); }) }, '✨ השלמה ב-Gemini'),
        h('div.grow'),
        h('button.btn.danger', { onclick: async () => {
          if (!confirm(`למחוק את "${w.en}" מהמאגר?` + (w.usedBy ? ' נתוני הלמידה של המילה אצל הילדים יימחקו.' : ''))) return;
          try { await WS.del('words/' + w.id); m.close(); done(); } catch (e) { WS.fail(e); }
        } }, 'מחיקה'))), { wide: true });
  }

  // ---------------- דוחות ----------------
  async function reports(id) {
    const kids = await WS.get('children');
    if (!kids.length) return page('דוחות', h('p.muted', 'עוד אין ילדים.'));
    const cid = id || String(kids[0].id);
    const sel = h('select', kids.map(c => h('option', { value: c.id, selected: String(c.id) === cid }, c.name)));
    sel.onchange = () => WS.go('#/reports/' + sel.value);
    const today = M.today;
    const shift = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
    const from = h('input', { type: 'date', value: shift(today, -6) });
    const to = h('input', { type: 'date', value: today });
    const out = h('div');
    const load = async () => {
      out.innerHTML = '<div class="loading">טוען…</div>';
      try { renderReport(out, await WS.get(`reports/${cid}?from=${from.value}&to=${to.value}`)); } catch (e) { out.innerHTML = ''; out.appendChild(h('div.alert.bad', e.message)); }
    };
    const preset = (n) => () => { from.value = shift(today, -(n - 1)); to.value = today; load(); };
    from.onchange = load; to.onchange = load;
    page('דוחות התקדמות',
      h('div.card', h('div.row',
        h('div', { style: { width: '160px' } }, sel),
        h('button.btn', { onclick: preset(7) }, 'שבוע'), h('button.btn', { onclick: preset(30) }, 'חודש'), h('button.btn', { onclick: preset(90) }, '3 חודשים'),
        h('span.muted', 'או טווח:'), h('div', { style: { width: '150px' } }, from), h('span', '–'), h('div', { style: { width: '150px' } }, to))),
      out);
    load();
  }

  function renderReport(out, r) {
    out.innerHTML = '';
    const stat = (v, k) => h('div.stat', h('div.v', v), h('div.k', k));
    out.append(
      h('div.grid3', { style: { marginBottom: '14px' } },
        stat(r.newWordsLearned, 'מילים חדשות שנלמדו בתקופה'),
        stat(r.accuracy.pct == null ? '—' : r.accuracy.pct + '%', `אחוז הצלחה (${r.accuracy.correct}/${r.accuracy.total})`),
        stat(r.studyDays, 'ימי למידה'),
        stat(`${r.lessonsCompleted} / ${r.lessonsMissed}`, 'שיעורים שהושלמו / הוחמצו'),
        stat(r.status.mastered || 0, 'נלמדו היטב (סה״כ)'),
        stat(r.status.needs_reinforcement || 0, 'דורשות חיזוק (כעת)'),
        stat(r.learnedTotal, 'סה״כ מילים שנלמדו')),
      h('div.card', h('h2', 'מגמה יומית'), chart(r.days), h('p.small.muted', 'עמודות: אחוז הצלחה ביום (תשובות ראשונות). מספר מעל העמודה: מילים חדשות באותו יום.')),
      h('div.card', h('h2', 'מצב המילים'), h('div.chips', Object.entries(r.status).map(([k, v]) => h('span.chip', progBadge(k), ' ', String(v))))),
      h('div.card', h('h2', 'מילים שהילד מתקשה בהן'),
        r.hard.length ? h('div.table-wrap', h('table.t', h('tr', h('th', 'מילה'), h('th', 'תרגום'), h('th', 'טעויות בתקופה'), h('th', 'מצב')),
          r.hard.map(w => h('tr', h('td', en(w.en)), h('td', w.he), h('td', String(w.wrong)), h('td', progBadge(w.status)))))) : h('p.muted', 'אין טעויות בתקופה 🎉')),
      h('div.card', h('h2', 'שיעורים'),
        r.lessons.length ? h('div.table-wrap', h('table.t', h('tr', h('th', 'תאריך'), h('th', 'סטטוס'), h('th', 'מילים חדשות'), h('th', 'הצלחה')),
          r.lessons.map(l => h('tr.click', { onclick: () => WS.go('#/lesson/' + l.id) }, h('td', WS.fmtDate(l.date)), h('td', badge(LESSON_ST, l.status)), h('td', String(l.newWords)), h('td', l.pct == null ? '' : l.pct + '%'))))) : h('p.muted', 'אין שיעורים בתקופה.'),
        r.extraSessions ? h('p.small.muted', `ועוד ${r.extraSessions} סבבי חזרה/תרגול נוסף.`) : null));
  }

  function chart(days) {
    const W = 720, H = 200, pad = 28, n = days.length;
    const bw = Math.max(2, (W - pad * 2) / n - 2);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H + 24}`);
    const el = (t, a, txt) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; svg.appendChild(e); return e; };
    for (const p of [0, 50, 100]) {
      const y = H - (p / 100) * (H - 20);
      el('line', { x1: pad, x2: W - pad, y1: y, y2: y, class: 'axis' });
      el('text', { x: W - pad + 4, y: y + 4 }, p + '%');
    }
    days.forEach((d, i) => {
      // ציר הזמן מימין לשמאל, כמו בעברית
      const x = W - pad - (i + 1) * ((W - pad * 2) / n) + 1;
      if (d.pct != null) {
        const bh = Math.max(2, (d.pct / 100) * (H - 20));
        const r = el('rect', { x, y: H - bh, width: bw, height: bh, rx: 3, fill: d.pct >= 80 ? '#22c55e' : d.pct >= 50 ? '#60a5fa' : '#f59e0b' });
        const t = document.createElementNS(ns, 'title'); t.textContent = `${d.date}: ${d.pct}% (${d.correct}/${d.total}), ${d.newWords} מילים חדשות`; r.appendChild(t);
        if (d.newWords && n <= 31) el('text', { x: x + bw / 2, y: H - bh - 4, 'text-anchor': 'middle' }, '+' + d.newWords);
      }
      if (n <= 14 || i % Math.ceil(n / 10) === 0) el('text', { x: x + bw / 2, y: H + 16, 'text-anchor': 'middle' }, d.date.slice(8) + '/' + +d.date.slice(5, 7));
    });
    return h('div.chart', svg);
  }

  // ---------------- הגדרות ----------------
  async function settings() {
    const [{ settings: s, status }, servR, usersR, notifs] = await Promise.all([WS.get('settings'), WS.get('ha/services'), WS.get('ha/users'), WS.get('notifications')]);
    const I = {
      adminNotifyService: h('select', h('option', { value: '' }, '— ללא —'), [...new Set([...servR.services, s.adminNotifyService].filter(Boolean))].map(x => h('option', { value: x, selected: s.adminNotifyService === x }, x.replace('mobile_app_', '')))),
      prepTime: h('input', { type: 'time', value: s.prepTime }),
      daysAhead: h('input', { type: 'number', min: 1, max: 14, value: s.daysAhead }),
      imageSource: h('select', [['arasaac', 'איור מ-ARASAAC, ואם אין — תמונה מ-Openverse (חינם)'], ['openverse', 'חיפוש תמונה ב-Openverse (חינם)'], ['gemini', 'איור ב-Gemini (בתשלום לפי שימוש)'], ['none', 'ללא — אבחר ידנית']].map(([k, t]) => h('option', { value: k, selected: s.imageSource === k }, t))),
      notifyReviewDays: h('input', { type: 'checkbox', checked: s.notifyReviewDays })
    };
    const adminChecks = h('div.checks', usersR.users.map(u => h('label',
      h('input', { type: 'checkbox', name: 'adm', value: u.id, checked: u.isAdmin || s.adminUserIds.includes(u.id), disabled: u.isAdmin }),
      u.name + (u.isAdmin ? ' (מנהל ב-HA)' : ''))));
    const ok = v => v ? h('span.badge.ok', 'תקין') : h('span.badge.bad', 'לא מחובר');
    page('הגדרות',
      h('div.card', h('h2', 'מצב המערכת'),
        h('div', 'Home Assistant: ', ok(status.ha.connected), status.ha.mode === 'direct' ? h('span.small.muted', ' (חיבור ישיר — מצב פיתוח)') : null),
        h('div', 'קישור לפתיחת האפליקציה מההתראה: ', status.panelUrl ? h('code', status.panelUrl) : h('span.badge.warn', 'לא ידוע — ההתראה תיפתח במסך הבית של HA')),
        h('div', 'Gemini: ', status.gemini.configured ? h('span.badge.ok', status.gemini.model) : h('span.badge.warn', 'לא מוגדר'), ' ',
          status.gemini.configured ? h('button.btn.sm', { onclick: (e) => WS.busy(e.currentTarget, async () => { const r = await WS.post('settings/test-gemini'); WS.toast('Gemini ענה: ' + r.reply); }) }, 'בדיקה') : null),
        h('div', `אזור זמן: ${status.timeZone} · עכשיו ${status.now.time}`),
        h('p.small.muted', 'מפתח ה-API של Gemini ושמות המודלים מוגדרים בלשונית Configuration של התוסף ב-Home Assistant — הם לא נחשפים כאן.')),
      h('div.card', h('h2', 'הכנת שיעורים והודעה למנהל'),
        h('div.grid3', field('שעת הכנת שיעורי המחר', I.prepTime), field('כמה ימים קדימה להכין', I.daysAhead), field('המכשיר שלך להודעות', I.adminNotifyService)),
        h('div.row', { style: { marginTop: '10px' } },
          h('button.btn.sm', { onclick: (e) => WS.busy(e.currentTarget, async () => { const r = await WS.post('settings/test-admin-notify', { service: I.adminNotifyService.value }); r.ok ? WS.toast('נשלחה ✓') : WS.toast('נכשלה: ' + r.error, true); }) }, '📨 התראת בדיקה למנהל'))),
      h('div.card', h('h2', 'תוכן ותמונות'), field('הצעת תמונה למילים חדשות', I.imageSource),
        h('label.checks', { style: { marginTop: '10px' } }, I.notifyReviewDays, ' לשלוח לילד התראה גם ביום בלי שיעור מאושר (חזרה בלבד)')),
      h('div.card', h('h2', 'מנהלים'), h('p.small.muted', 'מנהלי Home Assistant הם תמיד מנהלים כאן. אפשר להוסיף משתמשים נוספים:'), adminChecks),
      h('div.row', h('button.btn.primary', { onclick: (e) => WS.busy(e.currentTarget, async () => {
        await WS.put('settings', {
          adminNotifyService: I.adminNotifyService.value, prepTime: I.prepTime.value, daysAhead: I.daysAhead.value,
          imageSource: I.imageSource.value, notifyReviewDays: I.notifyReviewDays.checked,
          adminUserIds: [...adminChecks.querySelectorAll('input:checked:not(:disabled)')].map(x => x.value)
        });
        WS.toast('נשמר ✓');
      }) }, 'שמירה')),
      h('div.card', { style: { marginTop: '14px' } }, h('h2', 'יומן התראות'),
        notifs.length ? h('div.table-wrap', h('table.t', h('tr', h('th', 'מתי'), h('th', 'סוג'), h('th', 'אל'), h('th', 'הודעה'), h('th', 'סטטוס')),
          notifs.slice(0, 50).map(n => h('tr', h('td', WS.fmtTime(n.at)), h('td', { daily: 'יומית', reminder: 'תזכורת', test: 'בדיקה', admin: 'מנהל' }[n.kind] || n.kind),
            h('td', (n.service || '').replace('mobile_app_', '')), h('td.small', n.message), h('td', n.ok ? h('span.badge.ok', 'נשלחה') : h('span.badge.bad', n.error)))))) : h('p.muted', 'עוד לא נשלחו התראות.')));
  }
})();
