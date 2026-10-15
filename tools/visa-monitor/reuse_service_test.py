import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import os
import sys

spec = importlib.util.spec_from_file_location('reuse_service', Path(__file__).with_name('reuse-service.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Tests(unittest.TestCase):
    def test_memory_counts_resident_and_kernel_separately_from_clean_cache(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p/'memory.max').write_text('536870912')
            (p/'memory.stat').write_text('anon 104857600\nkernel 10485760\nfile 200000000\n')
            (p/'memory.current').write_text('315343360')
            self.assertEqual(m.memory_usage(p)['resident_bytes'], 115343360)

    def check_guard(self, readings, command, seconds, expected):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            original=m.memory_usage
            iterator=iter(readings)
            m.memory_usage=lambda: {'resident_bytes': next(iterator,readings[-1])*1048576, 'current_bytes':300*1048576,'limit_bytes':512*1048576}
            try:
                with patch.object(m.os, 'setpriority', return_value=None), self.assertRaises(RuntimeError):
                    m.guarded(command, os.environ.copy(), p/'log', p/'result.json', seconds, check_health=False)
                if expected:
                    self.assertIn(expected,(p/'result.json').read_text())
            finally:
                m.memory_usage=original

    def test_insufficient_headroom_refuses_to_start(self):
        self.check_guard([380],[sys.executable,'-c','print("should not run")'],2,None)

    def test_memory_guard_terminates_only_its_child(self):
        self.check_guard([100,420],[sys.executable,'-c','import time; time.sleep(5)'],5,'memory_guard')

    def test_runtime_limit_terminates_child(self):
        self.check_guard([100],[sys.executable,'-c','import time; time.sleep(5)'],0,'supervisor_time_limit')


unittest.main()
