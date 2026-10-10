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

class Dashboard10YearE2ETest(unittest.TestCase):
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
        self.url = f"http://127.0.0.1:{self.port}/dashboard.html"

    def tearDown(self):
        self.context.close()

    def test_tc_dash_01_page_load_and_nav_link(self):
        """TC-DASH-01: dashboard.html が正常に開き、スマホ現場版(index.html)への戻りリンクが存在すること"""
        self.page.goto(self.url)
        expect(self.page.locator("body")).to_be_visible()
        # タイトルまたはヘッダーの確認
        expect(self.page.locator("#dashboard-title")).to_contain_text("10年日記")
        # 現場入力へのリンク
        back_link = self.page.locator("#btn-back-to-input")
        expect(back_link).to_be_visible()
        href = back_link.get_attribute("href")
        self.assertTrue("index.html" in href or href == "index.html")

    def test_tc_dash_02_stacked_cards_and_system_switch(self):
        """TC-DASH-02: 過去年と本年の日誌が上下スタック形式で描画され、系統切り替えができること"""
        entries = [
            {
                "id": "entry_2026_10_10",
                "date": "2026年10月10日",
                "dayName": "土曜日",
                "system": "BatoBucket",
                "ec": "2.2",
                "memo": "2026年のイチゴ。第一花房の蕾を確認。",
                "photos": ["https://lh3.googleusercontent.com/d/dummy_photo_2026"],
                "timestamp": "2026-10-10T08:00:00.000Z"
            },
            {
                "id": "entry_2025_10_10",
                "date": "2025年10月10日",
                "dayName": "金曜日",
                "system": "BatoBucket",
                "ec": "1.9",
                "memo": "2025年のイチゴ。去年はすでに開花していた。",
                "photos": ["https://lh3.googleusercontent.com/d/dummy_photo_2025"],
                "timestamp": "2025-10-10T08:00:00.000Z"
            },
            {
                "id": "entry_2026_dwc",
                "date": "2026年10月10日",
                "dayName": "土曜日",
                "system": "DWC",
                "ec": "1.5",
                "memo": "DWCレタス収穫",
                "photos": [],
                "timestamp": "2026-10-10T09:00:00.000Z"
            }
        ]

        self.page.goto(self.url)
        self.page.evaluate(f"localStorage.setItem('hydro_timeline_entries', '{json.dumps(entries)}');")
        # 日付を 2026-10-10 に設定してリロード/再描画
        self.page.goto(self.url)
        
        # BatoBucket選択中のカード確認
        cards = self.page.locator(".comparison-year-card")
        # 少なくとも2026年と2025年のカードが存在すること
        expect(cards.first).to_be_visible()
        self.assertGreaterEqual(cards.count(), 2)
        
        # 2026年の内容と2025年の内容が画面内に存在すること
        expect(self.page.locator("text=第一花房の蕾を確認")).to_be_visible()
        expect(self.page.locator("text=去年はすでに開花していた")).to_be_visible()

        # DWCタブに切り替えると、DWCのメモが表示されイチゴのメモは隠れること
        self.page.locator("button[data-system='DWC']").click()
        expect(self.page.locator("text=DWCレタス収穫")).to_be_visible()
        expect(self.page.locator("text=第一花房の蕾を確認")).not_to_be_visible()

    def test_tc_dash_03_smart_proximity_fallback(self):
        """TC-DASH-03: 前年同日に記録がない場合、前後±7日の直近ログをスマート補完表示すること"""
        entries = [
            {
                "id": "entry_2026_10_10",
                "date": "2026年10月10日",
                "dayName": "土曜日",
                "system": "BatoBucket",
                "ec": "2.0",
                "memo": "2026年10月10日の本日の記録",
                "photos": [],
                "timestamp": "2026-10-10T08:00:00.000Z"
            },
            {
                "id": "entry_2025_10_08",
                "date": "2025年10月8日",
                "dayName": "水曜日",
                "system": "BatoBucket",
                "ec": "1.8",
                "memo": "2025年は10月8日（2日前）に記録していたメモ",
                "photos": [],
                "timestamp": "2025-10-08T08:00:00.000Z"
            }
        ]

        self.page.goto(self.url)
        self.page.evaluate(f"localStorage.setItem('hydro_timeline_entries', '{json.dumps(entries)}');")
        self.page.goto(self.url)

        # 2025年のカードに近似バッジ（2日前など）が表示されていること
        expect(self.page.locator(".proximity-badge")).to_be_visible()
        expect(self.page.locator("text=2025年は10月8日")).to_be_visible()

    def test_tc_dash_04_lightbox_modal(self):
        """TC-DASH-04: 写真をクリックするとLightbox拡大モーダルが起動すること"""
        entries = [
            {
                "id": "entry_with_photo",
                "date": "2026年10月10日",
                "dayName": "土曜日",
                "system": "BatoBucket",
                "ec": "2.0",
                "memo": "写真付きテストメモ",
                "photos": ["https://lh3.googleusercontent.com/d/sample_photo_id"],
                "timestamp": "2026-10-10T08:00:00.000Z"
            }
        ]
        self.page.goto(self.url)
        self.page.evaluate(f"localStorage.setItem('hydro_timeline_entries', '{json.dumps(entries)}');")
        self.page.goto(self.url)

        # 写真サムネイルをクリック
        self.page.locator(".comparison-photo-thumb").first.click()
        # Lightboxモーダルが表示されること
        expect(self.page.locator("#lightbox-modal")).to_be_visible()
        # 閉じるボタンで非表示になること
        self.page.locator("#lightbox-close").click()
        expect(self.page.locator("#lightbox-modal")).not_to_be_visible()

if __name__ == '__main__':
    unittest.main()
