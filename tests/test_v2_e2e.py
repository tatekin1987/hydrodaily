"""
HydroDaily v2 画面（index.html）の受け入れテスト（2026-11-08 モック mock_v2.html で合意した動線）
- 時計は 2026-11-08（東京）に固定。本番の GAS にはつながず、テストの中のにせもの GAS（書きかえの決まりつき）を使う
動かし方：PYTHONUTF8=1 py -3.13 -m unittest tests.test_v2_e2e
"""
import json
import os
import socket
import threading
import unittest
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from playwright.sync_api import sync_playwright, expect


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


class FakeGas:
    """書きかえの決まり（新しい方が勝つ・消した印は戻らない）だけを持つ、にせものの GAS"""

    def __init__(self):
        self.records = {}
        self.plans = {}
        self.posts = []
        self.down = False
        self.today_items = []
        self.settings = {"目標EC_bato": "2.0", "目標EC_dwc": "1.6", "目標EC_tower": "2.0",
                         "作物_bato": "スティックセニョール", "作物_dwc": "サンチュ・小松菜・ルッコラ", "作物_tower": "スティックセニョール"}
        self.pesticides = [
            {"id": "sanyol", "name": "サンヨール", "dilution": 500, "unit": "mL", "intervalDays": "", "maxUses": "", "preharvestDays": "", "memo": ""},
            {"id": "zentari", "name": "ゼンターリ顆粒水和剤", "dilution": 1000, "unit": "g", "intervalDays": "", "maxUses": 2, "preharvestDays": 1, "memo": ""},
        ]
        self.spray_counts = {}

    def apply(self, op):
        a = op.get("action")
        if a == "upsert":
            r = op["record"]
            cur = self.records.get(r["id"])
            if cur and cur.get("deleted"):
                return {"id": r["id"], "result": "deleted"}
            if cur and r.get("updatedAt", "") <= cur.get("updatedAt", ""):
                return {"id": r["id"], "result": "stale"}
            photos = [("https://lh3.googleusercontent.com/d/fake_" + str(i)) if str(p).startswith("data:image") else p for i, p in enumerate(r.get("photos", []))]
            self.records[r["id"]] = dict(r, photos=photos, deleted=False)
            return {"id": r["id"], "result": "updated" if cur else "saved", "photos": photos}
        if a in ("delete", "delete_journal"):
            cur = self.records.get(op["id"], {"id": op["id"]})
            cur["deleted"] = True
            cur["updatedAt"] = max(cur.get("updatedAt", ""), op.get("updatedAt", ""))
            self.records[op["id"]] = cur
            return {"id": op["id"], "result": "deleted"}
        if a == "save_plan":
            p = op["plan"]
            cur = self.plans.get(p["id"])
            if cur and cur.get("deleted"):
                return {"id": p["id"], "result": "deleted"}
            if cur and p.get("updatedAt", "") <= cur.get("updatedAt", ""):
                return {"id": p["id"], "result": "stale"}
            self.plans[p["id"]] = dict(p, deleted=False, status=p.get("status") or "予定")
            return {"id": p["id"], "result": "updated" if cur else "saved"}
        if a == "delete_plan":
            if op["id"] in self.plans:
                self.plans[op["id"]]["deleted"] = True
            return {"id": op["id"], "result": "deleted"}
        return {"id": op.get("id"), "result": "error", "message": "Invalid action"}

    def handle(self, route):
        if self.down:
            return route.abort()
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            self.posts.append(body)
            if body.get("action") == "batch":
                res = {"status": "success", "results": [self.apply(o) for o in body.get("ops", [])]}
            else:
                r = self.apply(body)
                res = dict({"status": "success"}, **r)
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(res))
        q = {k: v[0] for k, v in parse_qs(urlparse(req.url).query).items()}
        a = q.get("action")
        if a == "get_records":
            recs = list(self.records.values())
            if "since" in q:
                recs = [r for r in recs if r.get("updatedAt", "") > q["since"]]
            else:
                recs = [r for r in recs if not r.get("deleted")]
            res = {"status": "success", "records": recs, "server_time": "2026-11-08T01:00:00.000Z"}
        elif a == "get_plans":
            res = {"status": "success", "plans": [p for p in self.plans.values() if not p.get("deleted")]}
        elif a == "get_today":
            res = {"status": "success", "today": "2026-11-08", "items": self.today_items}
        elif a == "get_settings":
            res = {"status": "success", "settings": self.settings, "pesticides": self.pesticides, "sprayCounts": self.spray_counts}
        else:
            res = {"status": "success"}
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(res))

    def ops(self):
        out = []
        for b in self.posts:
            out.extend(b.get("ops", [b]) if b.get("action") == "batch" else [b])
        return out


class HydroDailyV2Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = free_port()
        root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

        class H(SimpleHTTPRequestHandler):
            def __init__(self, *a, **k):
                super().__init__(*a, directory=root, **k)

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

    def setUp(self, when="2026-11-08T10:00:00+09:00"):
        self.gas = FakeGas()
        self.ctx = self.browser.new_context(viewport={"width": 375, "height": 812}, timezone_id="Asia/Tokyo", service_workers="block")
        self.ctx.route("**/script.google.com/**", lambda r: r.abort())
        # 外のフォントを待つと読み込みが遅れて揺れるので、テストでは取りに行かない（2026-11-08）
        self.ctx.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        self.ctx.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        self.ctx.set_default_navigation_timeout(15000)
        self.ctx.route("**/dummy-gas-endpoint**", self.gas.handle)
        self.page = self.ctx.new_page()
        self.page.clock.set_fixed_time(when)
        self.page.set_default_timeout(4000)
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.url = f"http://127.0.0.1:{self.port}/index.html"

    def tearDown(self):
        self.ctx.close()
        self.assertEqual(self.errors, [], "画面でエラーが出た")

    # ---- 道具 ----
    def open(self, local=None):
        if local is not None:
            self.page.goto(self.url)
            self.page.evaluate("d => { localStorage.clear(); for (const k in d) localStorage.setItem(k, typeof d[k] === 'string' ? d[k] : JSON.stringify(d[k])); }", local)
        self.page.goto(self.url)
        self.page.wait_for_function("window.__hydroReady === true")

    def tab(self, v):
        self.page.click(f"nav.tabs button[data-v={v}]")

    def wait_sent(self):
        expect(self.page.locator("#sync-text")).to_contain_text("すべて送信済み")

    # ---- テスト ----
    def test_01_作り値が1つも出ない(self):
        """記録がないとき、見返し・予定に作り値を出さず「まだ〜ありません」と出す"""
        self.open({})
        body = self.page.inner_text("body")
        for fake in ["277/365", "2025年10月02日", "秋ナス", "ミニトマト", "全8枚"]:
            self.assertNotIn(fake, body)
        expect(self.page.locator("[data-sys=bato]")).to_contain_text("スティックセニョール")
        expect(self.page.locator("[data-sys=dwc]")).to_contain_text("サンチュ")
        self.tab("v-history")
        expect(self.page.locator("#history-empty")).to_be_visible()
        self.tab("v-plan")
        expect(self.page.locator("#near-empty")).to_be_visible()

    def test_02_液肥の計算とロック(self):
        """満水94L×差×4.0。0.3 は保存でき、3.5 以上はロック"""
        self.open({})
        self.page.click("[data-sys=bato]")
        self.page.fill("#ec-input", "1.8")
        expect(self.page.locator("#dose")).to_have_text("75.2")
        self.page.fill("#ec-input", "0.3")
        expect(self.page.locator("#btn-save")).to_be_enabled()
        expect(self.page.locator("#warn")).to_be_hidden()
        self.page.fill("#ec-input", "3.6")
        expect(self.page.locator("#btn-save")).to_be_disabled()
        expect(self.page.locator("#warn")).to_be_visible()
        self.page.fill("#ec-input", "2.4")
        expect(self.page.locator("#dose")).to_contain_text("追肥不要")
        self.page.click("[data-sys=dwc]")
        self.page.fill("#ec-input", "1.4")
        expect(self.page.locator("#dose")).to_have_text("112.0")  # 140L × 0.2 × 4

    def test_03_保存するとシートに送られる(self):
        """保存→送信→「すべて送信済み」。日付は端末の日付、0 は 0 のまま、空欄は空欄"""
        self.open({})
        self.page.click("[data-sys=tower]")
        self.page.fill("#ec-input", "0")
        self.page.fill("#input-memo", "水替え直後")
        self.page.click("#btn-save")
        self.wait_sent()
        ups = [o for o in self.gas.ops() if o.get("action") == "upsert"]
        self.assertEqual(len(ups), 1)
        r = ups[0]["record"]
        self.assertEqual(r["date"], "2026-11-08")
        self.assertEqual(r["systemKey"], "tower")
        self.assertEqual(r["kind"], "液肥")
        self.assertEqual(r["ec"], 0)
        self.assertEqual(r["ph"], "")
        self.assertEqual(r["targetEc"], 2.0)
        self.assertEqual(r["memo"], "水替え直後")
        expect(self.page.locator("#toast")).to_contain_text("シートに保存しました")

    def test_04_送れないときは未送信と出て_戻ると送り直す(self):
        self.open({})
        self.gas.down = True
        self.page.click("[data-sys=bato]")
        self.page.fill("#ec-input", "1.9")
        self.page.click("#btn-save")
        expect(self.page.locator("#sync-text")).to_contain_text("未送信 1件")
        expect(self.page.locator("#toast")).to_contain_text("送れませんでした")
        self.gas.down = False
        self.page.click("#btn-send-now")
        self.wait_sent()
        self.assertEqual(len([o for o in self.gas.ops() if o.get("action") == "upsert"]), 1)

    def test_05_朝7時でも日付は今日(self):
        self.setUp_when("2026-11-08T07:00:00+09:00")
        self.open({})
        self.page.fill("#ec-input", "1.9")
        self.page.click("#btn-save")
        self.wait_sent()
        self.assertEqual(self.gas.ops()[-1]["record"]["date"], "2026-11-08")

    def test_06_古い端末の記録を最初の1回だけ送り直す(self):
        """v1.9 の hydro_timeline_entries（液肥・日誌）と消した id を送る。2回目の起動では送らない"""
        old = [
            {"id": "entry_1", "timestamp": "2026-11-01T00:00:00.000Z", "date": "2026年11月1日", "system": "BatoBucket", "systemKey": "bato",
             "ec": "1.8", "targetEc": 2.2, "addedMl": "150.4", "ph": 6.1, "temp": 15, "memo": "記録タブから", "photos": [], "source": "record_tab"},
            {"id": "entry_2", "timestamp": "2026-10-20T00:00:00.000Z", "date": "2026年10月20日", "system": "DWC / NFT", "ec": "2.0", "memo": "日誌", "photos": []},
        ]
        self.open({"hydro_timeline_entries": old, "hydro_deleted_journal_ids": ["entry_9"]})
        self.wait_sent()
        ops = self.gas.ops()
        ups = {o["record"]["id"]: o["record"] for o in ops if o.get("action") == "upsert"}
        self.assertEqual(set(ups), {"entry_1", "entry_2"})
        self.assertEqual(ups["entry_1"]["kind"], "液肥")
        self.assertEqual(ups["entry_1"]["date"], "2026-11-01")
        self.assertEqual(ups["entry_1"]["addedMl"], 150.4)
        self.assertEqual(ups["entry_1"]["updatedAt"], "2026-11-01T00:00:00.000Z")
        self.assertEqual(ups["entry_2"]["kind"], "日誌")
        self.assertEqual(ups["entry_2"]["systemKey"], "dwc")
        self.assertIn("entry_9", [o["id"] for o in ops if o.get("action") == "delete"])
        n = len(self.gas.posts)
        self.page.reload()
        self.page.wait_for_function("window.__hydroReady === true")
        self.page.wait_for_timeout(300)
        self.assertFalse(any(o.get("action") == "upsert" for b in self.gas.posts[n:] for o in (b.get("ops") or [b])))

    def test_07_見返し_絞り込みと農薬(self):
        self.gas.records = {
            "a": {"id": "a", "date": "2026-11-07", "time": "08:00", "systemKey": "bato", "system": "BatoBucket", "kind": "液肥", "ec": 1.8, "addedMl": 75.2, "memo": "花蕾", "photos": [], "updatedAt": "2026-11-07T00:00:00.000Z", "deleted": False},
            "b": {"id": "b", "date": "2026-11-06", "time": "08:00", "systemKey": "dwc", "system": "DWC / NFT", "kind": "農薬", "pestName": "ゼンターリ顆粒水和剤", "dilution": 1000, "waterL": 2, "dose": 2, "unit": "g", "memo": "", "photos": [], "updatedAt": "2026-11-06T00:00:00.000Z", "deleted": False},
            "c": {"id": "c", "date": "2026-11-05", "time": "08:00", "systemKey": "tower", "system": "タワー型", "kind": "日誌", "memo": "写真あり", "photos": ["https://lh3.googleusercontent.com/d/x"], "updatedAt": "2026-11-05T00:00:00.000Z", "deleted": False},
        }
        self.open({})
        self.tab("v-history")
        expect(self.page.locator("#history-list .rec")).to_have_count(3)
        self.page.click("[data-filter-kind=農薬]")
        expect(self.page.locator("#history-list .rec")).to_have_count(1)
        expect(self.page.locator("#history-list")).to_contain_text("ゼンターリ顆粒水和剤 2 g")
        self.page.click("[data-filter-kind=all]")
        self.page.click("[data-filter-sys=bato]")
        expect(self.page.locator("#history-list .rec")).to_have_count(1)
        expect(self.page.locator("#history-list")).to_contain_text("EC 1.8")
        self.page.click("[data-filter-sys=all]")
        self.page.click("[data-filter-kind=photo]")
        expect(self.page.locator("#history-list .rec")).to_have_count(1)
        expect(self.page.locator("#ec-chart polyline")).to_have_count(1)

    def test_08_記録を直すと日付はそのまま_消すと消した印を送る(self):
        self.gas.records = {"a": {"id": "a", "date": "2026-11-01", "time": "08:00", "systemKey": "bato", "system": "BatoBucket", "kind": "液肥", "ec": 1.8, "addedMl": 75.2, "memo": "前", "photos": [], "updatedAt": "2026-11-01T00:00:00.000Z", "deleted": False}}
        self.open({})
        self.tab("v-history")
        self.page.click("#history-list .rec [data-act=edit]")
        expect(self.page.locator("#edit-memo")).to_have_value("前")
        self.page.fill("#edit-memo", "直した")
        self.page.click("#btn-edit-save")
        self.wait_sent()
        r = [o for o in self.gas.ops() if o.get("action") == "upsert"][-1]["record"]
        self.assertEqual(r["memo"], "直した")
        self.assertEqual(r["date"], "2026-11-01")
        self.assertGreater(r["updatedAt"], "2026-11-01T00:00:00.000Z")
        self.page.on("dialog", lambda d: d.accept())
        self.page.click("#history-list .rec [data-act=edit]")
        self.page.click("#btn-edit-delete")
        self.wait_sent()
        self.assertEqual(self.gas.ops()[-1], {"action": "delete", "id": "a", "updatedAt": self.gas.ops()[-1]["updatedAt"]})
        expect(self.page.locator("#history-empty")).to_be_visible()

    def test_09_予定を足す_直す_済(self):
        self.open({})
        self.tab("v-plan")
        self.page.click("#btn-plan-add")
        self.page.select_option("#plan-month", "2026-11")
        self.page.select_option("#plan-timing", "中旬")
        self.page.select_option("#plan-system", "dwc")
        self.page.select_option("#plan-work", "種まき")
        self.page.fill("#plan-details", "ルッコラ")
        self.page.click("#btn-plan-save")
        self.wait_sent()
        expect(self.page.locator("#near-list")).to_contain_text("DWC：種まき ルッコラ")
        p = [o for o in self.gas.ops() if o.get("action") == "save_plan"][-1]["plan"]
        self.assertEqual((p["year"], p["month"], p["timing"], p["systemKey"], p["work"], p["status"]), (2026, 11, "中旬", "dwc", "種まき", "予定"))
        # 直す：今の内容が入って開く（v1.9 の不具合の再発防止）
        self.page.click("#near-list .plan [data-act=edit]")
        expect(self.page.locator("#plan-details")).to_have_value("ルッコラ")
        expect(self.page.locator("#plan-timing")).to_have_value("中旬")
        self.page.fill("#plan-details", "ルッコラ（2回目）")
        self.page.click("#btn-plan-save")
        self.wait_sent()
        expect(self.page.locator("#near-list")).to_contain_text("ルッコラ（2回目）")
        # 済
        self.page.click("#near-list .plan [data-act=done]")
        self.wait_sent()
        self.assertEqual([o for o in self.gas.ops() if o.get("action") == "save_plan"][-1]["plan"]["doneDate"], "2026-11-08")
        # 1年の一覧：11月に点が付く
        expect(self.page.locator("#year-grid .mon").first).to_contain_text("11月")
        self.assertGreaterEqual(self.page.locator("#year-grid .mon").first.locator("i").count(), 1)

    def test_22_年を選ぶと前の年の予定と記録をふりかえれる(self):
        def plan(i, y, m, w, done=""):
            return {"id": i, "year": y, "month": m, "timing": "中旬", "system": "全体", "systemKey": "", "work": w, "details": "",
                    "doneDate": done, "status": "予定", "updatedAt": "2026-11-01T00:00:00.000Z", "deleted": False}
        self.gas.plans = {"p25": plan("p25", 2025, 7, "種まき", "2025-07-15"), "p26": plan("p26", 2026, 7, "収穫", "2026-07-12")}
        self.gas.records = {"r1": {"id": "r1", "date": "2025-07-03", "time": "08:00", "kind": "液肥", "system": "タワー型", "systemKey": "tower",
                                   "ec": 1.8, "memo": "", "photos": [], "updatedAt": "2026-11-01T00:00:00.000Z", "deleted": False}}
        self.open({})
        self.tab("v-plan")
        sel = self.page.locator("#plan-year")
        # 選べる年：これから1年・来年・今年・前の年（予定か記録がある年まで）
        values = sel.locator("option").evaluate_all("os => os.map(o => o.value)")
        self.assertEqual(values, ["next", "2027", "2026", "2025"])
        self.assertEqual(sel.input_value(), "next")
        # 2025年を選ぶと、1月〜12月が並ぶ
        sel.select_option("2025")
        grid = self.page.locator("#year-grid .mon")
        expect(grid).to_have_count(12)
        expect(grid.first).to_contain_text("1月")
        expect(grid.nth(6)).to_contain_text("7月")
        self.assertEqual(grid.nth(6).locator("i").count(), 1)
        # 7月を押すと、その年の予定と、その月の記録の件数
        grid.nth(6).click()
        expect(self.page.locator("#month-title")).to_contain_text("2025年7月")
        expect(self.page.locator("#month-list")).to_contain_text("種まき")
        expect(self.page.locator("#month-list")).not_to_contain_text("収穫")
        expect(self.page.locator("#month-record-note")).to_contain_text("記録 1 件")
        # 2025年を見ているときに「予定を足す」と、2025年の月も選べる
        self.page.click("#btn-plan-add")
        months = self.page.locator("#plan-month option").evaluate_all("os => os.map(o => o.value)")
        self.assertIn("2025-7", months)
        self.page.click("#btn-plan-cancel") if self.page.locator("#btn-plan-cancel").count() else self.page.evaluate("closeSheets()")
        # 「これから1年」に戻すと今月から
        sel.select_option("next")
        expect(grid.first).to_contain_text("11月")

    def test_10_AIの提案は採用で予定に移る(self):
        self.gas.plans = {"ai1": {"id": "ai1", "year": 2026, "month": 11, "timing": "下旬", "system": "BatoBucket", "systemKey": "bato", "work": "追肥",
                                  "details": "AIの案", "doneDate": "", "status": "提案", "updatedAt": "2026-11-08T00:00:00.000Z", "deleted": False}}
        self.open({})
        self.tab("v-plan")
        expect(self.page.locator("#proposal-list")).to_contain_text("AIの案")
        self.page.click("#proposal-list .plan [data-act=adopt]")
        self.wait_sent()
        p = [o for o in self.gas.ops() if o.get("action") == "save_plan"][-1]["plan"]
        self.assertEqual(p["status"], "予定")
        expect(self.page.locator("#proposal-list .plan")).to_have_count(0)

    def test_11_農薬_うすめ方と散布の記録(self):
        self.gas.spray_counts = {"tower|ゼンターリ顆粒水和剤": 2}
        self.open({})
        self.tab("v-pest")
        self.page.select_option("#pest-select", "sanyol")
        self.page.click("[data-l='2']")
        expect(self.page.locator("#pest-dose")).to_have_text("4.0")
        expect(self.page.locator("#pest-unit")).to_have_text("mL")
        self.page.select_option("#pest-select", "zentari")
        self.page.select_option("#pest-system", "tower")
        expect(self.page.locator("#pest-uses")).to_contain_text("上限")
        expect(self.page.locator("#btn-pest-save")).to_be_disabled()
        self.page.select_option("#pest-system", "bato")
        expect(self.page.locator("#btn-pest-save")).to_be_enabled()
        self.page.click("#btn-pest-save")
        self.wait_sent()
        r = [o for o in self.gas.ops() if o.get("action") == "upsert"][-1]["record"]
        self.assertEqual((r["kind"], r["pestName"], r["dilution"], r["waterL"], r["dose"], r["unit"], r["systemKey"]),
                         ("農薬", "ゼンターリ顆粒水和剤", 1000, 2, 2, "g", "bato"))

    def test_12_今日やることが出る(self):
        self.gas.today_items = [{"type": "液肥", "system": "bato", "title": "BatoBucket：ECを測る日です", "detail": "前回 11/1（7日前）"}]
        self.open({})
        expect(self.page.locator("#today-list")).to_contain_text("BatoBucket：ECを測る日です")

    def test_13_合言葉は送るときに付く(self):
        self.open({"hydro_write_token": "himitsu"})
        self.page.fill("#ec-input", "1.9")
        self.page.click("#btn-save")
        self.wait_sent()
        self.assertEqual(self.gas.posts[-1].get("token"), "himitsu")

    def test_14_スマホ幅で横にはみ出さず_押す所は44px以上(self):
        self.open({})
        for v in ["v-record", "v-history", "v-plan", "v-pest"]:
            self.tab(v)
            self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth"), 375, v)
            small = self.page.evaluate("""[...document.querySelectorAll('button, select, input')].filter(b => {
                const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44 && getComputedStyle(b).visibility !== 'hidden';
            }).map(b => b.id || b.textContent.trim().slice(0, 10))""")
            self.assertEqual(small, [], v)

    # ---- 2026-11-08 辛口審査（REJECT）の指摘をテストにしたもの ----
    def test_15_保存枠がいっぱいでも_送っていない記録を送信済みに見せない(self):
        """C1：未送信の列に入れられなかったら、入力を消さずに知らせる。記録だけ端末に残ることはない"""
        self.open({})
        self.gas.down = True
        self.page.evaluate("""() => { const big = 'x'.repeat(256 * 1024); let i = 0;
            try { while (true) { localStorage.setItem('fill_' + i, big); i++; } } catch (e) {}
            const small = 'y'.repeat(1024); let j = 0; try { while (true) { localStorage.setItem('fills_' + j, small); j++; } } catch (e) {} }""")
        self.page.fill("#ec-input", "1.7")
        self.page.fill("#input-memo", "枠いっぱい" * 50)
        self.page.click("#btn-save")
        expect(self.page.locator("#toast")).to_contain_text("端末に保存できませんでした")
        expect(self.page.locator("#ec-input")).to_have_value("1.7")
        recs = self.page.evaluate("JSON.parse(localStorage.getItem('hydro_v2_records') || '{}')")
        queue = self.page.evaluate("JSON.parse(localStorage.getItem('hydro_v2_queue') || '[]')")
        qids = {q.get("record", {}).get("id") for q in queue}
        for rid in recs:
            self.assertIn(rid, qids, "未送信の列に無い記録が端末にだけ残っている")
        self.page.evaluate("Object.keys(localStorage).filter(k => k.startsWith('fill')).forEach(k => localStorage.removeItem(k))")

    def test_16_大きい古い記録も移し替えが終わり_古い置き場を片付ける(self):
        """C2：写真入りで大きい v1.9 の記録でも、送れたら古い置き場を消し、開き直しても送り直さない"""
        pic = "data:image/jpeg;base64," + ("A" * (1100 * 1024))
        old = [{"id": f"entry_big{i}", "timestamp": f"2026-10-0{i + 1}T00:00:00.000Z", "date": f"2026年10月{i + 1}日", "system": "BatoBucket",
                "systemKey": "bato", "ec": "1.8", "addedMl": "10", "memo": "写真入り", "photos": [pic], "source": "record_tab"} for i in range(3)]
        self.page.goto(self.url)
        self.page.evaluate("d => { localStorage.clear(); localStorage.setItem('hydro_timeline_entries', JSON.stringify(d)); }", old)
        self.page.goto(self.url)
        self.page.wait_for_function("window.__hydroReady === true")
        self.wait_sent()
        self.assertEqual(len([o for o in self.gas.ops() if o.get("action") == "upsert"]), 3)
        self.page.wait_for_function("localStorage.getItem('hydro_timeline_entries') === null")
        n = len(self.gas.posts)
        self.page.reload()
        self.page.wait_for_function("window.__hydroReady === true")
        self.page.wait_for_timeout(400)
        self.assertFalse(any(o.get("action") == "upsert" for b in self.gas.posts[n:] for o in (b.get("ops") or [b])))
        # 端末の記録には写真の中身（dataURL）を持たない
        self.assertNotIn("data:image", self.page.evaluate("localStorage.getItem('hydro_v2_records') || ''"))

    def test_17_二度押ししても記録は1件(self):
        """C4：濡れた手の二度押しで、水替え・農薬が2件にならない"""
        self.open({})
        self.page.click("[data-kind=水替え]")
        self.page.dblclick("#btn-save")
        self.wait_sent()
        self.tab("v-pest")
        self.page.dblclick("#btn-pest-save")
        self.wait_sent()
        kinds = [o["record"]["kind"] for o in self.gas.ops() if o.get("action") == "upsert"]
        self.assertEqual(kinds, ["水替え", "農薬"])

    def test_18_シートの方が新しかったら_保存しましたと言わない(self):
        """W1：返事が stale のときは、シートの内容に合わせたことを知らせ、読み直す"""
        self.gas.records = {"a": {"id": "a", "date": "2026-11-01", "time": "08:00", "systemKey": "bato", "system": "BatoBucket", "kind": "日誌",
                                  "memo": "はじめ", "photos": [], "updatedAt": "2026-11-01T00:00:00.000Z", "deleted": False}}
        self.open({})
        # この端末が読んだあとに、別の端末（時計が先の端末）で直された
        self.gas.records["a"]["memo"] = "別の端末で直した"
        self.gas.records["a"]["updatedAt"] = "2099-01-01T00:00:00.000Z"
        self.tab("v-history")
        self.page.click("#history-list .rec [data-act=edit]")
        self.page.fill("#edit-memo", "この端末の文")
        self.page.click("#btn-edit-save")
        expect(self.page.locator("#toast")).to_contain_text("シートの方が新しい")
        expect(self.page.locator("#history-list")).to_contain_text("別の端末で直した")

    def test_19_返事が来ないときは時間切れで未送信にもどる(self):
        """W2：電波が弱くて返事が来なくても「送っています…」で固まらない"""
        self.open({"hydro_v2_timeout_ms": "1200"})
        self.ctx.unroute("**/dummy-gas-endpoint**")
        self.ctx.route("**/dummy-gas-endpoint**", lambda r: None)  # 返事をしない
        self.page.fill("#ec-input", "1.9")
        self.page.click("#btn-save")
        expect(self.page.locator("#sync-text")).to_contain_text("未送信 1件", timeout=5000)
        expect(self.page.locator("#btn-send-now")).to_be_visible()

    def test_20_送る前の写真つき記録を直しても写真が消えない(self):
        """再審査 N1：電波なしで写真つき日誌を保存 → 直す → 送ると、写真の中身が1枚届く。見返しにも送る前から写真が出る"""
        import base64
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEJMDEgAUYGBgYAKDQDAY6aNcgAAAAASUVORK5CYII=")
        self.open({})
        self.gas.down = True
        self.page.click("[data-kind=日誌]")
        self.page.set_input_files("#gal", files=[{"name": "a.png", "mimeType": "image/png", "buffer": png}])
        expect(self.page.locator("#photo-tray .thumb")).to_have_count(1)
        self.page.fill("#input-memo", "はじめ")
        self.page.click("#btn-save")
        expect(self.page.locator("#sync-text")).to_contain_text("未送信 1件")
        self.tab("v-history")
        expect(self.page.locator("#history-list .rec .ph img")).to_have_count(1)
        self.page.click("#history-list .rec [data-act=edit]")
        self.page.fill("#edit-memo", "直した")
        self.page.click("#btn-edit-save")
        expect(self.page.locator("#history-list .rec .ph img")).to_have_count(1)
        self.gas.down = False
        self.page.click("#btn-send-now")
        self.wait_sent()
        r = [o for o in self.gas.ops() if o.get("action") == "upsert"][-1]["record"]
        self.assertEqual(r["memo"], "直した")
        self.assertEqual(len(r["photos"]), 1)
        self.assertTrue(r["photos"][0].startswith("data:image/jpeg"))

    def test_21_古い記録より新しい記録を先に送る(self):
        """再審査 W-a：古い v1.9 の記録が受け取ってもらえなくても、新しい記録は送られる"""
        old = [{"id": f"entry_x{i}", "timestamp": "2026-10-01T00:00:00.000Z", "date": "2026年10月1日", "system": "BatoBucket", "memo": "古い", "photos": []} for i in range(12)]
        real = self.gas.apply
        self.gas.apply = lambda op: {"id": op.get("record", {}).get("id"), "result": "error", "message": "x"} if str(op.get("record", {}).get("id", "")).startswith("entry_x") else real(op)
        self.open({"hydro_timeline_entries": old})
        self.page.fill("#ec-input", "1.9")
        self.page.click("#btn-save")
        self.page.wait_for_timeout(800)
        sent_new = [o for o in self.gas.ops() if o.get("action") == "upsert" and o["record"]["id"].startswith("rec_")]
        self.assertEqual(len(sent_new), 1)

    # 時刻を変えて開き直す（test_05 用）
    def setUp_when(self, when):
        self.ctx.close()
        self.setUp(when)


if __name__ == "__main__":
    unittest.main()
