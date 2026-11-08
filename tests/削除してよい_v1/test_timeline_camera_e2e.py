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

class TimelineCameraE2ETest(unittest.TestCase):
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
        self.page.goto(self.url)

    def tearDown(self):
        self.context.close()

    def test_camera_and_gallery_picker_elements(self):
        """TC-NEW-01: ギャラリー直結(multiple)とカメラ直結(capture)の要素が存在し機能すること"""
        # カメラ撮影用inputが存在し、capture="environment"属性を持つこと
        camera_input = self.page.locator('#input-camera-capture')
        expect(camera_input).to_have_attribute('capture', 'environment')

        # アルバム/ギャラリー選択用inputが存在し、multiple属性を持つこと
        gallery_input = self.page.locator('#input-gallery-pick')
        expect(gallery_input).to_have_attribute('type', 'file')
        expect(gallery_input).to_have_attribute('multiple', '')

        # エディタを開いた際、写真追加ボタン(＋)とギャラリー/カメラボタンが存在すること
        self.page.click('#btn-quick-pen')
        expect(self.page.locator('#journal-editor-modal')).to_be_visible()
        expect(self.page.locator('#btn-picker-add-more')).to_be_visible()
        expect(self.page.locator('#btn-editor-gallery')).to_be_visible()
        expect(self.page.locator('#btn-editor-camera')).to_be_visible()

    def test_journal_entry_updates_timeline_and_persists(self):
        """TC-NEW-02: 日誌エディタから投稿した日記がタイムラインに即時反映され、リロード後も永続化されること"""
        # 「文字から書く」でエディタを開く
        self.page.click('#btn-quick-pen')
        expect(self.page.locator('#journal-editor-modal')).to_be_visible()

        # 本文を入力
        unique_text = "【自動テスト日誌】秋ナスの追肥完了。新芽が力強く展開中！"
        self.page.fill('#editor-textarea', unique_text)

        # 日誌専用保存ボタンを押下
        self.page.click('#btn-save-journal')

        # タイムラインタブに遷移していること
        expect(self.page.locator('#view-timeline')).to_be_visible()

        # タイムライン先頭に投稿された日誌が表示されていること
        first_card = self.page.locator('#timeline-feed-container article').first
        expect(first_card).to_contain_text(unique_text)

        # ページをリロードしても日誌が維持されていること（LocalStorage永続化）
        self.page.reload()
        self.page.click('#tab-btn-timeline')
        expect(self.page.locator('#timeline-feed-container')).to_contain_text(unique_text)

        # タイムライン検索でもヒットすること
        self.page.fill('#timeline-search', '秋ナスの追肥')
        expect(self.page.locator('#timeline-feed-container')).to_contain_text(unique_text)

if __name__ == '__main__':
    unittest.main()
