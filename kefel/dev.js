'use strict';
// הרצה מקומית לפיתוח: נתונים ב-dev-data-kefel, זהות לפי ?as=admin / ?as=<משתמש>, בלי התראות אמיתיות.
// בפעם הראשונה נוצר ילד לדוגמה (משתמש "kid1") שנפתחה לו כפולות של 3.
const path = require('path');
process.env.KEFEL_DEV = '1';
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'dev-data-kefel');
process.env.PORT = process.env.PORT || '8791';

const { server, store, init } = require('./server/main');

if (!store.data.children.length) {
  store.data.children.push({
    id: store.nextId('child'), name: 'דני', gender: 'm', notifyTime: '16:00', days: [0, 1, 2, 3, 4, 5, 6], haUserId: 'kid1',
    notifyService: '', active: true, reminderEnabled: false, reminderAfterMin: 120,
    tables: [{ n: 3, openedAt: new Date().toISOString(), learnedAt: null, readyAt: null }], current: 3,
    stars: 0, starsEarned: 0, createdAt: new Date().toISOString()
  });
  store.flush();
}

server.listen(Number(process.env.PORT), () => {
  console.log(`Kefel dev: http://localhost:${process.env.PORT}/?as=admin  |  ילד: http://localhost:${process.env.PORT}/?as=kid1`);
  init();
});
