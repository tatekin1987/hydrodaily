"""
HydroDaily E2E Acceptance Test Suite
Verified via Playwright (channel='msedge')
Acceptance Criteria:
1. 【計算検証】BatoBucket (94L) EC 1.8 -> 2.2 => A液/B液 各150.4 mL
2. 【飽和検証】現在EC >= 目標EC => 「追肥不要（0 mL）」
3. 【安全停止】現在EC <= 0.5 または >= 3.5 => 警告表示 & 保存ボタンDisabled
4. 【UX防衛】入力中にリロードしてもLocalStorageから復元
5. 【二重送信防止】保存ボタン押下直後にDisabled化 & スピナー表示
6. 【農薬計算】希釈倍率と水量から薬量を正しく算出
"""

import os
import sys
import time
import socket
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
import unittest
from playwright.sync_api import sync_playwright

def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

class HydroDailyE2ETest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = find_free_port()
        cls.dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        
        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=cls.dir, **kwargs)
            def do_POST(self):
                if "dummy-gas-endpoint" in self.path:
                    time.sleep(0.12)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"status": "success"}')
                else:
                    self.send_response(404)
                    self.end_headers()
            def log_message(self, format, *args):
                pass  # suppress logs

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
        self.page.on("console", lambda msg: print("CONSOLE:", msg.text))
        self.page.on("pageerror", lambda err: print("PAGEERROR:", err))
        self.page.set_default_timeout(3000)
        self.url = f"http://127.0.0.1:{self.port}/index.html"

    def tearDown(self):
        self.context.close()

    def test_01_fertilizer_calculation_batobucket(self):
        """【計算検証】BatoBucket (94L) EC 1.8 -> 2.2 => 各150.4 mL"""
        self.page.goto(self.url)
        # Select BatoBucket tab/button
        self.page.locator('[data-testid="tab-bato"]').click()
        # Input current EC = 1.8
        ec_input = self.page.locator('[data-testid="input-current-ec"]')
        ec_input.fill("1.8")
        
        # Check added ml display
        added_ml = self.page.locator('[data-testid="display-added-ml"]').inner_text()
        self.assertIn("150.4", added_ml)

    def test_02_fertilizer_saturation_guard(self):
        """【飽和検証】現在EC >= 目標EC => 追肥不要 (0 mL)"""
        self.page.goto(self.url)
        self.page.locator('[data-testid="tab-bato"]').click()
        ec_input = self.page.locator('[data-testid="input-current-ec"]')
        ec_input.fill("2.5")
        
        added_ml = self.page.locator('[data-testid="display-added-ml"]').inner_text()
        self.assertTrue("0" in added_ml or "追肥不要" in added_ml)

    def test_03_safety_lock_abnormal_ec(self):
        """【安全停止】EC <= 0.5 または >= 3.5 => 警告表示 & 保存ボタンDisabled"""
        self.page.goto(self.url)
        self.page.locator('[data-testid="tab-bato"]').click()
        ec_input = self.page.locator('[data-testid="input-current-ec"]')
        save_btn = self.page.locator('[data-testid="btn-save"]')
        warning_box = self.page.locator('[data-testid="warning-box"]')

        # Test EC <= 0.5
        ec_input.fill("0.4")
        self.assertTrue(warning_box.is_visible())
        self.assertTrue(save_btn.is_disabled())

        # Test EC >= 3.5
        ec_input.fill("3.6")
        self.assertTrue(warning_box.is_visible())
        self.assertTrue(save_btn.is_disabled())

    def test_04_draft_restoration_from_localstorage(self):
        """【UX防衛】入力途中でリロードしてもLocalStorageから復元"""
        self.page.goto(self.url)
        self.page.locator('[data-testid="tab-bato"]').click()
        self.page.locator('[data-testid="input-current-ec"]').fill("1.9")
        self.page.locator('[data-testid="input-memo"]').fill("生育順調・花蕾確認")

        # Reload page
        self.page.reload()

        ec_val = self.page.locator('[data-testid="input-current-ec"]').input_value()
        memo_val = self.page.locator('[data-testid="input-memo"]').input_value()
        self.assertEqual(ec_val, "1.9")
        self.assertEqual(memo_val, "生育順調・花蕾確認")

    def test_05_double_submit_prevention(self):
        """【二重送信防止】保存ボタン押下直後にDisabled化 & スピナー表示"""
        self.page.goto(self.url)
        self.page.locator('[data-testid="tab-bato"]').click()
        self.page.locator('[data-testid="input-current-ec"]').fill("1.8")
        save_btn = self.page.locator('[data-testid="btn-save"]')
        self.assertFalse(save_btn.is_disabled())

        # Click save
        save_btn.click()
        self.assertTrue(save_btn.is_disabled())
        spinner = self.page.locator('[data-testid="save-spinner"]')
        self.assertTrue(spinner.is_visible())

        # Wait for request to complete
        self.page.wait_for_timeout(600)  # Allow time for fetch to complete
        self.assertFalse(save_btn.is_disabled())
        self.assertFalse(spinner.is_visible())

    def test_07_network_error_handling(self):
        """【ネットワークエラー】接続失敗時に適切なエラートースト表示"""
        # Mock network failure
        self.page.route('**/dummy-gas-endpoint', lambda route: route.abort())

        self.page.goto(self.url)
        self.page.locator('[data-testid="tab-bato"]').click()
        self.page.locator('[data-testid="input-current-ec"]').fill("1.8")
        self.page.locator('[data-testid="btn-save"]').click()

        # Verify error toast appears with wait_for
        toast = self.page.locator('#toast:has-text("接続に失敗しました")')
        toast.wait_for(state="visible", timeout=3000)
        self.assertTrue(toast.is_visible())

    def test_06_pesticide_calculator(self):
        """【農薬計算】水量と希釈倍率から必要薬量を算出"""
        self.page.goto(self.url)
        # Switch to pesticide mode tab
        self.page.locator('[data-testid="mode-pesticide"]').click()
        self.page.locator('[data-testid="input-water-ml"]').fill("1000") # 1L
        self.page.locator('[data-testid="input-dilution"]').fill("100") # 100倍
        pesticide_amt = self.page.locator('[data-testid="display-pesticide-ml"]').inner_text()
        self.assertIn("10", pesticide_amt) # 1000 / 100 = 10 mL

if __name__ == "__main__":
    unittest.main()
