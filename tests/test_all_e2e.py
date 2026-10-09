import unittest
import sys
import os

# Ensure tests directory is in sys.path
sys.path.insert(0, os.path.dirname(__file__))

from test_hydrodaily_e2e import HydroDailyE2ETest
from test_diary_views_e2e import DiaryViewsE2ETest
from test_timeline_camera_e2e import TimelineCameraE2ETest

def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(HydroDailyE2ETest))
    suite.addTests(loader.loadTestsFromTestCase(DiaryViewsE2ETest))
    suite.addTests(loader.loadTestsFromTestCase(TimelineCameraE2ETest))
    return suite

if __name__ == '__main__':
    unittest.main()
