'use strict';
// חיבור ל-Home Assistant: משתמשים, שירותי התראה של אפליקציית הטלפון, ושליחת התראות.
// בתוך התוסף עובדים מול ה-Supervisor עם SUPERVISOR_TOKEN; בפיתוח מקומי אפשר HA_URL + HA_TOKEN.
const { HttpError } = require('./util');

const SUP_TOKEN = process.env.SUPERVISOR_TOKEN || '';
const HA_URL = (process.env.HA_URL || '').replace(/\/$/, '');
const HA_TOKEN = process.env.HA_TOKEN || '';

const mode = SUP_TOKEN ? 'supervisor' : (HA_URL && HA_TOKEN ? 'direct' : 'none');
const REST = mode === 'supervisor' ? 'http://supervisor/core/api' : HA_URL + '/api';
const WS = mode === 'supervisor' ? 'ws://supervisor/core/websocket' : HA_URL.replace(/^http/, 'ws') + '/api/websocket';
const TOKEN = SUP_TOKEN || HA_TOKEN;

function connected() { return mode !== 'none'; }
function requireHa() { if (!connected()) throw new HttpError(503, 'אין חיבור ל-Home Assistant'); }

async function rest(method, p, body) {
  requireHa();
  let res;
  try {
    res = await fetch(REST + p, {
      method, signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) { throw new HttpError(502, 'Home Assistant לא זמין: ' + e.message); }
  const text = await res.text();
  if (!res.ok) throw new HttpError(502, `Home Assistant החזיר ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function wsCommand(cmd) {
  requireHa();
  return new Promise((resolve, reject) => {
    let ws;
    const timer = setTimeout(() => done(new HttpError(504, 'תם הזמן מול Home Assistant')), 15000);
    function done(err, val) {
      clearTimeout(timer);
      try { ws.close(); } catch (e) { /* כבר סגור */ }
      err ? reject(err) : resolve(val);
    }
    try { ws = new WebSocket(WS); } catch (e) { return done(new HttpError(502, e.message)); }
    ws.onerror = () => done(new HttpError(502, 'חיבור WebSocket ל-Home Assistant נכשל'));
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: TOKEN }));
      else if (m.type === 'auth_invalid') done(new HttpError(502, 'ההרשאה מול Home Assistant נדחתה'));
      else if (m.type === 'auth_ok') ws.send(JSON.stringify({ ...cmd, id: 1 }));
      else if (m.type === 'result' && m.id === 1) {
        m.success ? done(null, m.result) : done(new HttpError(502, m.error?.message || 'הפקודה נכשלה'));
      }
    };
  });
}

// משתמשי HA (לא כולל משתמשי מערכת)
let usersCache = { at: 0, list: null };
async function listUsers() {
  if (usersCache.list && Date.now() - usersCache.at < 5 * 60 * 1000) return usersCache.list;
  const raw = await wsCommand({ type: 'config/auth/list' });
  const list = raw.filter(u => !u.system_generated).map(u => ({
    id: u.id, name: u.name, username: u.username || (u.credentials || [])[0]?.data?.username || '',
    isAdmin: !!(u.is_owner || u.is_admin || (u.group_ids || []).includes('system-admin')),
    active: u.is_active !== false
  }));
  usersCache = { at: Date.now(), list };
  return list;
}

async function notifyServices() {
  const services = await rest('GET', '/services');
  const notify = services.find(s => s.domain === 'notify');
  return Object.keys(notify?.services || {}).filter(s => s.startsWith('mobile_app_')).sort();
}

// שליחת התראה לאפליקציית הטלפון. url פותח את הנתיב בתוך אפליקציית HA
async function notify(service, { title, message, url }) {
  if (!/^mobile_app_[a-z0-9_]+$/.test(service || '')) throw new HttpError(400, 'שירות התראה לא תקין');
  const data = url ? { url, clickAction: url } : undefined;
  await rest('POST', `/services/notify/${service}`, { title, message, data });
}

async function config() { return rest('GET', '/config'); }

// פרטי התוסף עצמו (לבניית קישור הפאנל בהתראה)
async function selfInfo() {
  if (mode !== 'supervisor') return null;
  try {
    const res = await fetch('http://supervisor/addons/self/info', {
      headers: { Authorization: `Bearer ${SUP_TOKEN}` }, signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    return (await res.json()).data || null;
  } catch (e) { return null; }
}

module.exports = { mode, connected, rest, wsCommand, listUsers, notifyServices, notify, config, selfInfo };
