"""
画面（index.html）→ 本物の gas/Code.gs の通しテスト（2026-11-08 辛口審査 W9 の指摘で追加）
- Code.gs は tests/gas/serve.js が Node の上で動かす（Google の部分だけにせもの。シートの日付の自動変換もまねる）
- 時計は 2026-11-08（東京）に固定
動かし方：PYTHONUTF8=1 py -3.13 -m unittest tests.test_v2_real_gas
"""
import json
import os
import socket
import subprocess
import threading
import time
import unittest
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


class RealGasTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = free_port()

        class H(SimpleHTTPRequestHandler):
            def __init__(self, *a, **k):
                super().__init__(*a, directory=ROOT, **k)

            def log_message(self, *a):
                pass

        cls.httpd = HTTPServer(("127.0.0.1", cls.port), H)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(channel="msedge", headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.httpd.shutdown()

    def setUp(self):
        # テストごとに、まっさらな本物の Code.gs を起こす
        self.gport = free_port()
        self.node = subprocess.Popen(["node", os.path.join(ROOT, "tests", "gas", "serve.js"), str(self.gport)],
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
        line = self.node.stdout.readline()
        self.assertIn("ready", line, line)
        self.ctx = self.browser.new_context(viewport={"width": 375, "height": 812}, timezone_id="Asia/Tokyo", service_workers="block")
        self.ctx.set_default_navigation_timeout(15000)
        for pat in ["**/script.google.com/**", "**/fonts.googleapis.com/**", "**/fonts.gstatic.com/**"]:
            self.ctx.route(pat, lambda r: r.abort())
        self.ctx.route("**/dummy-gas-endpoint**", self.forward)
        self.page = self.ctx.new_page()
        self.page.clock.set_fixed_time("2026-11-08T10:00:00+09:00")
        self.page.set_default_timeout(6000)
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.url = f"http://127.0.0.1:{self.port}/index.html"

    def tearDown(self):
        self.ctx.close()
        self.node.kill()
        self.node.wait()
        self.assertEqual(self.errors, [], "画面でエラーが出た")

    # ---- 道具 ----
    def gas(self, path, body=None):
        url = f"http://127.0.0.1:{self.gport}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        with urllib.request.urlopen(urllib.request.Request(url, data=data, method="POST" if data else "GET"), timeout=10) as r:
            return json.loads(r.read().decode("utf-8"))

    def forward(self, route):
        req = route.request
        q = urlparse(req.url).query
        url = f"http://127.0.0.1:{self.gport}/gas" + (("?" + q) if q else "")
        data = req.post_data.encode("utf-8") if req.method == "POST" else None
        with urllib.request.urlopen(urllib.request.Request(url, data=data, method=req.method), timeout=10) as r:
            route.fulfill(status=200, content_type="application/json", body=r.read())

    def table(self, name):
        return self.gas("/__table?name=" + urllib.request.quote(name)) or []

    def open(self, local=None):
        if local is not None:
            self.page.goto(self.url)
            self.page.evaluate("d => { localStorage.clear(); for (const k in d) localStorage.setItem(k, typeof d[k] === 'string' ? d[k] : JSON.stringify(d[k])); }", local)
        self.page.goto(self.url)
        self.page.wait_for_function("window.__hydroReady === true")

    def wait_sent(self):
        expect(self.page.locator("#sync-text")).to_contain_text("すべて送信済み")

    # ---- テスト ----
    def test_i1_記録_直す_消すがシートの同じ行に入る(self):
        self.open({})
        self.page.click("[data-sys=bato]")
        self.page.fill("#ec-input", "1.8")
        self.page.fill("#input-memo", "はじめ")
        self.page.click("#btn-save")
        self.wait_sent()
        rows = self.table("記録")
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual((r["日付"], r["種類"], r["系統"], r["EC"], r["追肥mL"], r["目標EC"], r["消した"]), ("2026-11-08", "液肥", "BatoBucket", 1.8, 75.2, 2, "いいえ"))
        # 直す
        self.page.click("nav.tabs button[data-v=v-history]")
        self.page.click("#history-list .rec [data-act=edit]")
        self.page.fill("#edit-memo", "直した")
        self.page.click("#btn-edit-save")
        self.wait_sent()
        rows = self.table("記録")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["メモ"], "直した")
        self.assertEqual(rows[0]["日付"], "2026-11-08")
        # 消す
        self.page.on("dialog", lambda d: d.accept())
        self.page.click("#history-list .rec [data-act=edit]")
        self.page.click("#btn-edit-delete")
        self.wait_sent()
        self.assertEqual(self.table("記録")[0]["消した"], "はい")
        # 開き直しても出てこない
        self.open()
        self.page.click("nav.tabs button[data-v=v-history]")
        expect(self.page.locator("#history-empty")).to_be_visible()

    def test_i2_予定とAIの提案_採用でカレンダーに入る(self):
        self.gas("/__run?name=" + urllib.request.quote("setupHydro"))
        self.open({})
        self.page.click("nav.tabs button[data-v=v-plan]")
        self.page.click("#btn-plan-add")
        self.page.select_option("#plan-month", "2026-11")
        self.page.select_option("#plan-timing", "下旬")
        self.page.select_option("#plan-system", "tower")
        self.page.select_option("#plan-work", "追肥")
        self.page.click("#btn-plan-save")
        self.wait_sent()
        plans = [p for p in self.table("予定") if p["作業"] == "追肥"]
        self.assertEqual((plans[0]["系統"], plans[0]["時期"], plans[0]["状態"]), ("タワー型", "下旬", "予定"))
        events = self.gas("/__calendars")[0]["events"]
        self.assertTrue(any("タワー型：追肥" in e for e in events), events)
        # AI がシートに提案を書く（段階7でスキルが行うこと）
        self.gas("/__post", {"action": "save_plan", "plan": {"id": "ai_x", "year": 2026, "month": 12, "timing": "上旬", "systemKey": "dwc",
                                                             "work": "種まき", "details": "小松菜の2回目", "status": "提案", "updatedAt": "2026-11-08T00:00:00.000Z"}})
        self.assertFalse(any("小松菜の2回目" in e for e in self.gas("/__calendars")[0]["events"]))
        self.open()
        self.page.click("nav.tabs button[data-v=v-plan]")
        expect(self.page.locator("#proposal-list")).to_contain_text("小松菜の2回目")
        self.page.click("#proposal-list .plan[data-id=ai_x] [data-act=adopt]")
        self.wait_sent()
        self.assertEqual([p for p in self.table("予定") if p["id"] == "ai_x"][0]["状態"], "予定")
        self.assertTrue(any("小松菜の2回目" in e for e in self.gas("/__calendars")[0]["events"]))

    def test_i3_古い端末の記録が1回だけシートに入り_古い置き場が片付く(self):
        old = [
            {"id": "entry_1", "timestamp": "2026-11-01T00:00:00.000Z", "date": "2026年11月1日", "system": "BatoBucket", "systemKey": "bato",
             "ec": "1.8", "targetEc": 2.2, "addedMl": "150.4", "memo": "記録タブから", "photos": ["data:image/jpeg;base64," + "A" * 3000], "source": "record_tab"},
            {"id": "entry_2", "timestamp": "2026-10-20T00:00:00.000Z", "date": "2026年10月20日", "system": "DWC / NFT", "ec": "2.0", "memo": "日誌", "photos": []},
        ]
        self.open({"hydro_timeline_entries": old, "hydro_deleted_journal_ids": ["entry_9"]})
        self.wait_sent()
        self.page.wait_for_function("localStorage.getItem('hydro_timeline_entries') === null")
        rows = {r["id"]: r for r in self.table("記録")}
        self.assertEqual(rows["entry_1"]["種類"], "液肥")
        self.assertEqual(rows["entry_1"]["日付"], "2026-11-01")
        self.assertTrue(rows["entry_1"]["写真"].startswith("https://lh3.googleusercontent.com/d/"))
        self.assertEqual(rows["entry_2"]["系統"], "DWC / NFT")
        self.assertEqual(rows["entry_9"]["消した"], "はい")
        n = len(self.table("記録"))
        self.open()
        self.page.wait_for_timeout(500)
        self.assertEqual(len(self.table("記録")), n)

    def test_i4_合言葉を決めると_合言葉なしでは送れず_入れると送れる(self):
        self.gas("/__prop?key=WRITE_TOKEN&value=himitsu-1")
        self.open({})
        self.page.fill("#ec-input", "1.9")
        self.page.click("#btn-save")
        expect(self.page.locator("#sync-text")).to_contain_text("合言葉")
        self.assertEqual(len(self.table("記録")), 0)
        self.page.click("#btn-settings")
        self.page.fill("#set-token", "himitsu-1")
        self.page.click("#btn-set-save")
        self.wait_sent()
        self.assertEqual(len(self.table("記録")), 1)

    def test_i5_古い画面の日誌で_v2の農薬の記録が壊れない(self):
        self.open({})
        self.page.click("nav.tabs button[data-v=v-pest]")
        self.page.click("#btn-pest-save")
        self.wait_sent()
        rid = self.table("記録")[0]["id"]
        self.gas("/__post", {"action": "journal", "id": rid, "timestamp": "2099-01-01T00:00:00.000Z", "date": "2026-11-08", "system": "BatoBucket", "ec": "2.0", "memo": "古い画面で直した", "photos": []})
        r = self.table("記録")[0]
        self.assertEqual((r["種類"], r["メモ"]), ("農薬", "古い画面で直した"))
        self.assertNotEqual(r["農薬名"], "")


if __name__ == "__main__":
    unittest.main()
