// GAS のにせもの（Node で Code.gs を動かすため）
// シートは「書式が @ でない列に YYYY-MM-DD や YYYY年M月D日 の文字を書くと Date に変わる」くせもまねる
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function tokyoParts(d) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = {};
  f.formatToParts(d).forEach(p => { o[p.type] = p.value; });
  return o;
}

function makeSheet(name) {
  const sh = {
    name, rows: [], formats: {}, maxRows: 1000, frozen: 0, formulas: {},
    getName: () => sh.name,
    setName: n => { sh.name = n; return sh; },
    getLastRow: () => sh.rows.length,
    getLastColumn: () => sh.rows.reduce((m, r) => Math.max(m, r.length), 0),
    getMaxRows: () => sh.maxRows,
    insertRowsAfter: (after, n) => { sh.maxRows += n; },
    setFrozenRows: n => { sh.frozen = n; },
    getRange: (a, b, c, d) => {
      if (typeof a === 'string') return { setFormula: f => { sh.formulas[a] = f; } };
      return makeRange(sh, a, b, c || 1, d || 1);
    }
  };
  return sh;
}

function convertLikeSheets(v) {
  if (typeof v !== 'string') return v;
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], -9)); // 東京の0時
  m = v.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], -9));
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function makeRange(sh, row, col, nr, nc) {
  const r = {
    setValues: vals => {
      if (row + nr - 1 > sh.maxRows) throw new Error('範囲がシートの外です（行 ' + (row + nr - 1) + ' > ' + sh.maxRows + '）');
      for (let i = 0; i < nr; i++) {
        const target = row + i - 1;
        while (sh.rows.length <= target) sh.rows.push([]);
        for (let j = 0; j < nc; j++) {
          const isText = sh.formats[(col + j) + ':' + (row + i)] === '@' || sh.formats['col' + (col + j)] === '@';
          let v = vals[i][j];
          sh.rows[target][col + j - 1] = isText ? (v === '' ? '' : (typeof v === 'number' ? String(v) : v)) : convertLikeSheets(v);
        }
      }
      return r;
    },
    setValue: v => r.setValues([[v]]),
    getValues: () => {
      const out = [];
      for (let i = 0; i < nr; i++) {
        const src = sh.rows[row + i - 1] || [];
        const line = [];
        for (let j = 0; j < nc; j++) line.push(src[col + j - 1] === undefined ? '' : src[col + j - 1]);
        out.push(line);
      }
      return out;
    },
    setNumberFormat: f => {
      if (row === 1 && nr >= sh.maxRows) sh.formats['col' + col] = f;
      else for (let i = 0; i < nr; i++) sh.formats[col + ':' + (row + i)] = f;
      return r;
    },
    setFontWeight: () => r,
    setBackground: () => r
  };
  return r;
}

function createEnv() {
  const sheets = [];
  const props = {};
  const mails = [];
  const files = [];
  const folders = {};
  const calendars = [];
  const triggers = [];
  let folderSeq = 0, fileSeq = 0, evSeq = 0;

  function makeFolder(name, parent) {
    const f = {
      id: 'folder_' + (++folderSeq), name, parent, children: [],
      getId: () => f.id,
      getFoldersByName: n => iter(f.children.filter(c => c.name === n && c.kind === 'folder')),
      createFolder: n => { const c = makeFolder(n, f); c.kind = 'folder'; f.children.push(c); return c; },
      createFile: blob => { const file = { id: 'file_' + (++fileSeq), name: blob.name, parent: f, sharing: null,
        getId: () => file.id, setSharing: (a, p) => { file.sharing = [a, p]; }, moveTo: dest => { file.parent = dest; } };
        files.push(file); return file; },
      getFolders: () => iter(f.children.filter(c => c.kind === 'folder')),
      getFiles: () => iter(files.filter(x => x.parent === f)),
      moveTo: dest => { f.parent.children = f.parent.children.filter(c => c !== f); f.parent = dest; dest.children.push(f); }
    };
    f.kind = 'folder';
    folders[f.id] = f;
    return f;
  }
  function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
  const root = makeFolder('マイドライブ', null);

  const ss = {
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    insertSheet: n => { const s = makeSheet(n); sheets.push(s); return s; },
    getUrl: () => 'https://docs.google.com/spreadsheets/d/fake',
    getId: () => 'fake_ss',
    setActiveSheet: () => {}, moveActiveSheet: () => {}
  };

  function makeCalendar(name) {
    const cal = { id: 'cal_' + (calendars.length + 1), name, events: [],
      getId: () => cal.id,
      getEventById: id => cal.events.find(e => e.id === id && !e.deleted) || null,
      createAllDayEvent: (title, day) => { const ev = { id: 'ev_' + (++evSeq), title, day, deleted: false,
        getId: () => ev.id, setTitle: t => { ev.title = t; }, setAllDayDate: d => { ev.day = d; }, deleteEvent: () => { ev.deleted = true; } };
        cal.events.push(ev); return ev; } };
    calendars.push(cal);
    return cal;
  }

  const sandbox = {
    console: { log: () => {}, warn: () => {} },
    JSON, Math, Date, String, Number, Array, Object, isNaN, parseInt, parseFloat, Error,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, open: () => ss, create: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) },
    Utilities: {
      formatDate: (d, tz, pat) => {
        const p = tokyoParts(d);
        return pat.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
      },
      base64Decode: s => Buffer.from(s, 'base64'),
      base64EncodeWebSafe: s => Buffer.from(String(s), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      newBlob: (bytes, type, name) => ({ bytes, type, name })
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'anyone' }, Permission: { VIEW: 'view' },
      getRootFolder: () => root,
      getFolderById: id => { if (!folders[id]) throw new Error('no folder'); return folders[id]; },
      getFoldersByName: n => iter(Object.values(folders).filter(f => f.name === n)),
      getFilesByName: () => iter([]),
      createFolder: n => root.createFolder(n)
    },
    CalendarApp: {
      Color: { GREEN: 'green' },
      getCalendarById: id => calendars.find(c => c.id === id) || null,
      getCalendarsByName: n => calendars.filter(c => c.name === n),
      createCalendar: n => makeCalendar(n)
    },
    MailApp: { sendEmail: (to, subject, body) => { mails.push({ to, subject, body }); } },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: fn => { const b = { everyDays: () => b, atHour: h => { b.hour = h; return b; }, inTimezone: () => b, timeBased: () => b,
        create: () => { const t = { getHandlerFunction: () => fn, hour: b.hour }; triggers.push(t); return t; } }; return b; }
    }
  };
  const ctx = vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', '..', 'gas', 'Code.gs'), 'utf8');
  vm.runInContext(code, ctx, { filename: 'Code.gs' });

  const api = {
    ctx, sheets, props, mails, files, calendars, triggers, root, ss, makeFolder,
    reset: () => { vm.runInContext('ensured_ = false; ss__ = null;', ctx); },
    post: body => { api.reset(); return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text); },
    get: params => { api.reset(); return JSON.parse(ctx.doGet({ parameter: params }).text); },
    run: name => { api.reset(); return ctx[name](); },
    sheet: n => sheets.find(s => s.name === n),
    table: n => { const s = api.sheet(n); const head = s.rows[0]; return s.rows.slice(1).map(r => { const o = {}; head.forEach((h, i) => { o[h] = r[i]; }); return o; }); },
    addLegacy: (name, header, rows) => { const s = makeSheet(name); s.rows.push(header); rows.forEach(r => s.rows.push(r.map(convertLikeSheets))); sheets.push(s); return s; }
  };
  return api;
}

module.exports = { createEnv, tokyoParts };
