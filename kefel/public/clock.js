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
    // הגרירה מזיזה את המחוג שנבחר, ולא את זה שקרוב לאצבע. ניחוש לפי קרבה
    // נראה חכם עד שילד מזיז דקות ופתאום קופץ מחוג השעות.
    let hand = opts.hand === 'hour' ? 'hour' : 'minute';

    // ה-viewBox רחב מהלוח כדי שמספרי הדקות שיושבים מחוצה לו — 0, 15, 30, 45 —
    // לא ייחתכו בקצוות. בלי השוליים האלה דווקא הרבעים, שהם החשובים, נעלמים.
    // כשמסתירים אותם הלוח נפרש על כל התיבה במקום להשאיר שוליים ריקים.
    const BOX = { on: '-8 -8 116 116', off: '-2 -2 104 104' };
    const svg = el('svg', { viewBox: BOX.on, class: 'clockface', width: size, height: size,
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

    // המספרים הקטנים של הדקות (5,10,...) — עוזרים לספור בלי לנחש. הם בקבוצה
    // אחת כדי שאפשר יהיה לכבות אותם בלי לבנות את הלוח מחדש: אחרי שהילד כבר
    // יודע לספור חמישיות, הם קביים שכדאי להוריד.
    const mins = el('g', { class: 'cf-mins' });
    for (let m = 5; m <= 60; m += 5) {
      const a = (m / 60) * 2 * Math.PI - Math.PI / 2;
      const t = el('text', { x: cx + Math.cos(a) * (R + 4.5), y: cy + Math.sin(a) * (R + 4.5) + 1.6, class: 'cf-min' });
      t.textContent = String(m === 60 ? 0 : m);
      mins.appendChild(t);
    }
    svg.appendChild(mins);
    function showMinutes(on) {
      mins.style.display = on ? '' : 'none';
      svg.setAttribute('viewBox', on ? BOX.on : BOX.off);
    }
    showMinutes(opts.minuteNumbers !== false);

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
    // גוררים את המחוג שנבחר בבורר, בכל מקום על הלוח. אין כאן ניחוש: נגיעה
    // ליד מחוג אחד לא מזיזה את השני, וילד יכול לגרור מהשפה גם את מחוג
    // השעות הקצר.
    let active = null;
    const angleAt = (ev) => {
      const r = svg.getBoundingClientRect();
      const x = ev.clientX - (r.left + r.width / 2);
      const y = ev.clientY - (r.top + r.height / 2);
      let a = Math.atan2(y, x) + Math.PI / 2;
      if (a < 0) a += 2 * Math.PI;
      return a / (2 * Math.PI);                 // 0..1 סביב הלוח
    };
    const apply = (ev) => {
      const frac = angleAt(ev);
      if (active === 'minute') {
        const m = Math.round((frac * 60) / step) * step;
        minute = ((m % 60) + 60) % 60;
      } else {
        // גרירת מחוג השעות משנה רק את השעה; הדקות נשארות
        // הדקות כבר ידועות, ולכן ידוע גם כמה מחוג השעות אמור להיות מוסט מהספרה:
        // ב-7:30 הוא חצי מקטע אחרי ה-7. מחסרים את ההיסט ומעגלים — וכך 7:30 מתקבל
        // כשהמחוג באמצע בין 7 ל-8, ו-1:00 מתקבל גם כשהאצבע החטיאה את ה-1 בפיקסל.
        const hh = (((Math.round(frac * 12 - minute / 60) % 12) + 12) % 12);
        hour = (hour >= 12 ? 12 : 0) + hh;
      }
      draw();
      if (opts.onChange) opts.onChange(hour, minute);
    };
    if (draggable) {
      svg.addEventListener('pointerdown', (ev) => {
        active = hand;
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

    // המחוג הנבחר מודגש על הלוח עצמו, כדי שהבורר לא יהיה ההבטחה היחידה
    // לגבי מה עומד לזוז.
    function markHand() {
      svg.classList.toggle('sel-hour', draggable && hand === 'hour');
      svg.classList.toggle('sel-minute', draggable && hand === 'minute');
    }
    markHand();

    return {
      el: svg,
      get hour() { return hour; },
      get minute() { return minute; },
      get hand() { return hand; },
      setHand(h) { hand = h === 'hour' ? 'hour' : 'minute'; markHand(); },
      showMinutes,
      set(h, m) { hour = ((h % 24) + 24) % 24; minute = ((m % 60) + 60) % 60; draw(); },
    };
  }

  // שמות הרמות, כמו בשרת — הילד רואה אותם במסך הסיכום
  const LEVEL_NAMES = { 1: 'שעות עגולות וחצי', 2: 'עם רבעים', 3: 'כל 5 דקות' };
  const levelName = (n) => LEVEL_NAMES[Number(n)] || 'שעון';

  KF.clock = { face, digital, spoken, pad, levelName };
})();
