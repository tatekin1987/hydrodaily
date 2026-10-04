# SCHEMA.md - HydroDaily データ・API定義書

## 1. Google スプレッドシート（`cultivation_logs`）
| 列番号 | カラム名 | データ型 | 制約・形式 | サンプル値 | 説明 |
| :---: | :--- | :--- | :--- | :--- | :--- |
| A | `timestamp` | string | ISO 8601 (UTC) | `2026-10-04T08:20:00Z` | 保存日時（UTC統一） |
| B | `date` | string | YYYY-MM-DD (JST) | `2026-10-04` | 栽培ログ日付（JST） |
| C | `system_id` | string | `bato` \| `dwc` \| `tower` | `bato` | 系統ID |
| D | `current_ec` | number | 小数点第2位まで | `1.8` | 測定時EC (mS/cm) |
| E | `target_ec` | number | 小数点第2位まで | `2.2` | 目標EC (mS/cm) |
| F | `added_ml` | number | 小数点第1位まで | `150.4` | A液/B液の各投入量 (mL) |
| G | `ph` | number \| null | 任意入力 | `6.2` | 水素イオン指数 |
| H | `water_temp` | number \| null | 任意入力 (℃) | `22.5` | 養液水温 |
| I | `memo` | string | 任意テキスト | `花蕾が大きくなってきた` | 観察メモ |
| J | `photo_urls` | string | カンマ区切りURL (最大5件) | `https://drive.google.com/...` | Drive格納先URL |

## 2. Google ドライブ（写真保存仕様）
- **保存親フォルダ**: `Antigravity_Inbox/photos/YYYYMM/`（年月別フォルダ自動生成）
- **ファイル命名規則**: `YYYYMMDD_[system_id]_[01-05].jpg`
- **画像圧縮**: クライアント側（PWA）で長辺最大1200px、JPEG品質0.8にリサイズ・圧縮してからBase64送信。

## 3. Google Apps Script (GAS) Web App API インターフェース
### ① ログ保存・写真アップロード (`POST /`)
- **Request Payload**:
```json
{
  "action": "save_log",
  "date": "2026-10-04",
  "system_id": "bato",
  "current_ec": 1.8,
  "target_ec": 2.2,
  "added_ml": 150.4,
  "ph": 6.2,
  "water_temp": 22.5,
  "memo": "花蕾が大きくなってきた",
  "photos": [
    {
      "name": "photo_01.jpg",
      "base64": "data:image/jpeg;base64,..."
    }
  ]
}
```
- **Response**:
```json
{
  "status": "success",
  "saved_row": 104,
  "photo_urls": [
    "https://drive.google.com/uc?id=xxx"
  ]
}
```

### ② 10年日記取得 (`GET /?action=get_diary&system_id=bato&month=10&day=04&range=7`)
- **Response**:
```json
{
  "status": "success",
  "logs": [
    {
      "year": 2025,
      "date": "2025-10-02",
      "current_ec": 1.9,
      "added_ml": 112.8,
      "memo": "定植完了",
      "photo_urls": ["https://drive.google.com/..."]
    }
  ]
}
```

## 4. クライアント側 LocalStorage キー構造
- `hydro_draft_[system_id]`: 系統ごとの入力中下書きデータ（リアルタイム同期）
- `hydro_custom_pesticides`: ユーザーが追加したカスタム農薬マスター
