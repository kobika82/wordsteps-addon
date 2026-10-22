'use strict';
// מאגר הנתונים: אובייקט אחד בזיכרון שנכתב אטומית ל-/data/store.json (נכלל בגיבויי Home Assistant).
// השרת חד-תהליכוני, ולכן כל שינוי מתבצע ברצף; הכתיבה לדיסק מאוחדת ונעשית דרך קובץ זמני ו-rename.
const fs = require('fs');
const path = require('path');

const KEEP_BACKUPS = 30;

function emptyData() {
  return {
    version: 1,
    seq: { child: 0, word: 0, lesson: 0, item: 0, answer: 0, notif: 0 },
    settings: {
      adminNotifyService: '',     // notify.mobile_app_* של המנהל
      prepTime: '19:00',          // שעת הכנת שיעורי המחר והודעה למנהל
      daysAhead: 1,               // כמה ימים קדימה להכין אוטומטית
      imageSource: 'arasaac',     // arasaac (ואז openverse) | openverse | gemini | none — הצעת תמונה אוטומטית למילים חדשות
      notifyReviewDays: true,     // לשלוח התראה גם ביום שיש בו רק שיעור חזרה
      adminUserIds: [],           // מנהלים נוספים שהוגדרו מתוך האפליקציה
      migratedArasaac: true,
      migratedAutoLessons: true
    },
    users: {},          // משתמשי HA שנכנסו לאפליקציה: { id: {id,name,displayName,lastSeen} }
    children: [],
    words: [],
    lessons: [],
    progress: {},       // { childId: { wordId: {...} } }
    answers: [],
    notifications: [],
    adminNotices: []    // הודעות מערכת למנהל (למשל: אין מילים חדשות מתאימות)
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
      // 0.1.3: ARASAAC הפך לברירת המחדל לתמונות (המשתמש בחר בכך)
      if (!(d.settings && d.settings.migratedArasaac)) { if (data.settings.imageSource === 'openverse') data.settings.imageSource = 'arasaac'; data.settings.migratedArasaac = true; }
      // 0.2.0: שיעורים נבנים אוטומטית ממילים מאושרות. שיעורים יומיים שהוכנו מראש ולא התחילו — נמחקים ונבנים מחדש.
      if (!(d.settings && d.settings.migratedAutoLessons)) {
        data.lessons = data.lessons.filter(l => !(l.kind === 'daily' && (l.status === 'pending' || l.status === 'approved')));
        data.settings.migratedAutoLessons = true;
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

  // ---- גישה נוחה ----
  child(id) { return this.data.children.find(c => c.id === Number(id)); }
  word(id) { return this.data.words.find(w => w.id === Number(id)); }
  lesson(id) { return this.data.lessons.find(l => l.id === Number(id)); }
  childProgress(childId) {
    const p = this.data.progress;
    if (!p[childId]) p[childId] = {};
    return p[childId];
  }
}

module.exports = { Store, emptyData };
