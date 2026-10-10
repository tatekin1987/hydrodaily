import unittest
import sys
import os

# Ensure tests directory is in sys.path
sys.path.insert(0, os.path.dirname(__file__))

from test_hydrodaily_e2e import HydroDailyE2ETest
from test_diary_views_e2e import DiaryViewsE2ETest
from test_timeline_camera_e2e import TimelineCameraE2ETest
from test_edit_lightbox_status_e2e import EditLightboxStatusE2ETest
from test_timeline_sync_e2e import TimelineSyncE2ETest
from test_journal_delete_e2e import JournalDeleteE2ETest
from test_dashboard_10year_e2e import Dashboard10YearE2ETest

def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(HydroDailyE2ETest))
    suite.addTests(loader.loadTestsFromTestCase(DiaryViewsE2ETest))
    suite.addTests(loader.loadTestsFromTestCase(TimelineCameraE2ETest))
    suite.addTests(loader.loadTestsFromTestCase(EditLightboxStatusE2ETest))
    suite.addTests(loader.loadTestsFromTestCase(TimelineSyncE2ETest))
    suite.addTests(loader.loadTestsFromTestCase(JournalDeleteE2ETest))
    suite.addTests(loader.loadTestsFromTestCase(Dashboard10YearE2ETest))
    return suite

if __name__ == '__main__':
    unittest.main()
