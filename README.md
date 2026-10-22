# WordSteps — תוסף Home Assistant

אפליקציה ללימוד אוצר מילים באנגלית לילדים, לפי האפיון (PRD) שסופק. התיעוד למשתמש: [wordsteps/DOCS.md](wordsteps/DOCS.md).

## מבנה

```
repository.yaml          ריפו תוספים של HA
wordsteps/
  config.yaml            הגדרות התוסף (Ingress, הרשאות, אפשרויות)
  Dockerfile, run.sh     Alpine + Node, בלי תלויות npm
  server/
    main.js              שרת HTTP, זיהוי משתמש לפי כותרות Ingress, כל נתיבי ה-API
    store.js             מאגר JSON בכתיבה אטומית + גיבוי יומי
    lessons.js           הכנת שיעור, אישור, רצף תרגילים, בדיקת תשובות, סיכום
    srs.js               חזרות במרווחי זמן ומצבי שליטה במילה
    scheduler.js         הכנה יומית, התראות ותזכורות
    gemini.js            יצירת מילים/תוכן/איורים
    images.js            Openverse, שמירה והעלאה
    ha.js                משתמשים, שירותי notify, שליחת התראות
    reports.js           דוחות ולוח בקרה
  public/                ממשק (HTML/CSS/JS בלי בנייה): app.js משותף, child.js, admin.js
  test/                  בדיקות תרחישים (node --test)
  dev.js                 הרצה מקומית
```

## פיתוח

```bash
cd wordsteps && npm test
```

```bash
cd wordsteps && node dev.js
```

ואז `http://localhost:8790/?as=admin` (מנהל) או `http://localhost:8790/?as=kid1` (ילד לדוגמה).
במצב פיתוח אין IP-guard ואין התראות אמיתיות. לחיבור ל-HA אמיתי: `HA_URL` + `HA_TOKEN`; ל-Gemini: `GEMINI_API_KEY`.
