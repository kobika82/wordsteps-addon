'use strict';
// ממשק הילד: מסך בית, שלב הלימוד (הקראה + ציור), שאלות עם משוב, סיכום, התקדמות ופרסים.
// הנגן משמש גם את התצוגה המקדימה של ההורה (preview) — שם התשובות נבדקות בדפדפן ולא נשמרות.
(function () {
  const h = KF.h;
  const Child = KF.Child = {};
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const gender = () => KF.me.child?.gender;
  const g = (m, f, n) => { const x = gender(); return x === 'f' ? f : x === 'm' ? m : n; };
  const GOOD = () => ['מעולה!', 'נכון!', 'כל הכבוד!', 'יופי!', 'בדיוק!', g('אלוף!', 'אלופה!', 'אלופים!'), 'מצוין!'];
  const GOOD_EMO = ['⭐', '🎉', '👏', '🌟', '✨', '🏆', '💪'];
  const theme = n => KF.me.meta.themes[n];
  const caption = (a, b) => { const t = theme(b); return a === 1 ? `${t.one}, ${t.inEach} ${t.each}` : `${a} ${t.many}, ${t.inEach} ${t.each}`; };
  const eq = (a, b, p, cls = '') => h('div.eq' + cls, { dir: 'ltr' },
    h('span', String(a)), h('span.op', '×'), h('span', String(b)), h('span.op', '='), p instanceof Node ? p : h('span.res', String(p)));

  function shell(content, tab) {
    document.body.classList.add('kid');
    const mute = h('button.mute', { 'aria-label': 'השתקת ההקראה', title: 'הקראה', onclick: () => { KF.setMuted(!KF.muted); mute.textContent = KF.muted ? '🔇' : '🔈'; } }, KF.muted ? '🔇' : '🔈');
    const top = h('div.kid-top', h('div.kid-logo', '✖️ לוח הכפל'), h('div.row', KF.canSpeak() ? mute : null, h('div.stars', '⭐ ', String(KF.me.child?.stars ?? 0))));
    const nav = h('nav.kid-nav',
      h('a' + (tab === 'home' ? '.on' : ''), { href: '#/' }, '🏠 בית'),
      h('a' + (tab === 'progress' ? '.on' : ''), { href: '#/progress' }, '📈 התקדמות'),
      h('a' + (tab === 'rewards' ? '.on' : ''), { href: '#/rewards' }, '🎁 פרסים'));
    KF.mount(h('div.kid-wrap', top, content), nav);
  }

  Child.init = function () {
    KF.route('/', home);
    KF.route('/progress', progress);
    KF.route('/rewards', rewards);
    KF.route('/learn/:n', n => learnFlow(Number(n), { onDone: () => KF.go('#/'), doneLabel: 'סיום 🏠', replay: true }));
  };

  // ---------- מסך הבית ----------
  async function home() {
    const d = await KF.get('child/home');
    KF.me.child.stars = d.child.stars;
    KF.me.child.gender = d.child.gender;
    if (d.intro) return intro(d);
    const start = (label, cls, body) => h('button.big-btn' + cls, {
      onclick: (e) => KF.busy(e.currentTarget, async () => play(await KF.post('child/session/start', body)))
    }, label);
    let card;
    const t = d.table ? theme(d.table) : null;
    if (d.mode === 'none') {
      card = h('div.kid-card.center',
        h('div.big-emo', '🌱'),
        h('h2', 'עוד מעט מתחילים!'),
        h('p', 'ההורים יפתחו לך בקרוב את הכפולה הראשונה. נתראה! 😊'));
    } else if (d.mode === 'resume') {
      card = h('div.kid-card.center',
        h('div.big-emo', '⏯️'),
        h('h2', 'יש לך תרגול באמצע'),
        h('p', `נמשיך בדיוק מאיפה ש${g('עצרת', 'עצרת', 'עצרתם')}.`),
        start('להמשיך ▶', '.blue', {}));
    } else if (d.mode === 'daily' && d.phase === 'mix') {
      card = h('div.kid-card.center.today',
        h('div.tag', 'התרגול היומי'),
        h('div.big-emo', '🔁'),
        h('h2.table-title', 'חזרה על הכפולות', KF.speakBtn(() => `היום חוזרים על הכפולות ש${g('למדת', 'למדת', 'למדתם')}. בואו נאסוף כוכבים.`)),
        h('p', `🎯 שאלות מכל הכפולות ש${g('למדת', 'למדת', 'למדתם')} עד עכשיו`),
        start('בואו נתחיל 🚀', '', { mode: 'daily' }));
    } else if (d.mode === 'daily') {
      card = h('div.kid-card.center.today',
        h('div.tag', 'הכפולה היומית'),
        h('div.big-emo', t.item),
        h('h2.table-title', `כפולות של ${d.table}`, KF.speakBtn(() => d.needLearn
          ? `היום לומדים את כפולות של ${KF.num(d.table)}. קודם נלמד יחד, ואחר כך שאלות.`
          : `הכפולה היומית: כפולות של ${KF.num(d.table)}. בואו נענה על שאלות ונאסוף כוכבים.`)),
        h('p', d.needLearn ? '📖 קודם נלמד אותה יחד, ואחר כך שאלות' : '🎯 שאלות על הכפולה — כל תשובה נכונה מקרבת כוכבים'),
        !d.needLearn && d.soloDays ? h('div.daydots', Array.from({ length: 1 + d.soloDays }, (_, i) => h('i' + (i < d.phaseDay ? '.on' : ''))), h('span.small.muted', ` יום ${d.phaseDay} מתוך ${1 + d.soloDays}`)) : null,
        start('בואו נתחיל 🚀', '', { mode: 'daily' }));
    } else if (d.mode === 'done') {
      card = h('div.kid-card.center',
        h('div.big-emo', '🎉'),
        h('h2', `${g('סיימת', 'סיימת', 'סיימתם')} את התרגול של היום!`),
        h('p', 'כל הכבוד. נתראה מחר 😊'),
        start('אימון נוסף (בלי כוכבים) 💪', '.purple', { mode: 'practice' }),
        h('button.big-btn.ghost', { onclick: () => KF.go('#/learn/' + d.table) }, `📖 ללמוד שוב את כפולות של ${d.table}`));
    } else {
      card = h('div.kid-card.center',
        h('div.big-emo', '🏖️'),
        h('h2', 'היום אין תרגול'),
        h('p', 'אפשר להתאמן בשביל הכיף — בלי כוכבים 🙂'),
        start(d.phase === 'mix' ? 'אימון על כל הכפולות 💪' : `אימון בכפולות של ${d.table} 💪`, '.purple', { mode: 'practice' }),
        h('button.big-btn.ghost', { onclick: () => KF.go('#/learn/' + d.table) }, `📖 ללמוד שוב את כפולות של ${d.table}`));
    }
    const goal = d.goal ? h('div.kid-card.goal-mini', { onclick: () => KF.go('#/rewards') },
      h('div.goal-row', h('span.emoji', d.goal.emoji), h('span.grow', h('b', d.goal.name)), h('span', `⭐ ${d.child.stars} / ${d.goal.cost}`)),
      h('div.bar', h('i', { style: { width: d.goal.pct + '%' } }))) : null;
    const tables = d.tables.length ? h('div.kid-card',
      h('h3', 'הכפולות שלי'),
      h('div.tchips', d.tables.map(x => h('button.tchip' + (x.n === d.table ? '.cur' : ''), { onclick: () => KF.go('#/learn/' + x.n) },
        h('span.n', '×' + x.n), h('span.small', x.pct + '%')))),
      h('p.muted.small', 'לחיצה על כפולה — ללמוד אותה שוב')) : null;
    shell(h('div', h('div.hello', `היי ${d.child.name}! 👋`), card, goal, tables), 'home');
  }

  // הסבר קצר בכניסה הראשונה. מוקרא, כי ילד בכיתה ב לא קורא מסך הסבר.
  function intro(d) {
    const lines = [
      ['📖', 'בכל פעם נלמד כפולה אחת — עם ציורים'],
      ['❓', 'אחר כך יש שאלות, ואם טועים — מנסים שוב בסוף'],
      ['⭐', 'על כל תרגול יומי מקבלים כוכבים'],
      ['🎁', 'עם הכוכבים בוחרים פרס']
    ];
    const text = `היי ${d.child.name}! ברוכים הבאים ללוח הכפל. ` + lines.map(l => l[1]).join('. ') + '.';
    shell(h('div.intro',
      h('div.big-emo', '✖️'),
      h('h2', `${d.child.name}, ברוכים הבאים!`),
      h('div.kid-card', h('ul.intro-list', lines.map(([e, t]) => h('li', h('span.ie', e), t))),
        h('div.center', KF.speakBtn(text))),
      h('button.big-btn', { onclick: async () => { await KF.post('child/intro/seen').catch(() => {}); home(); } }, 'יאללה! 🚀')), 'home');
  }

  // ---------- שלב הלימוד ----------
  // 12 מסכים: פתיחה, עשר העובדות (כל אחת עם ציור והקראה), ופזמון של כל הכפולות.
  function learnFlow(n, { onDone, doneLabel = 'עכשיו שאלות! ▶', replay = false, frameFn = null }) {
    const t = theme(n);
    let i = 0;
    const show = () => {
      KF.stopSpeak();
      const dots = h('div.dots', Array.from({ length: 12 }, (_, j) => h('i' + (j === i ? '.on' : j < i ? '.past' : ''))));
      const back = i > 0 ? h('button.big-btn.ghost', { onclick: () => { i--; show(); } }, '→ הקודם') : null;
      const next = (label = 'הבא ←') => h('button.big-btn.green', { onclick: () => { i++; show(); } }, label);
      let body, say;
      if (i === 0) {
        say = `היום לומדים את כפולות של ${KF.num(n)}. ${t.intro}.`;
        body = h('div.kid-card.center.learn',
          h('div.tag', replay ? 'חזרה על הלימוד' : 'שלב הלימוד'),
          h('h2.table-title', `כפולות של ${n}`),
          KF.groups(1, n, t.item, { hideCount: true }),
          h('p.lead', t.intro),
          h('div.navbtns', next('בואו נלמד ←')));
      } else if (i <= 10) {
        const k = i;
        say = `${caption(k, n)}. ${KF.sayFact(k, n, k * n)}.`;
        body = h('div.kid-card.center.learn',
          eq(k, n, k * n, '.big'),
          h('p.lead', caption(k, n)),
          KF.groups(k, n, t.item),
          KF.strip(n, k),
          h('div.center', KF.speakBtn(() => say)),
          h('div.navbtns', back, next()));
      } else {
        say = '';
        const strip = KF.strip(n, 0, { current: 0 });
        const sing = async () => {
          const cells = [...strip.children];
          cells.forEach(c => c.classList.remove('on', 'cur'));
          for (let k = 1; k <= 10; k++) {
            cells.forEach(c => c.classList.remove('cur'));
            cells[k - 1].classList.add('on', 'cur');
            await KF.speak(KF.num(k * n), { rate: 1 });
            if (!strip.isConnected) return;
          }
        };
        body = h('div.kid-card.center.learn',
          h('div.big-emo', '🎵'),
          h('h2', 'עכשיו כולם ביחד!'),
          h('p.lead', `כל הכפולות של ${n}, מההתחלה עד הסוף`),
          strip,
          h('button.btn.sing', { onclick: sing }, '🔊 לשמוע שוב'),
          h('div.navbtns', back, h('button.big-btn.green', { onclick: (e) => { KF.stopSpeak(); onDone(e); } }, doneLabel)));
        setTimeout(sing, 300);
      }
      const content = h('div', dots, body);
      if (frameFn) frameFn(content); else shell(content, 'home');
      if (say) KF.speak(say);
    };
    show();
  }
  Child.learnFlow = learnFlow;

  // ---------- נגן התרגול ----------
  // view: {id, kind, table, plan, step, results}; opts.preview: התשובות נבדקות כאן ולא נשמרות
  function play(view, opts = {}) {
    const P = { ...view, results: view.results || {}, preview: !!opts.preview, onExit: opts.onExit || (() => KF.go('#/')) };
    P.step = 0;
    while (P.results[P.step]) P.step++;
    render(P);
  }
  Child.play = play;

  function frame(P, body) {
    const total = P.plan.length || 1;
    const top = h('div.lesson-top',
      h('button.x-btn', { 'aria-label': 'יציאה', onclick: () => { KF.stopSpeak(); P.onExit(); } }, '✕'),
      h('div.pbar', h('div', { style: { width: Math.round((P.step / total) * 100) + '%' } })),
      h('div.stars.sm', '⭐ ', String(KF.me.child?.stars ?? 0)));
    document.body.classList.add('kid');
    KF.mount(h('div.kid-wrap', P.preview ? h('div.preview-flag', 'תצוגה מקדימה להורה — התשובות לא נשמרות') : null, top, body));
  }

  function render(P) {
    document.querySelectorAll('.feedback').forEach(x => x.remove());
    const s = P.plan[P.step];
    if (!s) return finish(P);
    if (s.t === 'learn') {
      return learnFlow(s.n, {
        frameFn: (content) => frame(P, content),
        onDone: async (e) => {
          if (!P.preview) {
            try { await KF.post(`child/session/${P.id}/learned`, { step: P.step }); } catch (err) { KF.fail(err); return; }
          }
          P.results[P.step] = { learned: true };
          P.step++;
          render(P);
        }
      });
    }
    return question(P, s);
  }

  // ניסוח השאלה (מוצג) והקראתה
  // שלוש תבניות: mc (בחירה מתוך ארבע), pad (הקלדה), seq (מספר חסר ברצף)
  function prompt(s) {
    if (s.t === 'seq') return { title: `איזה מספר חסר בכפולות של ${s.n}?`, say: `איזה מספר חסר בכפולות של ${KF.num(s.n)}?` };
    if (s.t === 'pad') return { title: 'כמה זה?', say: `כמה זה ${KF.sayFact(s.a, s.b)}? ${g('כתוב', 'כתבי', 'כתבו')} את התשובה.` };
    return { title: 'כמה זה?', say: `כמה זה ${KF.sayFact(s.a, s.b)}?` };
  }
  // העובדה המלאה, למשוב: a × b = p
  function fact(s) { return [s.a, s.b, s.a * s.b]; }

  function question(P, s) {
    const q = prompt(s);
    const hole = h('span.hole', '?');
    // ברצף, ה"חור" הוא תא בפס הכפולות; בשאר — התוצאה במשוואה
    if (s.t === 'seq') hole.classList.add('cell');
    const stage = s.t === 'seq'
      ? h('div.strip.seq', { dir: 'ltr' }, s.seq.map(x => (x == null ? hole : h('span.cell.on', String(x)))))
      : eq(s.a, s.b, hole, '.big');

    const card = h('div.kid-card.center.q',
      s.retry ? h('div.tag.retry', 'עוד ניסיון 💪') : s.role === 'review' || s.role === 'mix' ? h('div.tag.review', `כפולות של ${s.n}`) : null,
      h('div.q-title', q.title, KF.speakBtn(() => q.say)),
      stage);
    const lock = (on) => card.querySelectorAll('button.opt, .pad button').forEach(b => (b.disabled = on));

    const submit = async (value, mark) => {
      lock(true);
      let r;
      if (P.preview) r = { correct: Number(value) === s.answer, answer: s.answer, plan: P.plan.concat(Number(value) === s.answer || s.retry ? [] : [retryLocal(s)]) };
      else {
        try { r = await KF.post(`child/session/${P.id}/answer`, { step: P.step, answer: value }); } catch (e) { KF.fail(e); lock(false); return; }
      }
      P.plan = r.plan;
      P.results[P.step] = { correct: r.correct };
      if (mark) mark(r.correct);
      hole.textContent = String(s.answer);
      hole.classList.add(r.correct ? 'ok' : 'fix');
      P.step++;
      feedback(P, s, r.correct);
    };

    if (s.t === 'pad') {
      card.append(keypad(submit, hole));
    } else {
      const btns = s.options.map(o => h('button.opt', {
        onclick: () => submit(o, (ok) => {
          btns.forEach((b, i) => {
            if (s.options[i] === s.answer) b.classList.add('right');
            else if (s.options[i] === o && !ok) b.classList.add('wrong');
          });
        })
      }, String(o)));
      card.append(h('div.opts', btns));
    }
    frame(P, card);
    KF.speak(q.say);
  }

  // מקלדת מספרים על המסך: גדולה, בלי מקלדת המכשיר שמכסה חצי מסך
  function keypad(submit, hole) {
    let val = '';
    const show = () => { hole.textContent = val || '?'; hole.classList.toggle('typing', !!val); };
    const key = (label, fn, cls = '') => h('button' + cls, { type: 'button', onclick: fn }, label);
    const digit = d => key(String(d), () => { if (val.length < 3) { val = (val === '0' ? '' : val) + d; show(); } });
    const pad = h('div.pad', { dir: 'ltr' },
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit),
      key('⌫', () => { val = val.slice(0, -1); show(); }, '.del'),
      digit(0),
      key('✓', () => { if (val) submit(Number(val)); }, '.ok'));
    return pad;
  }

  function retryLocal(s) {
    const other = s.a === s.n ? s.b : s.a;
    const a = Math.random() < 0.5 ? other : s.n, b = a === other ? s.n : other;
    const p = a * b;
    const opts = [p, p + s.n, Math.max(1, p - s.n), p + 1].filter((x, i, arr) => arr.indexOf(x) === i);
    while (opts.length < 4) opts.push(p + opts.length + 1);
    return { t: 'mc', n: s.n, a, b, answer: p, options: opts.sort(() => Math.random() - 0.5), role: s.role, retry: true };
  }

  // פס המשוב בתחתית: חיובי עם שבח, שלילי עם התשובה והציור — כדי ללמוד מהטעות
  function feedback(P, s, good) {
    const [a, b, p] = fact(s);
    let msg, detail, say;
    if (good) {
      const word = pick(GOOD());
      msg = word + ' ' + pick(GOOD_EMO);
      detail = eq(a, b, p, '.sm');
      say = word;
    } else {
      msg = 'כמעט! 💡';
      detail = h('div',
        h('div', 'התשובה הנכונה:'), eq(a, b, p, '.sm'),
        a * b <= 40 ? KF.groups(a, b, theme(b).item, { hideCount: true }) : null,
        s.retry ? null : h('div.small', 'נתרגל את זה שוב בסוף 💪'));
      say = `כמעט. ${KF.sayFact(a, b, p)}.`;
    }
    const next = h('button.big-btn' + (good ? '.green' : '.blue'), { onclick: () => { bar.remove(); render(P); } }, 'המשך ←');
    const bar = h('div.feedback' + (good ? '.good' : '.soft'), h('div.in', h('div.msg', msg), h('div.detail', detail), next));
    document.body.appendChild(bar);
    if (good) burst();
    KF.speak(say);
    next.focus();
  }

  // כוכבים קטנים שקופצים בתשובה נכונה
  function burst(n = 8) {
    for (let i = 0; i < n; i++) {
      const s = h('span.burst', pick(['⭐', '✨', '🌟']));
      s.style.left = (10 + Math.random() * 80) + 'vw';
      s.style.animationDelay = (Math.random() * 0.25) + 's';
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 1500);
    }
  }

  async function finish(P) {
    if (P.preview) {
      frame(P, h('div.kid-card.center', h('div.big-emo', '✅'), h('h2', 'סוף התצוגה המקדימה'),
        h('button.big-btn.blue', { onclick: () => P.onExit() }, 'חזרה')));
      return;
    }
    let sum;
    try { sum = await KF.post(`child/session/${P.id}/complete`); } catch (e) { KF.fail(e); return; }
    KF.me.child.stars = sum.totalStars;
    summary(sum);
  }

  function summary(s) {
    if (s.pct >= 80) burst(24);
    shell(h('div',
      h('div.kid-card.center',
        h('div.big-emo', s.pct === 100 ? '🏆' : s.pct >= 60 ? '🎉' : '💪'),
        h('h2', `${g('סיימת', 'סיימת', 'סיימתם')} את התרגול!`),
        s.kind === 'daily' ? h('div.won', `+${s.stars} ⭐`) : h('p.muted', 'אימון נוסף — בלי כוכבים, אבל עם המון לימוד 🙂'),
        h('div.sum-tiles',
          h('div', h('b', `${s.correct}/${s.total}`), 'תשובות נכונות'),
          h('div', h('b', s.pct + '%'), 'הצלחה'),
          h('div', h('b', '⭐ ' + s.totalStars), 'כוכבים עכשיו'),
          s.tablePct ? h('div', h('b', s.tablePct + '%'), `${g('שולט', 'שולטת', 'שולטים')} בכפולות של ${s.table}`) : h('div', h('b', '🌱'), `התחלנו את כפולות של ${s.table}`)),
        h('p.lead', s.message)),
      s.weak.length ? h('div.kid-card',
        h('h3', '💪 כדאי לחזק'),
        h('p.muted', 'הן יופיעו שוב בתרגולים הבאים — ככה לומדים!'),
        h('div.weak', s.weak.map(w => h('div.w', eq(w.a, w.b, w.product, '.sm'), KF.speakBtn(KF.sayFact(w.a, w.b, w.product)))))) : null,
      h('button.big-btn.blue', { onclick: () => KF.go('#/') }, 'לדף הבית 🏠')
    ), 'home');
    KF.speak(`${g('סיימת', 'סיימת', 'סיימתם')}! ${s.correct} תשובות נכונות מתוך ${s.total}. ${s.kind === 'daily' ? `${g('קיבלת', 'קיבלת', 'קיבלתם')} ${s.stars} כוכבים.` : ''}`);
  }

  // ---------- ההתקדמות שלי ----------
  const ST_CLS = { mastered: 'st-m', good: 'st-g', learning: 'st-l', weak: 'st-w', new: 'st-n' };
  async function progress() {
    const d = await KF.get('child/progress');
    shell(h('div',
      h('div.hello', 'ההתקדמות שלי 📈'),
      h('div.kid-card',
        h('div.sum-tiles',
          h('div', h('b', '⭐ ' + d.stars), 'כוכבים'),
          h('div', h('b', String(d.earned)), 'נצברו בסך הכול'),
          h('div', h('b', String(d.sessions)), 'תרגולים'),
          h('div', h('b', String(d.perfect)), 'תרגולים מושלמים 🏆'))),
      d.tables.length ? d.tables.slice().reverse().map(t => h('div.kid-card',
        h('div.row', h('h3.grow', `${theme(t.n).item} כפולות של ${t.n}`), h('span.badge-pct', t.pct + '%')),
        h('div.facts', { dir: 'ltr' }, t.facts.map(f => h('span.fact.' + ST_CLS[f.status], { title: KF.me.meta.statusHe[f.status] },
          h('small', `${f.k}×${t.n}`), h('b', String(f.product))))),
        h('button.btn.sm', { onclick: () => KF.go('#/learn/' + t.n), style: { marginTop: '10px' } }, '📖 ללמוד שוב'))) : h('div.kid-card', h('p', 'עוד אין כפולות פתוחות.')),
      h('div.legend', ['mastered', 'good', 'learning', 'weak', 'new'].map(k => h('span', h('i.' + ST_CLS[k]), KF.me.meta.statusHe[k].replace('יודע/ת', g('יודע', 'יודעת', 'יודעים')))))
    ), 'progress');
  }

  // ---------- פרסים ----------
  // המודל: בוחרים יעד מראש, וצוברים לעברו. הסרגל הוא העיקר — מספר כוכבים לבדו לא אומר לילד כמה נשאר.
  function movieArt() {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', '0 0 240 150');
    el.setAttribute('width', '240');
    el.innerHTML = [
      '<rect x="18" y="34" width="150" height="96" rx="10" fill="#1f2937"/>',
      '<rect x="30" y="46" width="126" height="72" rx="5" fill="#374151"/>',
      '<path d="M78 66 L112 82 L78 98 Z" fill="#fbbf24"/>',
      '<rect x="14" y="16" width="158" height="22" rx="5" fill="#111827" transform="rotate(-8 93 27)"/>',
      '<circle cx="196" cy="98" r="30" fill="#fde68a"/><circle cx="196" cy="98" r="22" fill="#f59e0b"/>',
      '<circle cx="196" cy="98" r="6" fill="#78350f"/>'
    ].join('');
    return el;
  }
  function dreamScreen(name, back) {
    shell(h('div.dream',
      h('div.hello', '🎬'),
      h('h2', `${name} — ${g('אתה חי בסרט', 'את חיה בסרט', 'אתם חיים בסרט')}.`),
      h('div.art', movieArt()),
      h('p', 'נא לבחור פרס אחר 🙂'),
      h('button.big-btn', { onclick: back }, 'חזרה לפרסים')), 'rewards');
  }
  async function rewards() {
    const d = await KF.get('child/rewards');
    KF.me.child.stars = d.stars;
    const choose = async (c) => {
      const r = await KF.post(`child/rewards/${c.id}/goal`);
      if (r.joke) return dreamScreen(KF.me.child.name, rewards);
      rewards();
    };
    const claim = async () => {
      if (!confirm(`לממש את ${d.goal.emoji} ${d.goal.name}?`)) return;
      try { await KF.post(`child/rewards/${d.goal.id}/request`); rewards(); } catch (e) { KF.fail(e); }
    };
    shell(h('div',
      h('div.hello', 'הפרסים שלי 🎁'),
      h('div.kid-card', h('div.sum-tiles',
        h('div', h('b', '⭐ ' + d.stars), 'כוכבים עכשיו'),
        h('div', h('b', String(d.earned)), 'נצברו בסך הכול'))),
      d.pending ? h('div.kid-card', h('h3', '⏳ ממתין לאישור'),
        h('p', `${d.pending.emoji} ${d.pending.name} — ${g('ביקשת', 'ביקשת', 'ביקשתם')}, וההורים צריכים לאשר.`)) : null,
      d.goal && !d.pending ? h('div.kid-card',
        h('h3', 'היעד שלי'),
        h('div.goal-row', h('span.emoji', d.goal.emoji), h('span.grow', h('b', d.goal.name)), h('span', `⭐ ${d.stars} / ${d.goal.cost}`)),
        h('div.bar', h('i', { style: { width: d.goal.pct + '%' } })),
        d.goal.reached
          ? h('div', h('p', `${g('הגעת', 'הגעת', 'הגעתם')}! 🎉`), h('button.big-btn', { onclick: claim }, 'אני רוצה את הפרס'))
          : h('p.muted', `עוד ${d.goal.missing} כוכבים`)) : null,
      h('div.kid-card',
        h('h3', d.goal ? 'להחליף יעד' : 'איזה פרס אני רוצה?'),
        d.catalog.length ? h('div.rewards', d.catalog.map(c => h('button.reward' + (c.goal ? '.on' : ''), { onclick: () => choose(c) },
          h('span.emoji', c.emoji), h('span.name', c.name), h('span.cost', '⭐ ' + (c.cost > 9000 ? '∞' : c.cost)))))
          : h('p.muted', 'ההורים עוד לא הגדירו פרסים.')),
      d.history.filter(r => r.status === 'given').length ? h('div.kid-card',
        h('h3', 'פרסים שקיבלתי'),
        h('div.wlist', d.history.filter(r => r.status === 'given').map(r =>
          h('div.w', h('span', r.emoji), h('span.grow', r.name), h('span.muted', KF.fmtTime(r.at).slice(0, 10)))))) : null
    ), 'rewards');
  }
})();
