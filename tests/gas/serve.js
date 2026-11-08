// 本物の gas/Code.gs を、にせものの Google の上で動かす小さな送り先（画面との通しテスト用）
// 使い方：node tests/gas/serve.js <port>
'use strict';
const http = require('http');
const { URL } = require('url');
const { createEnv } = require('./fake_gas');

const env = createEnv();
const port = parseInt(process.argv[2], 10) || 8790;

function send(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const q = Object.fromEntries(u.searchParams.entries());
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    try {
      if (u.pathname === '/gas') {
        if (req.method === 'POST') return send(res, env.post(JSON.parse(body || '{}')));
        return send(res, env.get(q));
      }
      // ---- テストから中身を見る・さわる窓口 ----
      if (u.pathname === '/__run') { const r = env.run(q.name); return send(res, { ok: true, result: r === undefined ? null : JSON.parse(JSON.stringify(r)) }); }
      if (u.pathname === '/__table') return send(res, env.sheet(q.name) ? env.table(q.name) : null);
      if (u.pathname === '/__post') return send(res, env.post(JSON.parse(body || '{}')));
      if (u.pathname === '/__prop') { env.props[q.key] = q.value; return send(res, { ok: true }); }
      if (u.pathname === '/__calendars') return send(res, env.calendars.map(c => ({ name: c.name, events: c.events.filter(e => !e.deleted).map(e => e.title) })));
      if (u.pathname === '/__mails') return send(res, env.mails);
      res.writeHead(404); res.end();
    } catch (err) {
      res.writeHead(500); res.end(String(err && err.stack || err));
    }
  });
}).listen(port, '127.0.0.1', () => { console.log('ready ' + port); });
