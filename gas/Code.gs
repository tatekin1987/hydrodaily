/**
 * HydroDaily GAS v2.0（2026-11-08 立て直し）
 *
 * 正本：Apps Script エディタの本番。このファイルは本番に貼る前の新しい版。
 * 本番の旧版の控え：C:\Users\admin\AI設定の控え\20261108_hydrodaily_本番GAS\Code.gs
 *
 * 守る決まり（DECISIONS.md ADR-011〜015）
 * - 書き込みはすべて applyRecord_ / applyPlan_ を通す：
 *     ①更新日時が新しい方が勝つ（古いか同じなら何も変えない）
 *     ②消した印は戻らない
 * - 日付は「YYYY-MM-DD」の文字（列の書式は @）。時刻は「HH:mm」。更新日時は ISO（UTC）
 * - 古い送り名（journal / save_record / save_log / delete_journal）と古い読み出し口（get_timeline / get_diary）も受ける
 * - 出し直しは「デプロイを管理 → 今のデプロイを編集 → 新しいバージョン」。新しいデプロイは作らない（URLが変わる）
 *
 * はじめに手で動かす関数（エディタ上部の ▶）
 *   1. setupHydro      … シート・写真フォルダ・カレンダー・毎朝の時計を用意（何度動かしても同じ）
 *   2. migrateOldTabs        … 旧タブ（cultivation_logs / journal_logs）を「記録」へ写す（記録に無い id だけ足す）
 *   3. checkMigration      … 旧タブの id がすべて「記録」にあるか確かめる
 *   4. renameOldTabs … 3 が合格したときだけ、旧タブの頭に「旧_」を付ける
 *   （試し）testMorningMail … 毎朝のメールを今すぐ1通送る
 */

const APP_VERSION = '2.0.0';
const SS_NAME = 'HydroDaily_栽培ログ';
const TZ = 'Asia/Tokyo';

const SHEET_RECORDS = '記録';
const SHEET_PLANS = '予定';
const SHEET_SETTINGS = '設定';
const SHEET_PESTS = '農薬一覧';
const SHEET_NOTIFIED = '通知済み';
const VIEW_BY_SYSTEM = '見る_系統別';
const VIEW_MONTHLY = '見る_月まとめ';
const VIEW_SPRAYS = '見る_農薬の履歴';
const LEGACY_LOG = 'cultivation_logs';
const LEGACY_JOURNAL = 'journal_logs';

const SYSTEMS = {
  bato: { name: 'BatoBucket', aliases: ['BatoBucket', 'bato', 'Bato', 'バトバケット'] },
  dwc: { name: 'DWC / NFT', aliases: ['DWC / NFT', 'DWC', 'dwc', 'NFT'] },
  tower: { name: 'タワー型', aliases: ['タワー型', 'タワー', 'tower'] }
};

const KINDS = ['液肥', '水替え', '農薬', '日誌'];

// 記録シートの列（順番を変えるときは移し替えも見直す）
const REC_COLS = ['日付', '時刻', '系統', '種類', 'EC', 'pH', '水温', '目標EC', '追肥mL',
  '農薬名', '倍率', '散布水量L', '薬量', '単位', 'メモ', '写真', 'id', '系統キー', '更新日時', '消した', '元'];
const REC_TEXT_COLS = ['日付', '時刻', '写真', 'id', '系統キー', '更新日時', 'メモ', '元'];

// 状態：予定（知らせ・カレンダーに出す）／提案（AIが書いた案。アプリで「採用」を押すまで出さない）
const PLAN_COLS = ['id', '年', '月', '時期', '系統', '作業', '内容', '済んだ日', 'カレンダー予定ID', '更新日時', '消した', '状態'];
const PLAN_TEXT_COLS = ['id', '時期', '済んだ日', 'カレンダー予定ID', '更新日時', '内容'];
const PLAN_WORKS = ['追肥', '水替え', '農薬', '種まき', '植え付け', '収穫', '片付け', '見直し', 'その他'];

const DEFAULT_SETTINGS = [
  ['目標EC_bato', '2.0', 'BatoBucket の目標EC（冬：スティックセニョール）'],
  ['目標EC_dwc', '1.6', 'DWC の目標EC（冬：サンチュ・小松菜・ルッコラ）'],
  ['目標EC_tower', '2.0', 'タワーの目標EC（冬：スティックセニョール）'],
  ['作物_bato', 'スティックセニョール', '画面に出す作物名'],
  ['作物_dwc', 'サンチュ・小松菜・ルッコラ', ''],
  ['作物_tower', 'スティックセニョール', ''],
  ['液肥の確認間隔_bato', '7', '前回のEC記録からこの日数で「ECを測る日」と知らせる'],
  ['液肥の確認間隔_dwc', '7', ''],
  ['液肥の確認間隔_tower', '5', 'タワーは水が少ないので短め'],
  ['水替えの間隔_bato', '30', '前回の水替えからこの日数で知らせる（水替えの記録が1度もなければ知らせない）'],
  ['水替えの間隔_dwc', '30', ''],
  ['水替えの間隔_tower', '21', ''],
  ['防除の間隔_bato', '', '空欄なら防除の知らせは出さない'],
  ['防除の間隔_dwc', '', ''],
  ['防除の間隔_tower', '', ''],
  ['おやすみ_bato', 'いいえ', '「はい」にすると、この系統の知らせを止める（冬に片付けたとき）'],
  ['おやすみ_dwc', 'いいえ', ''],
  ['おやすみ_tower', 'いいえ', ''],
  ['作付け開始日_bato', '2026-09-01', '農薬の「今作の使用回数」を数え始める日'],
  ['作付け開始日_dwc', '2026-09-01', ''],
  ['作付け開始日_tower', '2026-09-01', ''],
  ['再通知の間隔', '3', '知らせたあと、まだ記録がないとき何日ごとにもう一度知らせるか'],
  ['通知メール', '', '空欄なら、このスクリプトの持ち主のアドレスへ送る'],
  ['毎朝の時刻', '6', '毎朝のまとめを送る時（0〜23）。変えたら、スクリプトの setupHydro をもう一度動かす']
];

// 農薬一覧（倍率は今のアプリと同じ。間隔・上限・収穫前日数はラベルを見て人が入れる。空欄なら判定しない）
const DEFAULT_PESTS = [
  ['nenchakukun', '粘着くん液剤', 100, 'mL', '', '', '', 'アブラムシ類、ハダニ類、コナジラミ類、うどんこ病（デンプン系物理防除）'],
  ['sanyol', 'サンヨール', 500, 'mL', '', '', '', 'うどんこ病、灰色かび病、コナジラミ類、ハダニ類（DBEDC乳剤）'],
  ['wide_hitter', 'GFワイドヒッター顆粒水和剤', 1000, 'g', '', '', '', '殺菌：うどんこ病、べと病、疫病'],
  ['zentari', 'ゼンターリ顆粒水和剤', 1000, 'g', '', '', '', 'BT殺虫：アオムシ、コナガ、オオタバコガ、ヨトウムシ'],
  ['malathon', 'マラソン乳剤', 1000, 'mL', '', '', '', '殺虫：アブラムシ類、ハダニ類、スリップス、カメムシ'],
  ['koromite', 'コロマイト乳剤', 1000, 'mL', '', '', '', '殺ダニ：ハダニ類、サビダニ類'],
  ['prevathon', 'プレバソンフロアブル5', 2000, 'mL', '', '', '', '殺虫：オオタバコガ、コナガ、ハモグリバエ'],
  ['dyne', 'ダイン（展着剤）', 5000, 'mL', '', '', '', '展着剤：散布水1Lあたり0.2mL']
];
const PEST_COLS = ['id', '名前', '倍率', '単位', '散布の間隔(日)', '今作の上限回数', '収穫前日数', 'メモ'];

/* =========================================================
 * 入口
 * ========================================================= */

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const res = handlePost_(data);
    return json_(res);
  } catch (err) {
    return json_({ status: 'error', message: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    return json_(handleGet_(p));
  } catch (err) {
    return json_({ status: 'error', message: String(err && err.message || err) });
  }
}

function handlePost_(data) {
  const action = data.action;
  // 合言葉（スクリプトのプロパティ WRITE_TOKEN）。決めていないうちは、今までどおり誰でも書ける
  const token = PropertiesService.getScriptProperties().getProperty('WRITE_TOKEN');
  if (token && data.token !== token) return { status: 'error', message: '合言葉がちがうので書き込めません（アプリの設定で合言葉を入れてください）' };
  ensureSheets_();

  if (action === 'batch') {
    const ops = Array.isArray(data.ops) ? data.ops : [];
    const results = ops.map(op => {
      try { return handleOne_(op); }
      catch (err) { return { id: op && op.id, result: 'error', message: String(err && err.message || err) }; }
    });
    return { status: 'success', version: APP_VERSION, results: results };
  }

  const r = handleOne_(data);
  if (r.result === 'error') return { status: 'error', message: r.message, id: r.id };
  return Object.assign({ status: 'success', version: APP_VERSION }, r);
}

function handleOne_(op) {
  switch (op.action) {
    case 'upsert': return applyRecord_(normalizeRecord_(op.record || op, 'new'));
    case 'delete':
    case 'delete_record':
    case 'delete_journal': return deleteRecord_(op.id, op.updatedAt);
    case 'journal': return applyRecord_(normalizeRecord_(op, 'journal'));
    case 'save_record': return applyRecord_(normalizeRecord_(op, 'save_record'));
    case 'save_log': return applyRecord_(normalizeRecord_(op, 'save_log'));
    case 'save_plan': return applyPlan_(normalizePlan_(op.plan || op));
    case 'delete_plan': return deletePlan_(op.id);
    default: return { id: op && op.id, result: 'error', message: 'Invalid action: ' + (op && op.action) };
  }
}

function handleGet_(p) {
  const action = p.action;
  if (action === 'ping') return { status: 'success', version: APP_VERSION, time: new Date().toISOString() };

  ensureSheets_();

  if (action === 'get_records') {
    let list = readRecords_();
    if (p.since) list = list.filter(r => r.updatedAt > p.since);
    else if (p.include_deleted !== '1') list = list.filter(r => !r.deleted);
    if (p.system) list = list.filter(r => r.systemKey === p.system);
    if (p.kind) list = list.filter(r => r.kind === p.kind);
    if (p.from) list = list.filter(r => r.date >= p.from);
    if (p.to) list = list.filter(r => r.date <= p.to);
    if (p.id) list = list.filter(r => r.id === p.id);
    list.sort(byNewest_);
    const total = list.length;
    const offset = parseInt(p.offset, 10) || 0;
    const limit = parseInt(p.limit, 10) || 0;
    if (limit) list = list.slice(offset, offset + limit);
    return { status: 'success', version: APP_VERSION, total: total, records: list, server_time: new Date().toISOString() };
  }

  if (action === 'get_summary') return { status: 'success', version: APP_VERSION, summary: buildSummary_() };
  if (action === 'get_plans') return { status: 'success', version: APP_VERSION, plans: readPlans_().filter(x => !x.deleted) };
  if (action === 'get_today') return { status: 'success', version: APP_VERSION, today: todayStr_(), items: computeReminders_(todayStr_()) };
  if (action === 'get_settings') return { status: 'success', version: APP_VERSION, settings: readSettings_(), pesticides: readPests_(), sprayCounts: sprayCounts_() };

  // ---- 古い読み出し口（v1.9 以前の画面・PCの10年日記のため） ----
  if (action === 'get_timeline') {
    const list = readRecords_().filter(r => !r.deleted).sort(byNewest_);
    return {
      status: 'success',
      entries: list.map(r => ({
        id: r.id,
        timestamp: r.createdAt || r.updatedAt,
        date: r.date,
        dayName: dayName_(r.date),
        system: r.system,
        systemKey: r.systemKey,
        kind: r.kind,
        ec: r.ec === '' ? '' : String(r.ec),
        addedMl: r.addedMl === '' ? '' : String(r.addedMl),
        ph: r.ph,
        temp: r.temp,
        waterTemp: r.temp,
        memo: legacyMemo_(r),
        photos: r.photos
      }))
    };
  }

  if (action === 'get_diary') {
    const sys = p.system_id || 'bato';
    const month = parseInt(p.month, 10);
    const day = parseInt(p.day, 10);
    const range = parseInt(p.range, 10) || 7;
    const logs = readRecords_().filter(r => !r.deleted && r.systemKey === sys && r.kind === '液肥').filter(r => {
      const parts = r.date.split('-');
      return parts.length === 3 && parseInt(parts[1], 10) === month && Math.abs(parseInt(parts[2], 10) - day) <= range;
    }).map(r => ({
      year: parseInt(r.date.slice(0, 4), 10), date: r.date, current_ec: r.ec, target_ec: r.targetEc,
      added_ml: r.addedMl, ph: r.ph, water_temp: r.temp, memo: r.memo, photo_urls: r.photos
    }));
    return { status: 'success', logs: logs };
  }

  return { status: 'error', message: 'Unknown action: ' + action };
}

/* =========================================================
 * 書きかえの決まり（ここだけが「記録」シートに書く）
 * ========================================================= */

function applyRecord_(rec) {
  if (!rec.id) return { id: '', result: 'error', message: 'id がありません' };
  const sh = sheet_(SHEET_RECORDS);
  const idx = colIndex_(REC_COLS);
  const found = findRow_(sh, idx['id'], rec.id);

  if (found) {
    const cur = found.values;
    if (isTrue_(cur[idx['消した']])) return { id: rec.id, result: 'deleted' };
    const curUpdated = isoOf_(cur[idx['更新日時']]);
    if (curUpdated && rec.updatedAt <= curUpdated) return { id: rec.id, result: 'stale' };
    // 古い送り名（開いたままの v1.9 画面）で、すでにある記録が来たとき：メモと写真だけを重ねる。
    // 種類・EC・農薬名などは v1.9 の画面が持っていない（または作り値）なので、シートの値を残す（辛口審査 C3）
    if (String(rec.source || '').indexOf('旧:') === 0) {
      const base = rowToRec_(cur, idx);
      base.memo = stripLegacyHead_(rec.memo);
      base.photos = rec.photos;
      base.updatedAt = rec.updatedAt;
      base.source = rec.source;
      rec = base;
    }
  }

  rec.photos = storePhotos_(rec.photos, rec.date, rec.systemKey, rec.kind);
  const row = recordToRow_(rec);
  writeRow_(sh, found ? found.row : null, row, REC_COLS, REC_TEXT_COLS);
  return { id: rec.id, result: found ? 'updated' : 'saved', photos: rec.photos };
}

function deleteRecord_(id, updatedAt) {
  if (!id) return { id: '', result: 'error', message: 'id がありません' };
  const sh = sheet_(SHEET_RECORDS);
  const idx = colIndex_(REC_COLS);
  const found = findRow_(sh, idx['id'], id);
  const now = isoOf_(updatedAt) || new Date().toISOString();
  if (found) {
    if (isTrue_(found.values[idx['消した']])) return { id: id, result: 'deleted' };
    sh.getRange(found.row, idx['消した'] + 1).setValue('はい');
    sh.getRange(found.row, idx['更新日時'] + 1).setValue(maxIso_(now, isoOf_(found.values[idx['更新日時']])));
    return { id: id, result: 'deleted' };
  }
  // まだ届いていない記録の「消した印」だけ先に立てる（あとから本体が届いても戻らない）
  const rec = { id: id, date: '', time: '', system: '', systemKey: '', kind: '日誌', ec: '', ph: '', temp: '', targetEc: '',
    addedMl: '', pestName: '', dilution: '', waterL: '', dose: '', unit: '', memo: '', photos: [], updatedAt: now, deleted: true, source: '消した印' };
  writeRow_(sh, null, recordToRow_(rec), REC_COLS, REC_TEXT_COLS);
  return { id: id, result: 'deleted' };
}

function applyPlan_(plan) {
  if (!plan.id) return { id: '', result: 'error', message: 'id がありません' };
  const sh = sheet_(SHEET_PLANS);
  const idx = colIndex_(PLAN_COLS);
  const found = findRow_(sh, idx['id'], plan.id);
  if (found) {
    const cur = found.values;
    if (isTrue_(cur[idx['消した']])) return { id: plan.id, result: 'deleted' };
    const curUpdated = isoOf_(cur[idx['更新日時']]);
    if (curUpdated && plan.updatedAt <= curUpdated) return { id: plan.id, result: 'stale' };
    plan.eventId = String(cur[idx['カレンダー予定ID']] || '');
  }
  try { plan.eventId = syncPlanEvent_(plan); } catch (err) { console.warn('calendar: ' + err); }
  const row = PLAN_COLS.map(c => ({
    'id': plan.id, '年': plan.year, '月': plan.month, '時期': plan.timing, '系統': plan.system, '作業': plan.work,
    '内容': plan.details, '済んだ日': plan.doneDate, 'カレンダー予定ID': plan.eventId || '', '更新日時': plan.updatedAt, '消した': 'いいえ',
    '状態': plan.status
  })[c]);
  writeRow_(sh, found ? found.row : null, row, PLAN_COLS, PLAN_TEXT_COLS);
  return { id: plan.id, result: found ? 'updated' : 'saved' };
}

function deletePlan_(id) {
  const sh = sheet_(SHEET_PLANS);
  const idx = colIndex_(PLAN_COLS);
  const found = findRow_(sh, idx['id'], id);
  if (!found) return { id: id, result: 'deleted' };
  const eventId = String(found.values[idx['カレンダー予定ID']] || '');
  if (eventId) { try { const cal = calendar_(); const ev = cal && cal.getEventById(eventId); if (ev) ev.deleteEvent(); } catch (err) {} }
  sh.getRange(found.row, idx['消した'] + 1).setValue('はい');
  sh.getRange(found.row, idx['更新日時'] + 1).setValue(new Date().toISOString());
  return { id: id, result: 'deleted' };
}

/* =========================================================
 * 受け取った形 → 記録の形
 * ========================================================= */

function normalizeRecord_(d, from) {
  const systemKey = systemKeyOf_(d.systemKey || d.system_id || d.system || d.systemName);
  const date = toDateStr_(d.date) || toDateStr_(d.timestamp) || todayStr_();
  let kind = d.kind;
  if (!kind) kind = (from === 'save_record' || from === 'save_log') ? '液肥' : '日誌';
  if (KINDS.indexOf(kind) < 0) kind = '日誌';
  const updatedAt = isoOf_(d.updatedAt) || isoOf_(d.timestamp) || new Date().toISOString();
  const createdAt = isoOf_(d.createdAt) || isoOf_(d.timestamp) || updatedAt;
  return {
    id: String(d.id || ('entry_' + Date.now())),
    date: date,
    time: d.time || timeOf_(createdAt),
    system: systemKey ? SYSTEMS[systemKey].name : String(d.system || ''),
    systemKey: systemKey,
    kind: kind,
    ec: num_(firstDefined_(d.ec, d.currentEc, d.current_ec)),
    ph: num_(d.ph),
    temp: num_(firstDefined_(d.temp, d.water_temp, d.waterTemp)),
    targetEc: num_(firstDefined_(d.targetEc, d.target_ec)),
    addedMl: num_(firstDefined_(d.addedMl, d.added_ml)),
    pestName: String(d.pestName || ''),
    dilution: num_(d.dilution),
    waterL: num_(d.waterL),
    dose: num_(d.dose),
    unit: String(d.unit || ''),
    memo: String(d.memo || ''),
    photos: Array.isArray(d.photos) ? d.photos : (d.photos ? String(d.photos).split(',') : []),
    createdAt: createdAt,
    updatedAt: updatedAt,
    deleted: false,
    source: from === 'new' ? 'アプリv2' : ('旧:' + from)
  };
}

function normalizePlan_(d) {
  const sysKey = systemKeyOf_(d.systemKey || d.system);
  return {
    id: String(d.id || ('plan_' + Date.now())),
    year: parseInt(d.year, 10) || new Date().getFullYear(),
    month: parseInt(d.month, 10) || (new Date().getMonth() + 1),
    timing: String(d.timing || '上旬'),
    system: sysKey ? SYSTEMS[sysKey].name : '全体',
    work: PLAN_WORKS.indexOf(d.work) >= 0 ? d.work : 'その他',
    details: String(d.details || ''),
    doneDate: toDateStr_(d.doneDate) || '',
    eventId: '',
    status: d.status === '提案' ? '提案' : '予定',
    updatedAt: isoOf_(d.updatedAt) || new Date().toISOString()
  };
}

function recordToRow_(r) {
  const m = {
    '日付': r.date, '時刻': r.time, '系統': r.system, '種類': r.kind, 'EC': r.ec, 'pH': r.ph, '水温': r.temp,
    '目標EC': r.targetEc, '追肥mL': r.addedMl, '農薬名': r.pestName, '倍率': r.dilution, '散布水量L': r.waterL,
    '薬量': r.dose, '単位': r.unit, 'メモ': r.memo, '写真': (r.photos || []).join(','), 'id': r.id,
    '系統キー': r.systemKey, '更新日時': r.updatedAt, '消した': r.deleted ? 'はい' : 'いいえ', '元': r.source || ''
  };
  return REC_COLS.map(c => m[c] === undefined || m[c] === null ? '' : m[c]);
}

function readRecords_() {
  const sh = sheet_(SHEET_RECORDS);
  if (sh.getLastRow() < 2) return [];
  const idx = colIndex_(REC_COLS);
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, REC_COLS.length).getValues();
  return rows.filter(v => v[idx['id']]).map(v => rowToRec_(v, idx));
}

function rowToRec_(v, idx) {
  return ({
    id: String(v[idx['id']]),
    date: toDateStr_(v[idx['日付']]),
    time: timeStr_(v[idx['時刻']]),
    system: String(v[idx['系統']] || ''),
    systemKey: String(v[idx['系統キー']] || systemKeyOf_(v[idx['系統']]) || ''),
    kind: String(v[idx['種類']] || '日誌'),
    ec: blankOr_(v[idx['EC']]),
    ph: blankOr_(v[idx['pH']]),
    temp: blankOr_(v[idx['水温']]),
    targetEc: blankOr_(v[idx['目標EC']]),
    addedMl: blankOr_(v[idx['追肥mL']]),
    pestName: String(v[idx['農薬名']] || ''),
    dilution: blankOr_(v[idx['倍率']]),
    waterL: blankOr_(v[idx['散布水量L']]),
    dose: blankOr_(v[idx['薬量']]),
    unit: String(v[idx['単位']] || ''),
    memo: String(v[idx['メモ']] || ''),
    photos: String(v[idx['写真']] || '').split(',').map(s => s.trim()).filter(Boolean),
    updatedAt: isoOf_(v[idx['更新日時']]),
    createdAt: '',
    deleted: isTrue_(v[idx['消した']]),
    source: String(v[idx['元']] || '')
  });
}

function readPlans_() {
  const sh = sheet_(SHEET_PLANS);
  if (sh.getLastRow() < 2) return [];
  const idx = colIndex_(PLAN_COLS);
  return sh.getRange(2, 1, sh.getLastRow() - 1, PLAN_COLS.length).getValues().filter(v => v[idx['id']]).map(v => ({
    id: String(v[idx['id']]), year: parseInt(v[idx['年']], 10), month: parseInt(v[idx['月']], 10),
    timing: v[idx['時期']] instanceof Date ? toDateStr_(v[idx['時期']]) : String(v[idx['時期']] || ''),
    system: String(v[idx['系統']] || ''), systemKey: systemKeyOf_(v[idx['系統']]) || '',
    work: String(v[idx['作業']] || ''), details: String(v[idx['内容']] || ''),
    doneDate: toDateStr_(v[idx['済んだ日']]), eventId: String(v[idx['カレンダー予定ID']] || ''),
    updatedAt: isoOf_(v[idx['更新日時']]), deleted: isTrue_(v[idx['消した']]),
    status: String(v[idx['状態']] || '') === '提案' ? '提案' : '予定'
  }));
}

/* =========================================================
 * 見返し・まとめ
 * ========================================================= */

function buildSummary_() {
  const recs = readRecords_().filter(r => !r.deleted).sort(byNewest_);
  const settings = readSettings_();
  const out = {};
  Object.keys(SYSTEMS).forEach(k => {
    const mine = recs.filter(r => r.systemKey === k);
    const ecRec = mine.find(r => r.kind === '液肥' && r.ec !== '');
    const water = mine.find(r => r.kind === '水替え');
    const spray = mine.find(r => r.kind === '農薬');
    out[k] = {
      name: SYSTEMS[k].name,
      crops: settings['作物_' + k] || '',
      targetEc: num_(settings['目標EC_' + k]),
      lastEc: ecRec ? { date: ecRec.date, ec: ecRec.ec, addedMl: ecRec.addedMl, ph: ecRec.ph, temp: ecRec.temp } : null,
      lastWaterChange: water ? water.date : '',
      lastSpray: spray ? { date: spray.date, name: spray.pestName } : null,
      paused: settings['おやすみ_' + k] === 'はい'
    };
  });
  return out;
}

function sprayCounts_() {
  const settings = readSettings_();
  const counts = {};
  readRecords_().filter(r => !r.deleted && r.kind === '農薬').forEach(r => {
    const start = settings['作付け開始日_' + r.systemKey] || '1900-01-01';
    if (r.date < start) return;
    const key = r.systemKey + '|' + r.pestName;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

/* =========================================================
 * リマインド（毎朝1回・メール1通・専用カレンダー）
 * ========================================================= */

function computeReminders_(today) {
  const settings = readSettings_();
  const recs = readRecords_().filter(r => !r.deleted).sort(byNewest_);
  const items = [];

  Object.keys(SYSTEMS).forEach(k => {
    if (settings['おやすみ_' + k] === 'はい') return;
    const name = SYSTEMS[k].name;
    const mine = recs.filter(r => r.systemKey === k);

    const ecInt = parseInt(settings['液肥の確認間隔_' + k], 10);
    const lastEc = mine.find(r => r.kind === '液肥');
    if (ecInt > 0) {
      if (!lastEc) {
        items.push({ type: '液肥', system: k, base: 'none', days: 0, title: name + '：ECの記録がまだありません', detail: 'ECを測って記録しましょう' });
      } else {
        const d = daysBetween_(lastEc.date, today);
        if (d >= ecInt) items.push({ type: '液肥', system: k, base: lastEc.date, days: d - ecInt,
          title: name + '：ECを測る日です', detail: '前回 ' + shortDate_(lastEc.date) + '（' + d + '日前）EC ' + (lastEc.ec === '' ? '-' : lastEc.ec) });
      }
    }

    const wInt = parseInt(settings['水替えの間隔_' + k], 10);
    const lastW = mine.find(r => r.kind === '水替え');
    if (wInt > 0 && lastW) {
      const d = daysBetween_(lastW.date, today);
      if (d >= wInt) items.push({ type: '水替え', system: k, base: lastW.date, days: d - wInt,
        title: name + '：水替えの目安です', detail: '前回 ' + shortDate_(lastW.date) + '（' + d + '日前）' });
    }

    const sInt = parseInt(settings['防除の間隔_' + k], 10);
    const lastS = mine.find(r => r.kind === '農薬');
    if (sInt > 0 && lastS) {
      const d = daysBetween_(lastS.date, today);
      if (d >= sInt) items.push({ type: '農薬', system: k, base: lastS.date, days: d - sInt,
        title: name + '：防除の目安です', detail: '前回 ' + shortDate_(lastS.date) + ' ' + lastS.pestName });
    }
  });

  readPlans_().filter(p => !p.deleted && !p.doneDate && p.status !== '提案').forEach(p => {
    const start = planStartDate_(p);
    if (!start || start > today) return;
    const end = planEndDate_(p);
    const late = end < today;
    items.push({ type: '予定', system: p.systemKey || '', base: p.id, days: daysBetween_(start, today), planId: p.id,
      title: (late ? '（すぎています）' : '') + (p.system || '全体') + '：' + p.work + (p.details ? ' ' + p.details : ''),
      detail: p.year + '年' + p.month + '月 ' + p.timing });
  });

  return items;
}

function dailyReminder() {
  ensureSheets_();
  const today = todayStr_();
  const settings = readSettings_();
  const every = parseInt(settings['再通知の間隔'], 10) || 3;
  const items = computeReminders_(today);
  const notified = readNotified_();
  const toSend = items.filter(it => {
    const bucket = Math.floor(Math.max(0, it.days) / every);
    it.key = [it.type, it.system, it.base, bucket].join('|');
    return !notified[it.key];
  });
  // カレンダーが消えていたら、そのことも知らせる（黙って止まらない）
  const calMissing = !!PropertiesService.getScriptProperties().getProperty('CALENDAR_ID') && !calendar_();
  const calKey = 'カレンダー無し|' + today;
  const calLine = calMissing && !notified[calKey] ? '・カレンダー「家庭菜園」が見つかりません。スクリプトの setupHydro をもう一度動かしてください' : '';

  // メールを先に送る（カレンダー合わせが重くなっても、知らせは必ず届く。辛口審査 W5）
  let sent = 0;
  if (toSend.length || calLine) {
    const to = settings['通知メール'] || Session.getEffectiveUser().getEmail();
    const lines = toSend.map(it => '・' + it.title + (it.detail ? '\n　' + it.detail : ''));
    if (calLine) lines.push(calLine);
    const others = items.length - toSend.length;
    const body = '今日（' + shortDate_(today) + '）の家庭菜園\n\n' + lines.join('\n') +
      (others > 0 ? '\n\n（ほかに、前に知らせたものが ' + others + ' 件あります。アプリの「今日やること」で見られます）' : '') +
      '\n\n記録すると、次からは知らせません。\n知らせの間隔は、スプレッドシート「' + SS_NAME + '」の「設定」タブで直せます。';
    MailApp.sendEmail(to, '【菜園】今日やること ' + lines.length + '件', body);
    const sh = sheet_(SHEET_NOTIFIED);
    const now = new Date().toISOString();
    toSend.forEach(it => writeRow_(sh, null, [it.key, now], ['通知の印', '送った日時'], ['通知の印', '送った日時']));
    if (calLine) writeRow_(sh, null, [calKey, now], ['通知の印', '送った日時'], ['通知の印', '送った日時']);
    sent = lines.length;
  }
  try { syncAllPlanEvents_(today); } catch (err) { console.warn('calendar sync: ' + err); }
  return { sent: sent };
}

function testMorningMail() {
  ensureSheets_();
  const settings = readSettings_();
  const items = computeReminders_(todayStr_());
  const to = settings['通知メール'] || Session.getEffectiveUser().getEmail();
  const body = items.length
    ? items.map(it => '・' + it.title + (it.detail ? '\n　' + it.detail : '')).join('\n')
    : '今日は知らせることがありません（試しの1通です）';
  MailApp.sendEmail(to, '【菜園】試し：今日やること ' + items.length + '件', body);
  console.log('送りました：' + to + ' / ' + items.length + '件');
}

function readNotified_() {
  const sh = sheet_(SHEET_NOTIFIED);
  const map = {};
  if (sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(v => { if (v[0]) map[String(v[0])] = true; });
  return map;
}

function calendar_() {
  const id = PropertiesService.getScriptProperties().getProperty('CALENDAR_ID');
  if (!id) return null;
  return CalendarApp.getCalendarById(id);
}

function syncPlanEvent_(plan) {
  const cal = calendar_();
  if (!cal) return plan.eventId || '';
  if (plan.status === '提案') return plan.eventId || '';
  const start = planStartDate_(plan);
  if (!start) return plan.eventId || '';
  const title = (plan.doneDate ? '✅ ' : '') + '【菜園】' + (plan.system || '全体') + '：' + plan.work + (plan.details ? ' ' + plan.details : '');
  const day = new Date(start + 'T00:00:00+09:00');
  let ev = null;
  if (plan.eventId) { try { ev = cal.getEventById(plan.eventId); } catch (e) { ev = null; } }
  if (ev) {
    ev.setTitle(title);
    ev.setAllDayDate(day);
    return ev.getId();
  }
  ev = cal.createAllDayEvent(title, day, { description: 'HydroDaily の予定（' + plan.timing + '）' });
  return ev.getId();
}

function syncAllPlanEvents_(today) {
  const cal = calendar_();
  if (!cal) return;
  const sh = sheet_(SHEET_PLANS);
  const idx = colIndex_(PLAN_COLS);
  const t = today || todayStr_();
  readPlans_().forEach(p => {
    // 毎朝合わせるのは、まだ済んでいない今日以降の予定だけ（年がたっても6分の上限に届かないように）
    if (p.deleted || p.doneDate || p.status === '提案' || planEndDate_(p) < t) return;
    const eventId = syncPlanEvent_(p);
    if (eventId && eventId !== p.eventId) {
      const found = findRow_(sh, idx['id'], p.id);
      if (found) sh.getRange(found.row, idx['カレンダー予定ID'] + 1).setValue(eventId);
    }
  });
}

function planStartDate_(p) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.timing)) return p.timing;
  const mm = ('0' + p.month).slice(-2);
  const d = p.timing === '中旬' ? '11' : (p.timing === '下旬' ? '21' : '01');
  if (!p.year || !p.month) return '';
  return p.year + '-' + mm + '-' + d;
}

function planEndDate_(p) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.timing)) return p.timing;
  const mm = ('0' + p.month).slice(-2);
  if (p.timing === '上旬') return p.year + '-' + mm + '-10';
  if (p.timing === '中旬') return p.year + '-' + mm + '-20';
  const last = new Date(p.year, p.month, 0).getDate();
  return p.year + '-' + mm + '-' + ('0' + last).slice(-2);
}

/* =========================================================
 * はじめの設定・移し替え（エディタから手で動かす）
 * ========================================================= */

function setupHydro() {
  ensureSheets_();
  const ss = ss_();
  const props = PropertiesService.getScriptProperties();

  // 写真フォルダ：マイドライブ/HydroDaily/photos（IDで持つ）
  if (!props.getProperty('PHOTO_ROOT_ID')) {
    const roots = DriveApp.getRootFolder().getFoldersByName('HydroDaily');
    const base = roots.hasNext() ? roots.next() : DriveApp.getRootFolder().createFolder('HydroDaily');
    const ph = base.getFoldersByName('photos');
    const photos = ph.hasNext() ? ph.next() : base.createFolder('photos');
    props.setProperty('PHOTO_ROOT_ID', photos.getId());
  }

  // 専用カレンダー「家庭菜園」（1度だけ作る）
  let calId = props.getProperty('CALENDAR_ID');
  if (!calId || !CalendarApp.getCalendarById(calId)) {
    const same = CalendarApp.getCalendarsByName('家庭菜園');
    const cal = same.length ? same[0] : CalendarApp.createCalendar('家庭菜園', { summary: 'HydroDaily が書く家庭菜園の予定（学校の予定とは別）', color: CalendarApp.Color.GREEN });
    calId = cal.getId();
    props.setProperty('CALENDAR_ID', calId);
  }

  // 毎朝の時計（1つだけ）
  const hour = parseInt(readSettings_()['毎朝の時刻'], 10);
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyReminder').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyReminder').timeBased().everyDays(1).atHour(isNaN(hour) ? 6 : hour).inTimezone(TZ).create();

  // 春の見直しの予定（1度だけ）
  const plans = readPlans_();
  if (!plans.some(p => p.id === 'plan_spring_review_2027')) {
    applyPlan_(normalizePlan_({ id: 'plan_spring_review_2027', year: 2027, month: 3, timing: '上旬', system: '', work: '見直し',
      details: '春の作物に合わせて目標ECを見直す（設定タブ）', updatedAt: new Date().toISOString() }));
  }

  ensureViews_();
  console.log('はじめの設定が終わりました。シート：' + ss.getUrl() + ' / カレンダーID：' + calId);
}

function migrateOldTabs() {
  ensureSheets_();
  const ss = ss_();
  const existing = {};
  readRecords_().forEach(r => { existing[r.id] = true; });

  const candidates = {};
  const keep = (rec) => {
    const cur = candidates[rec.id];
    if (!cur || rec.updatedAt > cur.updatedAt) candidates[rec.id] = rec;
  };

  legacySheets_(ss, LEGACY_JOURNAL).forEach(sh => {
    if (sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().forEach(v => {
      if (!v[0] && !v[2]) return;
      const rec = normalizeRecord_({ id: v[0] || legacyId_(v[1], v[4], v[5]), timestamp: v[1], date: v[2], system: v[4], ec: v[5], memo: v[6], photos: v[7] }, 'journal');
      keep(rec);
    });
  });

  legacySheets_(ss, LEGACY_LOG).forEach(sh => {
    if (sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues().forEach(v => {
      if (!v[0] && !v[1]) return;
      const rec = normalizeRecord_({ id: legacyId_(v[0], v[2], v[3]), timestamp: v[0], date: v[1], system_id: v[2], current_ec: v[3], target_ec: v[4],
        added_ml: v[5], ph: v[6], water_temp: v[7], memo: v[8], photos: v[9] }, 'save_log');
      keep(rec);
    });
  });

  let added = 0, skipped = 0;
  Object.keys(candidates).forEach(id => {
    if (existing[id]) { skipped++; return; }
    const rec = candidates[id];
    writeRow_(sheet_(SHEET_RECORDS), null, recordToRow_(rec), REC_COLS, REC_TEXT_COLS);
    existing[id] = true;
    added++;
  });
  const msg = '移し替え：足した ' + added + ' 件／すでにあったので触らなかった ' + skipped + ' 件／旧タブの id の種類 ' + Object.keys(candidates).length + ' 件';
  console.log(msg);
  return msg;
}

function checkMigration() {
  const ss = ss_();
  const have = {};
  readRecords_().forEach(r => { have[r.id] = true; });
  const missing = [];
  let total = 0;
  legacySheets_(ss, LEGACY_JOURNAL).forEach(sh => {
    if (sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().forEach(v => {
      if (!v[0] && !v[2]) return;
      total++;
      const id = String(v[0] || legacyId_(v[1], v[4], v[5]));
      if (!have[id]) missing.push(id);
    });
  });
  legacySheets_(ss, LEGACY_LOG).forEach(sh => {
    if (sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues().forEach(v => {
      if (!v[0] && !v[1]) return;
      total++;
      const id = legacyId_(v[0], v[2], v[3]);
      if (!have[id]) missing.push(id);
    });
  });
  const ok = missing.length === 0;
  const msg = (ok ? '✅ 合格：' : '❌ 不合格：') + '旧タブの行 ' + total + ' 行のうち、記録に無い id ' + missing.length + ' 件' +
    (missing.length ? '\n無い id：' + missing.slice(0, 50).join(', ') : '');
  console.log(msg);
  return { ok: ok, missing: missing, message: msg };
}

function renameOldTabs() {
  const res = checkMigration();
  if (!res.ok) throw new Error('照らし合わせが不合格なので、名前は変えません。先に migrateOldTabs をもう一度動かしてください。');
  const ss = ss_();
  [LEGACY_LOG, LEGACY_JOURNAL].forEach(n => {
    const sh = ss.getSheetByName(n);
    if (sh) sh.setName('旧_' + n);
  });
  console.log('旧タブの名前を「旧_」付きに変えました（中身はそのまま）');
}

function moveOldPhotos() {
  // Antigravity_Inbox/photos の中身を HydroDaily/photos へ移す（ファイルIDは変わらないので、表示は切れない）
  const props = PropertiesService.getScriptProperties();
  const destId = props.getProperty('PHOTO_ROOT_ID');
  if (!destId) throw new Error('先に setupHydro を動かしてください');
  const dest = DriveApp.getFolderById(destId);
  const inbox = DriveApp.getFoldersByName('Antigravity_Inbox');
  if (!inbox.hasNext()) { console.log('Antigravity_Inbox が見つかりません'); return; }
  const olds = inbox.next().getFoldersByName('photos');
  if (!olds.hasNext()) { console.log('古い写真フォルダはありません'); return; }
  const old = olds.next();
  let moved = 0;
  const months = old.getFolders();
  while (months.hasNext()) { const f = months.next(); f.moveTo(dest); moved++; }
  const files = old.getFiles();
  while (files.hasNext()) { files.next().moveTo(dest); moved++; }
  console.log('移した数：' + moved + '（空になった Antigravity_Inbox/photos は手で消してください）');
}

/* =========================================================
 * シートの用意
 * ========================================================= */

let ensured_ = false;
function ensureSheets_() {
  if (ensured_) return;
  const ss = ss_();
  makeSheet_(ss, SHEET_RECORDS, REC_COLS, REC_TEXT_COLS);
  makeSheet_(ss, SHEET_PLANS, PLAN_COLS, PLAN_TEXT_COLS);
  const st = makeSheet_(ss, SHEET_SETTINGS, ['項目', '値', '説明'], ['項目', '値', '説明']);
  if (st.getLastRow() < 2) st.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
  else {
    const have = st.getRange(2, 1, st.getLastRow() - 1, 1).getValues().map(v => String(v[0]));
    const add = DEFAULT_SETTINGS.filter(r => have.indexOf(r[0]) < 0);
    if (add.length) st.getRange(st.getLastRow() + 1, 1, add.length, 3).setValues(add);
  }
  const pe = makeSheet_(ss, SHEET_PESTS, PEST_COLS, ['id', '名前', '単位', 'メモ']);
  if (pe.getLastRow() < 2) pe.getRange(2, 1, DEFAULT_PESTS.length, PEST_COLS.length).setValues(DEFAULT_PESTS);
  makeSheet_(ss, SHEET_NOTIFIED, ['通知の印', '送った日時'], ['通知の印', '送った日時']);
  ensured_ = true;
}

function makeSheet_(ss, name, cols, textCols) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#e8f5e9');
    sh.setFrozenRows(1);
    (textCols || []).forEach(c => {
      const i = cols.indexOf(c);
      if (i >= 0) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  }
  return sh;
}

function ensureViews_() {
  const ss = ss_();
  const R = "'" + SHEET_RECORDS + "'!A:U";
  // 列：A日付 B時刻 C系統 D種類 E EC F pH G水温 H目標EC I追肥mL J農薬名 K倍率 L散布水量L M薬量 N単位 Oメモ P写真 Q id R系統キー S更新日時 T消した U元
  const views = [
    [VIEW_BY_SYSTEM, '=QUERY(' + R + ',"select C, A, B, D, E, F, G, I, J, M, N, O where T = \'いいえ\' and A <> \'\' order by C, A desc, B desc label C \'系統\', A \'日付\', B \'時刻\', D \'種類\', E \'EC\', F \'pH\', G \'水温\', I \'追肥mL\', J \'農薬名\', M \'薬量\', N \'単位\', O \'メモ\'",1)'],
    [VIEW_MONTHLY, '=QUERY({ARRAYFORMULA(IF(\'' + SHEET_RECORDS + '\'!A2:A="",,LEFT(\'' + SHEET_RECORDS + '\'!A2:A,7))),\'' + SHEET_RECORDS + '\'!C2:E,\'' + SHEET_RECORDS + '\'!I2:I,\'' + SHEET_RECORDS + '\'!T2:T},"select Col1, Col2, avg(Col4), count(Col4), sum(Col5) where Col3 = \'液肥\' and Col4 is not null and Col6 = \'いいえ\' group by Col1, Col2 order by Col1 desc label Col1 \'月\', Col2 \'系統\', avg(Col4) \'EC平均\', count(Col4) \'記録数\', sum(Col5) \'追肥mL合計\'",0)'],
    [VIEW_SPRAYS, '=QUERY(' + R + ',"select A, C, J, K, L, M, N, O where D = \'農薬\' and T = \'いいえ\' order by A desc label A \'日付\', C \'系統\', J \'農薬名\', K \'倍率\', L \'散布水量L\', M \'薬量\', N \'単位\', O \'メモ\'",1)']
  ];
  views.forEach(v => {
    let sh = ss.getSheetByName(v[0]);
    if (!sh) sh = ss.insertSheet(v[0]);
    sh.getRange('A1').setFormula(v[1]);
    sh.setFrozenRows(1);
  });
  // 人が開いたときに最初に目に入る順へ
  [VIEW_BY_SYSTEM, VIEW_MONTHLY, VIEW_SPRAYS, SHEET_PLANS, SHEET_SETTINGS].forEach((n, i) => {
    const sh = ss.getSheetByName(n);
    if (sh) { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); }
  });
}

/* =========================================================
 * 写真
 * ========================================================= */

function storePhotos_(photos, date, sysKey, kind) {
  const out = [];
  (photos || []).forEach((p, i) => {
    const s = typeof p === 'string' ? p : (p && p.base64) || '';
    if (s.indexOf('data:image') === 0) {
      const folder = photoFolder_(date);
      const bytes = Utilities.base64Decode(s.replace(/^data:image\/[a-z]+;base64,/, ''));
      const name = String(date || '').replace(/-/g, '') + '_' + (sysKey || 'all') + '_' + (kind || '') + '_' + Date.now() + '_' + (i + 1) + '.jpg';
      const file = folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      out.push('https://lh3.googleusercontent.com/d/' + file.getId());
    } else if (s) {
      out.push(s.trim());
    }
  });
  return out;
}

function photoFolder_(date) {
  const props = PropertiesService.getScriptProperties();
  const ym = String(date || todayStr_()).slice(0, 7).replace('-', '');
  let root;
  const id = props.getProperty('PHOTO_ROOT_ID');
  if (id) {
    try { root = DriveApp.getFolderById(id); } catch (e) { root = null; }
  }
  if (!root) {
    // はじめの設定の前：今までと同じ場所に入れる（届いた写真を落とさない）
    const inbox = DriveApp.getFoldersByName('Antigravity_Inbox');
    const base = inbox.hasNext() ? inbox.next() : DriveApp.getRootFolder();
    const ph = base.getFoldersByName('photos');
    root = ph.hasNext() ? ph.next() : base.createFolder('photos');
  }
  const f = root.getFoldersByName(ym);
  return f.hasNext() ? f.next() : root.createFolder(ym);
}

/* =========================================================
 * 小さな道具
 * ========================================================= */

let ss__ = null;
function ss_() {
  if (ss__) return ss__;
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (!ss) {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('SPREADSHEET_ID');
    if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) {} }
    if (!ss) {
      const files = DriveApp.getFilesByName(SS_NAME);
      ss = files.hasNext() ? SpreadsheetApp.open(files.next()) : SpreadsheetApp.create(SS_NAME);
      props.setProperty('SPREADSHEET_ID', ss.getId());
    }
  }
  ss__ = ss;
  return ss;
}

function sheet_(name) { return ss_().getSheetByName(name); }

// 1行を書く（rowNum が null なら末尾に足す）。足りなければ行を増やし、文字の列は書式 @ にそろえる
function writeRow_(sh, rowNum, row, cols, textCols) {
  let r = rowNum;
  if (!r) {
    r = sh.getLastRow() + 1;
    if (r > sh.getMaxRows()) {
      const before = sh.getMaxRows();
      sh.insertRowsAfter(before, 500);
      (textCols || []).forEach(c => {
        const i = cols.indexOf(c);
        if (i >= 0) sh.getRange(before + 1, i + 1, 500, 1).setNumberFormat('@');
      });
    }
  }
  sh.getRange(r, 1, 1, row.length).setValues([row]);
  return r;
}

function legacySheets_(ss, name) {
  return [ss.getSheetByName(name), ss.getSheetByName('旧_' + name)].filter(Boolean);
}

function colIndex_(cols) { const m = {}; cols.forEach((c, i) => { m[c] = i; }); return m; }

function findRow_(sh, colIdx, id) {
  const last = sh.getLastRow();
  if (last < 2) return null;
  const ids = sh.getRange(2, colIdx + 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      const row = i + 2;
      return { row: row, values: sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0] };
    }
  }
  return null;
}

function readSettings_() {
  const sh = sheet_(SHEET_SETTINGS);
  const m = {};
  DEFAULT_SETTINGS.forEach(r => { m[r[0]] = r[1]; });
  if (sh && sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(v => { if (v[0]) m[String(v[0])] = String(v[1]); });
  return m;
}

function readPests_() {
  const sh = sheet_(SHEET_PESTS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, PEST_COLS.length).getValues().filter(v => v[0]).map(v => ({
    id: String(v[0]), name: String(v[1]), dilution: num_(v[2]), unit: String(v[3] || 'mL'),
    intervalDays: num_(v[4]), maxUses: num_(v[5]), preharvestDays: num_(v[6]), memo: String(v[7] || '')
  }));
}

function systemKeyOf_(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  for (const k in SYSTEMS) {
    if (k === s || SYSTEMS[k].aliases.some(a => a.toLowerCase() === s.toLowerCase())) return k;
  }
  if (/bato/i.test(s)) return 'bato';
  if (/dwc|nft/i.test(s)) return 'dwc';
  if (/タワー|tower/i.test(s)) return 'tower';
  return '';
}

function toDateStr_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  return '';
}

function timeStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'HH:mm');
  return String(v || '');
}

function timeOf_(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, TZ, 'HH:mm');
}

function isoOf_(v) {
  if (v === null || v === undefined || v === '') return '';
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function maxIso_(a, b) { return (a || '') > (b || '') ? a : b; }

function todayStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

function daysBetween_(a, b) {
  const da = new Date(a + 'T00:00:00Z'), db = new Date(b + 'T00:00:00Z');
  return Math.round((db - da) / 86400000);
}

function shortDate_(s) { const p = String(s).split('-'); return p.length === 3 ? parseInt(p[1], 10) + '/' + parseInt(p[2], 10) : s; }

function dayName_(s) {
  if (!s) return '';
  const d = new Date(s + 'T12:00:00+09:00');
  return ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'][d.getUTCDay()] || '';
}

function num_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return isNaN(v) ? '' : v;
  const s = String(v).trim();
  if (s === '') return '';
  const n = Number(s);
  return isNaN(n) ? '' : n;
}

function blankOr_(v) { return v === null || v === undefined || v === '' ? '' : v; }

function firstDefined_() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

function isTrue_(v) { return v === true || v === 'はい' || v === 'TRUE' || v === 'true'; }

function legacyId_(ts, sys, ec) {
  const iso = isoOf_(ts) || String(ts || '');
  return 'legacy_' + Utilities.base64EncodeWebSafe(iso + '|' + String(sys || '') + '|' + String(ec === undefined ? '' : ec)).replace(/=+$/, '');
}

// 古い画面に見せた頭書き（legacyMemo_ が付けたもの）を外す。外さないと、古い画面で直されるたびに重なる（再審査 W-b）
function stripLegacyHead_(memo) {
  return String(memo || '').replace(/^【防除】[^（\n]*（[^）\n]*倍・水[^）\n]*）\s*/, '').replace(/^【水替え】\s*/, '');
}

function legacyMemo_(r) {
  if (r.kind === '農薬') return '【防除】' + r.pestName + ' ' + r.dose + r.unit + '（' + r.dilution + '倍・水' + r.waterL + 'L）' + (r.memo ? '\n' + r.memo : '');
  if (r.kind === '水替え') return '【水替え】' + (r.memo ? ' ' + r.memo : '');
  return r.memo;
}

function byNewest_(a, b) {
  const ka = (a.date || '') + ' ' + (a.time || '') + ' ' + (a.updatedAt || '');
  const kb = (b.date || '') + ' ' + (b.time || '') + ' ' + (b.updatedAt || '');
  return kb < ka ? -1 : (kb > ka ? 1 : 0);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
