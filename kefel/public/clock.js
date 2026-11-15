'use strict';
// שעון אנלוגי שאפשר לגרור את המחוגים שלו, ותצוגה דיגיטלית לצידו.
//
// הלב של המודול הוא פונקציה אחת, face(), שמחזירה SVG חי: היא מציירת את
// הלוח פעם אחת ומזיזה רק את המחוגים. אותו רכיב משמש גם את מגרש המשחקים
// וגם את השאלות, כדי שהילד יראה בדיוק את אותו שעון בשני המקומות.
//
// הספרות גדולות וברורות, ויש קו ארוך בכל 5 דקות וקו קצר בכל דקה — ככה
// ילד יכול לספור חמישיות ולא לנחש.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const KF = window.KF;
  const el = (name, attrs = {}) => {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    return n;
  };
  const pad = (n) => String(n).padStart(2, '0');

  // 14:05 בפורמט שההורה בחר. ב-12 שעות מוצג גם בוקר/אחר הצהריים, כי
  // "2:05" לבד לא אומר לילד אם זה לפני הצהריים או אחריו.
  function digital(hour, minute, h24) {
    const hh = h24 ? hour : (hour % 12 === 0 ? 12 : hour % 12);
    const txt = `${h24 ? pad(hh) : hh}:${pad(minute)}`;
    return h24 ? txt : `${txt} ${hour < 12 ? 'בבוקר' : 'אחה״צ'}`;
  }

  // "שתיים וחמישה" — מה שאומרים בקול, ולא מה שכתוב בספרות
  const WORDS_H = ['שתים עשרה', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע', 'עשר', 'אחת עשרה'];
  function spoken(hour, minute) {
    const h = WORDS_H[hour % 12];
    const part = hour < 12 ? 'בבוקר' : 'אחר הצהריים';
    if (minute === 0) return `${h} ${part} בדיוק`;
    if (minute === 15) return `${h} ורבע ${part}`;
    if (minute === 30) return `${h} וחצי ${part}`;
    if (minute === 45) return `רבע ל${WORDS_H[(hour + 1) % 12]} ${part}`;
    if (minute < 30) return `${h} ו${KF.num(minute)} דקות ${part}`;
    return `${KF.num(60 - minute)} דקות ל${WORDS_H[(hour + 1) % 12]} ${part}`;
  }

  // ---------- לוח השעון ----------
  // size הוא ריבוע; כל המידות יחסיות אליו, כדי שאותו קוד ישרת שעון גדול
  // במגרש המשחקים ושעונים קטנים בשאלת בחירה מרובה.
  function face(opts = {}) {
    const size = opts.size || 300;
    const R = 50;                      // רדיוס בקואורדינטות פנימיות (viewBox 0..100)
    const cx = 50, cy = 50;
    let hour = opts.hour ?? 10;
    let minute = opts.minute ?? 10;
    const step = opts.step || 1;       // קפיצות הגרירה של מחוג הדקות
    const draggable = !!opts.draggable;

    // ה-viewBox רחב מהלוח כדי שמספרי הדקות שיושבים מחוצה לו — 0, 15, 30, 45 —
    // לא ייחתכו בקצוות. בלי השוליים האלה דווקא הרבעים, שהם החשובים, נעלמים.
    const svg = el('svg', { viewBox: '-8 -8 116 116', class: 'clockface', width: size, height: size,
      role: 'img', 'aria-label': 'שעון אנלוגי' });
    if (draggable) svg.classList.add('drag');

    svg.appendChild(el('circle', { cx, cy, r: R - 1, class: 'cf-rim' }));

    // קווי הדקות: ארוך ועבה בכל חמש, קצר בכל דקה
    for (let m = 0; m < 60; m++) {
      const a = (m / 60) * 2 * Math.PI - Math.PI / 2;
      const five = m % 5 === 0;
      const r1 = five ? R - 9 : R - 6;
      const r2 = R - 3;
      svg.appendChild(el('line', {
        x1: cx + Math.cos(a) * r1, y1: cy + Math.sin(a) * r1,
        x2: cx + Math.cos(a) * r2, y2: cy + Math.sin(a) * r2,
        class: five ? 'cf-tick5' : 'cf-tick',
      }));
    }

    // הספרות 1..12
    for (let n = 1; n <= 12; n++) {
      const a = (n / 12) * 2 * Math.PI - Math.PI / 2;
      const t = el('text', { x: cx + Math.cos(a) * (R - 16), y: cy + Math.sin(a) * (R - 16) + 3.4, class: 'cf-num' });
      t.textContent = String(n);
      svg.appendChild(t);
    }

    // המספרים הקטנים של הדקות (5,10,...) — עוזרים לספור בלי לנחש
    if (opts.minuteNumbers !== false) {
      for (let m = 5; m <= 60; m += 5) {
        const a = (m / 60) * 2 * Math.PI - Math.PI / 2;
        const t = el('text', { x: cx + Math.cos(a) * (R + 4.5), y: cy + Math.sin(a) * (R + 4.5) + 1.6, class: 'cf-min' });
        t.textContent = String(m === 60 ? 0 : m);
        svg.appendChild(t);
      }
    }

    const hourHand = el('line', { class: 'cf-hand cf-hour', 'stroke-linecap': 'round' });
    const minHand = el('line', { class: 'cf-hand cf-min-hand', 'stroke-linecap': 'round' });
    svg.appendChild(hourHand);
    svg.appendChild(minHand);
    svg.appendChild(el('circle', { cx, cy, r: 2.6, class: 'cf-pin' }));

    function draw() {
      const ma = (minute / 60) * 2 * Math.PI - Math.PI / 2;
      // מחוג השעות זז עם הדקות: ב-3:30 הוא בין 3 ל-4, כמו בשעון אמיתי
      const ha = (((hour % 12) + minute / 60) / 12) * 2 * Math.PI - Math.PI / 2;
      minHand.setAttribute('x1', cx); minHand.setAttribute('y1', cy);
      minHand.setAttribute('x2', cx + Math.cos(ma) * (R - 10));
      minHand.setAttribute('y2', cy + Math.sin(ma) * (R - 10));
      hourHand.setAttribute('x1', cx); hourHand.setAttribute('y1', cy);
      hourHand.setAttribute('x2', cx + Math.cos(ha) * (R - 22));
      hourHand.setAttribute('y2', cy + Math.sin(ha) * (R - 22));
      svg.setAttribute('aria-label', `שעון: ${digital(hour, minute, true)}`);
    }
    draw();

    // ---------- גרירה ----------
    // בוחרים את המחוג שקצהו קרוב יותר לנקודת הלחיצה, וממשיכים איתו עד
    // שמרפים. בלי זה כל נגיעה הייתה קופצת בין המחוגים.
    let active = null;
    const polarAt = (ev) => {
      const r = svg.getBoundingClientRect();
      const x = ev.clientX - (r.left + r.width / 2);
      const y = ev.clientY - (r.top + r.height / 2);
      let a = Math.atan2(y, x) + Math.PI / 2;
      if (a < 0) a += 2 * Math.PI;
      const unit = (r.width / 116) * R;        // 116 = רוחב ה-viewBox עם השוליים
      return { frac: a / (2 * Math.PI), rad: Math.hypot(x, y) / unit };
    };
    const angleAt = (ev) => polarAt(ev).frac;
    const pick = (ev) => {
      const { frac, rad } = polarAt(ev);
      // נגיעה קרוב לשפה היא תמיד מחוג הדקות — רק הוא מגיע לשם. בלי זה
      // גרירה לצד הנגדי הייתה נתפסת כמחוג השעות רק כי הזווית קרובה אליו.
      if (rad > 0.62) return 'minute';
      // ולהפך: קרוב למרכז רק מחוג השעות קצר מספיק כדי להיתפס שם. בלי זה,
      // כששני המחוגים מצביעים לאותו כיוון, אי אפשר היה לגעת בקצר.
      if (rad < 0.50) return 'hour';
      const dMin = Math.abs(((frac - minute / 60 + 1.5) % 1) - 0.5);
      const dHour = Math.abs(((frac - ((hour % 12) + minute / 60) / 12 + 1.5) % 1) - 0.5);
      return dHour < dMin ? 'hour' : 'minute';
    };
    const apply = (ev) => {
      const frac = angleAt(ev);
      if (active === 'minute') {
        const m = Math.round((frac * 60) / step) * step;
        minute = ((m % 60) + 60) % 60;
      } else {
        // גרירת מחוג השעות משנה רק את השעה; הדקות נשארות
        // מחוג שעומד בין 7 ל-8 הוא 7, כמו בשעון אמיתי — ולא 8 כי הוא קרוב יותר.
        // עיגול לספרה הקרובה היה הופך 7:30 ל-8:30 בדיוק במקום שבו המחוג צריך לעמוד.
        const hh = Math.floor(frac * 12) % 12;
        hour = (hour >= 12 ? 12 : 0) + hh;
      }
      draw();
      if (opts.onChange) opts.onChange(hour, minute);
    };
    if (draggable) {
      svg.addEventListener('pointerdown', (ev) => {
        active = pick(ev);
        // תפיסת המצביע היא שיפור ולא תנאי: אם היא נכשלת הגרירה עדיין עובדת
        // בתוך הלוח, ולכן אסור לה להפיל את הטיפול בלחיצה.
        try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* ללא תפיסה */ }
        apply(ev);
        ev.preventDefault();
      });
      svg.addEventListener('pointermove', (ev) => { if (active) apply(ev); });
      const stop = (ev) => { if (active) { active = null; try { svg.releasePointerCapture(ev.pointerId); } catch (e) { /* שוחרר */ } } };
      svg.addEventListener('pointerup', stop);
      svg.addEventListener('pointercancel', stop);
    }

    return {
      el: svg,
      get hour() { return hour; },
      get minute() { return minute; },
      set(h, m) { hour = ((h % 24) + 24) % 24; minute = ((m % 60) + 60) % 60; draw(); },
    };
  }

  // שמות הרמות, כמו בשרת — הילד רואה אותם במסך הסיכום
  const LEVEL_NAMES = { 1: 'שעות עגולות וחצי', 2: 'עם רבעים', 3: 'כל 5 דקות' };
  const levelName = (n) => LEVEL_NAMES[Number(n)] || 'שעון';

  KF.clock = { face, digital, spoken, pad, levelName };
})();
