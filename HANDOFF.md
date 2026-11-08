# HANDOFF.md - HydroDaily 引き継ぎ書（正本）

- **最終更新**: 2026-11-08（🏠Claude）
- **版**: v2.0.0（立て直し。画面・GAS とも作り直し）。**まだ公開していない・本番GASも貼りかえていない**
- **決めたこと**: DECISIONS.md の ADR-012〜017 と、その下の「v2 の辛口審査」。設計の全文は REBUILD_PLAN.md

## どこに何があるか
- スマホ画面: `index.html`（下のタブ4つ：記録／見返し／予定／農薬）、`sw.js`（電波なしでも開く）、PCの10年日記 `dashboard.html`
- GAS: `gas/Code.gs`（v2.0.0。本番に貼る前の新しい版）。本番の旧版の控え: `C:\Users\admin\AI設定の控え\20261108_hydrodaily_本番GAS\Code.gs`
- 公開: GitHub Pages `https://tatekin1987.github.io/hydrodaily/`（main に push すると公開）
- シート: マイドライブ `HydroDaily_栽培ログ`。GAS の URL は index.html の DEFAULT_GAS_ENDPOINT
- モック: `mock_v2.html`（合意済み）

## テスト（全部合格 2026-11-08）
- `PYTHONUTF8=1 py -3.13 tests/test_all_e2e.py` … 30件（画面 23・画面→本物の Code.gs の通し 5・10年日記 4 のうち必要分）
- `node --test tests/gas/gas_contract.test.js` … 26件（Code.gs をにせものの Google の上で動かす）
- 通しテストは `tests/gas/serve.js` が本物の Code.gs を Node で動かす。v1.9 用の古いテストは `tests/削除してよい_v1/`

## 公開の順番（必ずこの順。GAS が先）
1. シートを「ファイル → コピーを作成」で控える
2. Apps Script に gas/Code.gs を丸ごと貼って保存
3. `setupHydro` を実行（権限を許可）
4. `migrateOldTabs` → `checkMigration`（✅合格を見る）
5. 「デプロイを管理 → 今のデプロイを編集 → 新バージョン」（新しいデプロイは作らない＝URLを変えない）
6. `URL?action=ping` で version 2.0.0 を見る
7. 画面を commit・push（先生のOK後）→ スマホで開く → 古い端末の記録が送られる
8. `checkMigration` → `renameOldTabs`
9. 合言葉（スクリプトのプロパティ WRITE_TOKEN）を決め、アプリの設定に入れる（必須）
10. `testMorningMail` でメールが届くか見る

## 次の一手
- 上の公開（先生の作業＋Claude の push）
- 段階7：AI連携スキル「菜園の相談」（記録を読んで相談に答え、予定を「提案」として書く。採用はアプリで）
- 段階6の残り：dashboard.html を v2 の「記録」に合わせる（今は get_timeline で読めている）
- 数年後：端末の records が増え続けるので、古い記録を端末から外す処理
