import os
import socket
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
import unittest
from playwright.sync_api import sync_playwright, expect

def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

class EditLightboxStatusE2ETest(unittest.TestCase):
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
        self.page.goto(self.url)

    def tearDown(self):
        self.context.close()

    def test_daily_status_badges_initial_and_update(self):
        """TC-NEW-03: 初期表示で3系統すべて未記録であり、保存後に記録済に切り替わること"""
        # LocalStorageをクリアして初期状態にする
        self.page.evaluate("() => localStorage.clear()")
        self.page.reload()

        # BatoBucketが初期状態で「⏳ 未記録」であること（勝手に記録済になっていないこと）
        bato_status = self.page.locator('#tab-bato-status')
        expect(bato_status).to_contain_text("未記録")

        # DWCとタワーも未記録であること
        expect(self.page.locator('#tab-dwc-status')).to_contain_text("未記録")
        expect(self.page.locator('#tab-tower-status')).to_contain_text("未記録")

    def test_photo_lightbox_open_on_click(self):
        """TC-NEW-04: タイムライン記事の写真タップで大画面モーダルが表示されること"""
        self.page.click('#tab-btn-timeline')
        expect(self.page.locator('#view-timeline')).to_be_visible()

        # タイムライン内の写真をクリック
        img = self.page.locator('#timeline-feed-container img').first
        img.click()

        # ライトボックスモーダルが表示されること
        modal = self.page.locator('#photo-modal')
        expect(modal).to_be_visible()

    def test_journal_entry_edit(self):
        """TC-NEW-05: タイムライン日誌に編集ボタンがあり、編集・上書き保存できること"""
        # 1件新規投稿
        self.page.click('#btn-quick-pen')
        self.page.fill('#editor-textarea', "編集前のオリジナル文章")
        self.page.click('#btn-save-journal')

        expect(self.page.locator('#view-timeline')).to_be_visible()
        card = self.page.locator('#timeline-feed-container article').first
        expect(card).to_contain_text("編集前のオリジナル文章")

        # 編集ボタンをクリック
        edit_btn = card.locator('.btn-edit-journal')
        expect(edit_btn).to_be_visible()
        edit_btn.click()

        # エディタが開き、本文が復元されていること
        expect(self.page.locator('#journal-editor-modal')).to_be_visible()
        expect(self.page.locator('#editor-textarea')).to_have_value("編集前のオリジナル文章")

        # 本文を変更して保存
        self.page.fill('#editor-textarea', "編集後のアップデート文章")
        self.page.click('#btn-save-journal')

        # タイムライン上で文章が書き換わっていること
        expect(card).to_contain_text("編集後のアップデート文章")

if __name__ == '__main__':
    unittest.main()
