import os
import re
import socket
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
import unittest
from playwright.sync_api import sync_playwright, expect

def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

class DiaryViewsE2ETest(unittest.TestCase):
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

    def test_tc01_header_tabs_switching(self):
        """TC-01: ヘッダータブの切り替え動作検証"""
        self.page.click('#tab-btn-plan')
        expect(self.page.locator('#view-plan')).to_be_visible()

        self.page.click('#tab-btn-gallery')
        expect(self.page.locator('#view-gallery')).to_be_visible()

        self.page.click('#tab-btn-timeline')
        expect(self.page.locator('#view-timeline')).to_be_visible()

        self.page.click('#tab-btn-record')
        expect(self.page.locator('#view-record')).to_be_visible()

    def test_tc02_annual_plan_board_rendering(self):
        """TC-02: 年間プランボードの2027年/2026年グリッドと計画テキスト描画検証"""
        self.page.click('#tab-btn-plan')
        plan_view = self.page.locator('#view-plan')
        expect(plan_view).to_be_visible()

        # 2027年および2026年の見出しが存在すること
        expect(plan_view).to_contain_text('2027')
        expect(plan_view).to_contain_text('2026')

        # ユーザーの実機データが正しく描画されていること
        expect(plan_view).to_contain_text('スナックエンドウの種まき')
        expect(plan_view).to_contain_text('遮光ネット')

        # 10月カードをクリックすると、計画編集モーダルが起動すること
        plan_view.locator('text=10月').first.click()
        expect(self.page.locator('#plan-editor-modal')).to_be_visible()

        # モーダル内に前年参照メモが表示されていること
        expect(self.page.locator('#plan-editor-modal')).to_contain_text('前年（2026年10月）の記録参照')
        self.page.click('#plan-editor-modal button:has-text("✕")')
        expect(self.page.locator('#plan-editor-modal')).to_be_hidden()

    def test_tc03_gallery_grid_and_date_badge(self):
        """TC-03: 写真ギャラリーの年月見出しと正方形タイル、撮影日バッジ検証"""
        self.page.click('#tab-btn-gallery')

        month_header = self.page.locator('.gallery-month-header').first
        expect(month_header).to_be_visible()

        first_tile = self.page.locator('.gallery-item').first
        expect(first_tile).to_be_visible()

        date_badge = first_tile.locator('.date-badge')
        expect(date_badge).to_be_visible()
        badge_text = date_badge.text_content()
        self.assertTrue(re.match(r'^\d{1,2}$', badge_text.strip() if badge_text else ''))

    def test_tc04_lightbox_modal_navigation(self):
        """TC-04: ライトボックスモーダルの表示と左右キーボード送り検証"""
        self.page.click('#tab-btn-gallery')

        self.page.locator('.gallery-item').first.click()
        modal = self.page.locator('#photo-modal')
        expect(modal).to_be_visible()

        first_src = self.page.locator('#modal-img').get_attribute('src')

        self.page.keyboard.press('ArrowRight')
        second_src = self.page.locator('#modal-img').get_attribute('src')
        self.assertNotEqual(second_src, first_src)

        self.page.keyboard.press('ArrowLeft')
        back_src = self.page.locator('#modal-img').get_attribute('src')
        self.assertEqual(back_src, first_src)

        self.page.keyboard.press('Escape')
        expect(modal).to_be_hidden()

    def test_tc05_timeline_incremental_search(self):
        """TC-05: タイムラインのリアルタイム・インクリメンタル検索検証"""
        self.page.click('#tab-btn-timeline')

        search_input = self.page.locator('#timeline-search')
        search_input.fill('ハダニ')

        visible_cards = self.page.locator('.timeline-card:visible')
        count = visible_cards.count()
        self.assertGreater(count, 0)

        for i in range(count):
            expect(visible_cards.nth(i)).to_contain_text('ハダニ')

        search_input.fill('')
        all_cards = self.page.locator('.timeline-card:visible')
        self.assertGreater(all_cards.count(), count)

    def test_tc06_quick_post_editor_modal(self):
        """TC-06: クイック投稿ボタン（カメラ/ペン）からのエディタ起動検証"""
        self.page.click('#btn-quick-pen')
        editor = self.page.locator('#journal-editor-modal')
        expect(editor).to_be_visible()
        expect(self.page.locator('#editor-textarea')).to_be_focused()

        self.page.click('#journal-editor-modal button:has-text("✕")')
        expect(editor).to_be_hidden()

if __name__ == '__main__':
    unittest.main()
