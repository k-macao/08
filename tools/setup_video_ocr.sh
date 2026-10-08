#!/usr/bin/env bash
# RapidOCR 1.x 间接依赖 GUI 版 OpenCV；两种 cv2 wheel 不能共存。
# 在隔离的虚拟环境安装后仅保留 headless，避免服务器缺少 libGL.so.1。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/.venv"
python3 -m venv "$VENV"
PY="$VENV/bin/python"
"$PY" -m pip install -r "$ROOT/tools/requirements-video-ocr.txt"
"$PY" -m pip uninstall -y opencv-python opencv-python-headless
"$PY" -m pip install 'opencv-python-headless>=4.8,<5'
"$PY" - <<'PY'
import cv2
import imageio_ffmpeg
from rapidocr_onnxruntime import RapidOCR
print('OCR 依赖导入成功；ffmpeg:', imageio_ffmpeg.get_ffmpeg_exe())
PY
printf '\n使用：%s tools/video_ocr.py ./video.mp4 -o result.md\n' "$PY"
