"""全部のテスト（v2 画面 ＋ PCの10年日記）。GAS は別に `node --test tests/gas/gas_contract.test.js`
v1.9 の画面用テストは tests/削除してよい_v1/ に移した（2026-11-08。画面を作り直したため）
"""
import unittest
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from test_v2_e2e import HydroDailyV2Test
from test_v2_real_gas import RealGasTest
from test_dashboard_10year_e2e import Dashboard10YearE2ETest


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(HydroDailyV2Test))
    suite.addTests(loader.loadTestsFromTestCase(RealGasTest))  # 画面 → 本物の Code.gs の通し
    suite.addTests(loader.loadTestsFromTestCase(Dashboard10YearE2ETest))
    return suite


if __name__ == '__main__':
    unittest.main()
