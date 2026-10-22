'use strict';
// הרצה מקומית לפיתוח: נתונים ב-dev-data, זהות לפי ?as=admin / ?as=<משתמש>, בלי התראות אמיתיות.
// בפעם הראשונה נטענים מילים לדוגמה (כטיוטות) וילד לדוגמה המשויך למשתמש "kid1".
const path = require('path');
process.env.WORDSTEPS_DEV = '1';
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'dev-data');
process.env.PORT = process.env.PORT || '8790';

const { server, store, init } = require('./server/main');
const L = require('./server/lessons');

if (!store.data.words.length) {
  for (const w of require('./test/fixtures')) L.addWordToBank(store, { ...w, level: 'beginner' });
  store.data.children.push({
    id: store.nextId('child'), name: 'נועה', age: 8, gender: 'f', level: 'beginner', newPerDay: 5, reviewPerDay: 7,
    notifyTime: '16:00', days: [0, 1, 2, 3, 4, 5, 6], haUserId: 'kid1', notifyService: '', active: true, topics: [],
    exerciseTypes: ['mc', 'match', 'cloze', 'type'], reminderEnabled: false, reminderAfterMin: 120, stars: 0,
    createdAt: new Date().toISOString()
  });
  store.flush();
}

server.listen(Number(process.env.PORT), () => {
  console.log(`WordSteps dev: http://localhost:${process.env.PORT}/?as=admin  |  ילד: http://localhost:${process.env.PORT}/?as=kid1`);
  init();
});
