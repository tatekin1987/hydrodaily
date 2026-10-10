# 🔄 HANDOFF.md - HydroDaily コンテキスト引き継ぎ書

- **プロジェクト名**: HydroDaily (水耕栽培日誌・液肥電卓 PWA)
- **最終更新日時**: 2026-10-10 09:52 (JST)
- **現行バージョン**: v1.7.1 (本番新GAS Web App完全開通・GitHub Pagesデプロイ完了)

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
3. **写真の大画面拡大表示（Lightbox）**:
   - タイムラインの写真タップで全画面暗幕モーダルが起動し、写真を拡大表示。
   - `let photoList` への再代入修正により、クラウド写真URLでも安定してフルスクリーン拡大可能。
4. **3系統セレクターの「（本日の記録状況）」動的連動**:
   - BatoBucketが最初から「本日記録済」と固定されていたハードコードを完全撤廃。
   - 本日（YYYY-MM-DD）に実際に保存が行われた系統のみ「✅ 本日記録済」（緑バッジ）、未保存は「⏳ 未記録」（アンバーバッジ）に動的切り替え。
   - 日付跨ぎで自動リセットされるKISS構造。
5. **PCとスマホのタイムライン完全同期 ＆ Google Drive画像表示 (v1.7.1 開通確認完了)**:
   - スプレッドシート直結の最新GAS Web Appが正常開通（`HTTP 200 / success` 確認済み）。
   - 自動生成された `journal_logs` シートへの日誌追記および `action=get_timeline` による全件JSON取得を確認。
   - `index.html` の `DEFAULT_GAS_ENDPOINT` を新URLへ完全更新し、古いURLのLocalStorage自動マイグレーションを追加。
   - 生の日付型がスプレッドシートから返された場合の自動日本語フォーマット整形ガードを実装。
6. **全21件のE2Eテスト完全合格（デグレゼロ）**:
   - `tests/test_all_e2e.py` により、既存機能18件＋同期新機能3件（`test_timeline_sync_e2e.py`）の全21テストがオールGreen。
7. **Service Worker v1.7.1 キャッシュバスター更新**:
   - `sw.js`（`hydrodaily-v1.7.1`）

---

## 🏛️ 3. 確定アーキテクチャ・決定事項 (ADRサマリー)
- **ADR-001**: 3系統固定満水 ＆ OAT100倍濃縮投入アルゴリズム
- **ADR-002**: Googleエコシステムによるサーバーレス0円運用（PWA + GAS + スプレッドシート + Drive）
- **ADR-003**: 農薬希釈マスターの保持と初期散布水量（3000 mL）
- **ADR-004**: PC版とアプリ版のURL物理分離（スマホ現場入力 / PC大画面分析）
- **ADR-006**: 実機カメラ撮影 ＆ タイムライン即時永続化設計（Canvas圧縮 + LocalStorage即時同期）
- **ADR-007**: 3系統本日記録連動 ＆ 日誌編集 ＆ 写真大画面ビューアー設計
- **ADR-008**: PCとスマホのタイムライン完全同期 ＆ Google Drive画像表示設計（`journal_logs` 分離・ID重複排除）

---

## 📄 4. 変更・作成されたファイル一覧
- [index.html](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/index.html): 本番フロントエンド（v1.7.1対応、同期バー、ID重複排除マージ、新GAS URL、安全な日付パース）
- [sw.js](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/sw.js): Service Worker キャッシュバスター（`hydrodaily-v1.7.1`）
- [gas/Code.gs](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/gas/Code.gs): バックエンドGAS（`journal_logs` シート自動作成、`action: journal`、`action: get_timeline`）
- [mock_sync_timeline.html](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/mock_sync_timeline.html): タイムライン同期UIモック
- [tests/test_all_e2e.py](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/tests/test_all_e2e.py): 全21件の総合E2Eテストスイート
- [tests/test_timeline_sync_e2e.py](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/tests/test_timeline_sync_e2e.py): タイムライン同期・重複排除・Drive画像Lightboxテスト
- [DECISIONS.md](file:///C:/Users/admin/.gemini/antigravity/scratch/hydrodaily/DECISIONS.md): ADR-001〜ADR-008の設計決定記録

---

## ⚠️ 5. 既知の落とし穴・禁止事項
1. **GASのWeb App再デプロイ時のバージョン選択**:
   - GASコード修正時は必ず「デプロイを管理」➔「編集」➔「新バージョン」を選択してデプロイすること（コード修正だけでは反映されない）。
2. **PWAキャッシュの更新**:
   - 静的HTML変更時は必ず `sw.js` のキャッシュ名バージョン（`CACHE_NAME`）をインクリメントすること。

---

## 🎯 6. 次の担当者への直近タスク（Next Immediate Step）
1. **PC大画面用ダッシュボード（`dashboard.html` / ADR-004）の着手**:
   - 10年日記の年次横断比較（前年同月の写真と今年の写真の並列比較）。
   - PCデスク環境での快適な観察・知見の蓄積画面の構築。
