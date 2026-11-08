// 新しい GAS（gas/Code.gs）の動きを、アプリが送る形のまま確かめる
// 動かし方：node --test tests/gas/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, tokyoParts } = require('./fake_gas');

function today(offsetDays = 0) {
  const p = tokyoParts(new Date(Date.now() + offsetDays * 86400000));
  return `${p.year}-${p.month}-${p.day}`;
}
function iso(offsetMin = 0) { return new Date(Date.now() + offsetMin * 60000).toISOString(); }

test('v1.9 の記録タブ（save_record）が「記録」シートに液肥として入る。EC 0 も 0 のまま', () => {
  const g = createEnv();
  const res = g.post({ action: 'save_record', id: 'entry_1', timestamp: iso(), date: '2026年11月8日', dayName: '日曜日',
    system: 'bato', systemName: 'BatoBucket', currentEc: 0, current_ec: 0, ec: 0, targetEc: 2.0, addedMl: 751.9, ph: null, temp: 18, memo: '水替え直後', photos: [] });
  assert.equal(res.status, 'success');
  assert.equal(res.result, 'saved');
  const rows = g.table('記録');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['日付'], '2026-11-08');           // 文字のまま（Date に化けない）
  assert.equal(typeof rows[0]['日付'], 'string');
  assert.equal(rows[0]['種類'], '液肥');
  assert.equal(rows[0]['系統'], 'BatoBucket');
  assert.equal(rows[0]['EC'], 0);                        // 0 が空欄にならない
  assert.equal(rows[0]['pH'], '');                       // 測っていないものは空欄
  assert.equal(rows[0]['水温'], 18);
  assert.equal(rows[0]['消した'], 'いいえ');
});

test('v1.9 の日誌（journal）は日誌として入り、系統名からキーが付く', () => {
  const g = createEnv();
  g.post({ action: 'journal', id: 'entry_j', timestamp: iso(), date: '2026年11月7日', dayName: '土曜日', system: 'タワー型', ec: '2.0', memo: '花蕾が見えた', photos: [] });
  const r = g.table('記録')[0];
  assert.equal(r['種類'], '日誌');
  assert.equal(r['系統キー'], 'tower');
  assert.equal(r['日付'], '2026-11-07');
});

test('書きかえの決まり①：更新日時が新しい方が勝つ。古いか同じなら何も変えない', () => {
  const g = createEnv();
  const t0 = '2026-11-08T01:00:00.000Z', t1 = '2026-11-08T01:01:00.000Z', t5 = '2026-11-08T01:05:00.000Z';
  const base = { action: 'upsert', record: { id: 'r1', date: today(), systemKey: 'dwc', kind: '液肥', ec: 1.5, memo: 'はじめ', updatedAt: t0 } };
  g.post(base);
  const newer = g.post({ action: 'upsert', record: { ...base.record, memo: '直した', updatedAt: t5 } });
  assert.equal(newer.result, 'updated');
  const older = g.post({ action: 'upsert', record: { ...base.record, memo: '古い端末の文', updatedAt: t1 } });
  assert.equal(older.result, 'stale');
  const same = g.post({ action: 'upsert', record: { ...base.record, memo: '同じ時刻', updatedAt: t5 } });
  assert.equal(same.result, 'stale');
  const rows = g.table('記録');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['メモ'], '直した');
});

test('書きかえの決まり②：消した印は戻らない（あとから新しい文が届いても）', () => {
  const g = createEnv();
  g.post({ action: 'upsert', record: { id: 'r2', date: today(), systemKey: 'bato', kind: '日誌', memo: 'a', updatedAt: iso(0) } });
  assert.equal(g.post({ action: 'delete_journal', id: 'r2' }).result, 'deleted');
  const again = g.post({ action: 'upsert', record: { id: 'r2', date: today(), systemKey: 'bato', kind: '日誌', memo: 'よみがえり', updatedAt: iso(60) } });
  assert.equal(again.result, 'deleted');
  const r = g.table('記録')[0];
  assert.equal(r['消した'], 'はい');
  assert.equal(r['メモ'], 'a');
  assert.equal(g.get({ action: 'get_records' }).records.length, 0);
});

test('まだ届いていない記録を先に消しても、あとから本体が届いて戻らない', () => {
  const g = createEnv();
  g.post({ action: 'delete', id: 'r3' });
  const later = g.post({ action: 'save_record', id: 'r3', timestamp: iso(), date: today(), system: 'bato', ec: 2.1 });
  assert.equal(later.result, 'deleted');
  assert.equal(g.get({ action: 'get_records' }).records.length, 0);
});

test('まとめ送り（batch）：未送信の列をまとめて送ると、1件ずつ結果が返る', () => {
  const g = createEnv();
  const res = g.post({ action: 'batch', ops: [
    { action: 'upsert', record: { id: 'b1', date: today(), systemKey: 'bato', kind: '液肥', ec: 1.9, updatedAt: iso() } },
    { action: 'upsert', record: { id: 'b2', date: today(), systemKey: 'dwc', kind: '農薬', pestName: 'サンヨール', dilution: 500, waterL: 2, dose: 4, unit: 'mL', updatedAt: iso() } },
    { action: 'delete', id: 'b1' },
    { action: 'nanika' }
  ] });
  assert.equal(res.status, 'success');
  assert.deepEqual(res.results.map(r => r.result), ['saved', 'saved', 'deleted', 'error']);
  const live = g.get({ action: 'get_records' }).records;
  assert.equal(live.length, 1);
  assert.equal(live[0].kind, '農薬');
  assert.equal(live[0].pestName, 'サンヨール');
});

test('知らない送り名は error を返す（黙って成功にしない）', () => {
  const g = createEnv();
  const res = g.post({ action: 'save_nanika', id: 'x' });
  assert.equal(res.status, 'error');
});

test('移し替え：旧タブの重なった id は一番新しい行だけ。日付は YYYY-MM-DD。2回流しても新しい画面の直し・消しは変わらない', () => {
  const g = createEnv();
  g.post({ action: 'ping' });
  g.addLegacy('journal_logs', ['id', 'timestamp', 'date', 'day_name', 'system', 'ec', 'memo', 'photo_urls'], [
    ['entry_100', '2026-10-01T01:00:00.000Z', '2026年10月1日', '木曜日', 'BatoBucket', '2.0', '直す前', ''],
    ['entry_100', '2026-10-02T01:00:00.000Z', '2026年10月1日', '木曜日', 'BatoBucket', '2.0', '直した後', 'https://lh3.googleusercontent.com/d/abc'],
    ['entry_200', '2026-10-05T01:00:00.000Z', '2026年10月5日', '月曜日', 'DWC / NFT', '1.4', '葉物', ''],
    ['entry_300', '2026-10-06T01:00:00.000Z', '2026年10月6日', '火曜日', 'タワー型', '', '消す予定', '']
  ]);
  const msg = g.run('migrateOldTabs');
  assert.match(msg, /足した 3 件/);
  let rows = g.table('記録');
  const e100 = rows.find(r => r['id'] === 'entry_100');
  assert.equal(e100['メモ'], '直した後');
  assert.equal(e100['日付'], '2026-10-01');
  assert.equal(e100['写真'], 'https://lh3.googleusercontent.com/d/abc');

  // 新しい画面で直す・消す
  g.post({ action: 'upsert', record: { id: 'entry_200', date: '2026-10-05', systemKey: 'dwc', kind: '日誌', memo: '新しい画面で直した', updatedAt: iso() } });
  g.post({ action: 'delete', id: 'entry_300' });
  // もう一度流す
  const msg2 = g.run('migrateOldTabs');
  assert.match(msg2, /足した 0 件/);
  rows = g.table('記録');
  assert.equal(rows.find(r => r['id'] === 'entry_200')['メモ'], '新しい画面で直した');
  assert.equal(rows.find(r => r['id'] === 'entry_300')['消した'], 'はい');
  assert.equal(rows.length, 3);

  // 照らし合わせ → 名前を変える
  const chk = g.run('checkMigration');
  assert.equal(chk.ok, true);
  g.run('renameOldTabs');
  assert.ok(g.sheet('旧_journal_logs'));
  assert.equal(g.ss.getSheetByName('journal_logs'), null);
  // 名前を変えたあとに journal が来ても、旧タブは作り直されない
  g.post({ action: 'journal', id: 'entry_400', timestamp: iso(), date: '2026年11月8日', system: 'BatoBucket', memo: '古い画面から' });
  assert.equal(g.ss.getSheetByName('journal_logs'), null);
  assert.equal(g.table('記録').length, 4);
});

test('照らし合わせ：記録に無い id があれば不合格で、名前は変えない', () => {
  const g = createEnv();
  g.post({ action: 'ping' });
  g.addLegacy('journal_logs', ['id', 'timestamp', 'date', 'day_name', 'system', 'ec', 'memo', 'photo_urls'], [
    ['entry_9', '2026-10-01T01:00:00.000Z', '2026年10月1日', '', 'BatoBucket', '', 'x', '']
  ]);
  const chk = g.run('checkMigration');
  assert.equal(chk.ok, false);
  assert.deepEqual([...chk.missing], ['entry_9']);
  assert.throws(() => g.run('renameOldTabs'));
  assert.ok(g.sheet('journal_logs'));
});

test('古い読み出し口 get_timeline は「記録」から、pH・水温・追肥量も付けて返す', () => {
  const g = createEnv();
  g.post({ action: 'save_record', id: 'e1', timestamp: iso(), date: today(), system: 'bato', ec: 1.8, targetEc: 2.0, addedMl: 75.2, ph: 6.2, temp: 16 });
  const tl = g.get({ action: 'get_timeline' });
  assert.equal(tl.status, 'success');
  assert.equal(tl.entries.length, 1);
  const e = tl.entries[0];
  assert.equal(e.system, 'BatoBucket');
  assert.equal(e.ec, '1.8');
  assert.equal(e.addedMl, '75.2');
  assert.equal(e.ph, 6.2);
  assert.equal(e.temp, 16);
  assert.ok(e.dayName.endsWith('曜日'));
});

test('get_diary（PCの10年日記）は液肥の記録を同月同日±7日で返す', () => {
  const g = createEnv();
  g.post({ action: 'upsert', record: { id: 'd1', date: '2025-11-05', systemKey: 'bato', kind: '液肥', ec: 1.9, updatedAt: iso() } });
  g.post({ action: 'upsert', record: { id: 'd2', date: '2025-12-05', systemKey: 'bato', kind: '液肥', ec: 1.9, updatedAt: iso() } });
  const res = g.get({ action: 'get_diary', system_id: 'bato', month: '11', day: '8' });
  assert.deepEqual(res.logs.map(l => l.date), ['2025-11-05']);
});

test('get_records：系統・種類・期間で絞り込める。since で消した印も受け取れる', () => {
  const g = createEnv();
  const t0 = iso(-10);
  g.post({ action: 'upsert', record: { id: 'a', date: today(-3), systemKey: 'bato', kind: '液肥', ec: 1.9, updatedAt: iso(-5) } });
  g.post({ action: 'upsert', record: { id: 'b', date: today(-2), systemKey: 'dwc', kind: '液肥', ec: 1.5, updatedAt: iso(-4) } });
  g.post({ action: 'upsert', record: { id: 'c', date: today(-1), systemKey: 'bato', kind: '農薬', pestName: 'ゼンターリ', updatedAt: iso(-3) } });
  g.post({ action: 'delete', id: 'a' });
  assert.deepEqual(g.get({ action: 'get_records', system: 'bato' }).records.map(r => r.id), ['c']);
  assert.deepEqual(g.get({ action: 'get_records', kind: '液肥' }).records.map(r => r.id), ['b']);
  const since = g.get({ action: 'get_records', since: t0 }).records;
  assert.equal(since.length, 3);
  assert.equal(since.find(r => r.id === 'a').deleted, true);
});

test('get_summary：系統ごとに直近のEC・最後の農薬・目標EC（冬の値）を返す', () => {
  const g = createEnv();
  g.post({ action: 'upsert', record: { id: 's1', date: today(-2), systemKey: 'tower', kind: '液肥', ec: 1.7, updatedAt: iso() } });
  g.post({ action: 'upsert', record: { id: 's2', date: today(-1), systemKey: 'tower', kind: '農薬', pestName: 'ゼンターリ顆粒水和剤', updatedAt: iso() } });
  const s = g.get({ action: 'get_summary' }).summary;
  assert.equal(s.tower.lastEc.ec, 1.7);
  assert.equal(s.tower.lastSpray.name, 'ゼンターリ顆粒水和剤');
  assert.equal(s.bato.targetEc, 2);
  assert.equal(s.dwc.targetEc, 1.6);
  assert.equal(s.tower.crops, 'スティックセニョール');
  assert.equal(s.bato.lastEc, null);
});

test('リマインド：ECの記録から間隔が過ぎた系統・この旬の予定が出る。おやすみの系統は出ない。メールは1日1通で、同じものを2度送らない', () => {
  const g = createEnv();
  g.run('setupHydro');
  g.post({ action: 'upsert', record: { id: 'm1', date: today(-8), systemKey: 'bato', kind: '液肥', ec: 1.8, updatedAt: iso() } });
  g.post({ action: 'upsert', record: { id: 'm2', date: today(-1), systemKey: 'dwc', kind: '液肥', ec: 1.5, updatedAt: iso() } });
  // タワーはおやすみにする
  const st = g.sheet('設定');
  const row = st.rows.findIndex(r => r[0] === 'おやすみ_tower');
  st.rows[row][1] = 'はい';
  const t = today();
  g.post({ action: 'save_plan', plan: { id: 'p1', year: +t.slice(0, 4), month: +t.slice(5, 7), timing: t, system: 'dwc', work: '種まき', details: 'ルッコラ', updatedAt: iso() } });

  const items = g.get({ action: 'get_today' }).items;
  const titles = items.map(i => i.title);
  assert.ok(titles.some(x => x.startsWith('BatoBucket：ECを測る日')), titles.join(' / '));
  assert.ok(!titles.some(x => x.startsWith('DWC')) || titles.some(x => x.includes('種まき')));
  assert.ok(!titles.some(x => x.startsWith('タワー型')));
  assert.ok(titles.some(x => x.includes('種まき ルッコラ')));

  g.run('dailyReminder');
  assert.equal(g.mails.length, 1);
  assert.match(g.mails[0].subject, /^【菜園】今日やること/);
  assert.equal(g.mails[0].to, 'owner@example.com');
  g.run('dailyReminder');
  assert.equal(g.mails.length, 1, '2回目は送らない');
});

test('予定：専用カレンダー「家庭菜園」に1つだけ予定ができ、直すと同じ予定が変わり、消すと予定も消える', () => {
  const g = createEnv();
  g.run('setupHydro');
  g.run('setupHydro'); // 2回動かしてもカレンダー・時計は増えない
  assert.equal(g.calendars.length, 1);
  assert.equal(g.calendars[0].name, '家庭菜園');
  assert.equal(g.triggers.length, 1);
  const cal = g.calendars[0];
  const springReview = cal.events.length; // 春の見直しの予定
  assert.equal(springReview, 1);

  g.post({ action: 'save_plan', plan: { id: 'p2', year: 2026, month: 12, timing: '中旬', system: 'bato', work: '追肥', details: '', updatedAt: iso(0) } });
  assert.equal(cal.events.length, 2);
  const ev = cal.events[1];
  assert.match(ev.title, /【菜園】BatoBucket：追肥/);
  g.post({ action: 'save_plan', plan: { id: 'p2', year: 2026, month: 12, timing: '中旬', system: 'bato', work: '追肥', details: '多めに', doneDate: '2026-12-12', updatedAt: iso(5) } });
  assert.equal(cal.events.length, 2, '直しても予定は増えない');
  assert.match(ev.title, /^✅ 【菜園】BatoBucket：追肥 多めに/);
  g.post({ action: 'delete_plan', id: 'p2' });
  assert.equal(ev.deleted, true);
  assert.equal(g.get({ action: 'get_plans' }).plans.filter(p => p.id === 'p2').length, 0);
});

test('1000行を超えても書き込める（行を足す）', () => {
  const g = createEnv();
  const ops = [];
  for (let i = 0; i < 1005; i++) ops.push({ action: 'upsert', record: { id: 'n' + i, date: today(), systemKey: 'bato', kind: '液肥', ec: 1.9, updatedAt: iso() } });
  const res = g.post({ action: 'batch', ops });
  assert.equal(res.results.filter(r => r.result === 'saved').length, 1005);
  assert.equal(g.table('記録').length, 1005);
  assert.equal(typeof g.table('記録')[1004]['日付'], 'string');
});

test('写真：base64 はドライブ（はじめの設定のあとは HydroDaily/photos）に入り、リンクを知る人が見られる URL になる', () => {
  const g = createEnv();
  g.run('setupHydro');
  const tiny = 'data:image/jpeg;base64,' + Buffer.from('jpg').toString('base64');
  const res = g.post({ action: 'upsert', record: { id: 'ph1', date: '2026-11-08', systemKey: 'bato', kind: '日誌', photos: [tiny, 'https://lh3.googleusercontent.com/d/old'], updatedAt: iso() } });
  assert.equal(res.photos.length, 2);
  assert.match(res.photos[0], /^https:\/\/lh3\.googleusercontent\.com\/d\/file_/);
  assert.equal(res.photos[1], 'https://lh3.googleusercontent.com/d/old');
  const f = g.files[0];
  assert.deepEqual(f.sharing, ['anyone', 'view']);
  assert.equal(f.parent.name, '202611');
  assert.equal(f.parent.parent.name, 'photos');
  assert.equal(f.parent.parent.parent.name, 'HydroDaily');
});

test('見る用タブ：消していない記録（消した＝いいえ）だけを出す式になっている', () => {
  const g = createEnv();
  g.run('setupHydro');
  const f = n => g.sheet(n).formulas.A1;
  assert.match(f('見る_系統別'), /where T = 'いいえ'/);
  assert.match(f('見る_農薬の履歴'), /D = '農薬' and T = 'いいえ'/);
  assert.match(f('見る_月まとめ'), /Col3 = '液肥' and Col4 is not null and Col6 = 'いいえ'/);
  for (const n of ['見る_系統別', '見る_月まとめ', '見る_農薬の履歴']) assert.doesNotMatch(f(n), /'はい'/);
  // 記録の「消した」列は いいえ／はい のどちらかだけ
  g.post({ action: 'upsert', record: { id: 'v1', date: today(), systemKey: 'bato', kind: '液肥', ec: 1.9, updatedAt: iso() } });
  assert.equal(g.table('記録')[0]['消した'], 'いいえ');
});

test('AIの提案：状態「提案」の予定は、今日やること・カレンダーに出ない。「採用」（状態＝予定）で出る', () => {
  const g = createEnv();
  g.run('setupHydro');
  const cal = g.calendars[0];
  const before = cal.events.length;
  const t = today();
  const plan = { id: 'ai1', year: +t.slice(0, 4), month: +t.slice(5, 7), timing: t, system: 'bato', work: '追肥', details: 'AIの案', status: '提案', updatedAt: iso(0) };
  assert.equal(g.post({ action: 'save_plan', plan }).result, 'saved');
  assert.equal(cal.events.length, before, '提案はカレンダーに入れない');
  assert.ok(!g.get({ action: 'get_today' }).items.some(i => i.planId === 'ai1'));
  const p = g.get({ action: 'get_plans' }).plans.find(x => x.id === 'ai1');
  assert.equal(p.status, '提案');
  g.post({ action: 'save_plan', plan: { ...plan, status: '予定', updatedAt: iso(5) } });
  assert.equal(cal.events.length, before + 1);
  assert.ok(g.get({ action: 'get_today' }).items.some(i => i.planId === 'ai1'));
  // 状態を書かない古い送り方は「予定」
  g.post({ action: 'save_plan', plan: { id: 'old1', year: 2026, month: 12, timing: '上旬', system: 'dwc', work: '収穫', updatedAt: iso() } });
  assert.equal(g.get({ action: 'get_plans' }).plans.find(x => x.id === 'old1').status, '予定');
});

test('合言葉：決めてあると、合言葉のない・ちがう書き込みは断る。読み出しはできる', () => {
  const g = createEnv();
  g.props['WRITE_TOKEN'] = 'himitsu-123';
  const rec = { id: 'tk1', date: today(), systemKey: 'bato', kind: '液肥', ec: 1.9, updatedAt: iso() };
  const no = g.post({ action: 'upsert', record: rec });
  assert.equal(no.status, 'error');
  assert.match(no.message, /合言葉/);
  assert.equal(g.post({ action: 'batch', token: 'chigau', ops: [{ action: 'upsert', record: rec }] }).status, 'error');
  assert.equal(g.post({ action: 'upsert', token: 'himitsu-123', record: rec }).status, 'success');
  assert.equal(g.get({ action: 'get_records' }).records.length, 1);
});

test('合言葉を決めていないうちは、今までどおり書ける（古い画面を止めない）', () => {
  const g = createEnv();
  assert.equal(g.post({ action: 'journal', id: 'j0', timestamp: iso(), date: today(), system: 'BatoBucket', memo: 'x' }).status, 'success');
});

// ---- 2026-11-08 辛口審査（REJECT）の指摘 ----
test('C3：開いたままの古い画面から journal で同じ id が来ても、v2 の農薬・液肥の記録の種類や項目は消えない（メモと写真だけ重ねる）', () => {
  const g = createEnv();
  g.post({ action: 'upsert', record: { id: 'v2p', date: '2026-11-06', systemKey: 'dwc', kind: '農薬', pestName: 'ゼンターリ顆粒水和剤', dilution: 1000, waterL: 2, dose: 2, unit: 'g', memo: 'はじめ', updatedAt: '2026-11-06T00:00:00.000Z' } });
  g.post({ action: 'upsert', record: { id: 'v2e', date: '2026-11-06', systemKey: 'bato', kind: '液肥', ec: 1.8, ph: 6.1, temp: 15, addedMl: 75.2, updatedAt: '2026-11-06T00:00:00.000Z' } });
  g.post({ action: 'journal', id: 'v2p', timestamp: '2026-11-07T00:00:00.000Z', date: '2026-11-06', system: 'DWC / NFT', ec: '2.0', memo: '古い画面で直した', photos: [] });
  g.post({ action: 'journal', id: 'v2e', timestamp: '2026-11-07T00:00:00.000Z', date: '2026-11-06', system: 'BatoBucket', ec: '2.0', memo: 'メモだけ', photos: [] });
  const rows = g.table('記録');
  const p = rows.find(r => r['id'] === 'v2p'), e = rows.find(r => r['id'] === 'v2e');
  assert.equal(p['種類'], '農薬'); assert.equal(p['農薬名'], 'ゼンターリ顆粒水和剤'); assert.equal(p['薬量'], 2); assert.equal(p['メモ'], '古い画面で直した');
  assert.equal(e['種類'], '液肥'); assert.equal(e['EC'], 1.8); assert.equal(e['pH'], 6.1); assert.equal(e['水温'], 15); assert.equal(e['追肥mL'], 75.2); assert.equal(e['メモ'], 'メモだけ');
});

test('W5：毎朝のメールは、カレンダーが見つからなくても先に送り、そのことも書く', () => {
  const g = createEnv();
  g.run('setupHydro');
  g.calendars.length = 0; // 誰かがカレンダーを消した
  g.post({ action: 'upsert', record: { id: 'w5', date: today(-9), systemKey: 'bato', kind: '液肥', ec: 1.8, updatedAt: iso() } });
  g.run('dailyReminder');
  assert.equal(g.mails.length, 1);
  assert.match(g.mails[0].body, /カレンダー「家庭菜園」が見つかりません/);
});

test('W5：毎朝カレンダーに合わせるのは、まだ済んでいない今日以降の予定だけ', () => {
  const g = createEnv();
  g.run('setupHydro');
  const cal = g.calendars[0];
  g.post({ action: 'save_plan', plan: { id: 'old', year: 2025, month: 1, timing: '上旬', system: 'bato', work: '追肥', doneDate: '2025-01-05', updatedAt: iso() } });
  const ev = cal.events.find(e => /追肥/.test(e.title));
  ev.title = 'さわられていない';
  g.run('dailyReminder');
  assert.equal(ev.title, 'さわられていない');
});

test('再審査 W-b：古い画面が見せていた「【防除】…」「【水替え】」の頭書きは、直されても重ならない', () => {
  const g = createEnv();
  g.post({ action: 'upsert', record: { id: 'wb', date: '2026-11-06', systemKey: 'dwc', kind: '農薬', pestName: 'サンヨール', dilution: 500, waterL: 2, dose: 4, unit: 'mL', memo: '', updatedAt: '2026-11-06T00:00:00.000Z' } });
  const shown = g.get({ action: 'get_timeline' }).entries.find(e => e.id === 'wb').memo;
  assert.match(shown, /^【防除】サンヨール/);
  g.post({ action: 'journal', id: 'wb', timestamp: '2026-11-07T00:00:00.000Z', date: '2026-11-06', system: 'DWC / NFT', memo: shown + ' 追記', photos: [] });
  assert.equal(g.table('記録')[0]['メモ'], '追記');
  g.post({ action: 'upsert', record: { id: 'wc', date: '2026-11-06', systemKey: 'bato', kind: '水替え', memo: '全部', updatedAt: '2026-11-06T00:00:00.000Z' } });
  const shown2 = g.get({ action: 'get_timeline' }).entries.find(e => e.id === 'wc').memo;
  g.post({ action: 'journal', id: 'wc', timestamp: '2026-11-07T00:00:00.000Z', date: '2026-11-06', system: 'BatoBucket', memo: shown2, photos: [] });
  assert.equal(g.table('記録').find(r => r['id'] === 'wc')['メモ'], '全部');
});

test('ping は版を返す', () => {
  const g = createEnv();
  assert.equal(g.get({ action: 'ping' }).version, '2.0.0');
});

test('関数名はすべて英数字（日本語の名前は Apps Script のエディタで「不明なエラー」になって動かない。2026-11-08 本番で発生）', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'gas', 'Code.gs'), 'utf8');
  const names = [...src.matchAll(/^function\s+([^\s(]+)\s*\(/gm)].map(m => m[1]);
  assert.ok(names.length > 10);
  const bad = names.filter(n => !/^[A-Za-z0-9_$]+$/.test(n));
  assert.deepEqual(bad, []);
  for (const n of ['setupHydro', 'migrateOldTabs', 'checkMigration', 'renameOldTabs', 'testMorningMail', 'moveOldPhotos', 'dailyReminder']) assert.ok(names.includes(n), n);
});
