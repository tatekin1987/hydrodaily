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

class RecordTimelineIntegrationE2ETest(unittest.TestCase):
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

    def test_record_save_integrates_into_timeline_and_updates_status(self):
        """TC-INT-01: 記録タブで保存すると、タイムライン先頭に水質データ付きカードが追加され、本日記録済になること"""
        # 1. 記録タブでEC, 水温, pH, メモを入力
        self.page.fill('#input-current-ec', '1.8')
        self.page.fill('#input-temp', '22.5')
        self.page.fill('#input-ph', '6.2')
        test_memo = "【統合テスト】秋ナスの花蕾が肥大中。下葉順調！"
        self.page.fill('#input-memo', test_memo)

        # 2. 「記録をGoogleシートに保存」をクリック
        self.page.click('#btn-save')

        # トーストが表示されること（保存完了）
        toast = self.page.locator('#toast')
        expect(toast).to_be_visible()

        # 3. 系統セレクターのバッジが「✅ 本日記録済」に更新されていること
        bato_status = self.page.locator('#tab-bato-status')
        expect(bato_status).to_contain_text("本日記録済")

        # 4. タイムラインタブへ移動
        self.page.click('#tab-btn-timeline')
        expect(self.page.locator('#view-timeline')).to_be_visible()

        # タイムライン先頭カードを検証
        first_card = self.page.locator('#timeline-feed-container article').first
        expect(first_card).to_contain_text(test_memo)
        expect(first_card).to_contain_text("BatoBucket")
        # 水質データ（追肥量またはEC）がカード内に表示されていること
        expect(first_card).to_contain_text("1.8")
        expect(first_card).to_contain_text("150.4")

        # 5. リロード後もタイムラインに維持されていること
        self.page.reload()
        self.page.click('#tab-btn-timeline')
        first_card_reloaded = self.page.locator('#timeline-feed-container article').first
        expect(first_card_reloaded).to_contain_text(test_memo)

    def test_photo_picker_bottom_sheet_modal_in_record_tab(self):
        """TC-INT-02: 記録タブの写真追加ボタンを押すと、共通ボトムシートが表示され、カメラとギャラリーが選べること"""
        # 記録タブの写真追加トリガーをクリック
        btn_add_photo = self.page.locator('#btn-record-add-photo')
        btn_add_photo.click()

        # ボトムシートモーダルが表示されること
        sheet = self.page.locator('#photo-picker-sheet')
        expect(sheet).to_be_visible()

        # カメラで撮影ボタンとギャラリーから選択ボタンが存在すること
        btn_camera = self.page.locator('#btn-sheet-camera')
        btn_gallery = self.page.locator('#btn-sheet-gallery')
        expect(btn_camera).to_be_visible()
        expect(btn_gallery).to_be_visible()

        # キャンセルボタンで閉じられること
        self.page.click('#btn-sheet-cancel')
        expect(sheet).not_to_be_visible()

if __name__ == '__main__':
    unittest.main()
