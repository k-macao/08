"""不安装 OCR 模型也能运行：python3 -m unittest discover -s test -p 'test_*.py'"""
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('video_ocr', Path(__file__).resolve().parents[1] / 'tools/video_ocr.py')
ocr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ocr)


class VideoOCRTests(unittest.TestCase):
    def test_adjacent_text_merges(self):
        self.assertEqual(ocr.merge_segments([(0, ['上涨']), (2, ['上涨'])], 2),
                         [{'start': 0, 'end': 4, 'text': '上涨'}])

    def test_blank_frame_breaks_segment(self):
        self.assertEqual(len(ocr.merge_segments([(0, ['上涨']), (2, []), (4, ['上涨'])], 2)), 2)

    def test_missing_frame_breaks_segment(self):
        self.assertEqual(len(ocr.merge_segments([(0, ['上涨']), (4, ['上涨'])], 2)), 2)

    def test_invalid_cli_numbers_rejected_before_dependency_import(self):
        for option, value in [('--interval', '0'), ('--interval', '-1'), ('--interval', 'nan'),
                              ('--interval', 'inf'), ('--min-score', '2'), ('--min-score', '-1')]:
            with self.subTest(option=option, value=value), patch.object(sys, 'argv', ['video_ocr.py', 'x.mp4', option, value]):
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as exc:
                    ocr.main()
                self.assertEqual(exc.exception.code, 2)

    def test_download_logs_do_not_pollute_json_stdout(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'video.mp4').touch()
            with patch.object(ocr.shutil, 'which', return_value='/bin/yt-dlp'), patch.object(ocr.subprocess, 'run') as run:
                self.assertEqual(ocr.download_video('https://www.youtube.com/watch?v=abcdefghijk', tmp), str(Path(tmp, 'video.mp4')))
                self.assertIs(run.call_args.kwargs['stdout'], sys.stderr)

    def test_partial_download_is_not_a_video(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'video.mp4.part').touch()
            with patch.object(ocr.subprocess, 'run'), self.assertRaises(SystemExit):
                ocr.download_video('https://www.youtube.com/watch?v=abcdefghijk', tmp)


if __name__ == '__main__':
    unittest.main()
