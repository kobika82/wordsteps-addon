'use strict';
// מאגר הנתונים: אובייקט אחד בזיכרון שנכתב אטומית ל-/data/store.json (נכלל בגיבויי Home Assistant).
// השרת חד-תהליכוני, ולכן כל שינוי מתבצע ברצף; הכתיבה לדיסק מאוחדת ונעשית דרך קובץ זמני ו-rename.
const fs = require('fs');
const path = require('path');

const KEEP_BACKUPS = 30;

function emptyData() {
  return {
    version: 1,
    seq: { child: 0, session: 0, notif: 0, redemption: 0, notice: 0 },
    settings: {
      adminNotifyService: '',        // notify.mobile_app_* של ההורה
      adminUserIds: [],              // מנהלים נוספים שהוגדרו מתוך האפליקציה
      questions: 10,                 // שאלות בתרגול היומי (בלי חזרות על טעויות)
      soloDays: 2,                   // ימי תרגול על הכפולה החדשה לבד, אחרי יום הלימוד
      mixMaxTables: 4,               // בחזרה על כל הכפולות: כמה כפולות לכל היותר בתרגול אחד
      notifyAdminSessionDone: true,  // דיווח להורה מיד כשהילד מסיים
      notifyAdminReady: true,        // הודעה להורה כשנגמרו ימי הכפולה לבד: לפתוח חדשה או לעבור לחזרה
      notifyChildOnUnlock: true,     // הודעה לילד כשנפתחת לו כפולה חדשה
      notifyAdminDaySummary: false,  // סיכום יומי להורה
      summaryTime: '20:30',          // שעת הסיכום והקנס (אם מוגדר)
      stars: null,                   // נוסחת הכוכבים; null = ברירת המחדל ב-rewards.js
      rewards: [                     // קטלוג הפרסים; ההורה יכול לשנות הכול
        { id: 1, emoji: '🎲', name: 'משחק קופסה עם אבא או אמא', cost: 40, active: true },
        { id: 2, emoji: '🍦', name: 'גלידה', cost: 60, active: true },
        { id: 3, emoji: '🎬', name: 'ערב סרט בבית', cost: 120, active: true },
        { id: 4, emoji: '🧸', name: 'צעצוע קטן', cost: 250, active: true },
        { id: 5, emoji: '📱', name: 'אייפון חדש', cost: 99999, active: true, joke: true }
      ]
    },
    users: {},          // משתמשי HA שנכנסו לאפליקציה: { id: {id,name,displayName,lastSeen} }
    children: [],
    sessions: [],
    facts: {},          // { childId: { '3x4': {...} } } — עובדה אחת לכל זוג, בלי חשיבות לסדר
    notifications: [],
    notices: [],        // הודעות למנהל בלוח הבקרה
    redemptions: []     // בקשות פרס: pending / given / denied
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'store.json');
    this.backupDir = path.join(dir, 'backups');
    this.timer = null;
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.data = this.load();
  }

  load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const base = emptyData();
      // השלמת שדות שנוספו בגרסאות מאוחרות יותר
      const data = { ...base, ...d, seq: { ...base.seq, ...d.seq }, settings: { ...base.settings, ...d.settings } };
      // 0.3.0: התבניות ציור וגורם חסר הוסרו. תרגול פתוח שמכיל אותן נסגר, ומחר נבנה חדש.
      for (const s of data.sessions || []) {
        if (s.status === 'in_progress' && (s.plan || []).some(st => ['pic', 'miss'].includes(st.t))) s.status = 'abandoned';
      }
      return data;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // קובץ פגום — לא דורסים אותו בשקט
        const bad = this.file + '.corrupt-' + Date.now();
        try { fs.copyFileSync(this.file, bad); } catch (x) { /* אין מה להעתיק */ }
        console.error('store.json could not be read, copied to', bad, e.message);
      }
      return emptyData();
    }
  }

  nextId(kind) {
    this.data.seq[kind] = (this.data.seq[kind] || 0) + 1;
    return this.data.seq[kind];
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 150);
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.backupDaily();
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  backupDaily() {
    if (!fs.existsSync(this.file)) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const target = path.join(this.backupDir, `store-${stamp}.json`);
    if (fs.existsSync(target)) return;
    fs.copyFileSync(this.file, target);
    const all = fs.readdirSync(this.backupDir).filter(f => f.endsWith('.json')).sort();
    for (const f of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.unlinkSync(path.join(this.backupDir, f));
  }

  child(id) { return this.data.children.find(c => c.id === Number(id)); }
  session(id) { return this.data.sessions.find(s => s.id === Number(id)); }
  childFacts(childId) {
    const f = this.data.facts;
    if (!f[childId]) f[childId] = {};
    return f[childId];
  }
}

module.exports = { Store, emptyData };
