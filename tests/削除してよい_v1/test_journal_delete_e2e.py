import os
import socket
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
import unittest
import json
from playwright.sync_api import sync_playwright, expect

def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

class JournalDeleteE2ETest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = find_free_port()
        cls.dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=cls.dir, **kwargs)
            def log_message(self, format, *args):
                pass

        cls.httpd = HTTPServer(('127.0.0.1', cls.port), Handler)
        cls.server_thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.server_thread.start()

        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(channel="msedge", headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.httpd.shutdown()

    def setUp(self):
        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        self.page.set_default_timeout(3000)
        self.url = f"http://127.0.0.1:{self.port}/index.html"

    def tearDown(self):
        self.context.close()

    def test_delete_journal_from_timeline_card(self):
        """TC-DEL-01: タイムラインカード右上の削除ボタンから削除でき、DOMとLocalStorageから消滅すること"""
        initial_entry = {
            "id": "entry_delete_target_01",
            "date": "2026年10月10日",
            "dayName": "土曜日",
            "system": "BatoBucket",
            "ec": "2.0",
            "memo": "削除対象のテストメモカード01",
            "photos": [],
            "timestamp": "2026-10-10T09:00:00.000Z"
        }

        self.page.goto(self.url)
        self.page.evaluate(f"""() => {{
            localStorage.clear();
            localStorage.setItem('hydro_timeline_entries', JSON.stringify([{json.dumps(initial_entry)}]));
        }}""")
        self.page.reload()

        # タイムラインタブを開く
        self.page.locator('button[onclick*="timeline"]').click()

        # メモが表示されていることを確認
        memo_locator = self.page.locator('text=削除対象のテストメモカード01')
        expect(memo_locator).to_be_visible()

        # 削除ボタンが存在すること
        delete_btn = self.page.locator('.btn-delete-journal[data-entry-id="entry_delete_target_01"], button[onclick*="entry_delete_target_01"].btn-delete-journal')
        expect(delete_btn).to_be_visible()

        # confirm ダイアログを自動承認
        self.page.on("dialog", lambda dialog: dialog.accept())

        # 削除ボタンをクリック
        delete_btn.click()

        # DOMからメモが消えたこと
        expect(memo_locator).not_to_be_visible()

        # LocalStorageからも消去されていること
        stored = self.page.evaluate("() => JSON.parse(localStorage.getItem('hydro_timeline_entries') || '[]')")
        self.assertEqual(len(stored), 0)

    def test_delete_journal_from_editor_modal(self):
        """TC-DEL-02: 編集モーダル内の削除ボタンから削除でき、新規作成時は非表示であること"""
        initial_entry = {
            "id": "entry_delete_target_02",
            "date": "2026年10月10日",
            "dayName": "土曜日",
            "system": "DWC",
            "ec": "1.8",
            "memo": "エディタから削除するテストメモ02",
            "photos": [],
            "timestamp": "2026-10-10T09:10:00.000Z"
        }

        self.page.goto(self.url)
        self.page.evaluate(f"""() => {{
            localStorage.clear();
            localStorage.setItem('hydro_timeline_entries', JSON.stringify([{json.dumps(initial_entry)}]));
        }}""")
        self.page.reload()

        # 新規作成モーダルを開いた時は削除ボタンが非表示
        self.page.locator('button[onclick*="timeline"]').click()
        new_journal_btn = self.page.locator('button:has-text("日誌を書く")')
        expect(new_journal_btn).to_be_visible()
        new_journal_btn.click()
        editor_delete_btn = self.page.locator('#btn-delete-from-editor')
        expect(editor_delete_btn).not_to_be_visible()
        self.page.locator('#journal-editor-modal button[onclick*="closeJournalEditor"]').click()

        # タイムラインタブへ切り替えて編集ボタンを押す
        self.page.locator('button[onclick*="timeline"]').click()
        edit_btn = self.page.locator('.btn-edit-journal').first
        edit_btn.click()

        # 編集モーダルが開いており、削除ボタンが表示されていること
        editor_modal = self.page.locator('#journal-editor-modal')
        expect(editor_modal).to_be_visible()
        editor_delete_btn = self.page.locator('#btn-delete-from-editor')
        expect(editor_delete_btn).to_be_visible()

        # confirm ダイアログを承認して削除
        self.page.on("dialog", lambda dialog: dialog.accept())
        editor_delete_btn.click()

        # モーダルが閉じ、タイムラインから消去されること
        expect(editor_modal).not_to_be_visible()
        memo_locator = self.page.locator('text=エディタから削除するテストメモ02')
        expect(memo_locator).not_to_be_visible()

    def test_anti_resurrection_after_delete(self):
        """TC-DEL-03: 削除されたエントリはGAS同期を行っても復活しないこと (ゾンビ復活完全防御)"""
        deleted_entry = {
            "id": "entry_zombie_target",
            "date": "2026年10月10日",
            "dayName": "土曜日",
            "system": "Tower",
            "ec": "2.5",
            "memo": "ゾンビ復活テストメモ",
            "photos": [],
            "timestamp": "2026-10-10T09:20:00.000Z"
        }

        # クラウドからはまだ該当エントリが返ってくるシチュエーション
        self.context.route(lambda url: "dummy-gas-endpoint" in url or "action=get_timeline" in url, lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"status": "success", "entries": [deleted_entry]})
        ))

        self.page.goto(self.url)
        self.page.evaluate(f"""() => {{
            localStorage.clear();
            localStorage.setItem('hydro_timeline_entries', JSON.stringify([{json.dumps(deleted_entry)}]));
        }}""")
        self.page.reload()

        self.page.locator('button[onclick*="timeline"]').click()
        memo_locator = self.page.locator('text=ゾンビ復活テストメモ')
        expect(memo_locator).to_be_visible()

        # 削除実行
        self.page.on("dialog", lambda dialog: dialog.accept())
        delete_btn = self.page.locator('.btn-delete-journal').first
        delete_btn.click()
        expect(memo_locator).not_to_be_visible()

        # 再度GAS同期ボタンを押す
        self.page.locator('#btn-sync-timeline').click()

        # ゾンビとして復活していないこと
        expect(memo_locator).not_to_be_visible()
        stored = self.page.evaluate("() => JSON.parse(localStorage.getItem('hydro_timeline_entries') || '[]')")
        self.assertNotIn("entry_zombie_target", [e.get('id') for e in stored])

if __name__ == '__main__':
    unittest.main()
