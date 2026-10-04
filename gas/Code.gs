/**
 * HydroDaily Google Apps Script Backend (Standalone & Bound Compatible)
 * 
 * - doPost: 栽培ログの記録 & 写真のGoogle Drive保存
 * - doGet: 過去の同月同日±7日間の10年日記データの抽出・返却
 */

const SHEET_NAME = 'cultivation_logs';
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
    if (data.action !== 'save_log') {
      return responseJson({ status: 'error', message: 'Invalid action' });
    }

    const ss = getOrCreateSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      // Header row
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
        const decoded = Utilities.base64Decode(photo.base64.replace(/^data:image\/[a-z]+;base64,/, ''));
        const fileName = `${data.date.replace(/-/g, '')}_${data.system_id}_0${idx + 1}.jpg`;
        const blob = Utilities.newBlob(decoded, 'image/jpeg', fileName);
        const file = targetFolder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        photoUrls.push(file.getUrl());
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
  } catch (err) {
    return responseJson({ status: 'error', message: err.toString() });
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action;
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

    return responseJson({ status: 'error', message: 'Unknown action' });
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
