# 🔄 HANDOFF.md - HydroDaily コンテキスト引き継ぎ書

- **プロジェクト名**: HydroDaily (水耕栽培日誌・液肥電卓 PWA)
- **最終更新日時**: 2026-10-10 10:08 (JST)
- **現行バージョン**: v1.7.2 (日誌安全削除 ＆ ゾンビ復活完全防御 ＆ 全24件E2Eテスト合格)

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
1. **実機カメラ直結 ＆ 端末フォトギャラリー複数選択**:
   - 余計な中間モーダルやサンプル画像（Unsplash）を全廃。
   - 点線枠「＋」ボタン（または🖼️ボタン）を押すと、直接OSのフォトギャラリーが開き、写真をポチポチ複数枚選んで一括追加可能。
   - 「📸」ボタンからスマホ背面カメラ（`capture="environment"`）が1タップで直接起動。
   - Canvasによる自動リサイズ圧縮（長辺1200px・JPEG品質0.8）でLocalStorage容量破綻を完全防止。
2. **タイムライン日誌の即時反映 ＆ 編集（Update）機能**:
   - 日誌保存時にミリ秒でタイムライン最上部に新着カードを追加・再描画。
   - 各カード右上に「✏️ 編集」ボタンを設置。押すと本文・写真がエディタに復元され、上書き更新可能。
3. **タイムライン日誌の安全削除 ＆ ゾンビ復活防御 (v1.7.2 新機能)**:
   - タイムラインカード右上に「🗑️ 削除」ボタン、エディタモーダル内に「🗑️ この日誌を削除」ボタンを設置。
   - 誤タップ防止の `confirm()` ダイアログを実装。
   - LocalStorageから該当日誌を即時消去し、DOMを即時除去。
   - `hydro_deleted_journal_ids`（削除済みIDブラックリスト）により、クラウド同期時のゾンビ復活を100%防止。
   - 本日の日誌がすべて消えた場合、系統セレクターのバッジを「⏳ 未記録」へ自動復帰。
   - GASバックエンドに `action: 'delete_journal'` を実装し、スプレッドシート `journal_logs` 行の物理削除に対応。
4. **写真の大画面拡大表示（Lightbox）**:
   - タイムラインの写真タップで全画面暗幕モーダルが起動し、写真を拡大表示。
   - クラウド写真URL（lh3）でも安定してフルスクリーン拡大可能。
5. **3系統セレクターの「（本日の記録状況）」動的連動**:
   - 本日（YYYY-MM-DD）に実際に保存が行われた系統のみ「✅ 本日記録済」（緑バッジ）、未保存・削除後は「⏳ 未記録」（アンバーバッジ）に動的切り替え。
6. **PCとスマホのタイムライン完全同期 ＆ Google Drive画像表示 (v1.7.1 開通)**:
   - スプレッドシート直結の最新GAS Web Appが正常開通（`HTTP 200 / success` 確認済み）。
   - 自動生成された `journal_logs` シートへの日誌追記および `action=get_timeline` による全件JSON取得を確認。
7. **全24件のE2Eテスト完全合格（デグレゼロ）**:
   - `tests/test_all_e2e.py` により、既存機能21件＋日誌削除新機能3件（`tests/test_journal_delete_e2e.py`）の全24テストがオールGreen。
8. **Service Worker v1.7.2 キャッシュバスター更新**:
   - `sw.js`（`hydrodaily-v1.7.2`）

---

## 🏛️ 3. 確定アーキテクチャ・決定事項 (ADRサマリー)
- **ADR-001**: 3系統固定満水 ＆ OAT100倍濃縮投入アルゴリズム
- **ADR-002**: Googleエコシステムによるサーバーレス0円運用（PWA + GAS + スプレッドシート + Drive）
- **ADR-003**: 農薬希釈マスターの保持と初期散布水量（3000 mL）
- **ADR-004**: PC版とアプリ版のURL物理分離（スマホ現場入力 / PC大画面分析）
- **ADR-006**: 実機カメラ撮影 ＆ タイムライン即時永続化設計（Canvas圧縮 + LocalStorage即時同期）
- **ADR-007**: 3系統本日記録連動 ＆ 日誌編集 ＆ 写真大画面ビューアー設計
- **ADR-008**: PCとスマホのタイムライン完全同期 ＆ Google Drive画像表示設計（`journal_logs` 分離・ID重複排除）
- **ADR-009**: タイムライン日誌の安全削除 ＆ クラウド・ゾンビ復活完全防御設計

---

## 📄 4. 変更・作成されたファイル一覧
- [index.html](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/index.html): 本番フロントエンド（v1.7.2対応、カード削除ボタン、エディタモーダル削除ボタン、ゾンビ復活ガード、ステータス再計算）
- [sw.js](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/sw.js): Service Worker キャッシュバスター（`hydrodaily-v1.7.2`）
- [gas/Code.gs](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/gas/Code.gs): バックエンドGAS（`action: delete_journal` による `journal_logs` 行の安全削除）
- [mock_journal_delete.html](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/mock_journal_delete.html): 日誌削除UI/UXプロトタイプモック
- [tests/test_all_e2e.py](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/tests/test_all_e2e.py): 全24件の総合E2Eテストスイート
- [tests/test_journal_delete_e2e.py](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/tests/test_journal_delete_e2e.py): 日誌削除・ゾンビ復活防御E2Eテストスイート
- [DECISIONS.md](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/DECISIONS.md): ADR-001〜ADR-009の設計決定記録

---

## ⚠️ 5. 既知の落とし穴・禁止事項
1. **GASのWeb App再デプロイ時のバージョン選択**:
   - GASコード（`gas/Code.gs`）を修正した際は、必ず「デプロイを管理」➔「編集」➔「新バージョン」を選択してデプロイすること（コード修正だけでは反映されない）。
2. **PWAキャッシュの更新**:
   - 静的HTML変更時は必ず `sw.js` のキャッシュ名バージョン（`CACHE_NAME`）をインクリメントすること。

---

## 🎯 6. 次の担当者への直近タスク（Next Immediate Step）
1. **PC大画面用ダッシュボード（`dashboard.html` / ADR-004）の着手**:
   - 10年日記の年次横断比較（前年同月の写真と今年の写真の並列比較）。
   - PCデスク環境での快適な観察・知見の蓄積画面の構築。
