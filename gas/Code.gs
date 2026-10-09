/**
 * HydroDaily Google Apps Script Backend (Standalone & Bound Compatible)
 * 
 * - doPost: 栽培ログ(save_log) または タイムライン日誌(journal)の記録 & 写真のGoogle Drive保存
 * - doGet: 過去の10年日記(get_diary) または 全タイムライン日誌(get_timeline)の抽出・返却
 */

const SHEET_NAME = 'cultivation_logs';
const JOURNAL_SHEET_NAME = 'journal_logs';
const DRIVE_BASE_FOLDER = 'Antigravity_Inbox';
const PHOTOS_FOLDER = 'photos';
const DEFAULT_SPREADSHEET_NAME = 'HydroDaily_栽培ログ';

function getOrCreateSpreadsheet() {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;

  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty('SPREADSHEET_ID');
  if (sheetId) {
    try {
      return SpreadsheetApp.openById(sheetId);
    } catch (e) {}
  }

  // Googleドライブから既存シートを検索、なければ完全自動作成
  const files = DriveApp.getFilesByName(DEFAULT_SPREADSHEET_NAME);
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(DEFAULT_SPREADSHEET_NAME);
  }

  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // 1. タイムライン日誌の保存 (action: journal)
    if (data.action === 'journal') {
      const ss = getOrCreateSpreadsheet();
      let sheet = ss.getSheetByName(JOURNAL_SHEET_NAME);
      if (!sheet) {
        sheet = ss.insertSheet(JOURNAL_SHEET_NAME);
        sheet.appendRow([
          'id', 'timestamp', 'date', 'day_name', 'system', 'ec', 'memo', 'photo_urls'
        ]);
      }

      // Google Driveへ写真保存 & 高速表示URL(lh3)生成
      const photoUrls = [];
      if (data.photos && data.photos.length > 0) {
        const yearMonth = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMM');
        const targetFolder = getOrCreatePhotosFolder(yearMonth);
        
        data.photos.forEach((photo, idx) => {
          if (typeof photo === 'string' && photo.startsWith('data:image')) {
            const decoded = Utilities.base64Decode(photo.replace(/^data:image\/[a-z]+;base64,/, ''));
            const safeDate = (data.date || 'unknown').replace(/[^0-9]/g, '');
            const safeSys = (data.system || 'bato').toLowerCase();
            const fileName = `${safeDate}_${safeSys}_journal_0${idx + 1}.jpg`;
            const blob = Utilities.newBlob(decoded, 'image/jpeg', fileName);
            const file = targetFolder.createFile(blob);
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            photoUrls.push(`https://lh3.googleusercontent.com/d/${file.getId()}`);
          } else if (typeof photo === 'string') {
            photoUrls.push(photo);
          }
        });
      }

      const nowUtc = data.timestamp || new Date().toISOString();
      const entryId = data.id || ('entry_' + Date.now());

      sheet.appendRow([
        entryId,
        nowUtc,
        data.date || '',
        data.dayName || data.day_name || '',
        data.system || '',
        data.ec || '',
        data.memo || '',
        photoUrls.join(',')
      ]);

      return responseJson({
        status: 'success',
        id: entryId,
        saved_row: sheet.getLastRow(),
        photo_urls: photoUrls
      });
    }

    // 2. 液肥計算ログの保存 (action: save_log)
    if (data.action === 'save_log') {
      const ss = getOrCreateSpreadsheet();
      let sheet = ss.getSheetByName(SHEET_NAME);
      if (!sheet) {
        sheet = ss.insertSheet(SHEET_NAME);
        sheet.appendRow([
          'timestamp', 'date', 'system_id', 'current_ec', 'target_ec',
          'added_ml', 'ph', 'water_temp', 'memo', 'photo_urls'
        ]);
      }

      // Photo upload to Drive
      const photoUrls = [];
      if (data.photos && data.photos.length > 0) {
        const yearMonth = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMM');
        const targetFolder = getOrCreatePhotosFolder(yearMonth);
        
        data.photos.forEach((photo, idx) => {
          const base64Str = photo.base64 || photo;
          if (typeof base64Str === 'string' && base64Str.startsWith('data:image')) {
            const decoded = Utilities.base64Decode(base64Str.replace(/^data:image\/[a-z]+;base64,/, ''));
            const fileName = `${data.date.replace(/-/g, '')}_${data.system_id}_0${idx + 1}.jpg`;
            const blob = Utilities.newBlob(decoded, 'image/jpeg', fileName);
            const file = targetFolder.createFile(blob);
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            photoUrls.push(`https://lh3.googleusercontent.com/d/${file.getId()}`);
          }
        });
      }

      // Append log row (UTC ISO timestamp)
      const nowUtc = new Date().toISOString();
      sheet.appendRow([
        nowUtc,
        data.date,
        data.system_id,
        data.current_ec,
        data.target_ec,
        data.added_ml,
        data.ph || '',
        data.water_temp || '',
        data.memo || '',
        photoUrls.join(',')
      ]);

      return responseJson({
        status: 'success',
        saved_row: sheet.getLastRow(),
        spreadsheet_url: ss.getUrl(),
        photo_urls: photoUrls
      });
    }

    return responseJson({ status: 'error', message: 'Invalid action: ' + data.action });
  } catch (err) {
    return responseJson({ status: 'error', message: err.toString() });
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action;

    // 1. 全タイムライン日誌リスト取得 (action: get_timeline)
    if (action === 'get_timeline') {
      const ss = getOrCreateSpreadsheet();
      const sheet = ss.getSheetByName(JOURNAL_SHEET_NAME);
      if (!sheet || sheet.getLastRow() <= 1) {
        return responseJson({ status: 'success', entries: [] });
      }

      const rows = sheet.getDataRange().getValues();
      const results = [];

      // Skip header row
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0] && !row[2]) continue; // IDまたは日付がない行はスキップ
        
        const photoUrlsStr = row[7] ? String(row[7]).trim() : '';
        results.push({
          id: String(row[0] || ('entry_' + i)),
          timestamp: row[1] ? String(row[1]) : '',
          date: String(row[2] || ''),
          dayName: String(row[3] || ''),
          system: String(row[4] || ''),
          ec: String(row[5] || ''),
          memo: String(row[6] || ''),
          photos: photoUrlsStr ? photoUrlsStr.split(',').map(s => s.trim()).filter(Boolean) : []
        });
      }

      // タイムスタンプまたは日付降順（新しい順）
      results.sort((a, b) => (b.timestamp || b.date).localeCompare(a.timestamp || a.date));

      return responseJson({ status: 'success', entries: results });
    }

    // 2. 過去の10年日記抽出 (action: get_diary)
    if (action === 'get_diary') {
      const systemId = e.parameter.system_id || 'bato';
      const month = parseInt(e.parameter.month, 10);
      const day = parseInt(e.parameter.day, 10);
      const range = parseInt(e.parameter.range, 10) || 7;

      const ss = getOrCreateSpreadsheet();
      const sheet = ss.getSheetByName(SHEET_NAME);
      if (!sheet || sheet.getLastRow() <= 1) {
        return responseJson({ status: 'success', logs: [] });
      }

      const rows = sheet.getDataRange().getValues();
      const results = [];

      // Skip header
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowSysId = row[2];
        const rowDateStr = String(row[1]); // YYYY-MM-DD
        
        if (rowSysId === systemId && rowDateStr) {
          const parts = rowDateStr.split('-');
          if (parts.length === 3) {
            const rowM = parseInt(parts[1], 10);
            const rowD = parseInt(parts[2], 10);
            
            // Check month and day proximity
            if (rowM === month && Math.abs(rowD - day) <= range) {
              results.push({
                year: parseInt(parts[0], 10),
                date: rowDateStr,
                current_ec: row[3],
                target_ec: row[4],
                added_ml: row[5],
                ph: row[6],
                water_temp: row[7],
                memo: row[8],
                photo_urls: row[9] ? String(row[9]).split(',') : []
              });
            }
          }
        }
      }

      return responseJson({ status: 'success', logs: results });
    }

    return responseJson({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return responseJson({ status: 'error', message: err.toString() });
  }
}

function getOrCreatePhotosFolder(yearMonth) {
  const rootFolders = DriveApp.getFoldersByName(DRIVE_BASE_FOLDER);
  let baseFolder = rootFolders.hasNext() ? rootFolders.next() : DriveApp.createFolder(DRIVE_BASE_FOLDER);
  
  const photoFolders = baseFolder.getFoldersByName(PHOTOS_FOLDER);
  let photosFolder = photoFolders.hasNext() ? photoFolders.next() : baseFolder.createFolder(PHOTOS_FOLDER);

  const ymFolders = photosFolder.getFoldersByName(yearMonth);
  return ymFolders.hasNext() ? ymFolders.next() : photosFolder.createFolder(yearMonth);
}

function responseJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
