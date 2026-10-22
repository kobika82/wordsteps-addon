// קורא xlsx פרוס: מחזיר לכל גיליון את השם ואת השורות (טקסט)
const fs = require('fs'), path = require('path');
function readXlsx(dir) {
const ss = fs.readFileSync(path.join(dir, 'xl/sharedStrings.xml'), 'utf8');
const strings = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
const wb = fs.readFileSync(path.join(dir, 'xl/workbook.xml'), 'utf8');
const names = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(m => m[1]);
  const out = names.map((name, i) => {
  const x = fs.readFileSync(path.join(dir, `xl/worksheets/sheet${i + 1}.xml`), 'utf8');
  const rows = [...x.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(r => [...r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(c => {
    const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] || ''); const t = /t="(\w+)"/.exec(c[2]);
    const is = /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] || '');
    return { col: c[1], val: t && t[1] === 's' && v ? strings[+v[1]] : (is ? is[1] : v ? v[1] : '') };
  }).filter(c => c.val !== ''));
  return { name, rows };
});
  return out;
}
module.exports = { readXlsx };
