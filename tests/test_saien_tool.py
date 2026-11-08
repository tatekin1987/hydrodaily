"""AI連携の道具（AI共通/skills/saien-soudan/scripts/saien.py）の試験。にせものの GAS を相手にする
動かし方：PYTHONUTF8=1 py -3.13 -m unittest tests.test_saien_tool
"""
import importlib.util
import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

TOOL = Path.home() / "AI共通" / "skills" / "saien-soudan" / "scripts" / "saien.py"
spec = importlib.util.spec_from_file_location("saien", TOOL)
saien = importlib.util.module_from_spec(spec)
spec.loader.exec_module(saien)


class Fake:
    posts = []
    token = ""
    log = []
    records = [
        {"id": "a", "date": "2026-11-05", "time": "08:00", "kind": "液肥", "system": "タワー型", "systemKey": "tower", "ec": 1.7, "ph": 6.1, "temp": "", "addedMl": 20, "memo": "葉が少し黄色い", "deleted": False},
        {"id": "b", "date": "2026-10-20", "time": "08:00", "kind": "農薬", "system": "タワー型", "systemKey": "tower", "pestName": "ゼンターリ顆粒水和剤", "memo": "", "deleted": False},
        {"id": "c", "date": "2026-11-01", "time": "08:00", "kind": "液肥", "system": "BatoBucket", "systemKey": "bato", "ec": 2.1, "memo": "", "deleted": True},
    ]
    plans = [
        {"id": "p1", "year": 2026, "month": 11, "timing": "中旬", "system": "全体", "systemKey": "", "work": "植え付け", "details": "スナックエンドウ", "doneDate": "", "status": "予定", "deleted": False},
        {"id": "p0", "year": 2025, "month": 11, "timing": "上旬", "system": "全体", "systemKey": "", "work": "種まき", "details": "去年のそら豆", "doneDate": "2025-11-05", "status": "予定", "deleted": False},
        {"id": "ai", "year": 2026, "month": 12, "timing": "上旬", "system": "全体", "systemKey": "", "work": "見直し", "details": "前の提案", "doneDate": "", "status": "提案", "deleted": False},
    ]


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, d):
        b = json.dumps(d, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        a = parse_qs(urlparse(self.path).query).get("action", [""])[0]
        if a == "get_records":
            self.send({"status": "success", "records": [r for r in Fake.records if not r["deleted"]]})
        elif a == "get_plans":
            self.send({"status": "success", "plans": Fake.plans})
        elif a == "get_settings":
            self.send({"status": "success", "settings": {"目標EC_tower": "2.0", "作物_tower": "スティックセニョール"},
                       "pesticides": [{"name": "ゼンターリ顆粒水和剤", "dilution": 1000, "maxUses": 2, "preharvestDays": 1}],
                       "sprayCounts": {"tower|ゼンターリ顆粒水和剤": 1}})
        elif a == "get_ai_log":
            self.send({"status": "success", "log": Fake.log})
        elif a == "get_today":
            self.send({"status": "success", "items": [{"title": "タワー型：ECを測る日です", "detail": "前回 11/5"}]})
        else:
            self.send({"status": "error", "message": "?"})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])).decode("utf-8"))
        Fake.posts.append(body)
        if Fake.token and body.get("token") != Fake.token:
            return self.send({"status": "error", "message": "合言葉がちがう"})
        res = []
        for o in body["ops"]:
            if o["action"] == "ai_save_plan":
                res.append({"id": o["plan"]["id"], "result": "updated"})
            elif o["action"] == "save_pest":
                res.append({"id": "pest_x", "result": "saved"})
            else:
                res.append({"id": o["plan"]["id"], "result": "saved"})
        self.send({"status": "success", "results": res})


class SaienToolTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def setUp(self):
        Fake.posts, Fake.token, Fake.log = [], "", []
        self.env = dict(os.environ)
        os.environ["HYDRO_GAS_URL"] = f"http://127.0.0.1:{self.httpd.server_port}/exec"
        os.environ["HYDRO_TODAY"] = "2026-11-08"
        os.environ.pop("HYDRO_WRITE_TOKEN", None)
        self.tmp = Path(os.environ.get("TEMP", ".")) / "saien_test"
        self.tmp.mkdir(exist_ok=True)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.env)

    def write_plan(self, items):
        f = self.tmp / "plan.json"
        f.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
        return str(f)

    def test_1_まとめに記録_農薬の回数_予定_去年の同じころが入り_消した記録は出ない(self):
        text = saien.build_context()
        self.assertIn("EC 1.7／pH 6.1／追肥mL 20", text)
        self.assertIn("ゼンターリ顆粒水和剤 1 回／上限 2 回", text)
        self.assertIn("スナックエンドウ", text)
        self.assertIn("去年のそら豆", text)
        self.assertIn("前の提案", text)
        self.assertIn("葉が少し黄色い", text)
        self.assertIn("ECを測る日です", text)
        self.assertNotIn("EC 2.1", text)

    def test_2_go_なしでは書かない(self):
        msg = saien.propose(self.write_plan([{"year": 2026, "month": 11, "timing": "下旬", "system": "tower", "work": "追肥", "details": "EC 2.0 まで"}]), go=False)
        self.assertIn("まだ書いていません", msg)
        self.assertEqual(Fake.posts, [])

    def test_3_go_で状態は提案として書く(self):
        saien.propose(self.write_plan([{"year": 2026, "month": 11, "timing": "下旬", "system": "tower", "work": "追肥", "details": "EC 2.0 まで"}]), go=True)
        p = Fake.posts[0]["ops"][0]["plan"]
        self.assertEqual((p["status"], p["system"], p["systemKey"], p["doneDate"]), ("提案", "タワー型", "tower", ""))
        self.assertTrue(p["id"].startswith("ai_"))
        self.assertEqual(Fake.posts[0]["ops"][0]["action"], "save_plan")

    def test_4_おかしな案は送らずに止める(self):
        bad = [
            [{"year": 2026, "month": 13, "timing": "上旬", "work": "追肥"}],
            [{"year": 2026, "month": 11, "timing": "そのうち", "work": "追肥"}],
            [{"year": 2026, "month": 11, "timing": "上旬", "work": "記録を消す"}],
            [{"year": 2026, "month": 11, "timing": "上旬", "work": "追肥", "system": "garden"}],
            [{"year": 2026, "month": 10, "timing": "下旬", "work": "追肥"}],
            [{"year": 2026, "month": 12, "timing": "上旬", "work": "追肥"}] * 6,
            [],
        ]
        for items in bad:
            with self.assertRaises(ValueError):
                saien.propose(self.write_plan(items), go=True)
        self.assertEqual(Fake.posts, [])

    def test_5_合言葉は送るときに付き_ちがえばエラー(self):
        Fake.token = "abc"
        os.environ["HYDRO_WRITE_TOKEN"] = "abc"
        saien.propose(self.write_plan([{"timing": "2026-11-20", "work": "見直し"}]), go=True)
        self.assertEqual(Fake.posts[-1]["token"], "abc")
        os.environ["HYDRO_WRITE_TOKEN"] = "xyz"
        with self.assertRaises(RuntimeError):
            saien.propose(self.write_plan([{"timing": "2026-11-20", "work": "見直し"}]), go=True)

    def test_6_道具は記録を書く送り名を持たない(self):
        src = TOOL.read_text(encoding="utf-8")
        for a in ("upsert", "delete_plan", "'delete'", '"delete"', "save_record", "journal"):
            self.assertNotIn(a, src)

    def test_7_まとめに予定のidが出る(self):
        text = saien.build_context()
        self.assertIn("［id p1］", text)

    def test_8_予定を直す_go_なしでは書かず_go_で前後を見せて書き換える(self):
        f = self.write_plan([{"id": "p1", "timing": "下旬", "details": "スナックエンドウ（遅らせる）"}])
        msg = saien.edit(f, go=False)
        self.assertIn("→", msg)
        self.assertEqual(Fake.posts, [])
        saien.edit(f, go=True)
        op = Fake.posts[0]["ops"][0]
        self.assertEqual(op["action"], "ai_save_plan")
        self.assertEqual((op["plan"]["timing"], op["plan"]["year"], op["plan"]["month"], op["plan"]["work"], op["plan"]["status"]),
                         ("下旬", 2026, 11, "植え付け", "予定"))

    def test_9_済にする_と_済をはずす(self):
        saien.edit(self.write_plan([{"id": "p1", "done": True}]), go=True)
        self.assertEqual(Fake.posts[-1]["ops"][0]["plan"]["doneDate"], "2026-11-08")
        saien.edit(self.write_plan([{"id": "p0", "done": False}]), go=True)
        self.assertEqual(Fake.posts[-1]["ops"][0]["plan"]["doneDate"], "")

    def test_10_直せないもの_無いid_消す_知らない項目は止める(self):
        for items in ([{"id": "nai", "timing": "下旬"}], [{"id": "p1", "deleted": True}], [{"id": "p1", "status": "提案"}],
                      [{"id": "p1", "timing": "そのうち"}], [{"id": "p1", "work": "削除"}]):
            with self.assertRaises(ValueError):
                saien.edit(self.write_plan(items), go=True)
        self.assertEqual(Fake.posts, [])

    def test_11_くすりを足す_同じ名前や倍率なしは止める(self):
        f = self.write_plan([{"name": "テスト乳剤", "dilution": 2000, "unit": "mL", "maxUses": 3, "preharvestDays": 14}])
        self.assertIn("まだ書いていません", saien.pest(f, go=False))
        saien.pest(f, go=True)
        op = Fake.posts[0]["ops"][0]
        self.assertEqual((op["action"], op["pest"]["name"], op["pest"]["dilution"], op["pest"]["maxUses"]), ("save_pest", "テスト乳剤", 2000, 3))
        for items in ([{"name": "ゼンターリ顆粒水和剤", "dilution": 1000}], [{"name": "倍率なし"}], [{"name": "x", "dilution": 100, "unit": "L"}]):
            with self.assertRaises(ValueError):
                saien.pest(self.write_plan(items), go=True)
        self.assertEqual(len(Fake.posts), 1)

    def test_12_変更記録から元に戻す(self):
        before = dict(Fake.plans[0])
        Fake.log = [{"time": "2026-11-08T01:00:00.000Z", "kind": "予定を直す", "id": "p1", "before": before, "after": dict(before, timing="下旬")}]
        self.assertIn("予定を直す", saien.ai_log())
        self.assertIn("まだ書いていません", saien.undo("p1", go=False))
        saien.undo("p1", go=True)
        op = Fake.posts[0]["ops"][0]
        self.assertEqual((op["action"], op["plan"]["timing"]), ("ai_save_plan", "中旬"))
        with self.assertRaises(ValueError):
            saien.undo("nai", go=True)


if __name__ == "__main__":
    unittest.main()
