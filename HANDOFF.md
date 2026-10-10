# 🔄 HANDOFF.md - HydroDaily コンテキスト引き継ぎ書

- **プロジェクト名**: HydroDaily (水耕栽培日誌・液肥電卓 PWA)
- **最終更新日時**: 2026-10-10 20:25 (JST)
- **現行バージョン**: v1.8.0 (10年日記・年次比較ダッシュボード & 全28件E2Eテスト合格)

---

## 📂 1. 成果物の保存先ディレクトリ
- **ローカルリポジトリ**: `C:\Users\admin\.gemini\antigravity\scratch\hydrodaily`
- **GitHubリモート**: `https://github.com/tatekin1987/hydrodaily.git` (ブランチ: `main`)
- **Google Drive同期先**: `G:\マイドライブ\Antigravity_Inbox`
- **本番スプレッドシート**: `G:\マイドライブ\HydroDaily_栽培ログ.gsheet`
- **本番GAS Web App URL**: `https://script.google.com/macros/s/AKfycbzHnbRYd8D5auR8GmDNNQAR9PiCKyxhVpFelbXPW4bJl9A6MmnasbcEPNCMqE_XgT_c/exec`

---

## 🏁 2. ゴールと現在地 (Progress)

### 【達成済み項目 (Done)】
1. **10年日記・年次比較ダッシュボード (`dashboard.html` / ADR-010 新機能)**:
   - スマホ現場利用を最優先にした「上下タイムライン・スタック型（B案）」を採用。
   - 選択された日付（デフォルト今日）の同月同日を基準に、今年（2026年）➔ 1年前（2025年）➔ 2年前（2024年）の記録を縦スクロールでストレスなく閲覧可能。
   - **同月同日 ±7日 スマート近似マッチング**: 過去同日ぴったりに記録がない場合、前後7日以内の直近ログを自動補完し、「📅 2025-10-08 (2日前)」などの近接バッジを表示（スカスカ画面の完全防止）。
   - **3系統セレクター ＆ 日付ナビゲーション**: 🍓 BatoBucket / 🥬 DWC / 🗼 タワーをワンタップ切り替え。「◀ 前の日」「次の日 ▶」「今日」およびカレンダー日付ピッカーで自在にタイムトラベル。
   - **大画面ハイレゾ写真 Lightbox 拡大表示**: 写真タップで全画面暗幕モーダルが起動し、高精細写真を見比べ可能。
   - **GAS クラウドオンデマンド同期**: ヘッダーの「🔄 同期」ボタンでスプレッドシートから最新の `journal_logs` を即座に取得・マージ。
2. **スマホ現場版 (`index.html`) との相互直結動線**:
   - `index.html` ヘッダーに「📊 10年日記」ボタンを設置。
   - `dashboard.html` ヘッダーに「📱 現場入力へ」ボタンを設置。1タップで往復可能。
3. **実機カメラ直結 ＆ 端末フォトギャラリー複数選択**:
   - 点線枠「＋」ボタン（または🖼️ボタン）でOSフォトギャラリー直接起動、写真複数一括追加。
   - 「📸」ボタンで背面カメラ直接起動。Canvas圧縮（長辺1200px・JPEG品質0.8）でLocalStorage保護。
4. **タイムライン日誌の安全削除 ＆ ゾンビ復活防御**:
   - タイムラインカード右上に「🗑️ 削除」ボタン。LocalStorageとDOMから即時消去。
   - `hydro_deleted_journal_ids` ブラックリストによりクラウド同期時のゾンビ復活を完全防御。
5. **全28件のE2Eテスト完全合格（デグレゼロ）**:
   - `tests/test_all_e2e.py` により、既存機能24件 ＋ 10年日記ダッシュボード新機能4件（`tests/test_dashboard_10year_e2e.py`）の全28テストがオールGreen。
6. **Service Worker v1.8.0 キャッシュバスター更新**:
   - `sw.js`（`hydrodaily-v1.8.0`）

---

## 🏛️ 3. 確定アーキテクチャ・決定事項 (ADRサマリー)
- **ADR-001**: 3系統固定満水 ＆ OAT100倍濃縮投入アルゴリズム
- **ADR-002**: Googleエコシステムによるサーバーレス0円運用（PWA + GAS + スプレッドシート + Drive）
- **ADR-003**: 農薬希釈マスターの保持と初期散布水量（3000 mL）
- **ADR-004**: PC版とアプリ版のURL物理分離（スマホ現場入力 / PC大画面分析）
- **ADR-006**: 実機カメラ撮影 ＆ タイムライン即時永続化設計（Canvas圧縮 + LocalStorage即時同期）
- **ADR-007**: 3系統本日記録連動 ＆ 日誌編集 ＆ 写真大画面ビューアー設計
- **ADR-008**: PCとスマホのタイムライン完全同期 ＆ Google Drive画像表示設計
- **ADR-009**: タイムライン日誌の安全削除 ＆ クラウド・ゾンビ復活完全防御設計
- **ADR-010**: 10年日記比較ビューの縦型レスポンシブ・スタック設計（B案採用）

---

## 📄 4. 変更・作成されたファイル一覧
- [dashboard.html](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/dashboard.html): 10年日記・年次比較ダッシュボード（上下スタック型、同月同日±7日スマート補完、Lightbox、系統切り替え、GASクラウド同期）
- [mock_dashboard_10year.html](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/mock_dashboard_10year.html): 10年日記UI/UXプロトタイプモック
- [index.html](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/index.html): スマホ現場版フロントエンド（ヘッダーに「📊 10年日記」ダッシュボード直結リンクを追加）
- [sw.js](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/sw.js): Service Worker キャッシュバスター（`hydrodaily-v1.8.0`）
- [tests/test_dashboard_10year_e2e.py](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/tests/test_dashboard_10year_e2e.py): 10年日記ダッシュボードE2Eテスト（4テスト）
- [tests/test_all_e2e.py](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/tests/test_all_e2e.py): 全28件の総合E2Eテストスイート
- [DECISIONS.md](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/DECISIONS.md): ADR-010（10年日記比較ビューの縦型スタック設計）追記
- [PLAN_DASHBOARD_10YEAR.md](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/PLAN_DASHBOARD_10YEAR.md): 16機能マトリクス＆10スプリントロードマップ計画書

---

## 🎯 5. 次の担当者への直近タスク（Next Immediate Step）
1. **実機（スマホ・PC）での使い心地のフィードバック受領**:
   - `dashboard.html` および `index.html` の往復動線、10年日記の前後送り・写真拡大の手触り確認。
2. **必要に応じた追加要望の実装**:
   - 年次横断のEC水質グラフ化やメモ検索機能など、さらなる発展機能の検討。
