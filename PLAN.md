# PLAN.md - HydroDaily 実装計画書（Step 4）

## 1. 実装フェーズと役割分担（7大パイプライン準拠）
- **Phase 1（Spark）**: 仕様確定・データ定義・計画書策定 ➔ **【Handover 1 完了】**
- **Phase 2（Antigravity）**: 画面骨組み（モック）構築 & 最小E2Eテスト作成（レッド確認） ➔ **【Handover 2】**
- **Phase 3（Aider）**: テスト通過ループ（オールグリーン化） & Gitコミット

## 2. 実装TODOリスト
- [ ] **Task 1: プロジェクト基盤の初期化**
  - Vite + Tailwind CSS による高速静的PWA環境のセットアップ
  - `config.json` の配置と読み込み処理
- [ ] **Task 2: コア計算モジュール (`src/calculator.js`)**
  - OAT液肥投入量算出関数 `calculateFertilizer(systemId, currentEc, targetEc)`
  - 異常値セーフティロック判定 `isAbnormalEc(currentEc)` (<=0.5 or >=3.5)
  - 農薬希釈計算関数 `calculatePesticide(waterMl, dilution)`
- [ ] **Task 3: 状態管理 & LocalStorage自動保存 (`src/storage.js`)**
  - 現在の入力値（系統、EC、メモ等）のリアルタイム下書き保存 & リロード復元
  - カスタム農薬の追加・読み込み
- [ ] **Task 4: UI/UXコンポーネント構築**
  - ヘッダー（日付表示、モードタブ、系統切替タブ）
  - メイン計算カード（テンキー入力、特大投入量表示、異常値警告バッジ）
  - 観察入力欄（pH、水温、メモ、写真アップローダー最大5枚）
  - 最下部固定バー（保存ボタン、ローディングスピナー）
- [ ] **Task 5: 10年日記カード (`src/diary.js`)**
  - 同一系統の過去ログ（本日±7日）表示カード
  - スケルトンローディング表示
- [ ] **Task 6: Google Apps Scriptバックエンド (`gas/Code.gs`)**
  - `doPost`: Base64画像をGoogle Drive (`Antigravity_Inbox/photos/YYYYMM/`) に保存し、スプレッドシート (`cultivation_logs`) に行追記
  - `doGet`: パラメータ（`system_id`, `month`, `day`, `range`）に応じた日記データ抽出・JSON返却

## 3. 変更対象ファイル群の特定
- `index.html` (エントリーポイント・PWAマニフェスト)
- `src/main.js` (UIイベント・バインド)
- `src/calculator.js` (コア計算ロジック)
- `src/storage.js` (LocalStorage永続化)
- `src/gasApi.js` (GAS Web App通信クライアント)
- `src/config.json` (設定辞書・資材データ)
- `gas/Code.gs` (Google Apps Scriptバックエンド)
- `tests/calculator.spec.js` (Antigravityが作成する最小E2Eテストハーネス)

## 4. 受け入れ基準（E2E先行テスト観点 / レッド確認要件）
1. **計算整合性**: BatoBucket（94L）でEC 1.8 ➔ 2.2 のとき、A液/B液 各150.4 mL が算出されること
2. **飽和ガード**: 現在EC >= 目標EC のとき、「追肥不要（0 mL）」と表示されること
3. **安全停止**: 現在EC <= 0.5 または >= 3.5 のとき、警告が表示され保存ボタンがDisabledになること
4. **UX下書き復元**: 入力途中でリロードしても、直前の入力値がLocalStorageから復元されること
5. **二重送信防止**: 保存ボタン押下直後にボタンが非活性化され、二重実行が遮断されること
