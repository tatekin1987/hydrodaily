import os
import socket
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
import unittest
import json
import re
from playwright.sync_api import sync_playwright, expect

def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

class TimelineSyncE2ETest(unittest.TestCase):
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
        self.page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        self.page.on("pageerror", lambda err: print(f"PAGEERROR: {err}"))
        self.page.set_default_timeout(3000)
        self.url = f"http://127.0.0.1:{self.port}/index.html"

    def tearDown(self):
        self.context.close()

    def test_timeline_sync_button_and_fetch(self):
        """TC-SYNC-01: 同期ボタン押下でGASから日誌を取得し、タイムラインに反映＆ステータス更新されること"""
        mock_cloud_entries = [
            {
                "id": "entry_cloud_101",
                "date": "2026年10月10日",
                "dayName": "土曜日",
                "system": "BatoBucket",
                "ec": "2.2",
                "memo": "クラウドから取得した最新日誌メモ",
                "photos": ["https://lh3.googleusercontent.com/d/mock_photo_101"],
                "timestamp": "2026-10-10T08:00:00.000Z"
            }
        ]

        # Route GAS endpoint
        self.context.route(lambda url: "dummy-gas-endpoint" in url, lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"status": "success", "entries": mock_cloud_entries})
        ))

        self.page.goto(self.url)
        self.page.evaluate("() => localStorage.clear()")
        self.page.reload()

        # タイムラインタブへ切り替え
        self.page.locator('button[onclick*="timeline"]').click()

        # 同期ボタン #btn-sync-timeline が存在し、クリックできること
        sync_btn = self.page.locator('#btn-sync-timeline')
        expect(sync_btn).to_be_visible()
        sync_btn.click()

        # クラウド日誌カードが描画されていること
        memo_locator = self.page.locator('text=クラウドから取得した最新日誌メモ')
        expect(memo_locator).to_be_visible()

        # 同期ステータスバッジに同期済が表示されること
        sync_badge = self.page.locator('#timeline-sync-status')
        expect(sync_badge).to_contain_text("同期")

    def test_timeline_merge_deduplication(self):
        """TC-SYNC-02: ローカル未送信とクラウド取得データが重複排除されマージされること"""
        # 事前にローカルに1件保存
        initial_local = [
            {
                "id": "entry_local_unique",
                "date": "2026年10月9日",
                "dayName": "金曜日",
                "system": "DWC",
                "ec": "1.8",
                "memo": "ローカルにしかない未送信メモ",
                "photos": [],
                "timestamp": "2026-10-09T08:00:00.000Z"
            },
            {
                "id": "entry_shared_1",
                "date": "2026年10月8日",
                "dayName": "木曜日",
                "system": "BatoBucket",
                "ec": "2.0",
                "memo": "ローカル側の古い内容",
                "photos": [],
                "timestamp": "2026-10-08T08:00:00.000Z"
            }
        ]

        mock_cloud_entries = [
            {
                "id": "entry_shared_1",
                "date": "2026年10月8日",
                "dayName": "木曜日",
                "system": "BatoBucket",
                "ec": "2.0",
                "memo": "クラウドで更新された最新内容",
                "photos": [],
                "timestamp": "2026-10-08T09:00:00.000Z"
            }
        ]

        self.context.route(lambda url: "dummy-gas-endpoint" in url, lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"status": "success", "entries": mock_cloud_entries})
        ))

        self.page.goto(self.url)
        self.page.evaluate(f"() => localStorage.setItem('hydro_timeline_entries', '{json.dumps(initial_local)}')")
        self.page.reload()

        self.page.locator('button[onclick*="timeline"]').click()
        self.page.locator('#btn-sync-timeline').click()

        # ローカル固有メモが消えずに存在すること
        expect(self.page.locator('text=ローカルにしかない未送信メモ')).to_be_visible()
        # 共有メモがクラウド最新内容に更新され、重複していないこと
        expect(self.page.locator('text=クラウドで更新された最新内容')).to_be_visible()
        expect(self.page.locator('text=ローカル側の古い内容')).not_to_be_visible()

    def test_timeline_cloud_drive_image_lightbox(self):
        """TC-SYNC-03: クラウド写真URLがカードに反映されライトボックスで拡大できること"""
        mock_cloud_entries = [
            {
                "id": "entry_photo_test",
                "date": "2026年10月10日",
                "dayName": "土曜日",
                "system": "タワー型",
                "ec": "1.5",
                "memo": "写真付きクラウド日誌",
                "photos": ["https://lh3.googleusercontent.com/d/mock_img_id_123"],
                "timestamp": "2026-10-10T10:00:00.000Z"
            }
        ]

        self.context.route(lambda url: "dummy-gas-endpoint" in url, lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"status": "success", "entries": mock_cloud_entries})
        ))

        self.page.goto(self.url)
        self.page.evaluate("() => localStorage.clear()")
        self.page.reload()

        self.page.locator('button[onclick*="timeline"]').click()
        self.page.locator('#btn-sync-timeline').click()

        # 画像が表示されていること
        img = self.page.locator('img[src="https://lh3.googleusercontent.com/d/mock_img_id_123"]')
        expect(img).to_be_visible()

        # クリックしてLightboxが開くこと
        img.click()
        lightbox = self.page.locator('#photo-modal')
        expect(lightbox).to_be_visible()
        expect(self.page.locator('#modal-img')).to_have_attribute('src', 'https://lh3.googleusercontent.com/d/mock_img_id_123')

if __name__ == '__main__':
    unittest.main()
