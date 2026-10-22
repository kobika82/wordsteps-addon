'use strict';
// ממשק הילד: מסך בית, נגן השיעור (כרטיסים ותרגילים), סיכום ומסך התקדמות.
// נגן השיעור משמש גם את התצוגה המקדימה של המנהל (preview) — שם שום דבר לא נשמר.
(function () {
  const h = WS.h, en = WS.en;
  const Child = WS.Child = {};
  const GOOD = ['מעולה! ⭐', 'נכון! 🎉', 'כל הכבוד! 👏', 'יופי! 🌟', 'בדיוק! ✨', 'אלופים! 🏆'];
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const g = (m, f, n) => { const x = WS.me.child?.gender; return x === 'f' ? f : x === 'm' ? m : n; };

  function shell(content, tab) {
    document.body.classList.add('kid');
    const top = h('div.kid-top', h('div.kid-logo', '📚 WordSteps'), h('div.stars', '⭐ ', String(WS.me.child?.stars ?? 0)));
    const nav = h('nav.kid-nav',
      h('a' + (tab === 'home' ? '.on' : ''), { href: '#/' }, '🏠 בית'),
      h('a' + (tab === 'progress' ? '.on' : ''), { href: '#/progress' }, '📈 ההתקדמות שלי'));
    WS.mount(h('div.kid-wrap', top, content), nav);
  }

  Child.init = function () {
    WS.route('/', home);
    WS.route('/progress', progress);
    WS.route('/lesson', () => WS.go('#/'));
  };

  async function home() {
    const d = await WS.get('child/home');
    WS.me.child.stars = d.child.stars;
    let card;
    const startBtn = (label, cls, body) => h('button.big-btn' + cls, {
      onclick: (e) => WS.busy(e.currentTarget, async () => play(await WS.post('child/lesson/start', body)))
    }, label);
    if (d.mode === 'start') {
      card = h('div.kid-card.center',
        h('div', { style: { fontSize: '64px' } }, '🎒'),
        h('h2', 'השיעור של היום מוכן!'),
        h('p', d.newCount
          ? `${d.newCount} מילים חדשות` + (d.reviewCount ? ` וחזרה קצרה על מילים ש${g('למדת', 'למדת', 'למדתם')}` : '')
          : `חזרה קצרה על מילים ש${g('למדת', 'למדת', 'למדתם')}`),
        startBtn('בואו נתחיל 🚀', '', { lessonId: d.lessonId }));
    } else if (d.mode === 'resume') {
      card = h('div.kid-card.center',
        h('div', { style: { fontSize: '64px' } }, '⏯️'),
        h('h2', 'יש לך שיעור באמצע'),
        h('p', `נמשיך בדיוק מאיפה ש${g('עצרת', 'עצרת', 'עצרתם')}.`),
        startBtn('להמשיך ▶', '.blue', { lessonId: d.lessonId }));
    } else if (d.mode === 'done') {
      card = h('div.kid-card.center',
        h('div', { style: { fontSize: '64px' } }, '🎉'),
        h('h2', `${g('סיימת', 'סיימת', 'סיימתם')} את השיעור של היום!`),
        h('p', 'כל הכבוד. נתראה בשיעור הבא 😊'),
        d.canPractice ? startBtn('תרגול נוסף (רשות) 💪', '.purple', { mode: 'practice' }) : null);
    } else if (d.mode === 'review') {
      card = h('div.kid-card.center',
        h('div', { style: { fontSize: '64px' } }, '🔁'),
        h('h2', 'זמן לחזרה קצרה'),
        h('p', 'אין היום מילים חדשות, אבל אפשר לחזור על מילים שלמדת.'),
        startBtn('חזרה קצרה 🔁', '.green', { mode: 'review' }));
    } else {
      card = h('div.kid-card.center',
        h('div', { style: { fontSize: '64px' } }, '🌱'),
        h('h2', 'עוד אין שיעור מוכן'),
        h('p', 'השיעור הבא יופיע כאן ממש בקרוב. נתראה! 😊'));
    }
    shell(h('div',
      h('div.hello', `היי ${d.child.name}! 👋`),
      h('p.muted', d.learned ? `${g('למדת', 'למדת', 'למדתם')} כבר ${d.learned} מילים באנגלית` : 'מוכנים להתחיל ללמוד אנגלית?'),
      card), 'home');
  }

  async function progress() {
    const d = await WS.get('child/progress');
    const S = WS.me.meta.statusHe;
    const order = ['mastered', 'familiar', 'learning', 'needs_reinforcement'];
    const color = { mastered: '#16a34a', familiar: '#2563eb', learning: '#7c3aed', needs_reinforcement: '#ea580c', new: '#6b7280' };
    shell(h('div',
      h('div.hello', 'ההתקדמות שלי 📈'),
      h('div.kid-card',
        h('div.sum-tiles',
          h('div', h('b', String(d.learned)), 'מילים שלמדתי'),
          h('div', h('b', '⭐ ' + d.stars), 'כוכבים'),
          h('div', h('b', String(d.status.mastered || 0)), 'נלמדו היטב'),
          h('div', h('b', String(d.studyDays)), 'ימי למידה')),
        h('h3', '🏅 אבני דרך'),
        h('div.badges', d.milestones.map(m => h('span' + (m.reached ? '.got' : ''), (m.reached ? '🏆 ' : '') + m.m + ' מילים')))),
      d.words.length ? h('div.kid-card',
        h('h3', 'המילים שלי'),
        order.map(st => {
          const ws = d.words.filter(w => w.status === st);
          if (!ws.length) return null;
          return h('div', { style: { marginBottom: '12px' } },
            h('div', { style: { fontWeight: 800, color: color[st], margin: '6px 0' } }, `${S[st]} (${ws.length})`),
            h('div.wlist', ws.map(w => h('div.w', h('span', w.emoji || '•'), h('span.grow', en(w.en), ' — ', w.he), WS.speakBtn(w.en)))));
        })) : null
    ), 'progress');
  }

  // ---------- נגן השיעור ----------
  // view: {id|token, kind, plan, step, results, words}; opts.preview: {token, onExit}
  function play(view, opts = {}) {
    const P = { ...view, preview: !!opts.preview, onExit: opts.onExit || (() => WS.go('#/')) };
    // אם השלב הנוכחי כבר נענה (למשל אחרי ניתוק) — ממשיכים לבא אחריו
    while (P.results && P.results[P.step]) P.step++;
    render(P);
  }
  Child.play = play;

  function advance(P, step) {
    P.step = step;
    if (!P.preview) WS.post(`child/lesson/${P.id}/advance`, { step }).catch(() => { /* ההתקדמות תישמר בתשובה הבאה */ });
    render(P);
  }

  async function submit(P, payload) {
    const path = P.preview ? `preview/${P.token}/answer` : `child/lesson/${P.id}/answer`;
    const r = await WS.post(path, { step: P.step, ...payload });
    P.plan = r.plan;
    return r;
  }

  function frame(P, body) {
    const answerable = P.plan.filter(s => !['stage'].includes(s.t)).length || 1;
    const done = P.plan.slice(0, P.step).filter(s => s.t !== 'stage').length;
    const top = h('div.lesson-top',
      h('button.x-btn', { 'aria-label': 'יציאה', onclick: () => P.onExit() }, '✕'),
      h('div.pbar', h('div', { style: { width: Math.round((done / answerable) * 100) + '%' } })));
    document.body.classList.add('kid');
    const wrap = h('div.kid-wrap', P.preview ? h('div.preview-flag', 'תצוגה מקדימה למנהל — התשובות לא נשמרות') : null, top, body);
    WS.mount(wrap);
  }

  function render(P) {
    const s = P.plan[P.step];
    if (!s) return finish(P);
    const W = P.words;
    if (s.t === 'stage') return stage(P, s);
    if (s.t === 'card') return card(P, s, W[s.w]);
    if (s.t === 'mc') return mc(P, s, W[s.w]);
    if (s.t === 'cloze') return cloze(P, s, W[s.w]);
    if (s.t === 'type') return typeEx(P, s, W[s.w]);
    if (s.t === 'match') return match(P, s);
    advance(P, P.step + 1);
  }

  const STAGES = {
    cards: ['📖', 'מילים חדשות', n => `נכיר ${n} מילים חדשות. אפשר ללחוץ על 🔊 כדי לשמוע.`],
    practice: ['🎯', 'בואו נתרגל', () => 'עכשיו בלי תמונות ובלי תרגום — מה זוכרים?'],
    review: ['🔁', 'חזרה על מילים שלמדנו', n => `${n} מילים מהשיעורים הקודמים.`],
    retry: ['💪', 'עוד ניסיון', () => 'נתרגל שוב את המילים שהיו קצת קשות.']
  };
  function stage(P, s) {
    const [emo, title, text] = STAGES[s.stage] || ['✨', '', () => ''];
    frame(P, h('div.kid-card.stage',
      h('div.emo', emo), h('h2', title), h('p', text(s.count)),
      h('button.big-btn.blue', { onclick: () => advance(P, P.step + 1) }, 'יאללה! ▶')));
  }

  function pic(c) {
    if (c.image) return h('div.pic', h('img', { src: c.image, alt: '' }));
    if (c.emoji) return h('div.pic', c.emoji);
    return null;
  }

  function card(P, s, c) {
    const prevIsCard = P.plan[P.step - 1]?.t === 'card';
    frame(P, h('div.kid-card.wcard',
      pic(c),
      h('div', h('span.word-en.en', { lang: 'en', dir: 'ltr' }, c.en), WS.speakBtn(c.en)),
      h('div.word-he', c.he),
      c.exampleEn ? h('div.sentence',
        h('div', h('span.en', { lang: 'en', dir: 'ltr' }, c.exampleEn), WS.speakBtn(c.exampleEn, '')),
        h('div.he', c.exampleHe)) : null,
      h('div.navbtns',
        prevIsCard ? h('button.big-btn.back', { onclick: () => advance(P, P.step - 1) }, '→ הקודם') : null,
        h('button.big-btn.green', { onclick: () => advance(P, P.step + 1) }, 'הבא ←'))));
    WS.speak(c.en);
  }

  // פס המשוב בתחתית המסך
  function feedback(P, good, msg, detail, sayText) {
    const next = h('button.big-btn' + (good ? '.green' : '.blue'), { onclick: () => { bar.remove(); render(P); } }, 'המשך ←');
    const bar = h('div.feedback' + (good ? '.good' : '.soft'), h('div.in',
      h('div.msg', msg), detail ? h('div.detail', detail) : null, next));
    document.body.appendChild(bar);
    if (sayText) WS.speak(sayText);
    next.focus();
  }

  async function answerAndShow(P, s, payload, after) {
    let r;
    try { r = await submit(P, payload); } catch (e) { WS.fail(e); return null; }
    P.step = Math.max(P.step + 1, 0);
    after(r);
    return r;
  }

  function wrongDetail(s, c) {
    const retryNote = s.retry ? '' : ' נתרגל אותה שוב בסוף.';
    if (s.t === 'cloze') return h('div', 'התשובה הנכונה: ', h('b', en(s.answer)), h('div', en(s.sentence.replace(/_{2,}/, s.answer))), h('div.small', c.clozeHe), retryNote);
    if (s.t === 'type') return h('div', 'כותבים כך: ', h('b', en(s.answer)), ` (${c.he}).`, retryNote);
    return h('div', h('b', en(c.en)), ' = ', h('b', c.he), '.', retryNote);
  }

  function options(P, s, c, labelFn) {
    const btns = s.options.map(o => h('button.opt' + (labelFn(o).en ? '.en' : ''), {
      dir: labelFn(o).en ? 'ltr' : 'rtl',
      onclick: async () => {
        btns.forEach(b => (b.disabled = true));
        const r = await answerAndShow(P, s, { answer: o }, (res) => {
          btns.forEach((b, i) => {
            if (s.options[i] === s.answer) b.classList.add('right');
            else if (s.options[i] === o && !res.correct) b.classList.add('wrong');
          });
          if (res.correct) feedback(P, true, pick(GOOD), null, s.t === 'cloze' ? s.sentence.replace(/_{2,}/, s.answer) : c.en);
          else feedback(P, false, 'כמעט! 💡', wrongDetail(s, c), s.t === 'cloze' ? s.sentence.replace(/_{2,}/, s.answer) : c.en);
        });
        if (!r) btns.forEach(b => (b.disabled = false));
      }
    }, labelFn(o).text));
    return h('div.opts', btns);
  }

  function mc(P, s, c) {
    const toHe = s.dir === 'en2he';
    frame(P, h('div.kid-card',
      h('div.q-title', toHe ? 'מה הפירוש של המילה?' : 'איך אומרים באנגלית?'),
      h('div.q-word', toHe ? [h('span.word-en.en', { lang: 'en', dir: 'ltr' }, c.en), WS.speakBtn(c.en)] : h('span.word-he', c.he)),
      options(P, s, c, o => ({ text: o, en: !toHe }))));
    if (toHe) WS.speak(c.en);
  }

  function cloze(P, s, c) {
    const parts = s.sentence.split(/_{2,}/);
    frame(P, h('div.kid-card',
      h('div.q-title', 'איזו מילה משלימה את המשפט?'),
      h('div.cloze.en', { lang: 'en', dir: 'ltr' }, parts[0], h('span.blank', ' '), parts.slice(1).join(' ')),
      options(P, s, c, o => ({ text: o, en: true }))));
  }

  function typeEx(P, s, c) {
    const input = h('input.typebox', { type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', lang: 'en', dir: 'ltr', 'aria-label': 'התשובה באנגלית' });
    const hint = h('div.hint');
    const check = h('button.big-btn.green', {
      onclick: async () => {
        if (!input.value.trim()) { input.focus(); return; }
        check.disabled = true; input.disabled = true;
        const r = await answerAndShow(P, s, { answer: input.value }, (res) => {
          if (res.correct) feedback(P, true, pick(GOOD), res.typo ? h('div', 'שימו לב לאיות: ', h('b', en(s.answer))) : null, s.answer);
          else feedback(P, false, 'כמעט! 💡', wrongDetail(s, c), s.answer);
        });
        if (!r) { check.disabled = false; input.disabled = false; }
      }
    }, 'בדיקה ✓');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') check.click(); });
    frame(P, h('div.kid-card',
      h('div.q-title', 'כתבו את המילה באנגלית'),
      h('div.q-word', h('span.word-he', c.he)),
      hint, input,
      h('div.center', h('button.btn.ghost', {
        onclick: () => {
          hint.textContent = s.answer[0] + ' ' + s.answer.slice(1).replace(/[a-z]/gi, '_ ').trim();
        }
      }, '💡 רמז')),
      check));
    setTimeout(() => input.focus(), 50);
  }

  function match(P, s) {
    const state = { sel: null, done: new Set(), wrong: new Set() };
    const leftBtns = {}, rightBtns = {};
    const pairs = Object.fromEntries(s.pairs.map(p => [p.w, p]));
    const onPick = (side, w) => {
      if (state.done.has(w) && state.sel?.side !== side) return;
      if (!state.sel || state.sel.side === side) {
        Object.values(side === 'l' ? leftBtns : rightBtns).forEach(b => b.classList.remove('sel'));
        state.sel = { side, w };
        (side === 'l' ? leftBtns : rightBtns)[w].classList.add('sel');
        if (side === 'l') WS.speak(pairs[w].en);
        return;
      }
      const lw = side === 'l' ? w : state.sel.w;
      const rw = side === 'r' ? w : state.sel.w;
      leftBtns[lw].classList.remove('sel'); rightBtns[rw].classList.remove('sel');
      state.sel = null;
      if (lw === rw) {
        state.done.add(lw);
        leftBtns[lw].classList.add('done'); rightBtns[rw].classList.add('done');
        leftBtns[lw].disabled = true; rightBtns[rw].disabled = true;
        if (state.done.size === s.ws.length) finishMatch();
      } else {
        state.wrong.add(lw);
        for (const b of [leftBtns[lw], rightBtns[rw]]) { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); }
      }
    };
    const finishMatch = () => answerAndShow(P, s, { results: s.ws.map(w => ({ w, correct: !state.wrong.has(w) })) }, (res) => {
      if (res.correct) feedback(P, true, pick(GOOD) + ' כל ההתאמות נכונות', null);
      else feedback(P, true, 'יופי! השלמת את ההתאמה 👍', h('div', 'את המילים שהיו קשות נתרגל שוב בסוף.'));
    });
    const left = s.ws.map(w => (leftBtns[w] = h('button.mitem.en', { lang: 'en', dir: 'ltr', onclick: () => onPick('l', w) }, pairs[w].en)));
    const right = s.right.map(w => (rightBtns[w] = h('button.mitem', { onclick: () => onPick('r', w) }, pairs[w].he)));
    frame(P, h('div.kid-card',
      h('div.q-title', { style: { marginBottom: '14px' } }, 'התאימו כל מילה לתרגום שלה'),
      h('div.match', h('div.col', left), h('div.col', right))));
  }

  async function finish(P) {
    if (P.preview) {
      frame(P, h('div.kid-card.stage', h('div.emo', '✅'), h('h2', 'סוף התצוגה המקדימה'),
        h('button.big-btn.blue', { onclick: () => P.onExit() }, 'חזרה לשיעור')));
      return;
    }
    let sum;
    try { sum = await WS.post(`child/lesson/${P.id}/complete`); } catch (e) { WS.fail(e); return; }
    WS.me.child.stars = sum.totalStars;
    summary(sum);
  }

  function summary(s) {
    shell(h('div',
      h('div.kid-card.center',
        h('div', { style: { fontSize: '72px' } }, s.pct >= 80 ? '🏆' : '🎉'),
        h('h2', `${g('סיימת', 'סיימת', 'סיימתם')} את השיעור!`),
        h('div', { style: { fontSize: '22px', fontWeight: 800, color: '#d97706' } }, `+${s.stars} ⭐`),
        s.milestone ? h('div.milestone', `🏅 אבן דרך: ${s.milestone} מילים באנגלית!`) : null,
        h('div.sum-tiles',
          h('div', h('b', String(s.newWords)), 'מילים חדשות'),
          h('div', h('b', String(s.practiced)), 'מילים שתרגלנו'),
          h('div', h('b', `${s.correct}/${s.total}`), 'תשובות נכונות'),
          h('div', h('b', s.pct + '%'), 'הצלחה')),
        h('p', { style: { fontSize: '19px', fontWeight: 700 } }, s.message)),
      s.weak.length ? h('div.kid-card',
        h('h3', '💪 מילים שכדאי לחזק'),
        h('p.muted', 'הן יופיעו שוב בשיעורים הבאים — ככה לומדים!'),
        h('div.wlist', s.weak.map(w => h('div.w', h('span.grow', en(w.en), ' — ', w.he), WS.speakBtn(w.en))))) : null,
      h('button.big-btn.blue', { onclick: () => WS.go('#/') }, 'לדף הבית 🏠')
    ), 'home');
  }
})();
